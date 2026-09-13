/**
 * Per-step thinking under pi — each skill's declared steps, the guard on `phase`, and the level that
 * reaches the next request.
 *
 * **The level is asserted on the request pi sends.** The scripted model is a reasoning one with the
 * `qwen` thinking format, so every request carries `enable_thinking`, and `reasoning_effort` when
 * thinking is on. What `setThinkingLevel` was called with is not the evidence; what the model was
 * asked for is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS, MOVES, phaseNote, planFor, plans, START } from '../extensions/dpm/phases.ts';
import { discoverSkills } from '../src/plugin/skills.ts';
import {
  answers, callsTool, limitFor, ROOT, runPrompt, scratchProject, scriptedModel, SKILLS, textOf, toolResults,
} from './support/pi.js';

const skills = discoverSkills(ROOT);
const declared = plans(skills);

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

test('every skill in the tree declares its steps or its one level, and every declaration parses', () => {
  assert.ok(skills.length > 20, `discovery found ${skills.length} skills, so this is not dpm's tree`);
  assert.deepEqual(Object.keys(declared).sort(), skills.map((entry) => entry.name).sort(),
    'a skill with no declaration runs at whatever level the last one left');

  for (const [name, plan] of Object.entries(declared)) {
    for (const phase of plan.phases) {
      assert.ok(LEVELS.includes(phase.level), `${name} phase ${phase.id} has level ${phase.level}`);
      assert.match(phase.id, /^[a-z][a-z-]*$/, `${name} phase "${phase.id}" is not a plain id`);
    }
  }
});

test('a phased skill starts off and a thinking skill starts at its level; malformed declarations are refused', () => {
  assert.deepEqual(planFor(skill('phases: recap:off decisions:high')), {
    start: START, phases: [{ id: 'recap', level: 'off' }, { id: 'decisions', level: 'high' }],
  });
  assert.deepEqual(planFor(skill('thinking: medium')), { start: 'medium', phases: [] });
  assert.equal(planFor(skill()), null);

  assert.throws(() => planFor(skill('phases: recap:loud')), /"loud" is not a thinking level/);
  assert.throws(() => planFor(skill('phases: recap')), /not written as id:level/);
  assert.throws(() => planFor(skill('phases: recap:off recap:high')), /phase ids repeat \(recap\)/);
  assert.throws(() => planFor(skill('phases: recap:off', 'thinking: low')), /declares both/);
  assert.throws(() => planFor(skill('thinking: loud')), /"loud" is not a thinking level/);
});

test('the note names the ids in order, and a skill with no steps has none', () => {
  assert.match(phaseNote(declared['dpm-spec']), /phases, in order: recap, functional, nonfunctional, /);
  assert.equal(phaseNote(declared['dpm-status']), null);
});

// --- Under pi ---------------------------------------------------------------------------------------

/**
 * One run of `/skill:dpm-spec` that passes a heading, then an id.
 *
 * Request 1 is the turn the skill opens on, at `START`. The heading is refused, so request 2 is
 * still at `START`. The id is accepted and recorded, so request 3 carries that step's level.
 */
test('a phase the skill does not declare is refused with the list, and a declared one sets the next request\'s level [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [
    callsTool(MOVES[0], { id: 'phase-test', skill: 'dpm:spec', phase: 'Section 4' }),
    callsTool(MOVES[0], { id: 'phase-test', skill: 'dpm:spec', phase: 'decisions' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl, { reasoning: true });
  const { messages, errors } = await runPrompt(scratch, '/skill:dpm-spec', { args: ['--skill', SKILLS] });

  assert.deepEqual(errors, [], 'the run raised an extension error');
  assert.equal(model.requests.length, 3, `the scripted model was asked ${model.requests.length} times`);

  const [refused, recorded] = toolResults(messages);

  assert.equal(refused.isError, true, 'a heading was accepted as a phase');
  assert.match(textOf(refused.content), /"Section 4" is not a phase of dpm-spec, so nothing was recorded/);
  assert.match(textOf(refused.content), /recap, functional, .*, review\./);
  assert.equal(recorded.isError, false, `the declared phase was refused: ${textOf(recorded.content)}`);

  const decisions = declared['dpm-spec'].phases.find((phase) => phase.id === 'decisions').level;

  assert.notEqual(decisions, START, 'the step chosen has the opening level, so a change could not be seen');
  assert.deepEqual(model.requests.map(thinkingOf), [START, START, decisions],
    'the requests did not follow the phases the run moved through');

  assert.ok(userText(model.requests[0]).includes(phaseNote(declared['dpm-spec'])),
    'the turn the skill opened on was not told its phase ids');
});

test('control: with no skill running, a session call carries any phase and the level is left alone [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [
    callsTool(MOVES[0], { id: 'phase-control', skill: 'dpm:spec', phase: 'Section 4' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl, { reasoning: true });
  const { messages } = await runPrompt(scratch, 'Record a session.', { args: ['--skill', SKILLS] });

  const [result] = toolResults(messages);

  assert.equal(result.isError, false, `a phase was refused outside a skill: ${textOf(result.content)}`);
  assert.equal(thinkingOf(model.requests[1]), thinkingOf(model.requests[0]), 'the level moved with no skill running');
});
