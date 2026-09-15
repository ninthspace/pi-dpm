/**
 * Thinking per skill under pi — each skill's declared level and steps, the guard on `phase`, and the
 * level that reaches every request of the run.
 *
 * **The level is asserted on the request pi sends.** The scripted model is a reasoning one with the
 * `qwen` thinking format, so every request carries `enable_thinking`, and `reasoning_effort` when
 * thinking is on. What `setThinkingLevel` was called with is not the evidence; what the model was
 * asked for is.
 *
 * **pi starts at `low`, so the skill's level can be seen.** `dpm-spec` runs at `medium`, which is
 * also pi's default; the control shows the same `--thinking low` run asking for `low` when no skill
 * is running.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { choiceFor, GATE } from '../extensions/dpm/gate.ts';
import { FINAL, LEVELS, MOVES, phaseNote, planFor, plans, reminder } from '../extensions/dpm/phases.ts';
import { discoverSkills } from '../src/plugin/skills.ts';
import {
  answers, callsTool, limitFor, ROOT, runPrompt, scratchProject, scriptedModel, SKILLS, textOf, toolResults,
} from './support/pi.js';

const skills = discoverSkills(ROOT);
const declared = plans(skills);

/** The level pi starts at when no skill sets one, chosen to differ from `dpm-spec`'s. */
const PROJECT_LEVEL = 'low';
const args = ['--skill', SKILLS, '--thinking', PROJECT_LEVEL];

/** A skill as `planFor` reads it, from front matter lines. */
const skill = (...lines) => ({ name: 'dpm-x', content: `---\nname: dpm-x\n${lines.join('\n')}\n---\n\n# Body\n` });

/** Every user-role text in a recorded request, joined. */
const userText = (request) => request.messages
  .filter((message) => message.role === 'user')
  .map((message) => textOf(message.content))
  .join('\n');

/** The thinking a request asked for: `off`, or the effort it named. */
const thinkingOf = (request) => (request.enable_thinking ? request.reasoning_effort : 'off');

// --- The declarations -------------------------------------------------------------------------------

test('every skill in the tree declares its level, and every declaration parses', () => {
  assert.ok(skills.length > 20, `discovery found ${skills.length} skills, so this is not dpm's tree`);
  assert.deepEqual(Object.keys(declared).sort(), skills.map((entry) => entry.name).sort(),
    'a skill with no declaration runs at whatever level the last one left');

  for (const [name, plan] of Object.entries(declared)) {
    assert.ok(LEVELS.includes(plan.level), `${name} has level ${plan.level}`);

    for (const id of plan.phases) assert.match(id, /^[a-z][a-z-]*$/, `${name} phase "${id}" is not a plain id`);
  }
});

