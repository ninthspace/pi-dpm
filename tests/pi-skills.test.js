/**
 * Skills under pi — the host-registry probe, the commands, per-skill activation and the session id.
 * Spec §6.3, §7.1 and §9.2: R10–R14, T5–T6.
 *
 * **The probe is `get_commands` over RPC**, which is pi's answer to `opencode debug skill`. Every
 * loaded skill appears as `skill:<name>` with the file it came from, so the host's own registry can
 * be compared with the directory rather than with a count.
 *
 * **Activation is asserted on the request pi sends**, not on what `setActiveTools` was called with.
 * pi silently ignores a name that is not registered, so the call and the request can disagree, and
 * only the request is what the model sees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PREFIX } from '../extensions/dpm/adapter.ts';
import { COMPLETIONS, completionsFor, skillMessage } from '../extensions/dpm/commands.ts';
import { GATE } from '../extensions/dpm/gate.ts';
import { HANDOFF } from '../extensions/dpm/handoff.ts';
import { narrowed, skillInvoked } from '../extensions/dpm/activation.ts';
import { allowances } from '../src/plugin/allowlist.ts';
import { announcement } from '../src/plugin/session-id.ts';
import { discoverSkills } from '../src/plugin/skills.ts';
import { advertisedTools } from '../src/server/index.ts';
import {
  answers, limitFor, listCommands, ROOT, runPrompt, scratchProject, scriptedModel, SKILLS, textOf, toolsSent,
} from './support/pi.js';

const derived = allowances(ROOT);
const registered = new Set(advertisedTools().map((tool) => `${PREFIX}${tool.name}`));

/** The skills directory as a listing — what the host's registry is compared against. */
const onDisk = () => readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

/** A probe run: project settings honoured (`--approve`), nothing else discovered, no extension. */
const PROBE = [
  '--no-session', '--approve', '--no-extensions', '--no-prompt-templates', '--no-themes', '--no-context-files',
  '--provider', 'scripted', '--model', 'scripted',
];

/** The dpm skills in a `get_commands` listing, by bare name. */
const dpmSkills = (commands) => commands
  .filter((command) => command.source === 'skill' && command.name.startsWith('skill:dpm-'))
  .map((command) => command.name.slice('skill:'.length))
  .sort();

/** Every user-role text in a recorded request, joined. */
const userText = (request) => request.messages
  .filter((message) => message.role === 'user')
  .map((message) => textOf(message.content))
  .join('\n');

// --- T5, T6: the host registry ----------------------------------------------------------------------

test('a project whose settings point skills at the checkout has every dpm skill in pi\'s registry (T5) [integration]', limitFor(), async (t) => {
  const scratch = scratchProject(t, 'http://127.0.0.1:9/v1', { settings: { skills: [SKILLS] } });
  const commands = await listCommands(scratch, PROBE);
  const listed = onDisk();

  assert.ok(listed.length > 20, `the skills directory lists ${listed.length}, so the comparison is not dpm's`);
  assert.deepEqual(dpmSkills(commands), listed, 'pi\'s registry and the skills directory disagree');

  // `sourceInfo.path` in 0.85.1 — `docs/rpc.md` still shows a top-level `path`, which is not sent.
  for (const command of commands.filter((entry) => entry.name.startsWith('skill:dpm-'))) {
    const path = command.sourceInfo?.path ?? '';

    assert.ok(path.startsWith(`${SKILLS}/`), `${command.name} came from "${path}", not the checkout`);
  }
});

test('control: the same project with no skills key has no dpm skill in pi\'s registry (T6) [integration]', limitFor(), async (t) => {
  const scratch = scratchProject(t, 'http://127.0.0.1:9/v1', { settings: {} });

  assert.deepEqual(dpmSkills(await listCommands(scratch, PROBE)), [],
    'dpm skills were found with nothing pointing at them, so T5 cannot fail');
});

// --- R13, R14: activation ---------------------------------------------------------------------------

test('every tool a skill is allowed is a registered one, so the request can match the allowance', () => {
  for (const [skill, tools] of Object.entries(derived)) {
    assert.deepEqual(tools.filter((tool) => !registered.has(tool)), [],
      `${skill} names tools pi would silently drop from its active set`);
  }
});

