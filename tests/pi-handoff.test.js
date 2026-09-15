/**
 * The handoff — `handoff` and `/dpm-continue`, a skill run continued in a fresh context.
 *
 * The sixth MTPLX epics run ran out of memory at an 86k-token prompt, one epic into four, because
 * one context held the whole run. `handoff.ts` carries the argument for ending a run at the end of a
 * unit of work and continuing it from the rows. What is checked here is what that depends on: the
 * skill and its arguments reach the new session unchanged, the new session is told which session to
 * adopt, and nothing from the old context comes with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PREFIX } from '../extensions/dpm/adapter.ts';
import {
  CONTINUE, continueCommand, continuation, continued, handedOff, HANDOFF, invocation, NOTHING_RUNNING,
} from '../extensions/dpm/handoff.ts';
import { announcement } from '../src/plugin/session-id.ts';
import {
  answers, callsTool, limitFor, runPrompt, scratchProject, scriptedModel, SKILLS, textOf, toolResults,
} from './support/pi.js';

/** Everything a request sent as the user's, joined — the skill body, its arguments, dpm's notes. */
const userText = (request) => request.messages
  .filter((message) => message.role === 'user')
  .map((message) => textOf(message.content))
  .join('\n');

/** Every message a request sent, as text. */
const allText = (request) => request.messages.map((message) => textOf(message.content ?? '')).join('\n');

/** The harness session id a request was announced, read back out of the announcement. */
function announcedId(request) {
  const found = userText(request).match(/The harness session id for this run is (\S+)\. Pass it/);

  assert.ok(found, 'the request carries no session id announcement');

  return found[1];
}

// --- The words and the parsing ---------------------------------------------------------------------

test('a skill invocation and a continue command carry the skill and its arguments unchanged', () => {
  assert.deepEqual(invocation('/skill:dpm-epics 01'), { skill: 'dpm-epics', args: '01' });
  assert.deepEqual(invocation('/skill:dpm-status'), { skill: 'dpm-status', args: '' });
  assert.equal(invocation('/dpm-epics 01'), null, 'the command form is sent on as the skill form, and read there');

  for (const target of [
    { skill: 'dpm-epics', args: '01' },
    { skill: 'dpm-status', args: '' },
    { skill: 'dpm-spec', args: 'FR scope only' },
  ]) {
    const command = continueCommand(target);

    assert.ok(command.startsWith(`/${CONTINUE} `), command);
    assert.deepEqual(continued(command.slice(CONTINUE.length + 2)), target, `${command} did not read back`);
  }

  assert.equal(continued('   '), null);
});

test('the continued run is told to adopt the session that handed off, by its id', () => {
  const note = continuation('pi-session-1');

  assert.ok(note.includes(`${PREFIX}adopt_session`), 'the note does not name the adoption call');
  assert.match(note, /`id`/);
  assert.match(note, /pi-session-1 as `predecessor_id`/);
  assert.match(note, /`include_body`/, 'without the body, adoption hands back no state');
});

// --- Through pi -------------------------------------------------------------------------------------

test('through pi, a handoff ends the turn itself, and the skill continues in a new session told what to adopt, with nothing of the old context [integration]', limitFor(), async (t) => {
  const SAID = 'Epic one is written and read back; handing off.';

  // The second turn is what the seventh MTPLX epics run did after its second handoff: carry on in
  // the old context. Here it is never asked for — the next request the model sees is the new session's.
  const model = await scriptedModel(t, [
    callsTool(HANDOFF, {}, SAID),
    answers('Continued.'),
  ]);
  const scratch = scratchProject(t, model.baseUrl);

  const { errors, state, messages } = await runPrompt(scratch, '/skill:dpm-epics 01', { args: ['--skill', SKILLS], settles: 2 });

  assert.deepEqual(errors, [], 'the handoff raised an extension error');
  assert.equal(model.requests.length, 2,
    `the scripted model was asked ${model.requests.length} times — the old context was asked to go on after its handoff`);

  const [opened, resumed] = model.requests;
  const handedFrom = announcedId(opened);

  assert.equal(toolResults(messages).length, 0, 'the continued session carries a tool result');
  assert.ok(handedOff('dpm-epics').includes('This turn ends here'));

  // The new session: the skill again, with its arguments, the note naming the old session, and its
  // own id — which is a different one.
  const text = userText(resumed);

  assert.ok(text.includes('<skill name="dpm-epics"'), 'the continued session did not open the skill');
  assert.match(text, /<\/skill>\n\n01/, 'the skill\'s arguments were lost on the way');
  assert.ok(text.includes(continuation(handedFrom)), 'the continued session was not told which session to adopt');
  assert.notEqual(announcedId(resumed), handedFrom, 'the continued run is announced as the session it continues');
  assert.equal(state.sessionId, announcedId(resumed));
  assert.equal(text.split(announcement(state.sessionId)).length - 1, 1, 'the announcement is not said exactly once');

  // And the point of it: nothing the first session said reaches the second.
  assert.equal(allText(resumed).includes(SAID), false, 'the old context came with the handoff');
  assert.equal(resumed.messages.some((message) => message.role === 'tool'), false,
    'a tool result from the old session reached the new one');
});

test('through pi, a handoff with no dpm skill running is refused, and no session follows [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [callsTool(HANDOFF, {}, 'Handing off.'), answers('ok')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages } = await runPrompt(scratch, 'Hand this off.', { args: ['--skill', SKILLS] });
  const [result] = toolResults(messages);

  assert.equal(result.isError, true, `a handoff with nothing to continue was accepted: ${textOf(result.content)}`);
  assert.equal(textOf(result.content), NOTHING_RUNNING);
  assert.equal(model.requests.length, 2, 'a continued session was started anyway');
});

test('through pi, /dpm-continue naming no dpm skill fails loudly and sends the model nothing [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [answers('ok')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { errors } = await runPrompt(scratch, `/${CONTINUE} not-a-skill 01`, { args: ['--skill', SKILLS] });

  assert.equal(errors.length, 1, `expected one extension error, got ${errors.length}`);
  assert.match(errors[0].error, /"not-a-skill 01" names none/);
  assert.equal(model.requests.length, 0, 'the model was asked something');
});