test('a skill declares one level and optionally its step ids; malformed declarations are refused', () => {
  assert.deepEqual(planFor(skill('thinking: high', 'phases: recap decisions')), {
    level: 'high', phases: ['recap', 'decisions'],
  });
  assert.deepEqual(planFor(skill('thinking: medium')), { level: 'medium', phases: [] });
  assert.equal(planFor(skill()), null);

  assert.throws(() => planFor(skill('thinking: loud')), /"loud" is not a thinking level/);
  assert.throws(() => planFor(skill('phases: recap decisions')), /declares phases and no thinking level/);
  assert.throws(() => planFor(skill('thinking: off', 'phases: recap:off decisions:high')), /phase "recap:off" carries a level/);
  assert.throws(() => planFor(skill('thinking: off', 'phases: recap recap')), /phase ids repeat \(recap\)/);
  assert.throws(() => planFor(skill('thinking: off', 'phases: recap complete')), /"complete" is every skill's final phase/);
});

test('the note names the ids in order, and a skill with no steps has none', () => {
  assert.match(phaseNote(declared['dpm-spec']), /phases, in order: recap, functional, nonfunctional, /);
  assert.match(phaseNote(declared['dpm-spec']), /review, then `complete` when the run is finished/);
  assert.equal(phaseNote(declared['dpm-status']), null);
});

test('an answered gate is reminded of the phase it is in and the one after it', () => {
  const plan = planFor(skill('thinking: medium', 'phases: recap decisions review'));

  assert.match(reminder(plan, null), /none recorded in this run yet.*recap or a later one/);
  assert.match(reminder(plan, 'recap'), /Phase: `recap`\. If this answer closes that step, call dpm_update_session with phase `decisions`/);
  assert.match(reminder(plan, 'review'), /Phase: `review`, the last\. .*phase `complete`/);
  assert.equal(reminder(plan, FINAL), null, 'a finished run is still being reminded');
  assert.equal(reminder(planFor(skill('thinking: low')), null), null, 'a skill with no steps is reminded of steps');
});

// --- Under pi ---------------------------------------------------------------------------------------

/**
 * One run of `/skill:dpm-spec` that passes a heading, then an id.
 *
 * Every request is at the skill's level, from the turn it opens on: the level is set once, and a
 * recorded phase does not move it, since a change of level mid-run costs a cached prompt.
 */
test('a phase the skill does not declare is refused with the list, and every request is at the skill\'s level [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [
    callsTool(MOVES[0], { id: 'phase-test', skill: 'dpm:spec', phase: 'Section 4' }),
    callsTool(MOVES[0], { id: 'phase-test', skill: 'dpm:spec', phase: 'decisions' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl, { reasoning: true });
  const { messages, errors } = await runPrompt(scratch, '/skill:dpm-spec', { args });

  assert.deepEqual(errors, [], 'the run raised an extension error');
  assert.equal(model.requests.length, 3, `the scripted model was asked ${model.requests.length} times`);

  const [refused, recorded] = toolResults(messages);

  assert.equal(refused.isError, true, 'a heading was accepted as a phase');
  assert.match(textOf(refused.content), /"Section 4" is not a phase of dpm-spec, so nothing was recorded/);
  assert.match(textOf(refused.content), /recap, functional, .*, review, then `complete` when the run is finished\./);
  assert.equal(recorded.isError, false, `the declared phase was refused: ${textOf(recorded.content)}`);

  const { level } = declared['dpm-spec'];

  assert.notEqual(level, PROJECT_LEVEL, 'the skill\'s level is the project\'s, so setting it could not be seen');
  assert.deepEqual(model.requests.map(thinkingOf), [level, level, level],
    'a request was not at the skill\'s level');

  assert.ok(userText(model.requests[0]).includes(phaseNote(declared['dpm-spec'])),
    'the turn the skill opened on was not told its phase ids');
});

/** The reminder and `complete`, in one run: a phase is recorded, a gate is answered and carries the reminder, and `complete` is accepted. */
test('an answered gate carries the phase reminder, and complete is accepted [integration]', limitFor(), async (t) => {
  const gate = {
    question: 'Approve the decisions?', header: 'Decisions',
    options: [{ label: 'Approve', description: 'Record them.' }, { label: 'Stop', description: 'End here.' }],
  };
  const model = await scriptedModel(t, [
    callsTool(MOVES[0], { id: 'phase-reminder', skill: 'dpm:spec', phase: 'decisions' }),
    callsTool(GATE, { questions: [gate] }, 'Here are the decisions:\n\n- ADR 1 — one static binary.'),
    callsTool(MOVES[1], { id: 'phase-reminder', phase: FINAL }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl, { reasoning: true });
  const { messages, errors } = await runPrompt(scratch, '/skill:dpm-spec', {
    args,
    answer: () => ({ value: choiceFor(gate.options[0]) }),
  });

  assert.deepEqual(errors, [], 'the run raised an extension error');

  const [created, answered, completed] = toolResults(messages);

  assert.equal(created.isError, false, textOf(created.content));
  assert.equal(answered.isError, false, textOf(answered.content));
  assert.match(textOf(answered.content), /"Approve the decisions\?"="Approve/, 'the reminder replaced the answer');
  assert.match(textOf(answered.content), /Phase: `decisions`\. If this answer closes that step, call dpm_update_session with phase `scope`/);
  assert.equal(completed.isError, false, `complete was refused: ${textOf(completed.content)}`);

  const { level } = declared['dpm-spec'];

  assert.deepEqual(model.requests.map(thinkingOf), [level, level, level, level], 'the level moved during the run');
});

test('control: with no skill running, a session call carries any phase and the project\'s level is used [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [
    callsTool(MOVES[0], { id: 'phase-control', skill: 'dpm:spec', phase: 'Section 4' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl, { reasoning: true });
  const { messages } = await runPrompt(scratch, 'Record a session.', { args });

  const [result] = toolResults(messages);

  assert.equal(result.isError, false, `a phase was refused outside a skill: ${textOf(result.content)}`);
  assert.deepEqual(model.requests.map(thinkingOf), [PROJECT_LEVEL, PROJECT_LEVEL], 'the project\'s level was not used');
});