test('narrowing replaces dpm\'s tools and keeps everything else', () => {
  assert.deepEqual(
    narrowed(['read', 'dpm_list_spec', GATE, 'dpm_read_spec', 'other_tool'], ['dpm_create_spec']),
    ['read', GATE, 'other_tool', 'dpm_create_spec'],
  );
  assert.equal(skillInvoked('/skill:dpm-spec'), 'dpm-spec');
  assert.equal(skillInvoked('/skill:dpm-retro learn'), 'dpm-retro');
  assert.equal(skillInvoked('please run /skill:dpm-spec'), null);
  assert.equal(skillInvoked('/dpm-spec'), null);
});

/**
 * R11 and R14 in one run pair: `/dpm-spec` and `/skill:dpm-spec` put the same tools in the request,
 * and that set is the OpenCode allow-list's for the skill, plus the gate.
 */
test('/dpm-spec and /skill:dpm-spec send the same tools, and they are the OpenCode allow-list plus the gate [integration]', limitFor(2), async (t) => {
  const run = async (message) => {
    const model = await scriptedModel(t, [answers('ok')]);
    const scratch = scratchProject(t, model.baseUrl);
    const outcome = await runPrompt(scratch, message, { args: ['--skill', SKILLS] });

    assert.deepEqual(outcome.errors, [], `${message} raised an extension error`);
    assert.equal(model.requests.length, 1, `${message} made ${model.requests.length} requests`);

    return { request: model.requests[0], state: outcome.state };
  };

  const command = await run('/dpm-spec FR scope only');
  const skill = await run('/skill:dpm-spec FR scope only');

  const expected = [...derived['dpm-spec'], GATE, HANDOFF].sort();

  assert.ok(expected.length < registered.size / 2, 'the allowance is not narrowing anything');
  assert.deepEqual(toolsSent(command.request), expected, '/dpm-spec is not at parity with the OpenCode allow-list');
  assert.deepEqual(toolsSent(skill.request), expected, '/skill:dpm-spec differs from /dpm-spec (R11)');

  for (const { request, state } of [command, skill]) {
    const text = userText(request);

    assert.ok(text.includes('<skill name="dpm-spec"'), 'the skill body was not expanded into the turn');
    assert.ok(text.includes('FR scope only'), 'the arguments were lost on the way');

    // R12: the id is the session's own, said once.
    assert.equal(text.split(announcement(state.sessionId)).length - 1, 1,
      'the turn does not carry the session id announcement exactly once');
  }
});

test('control: a prompt that runs no skill keeps every dpm tool and carries no announcement [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [answers('ok')]);
  const scratch = scratchProject(t, model.baseUrl);

  await runPrompt(scratch, 'What is dpm-spec for?', { args: ['--skill', SKILLS] });

  assert.deepEqual(toolsSent(model.requests[0]), [...registered, GATE, HANDOFF].sort());
  assert.equal(userText(model.requests[0]).includes('harness session id'), false,
    'a turn that opened no dpm skill was told about dpm sessions');
});

test('a /dpm-* command with no skill behind it fails loudly and sends the model nothing [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [answers('ok')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { errors, refusals } = await runPrompt(scratch, '/dpm-spec');
  const reported = [...errors.map((error) => error.error), ...refusals.map((refusal) => refusal.error)].join('\n');

  assert.match(reported, /\/dpm-spec has no skill behind it/, 'the missing skill was not reported');
  assert.equal(model.requests.length, 0, 'the literal command text was sent to the model');
});

// --- R10: completions -------------------------------------------------------------------------------

test('each completion is a mode its skill\'s body names, and only those complete (R10)', () => {
  const skills = new Map(discoverSkills(ROOT).map((skill) => [skill.name, skill.content]));

  for (const [skill, modes] of Object.entries(COMPLETIONS)) {
    assert.ok(skills.has(skill), `${skill} has completions but is not a skill`);
    for (const mode of modes) {
      assert.ok(skills.get(skill).includes(`**\`${mode}\`**`), `${skill}'s body no longer names the mode ${mode}`);
    }
  }

  assert.deepEqual(completionsFor('dpm-retro')('re'), [{ value: 'retire', label: 'retire' }]);
  assert.equal(completionsFor('dpm-retro')('x'), null);
  assert.equal(completionsFor('dpm-spec'), undefined);
  assert.equal(skillMessage('dpm-retro', '  learn '), '/skill:dpm-retro learn');
  assert.equal(skillMessage('dpm-spec', ''), '/skill:dpm-spec');
});
