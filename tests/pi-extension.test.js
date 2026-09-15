/**
 * The pi port's tool adapter — dpm's registry, called through the pi CLI against a real database.
 * Spec §9.1, T1–T4.
 *
 * `support/pi.js` carries how pi is driven and why the model is scripted rather than MTPLX.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PREFIX, register } from '../extensions/dpm/adapter.ts';
import { GATE, registerGate } from '../extensions/dpm/gate.ts';
import { HANDOFF } from '../extensions/dpm/handoff.ts';
import { advertisedTools } from '../src/server/index.ts';
import {
  answers, callsTool, limitFor, PI, runPrompt, scratchProject, scriptedModel, textOf, toolResults, toolsSent,
} from './support/pi.js';

/** A spec the committed dump is known to hold. */
const KNOWN_SPEC = 'opencode-dpm: port DPM to OpenCode v2';

/** The one tool result pi recorded. */
function toolResult(messages) {
  const results = toolResults(messages);

  assert.equal(results.length, 1, `pi recorded ${results.length} tool results`);

  return results[0];
}

/** Whether the scratch project has a database yet — the evidence a handler ran. */
const opened = (scratch) => existsSync(join(scratch.project, '.dpm', 'dpm.db'));

test('pi sends the model every registry tool under its dpm_ name, and a turn with no call creates no database [integration]', limitFor(), async (t) => {
  assert.ok(existsSync(PI), 'pi is installed from devDependencies rather than fetched');

  const model = await scriptedModel(t, [answers('Nothing to do.')]);
  const scratch = scratchProject(t, model.baseUrl);

  await runPrompt(scratch, 'Say hello.');

  assert.equal(model.requests.length, 1, `the scripted model was asked ${model.requests.length} times`);

  const sent = toolsSent(model.requests[0]);
  const expected = advertisedTools().map((tool) => `${PREFIX}${tool.name}`).sort();

  // Derived from the registry, never a restated 184 (T1). The gate and the handoff are the two tools
  // beside them.
  assert.ok(expected.length > 100, `the registry built ${expected.length} tools, which is not dpm's`);
  assert.deepEqual(sent, [...expected, GATE, HANDOFF].sort(),
    'the tools pi put in front of the model are not the registry, the gate and the handoff');

  // The schema reaches the model as the registry wrote it: no typebox wrapping, nothing dropped.
  const listSpec = model.requests[0].tools.find((tool) => tool.function.name === `${PREFIX}list_spec`);
  const { inputSchema } = advertisedTools().find((tool) => tool.name === 'list_spec');

  assert.deepEqual(listSpec.function.parameters, inputSchema);

  // The deferral the MCP server has, kept: a session that calls nothing creates nothing.
  assert.equal(opened(scratch), false, 'loading the extension created the database before any tool was called');
});

test('dpm_list_spec round-trips through pi against a database restored from the dump [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [callsTool(`${PREFIX}list_spec`, {}), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages } = await runPrompt(scratch, 'Which specifications are there?');
  const result = toolResult(messages);

  assert.equal(result.toolName, `${PREFIX}list_spec`);
  assert.equal(result.isError, false, `the call failed: ${textOf(result.content)}`);
  assert.equal(opened(scratch), true, 'the call answered without the database it should have restored');

  // And the far end of the round trip: what went back to the model on its next request.
  assert.equal(model.requests.length, 2, `the scripted model was asked ${model.requests.length} times`);

  const returned = model.requests[1].messages.filter((entry) => entry.role === 'tool');

  assert.equal(returned.length, 1, 'the second request carries no tool result');

  const { items } = JSON.parse(textOf(returned[0].content));

  assert.ok(items.map((item) => item.title).includes(KNOWN_SPEC),
    `the specs the model was sent do not include the one the dump holds: ${items.map((item) => item.title)}`);
});

test('a handler refusal is recorded as an error rather than an answer [integration]', limitFor(), async (t) => {
  // Well-formed for the schema, so pi's own validation passes it and the refusal is dpm's (R2, T3).
  const model = await scriptedModel(t, [
    callsTool(`${PREFIX}read_spec`, { id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages } = await runPrompt(scratch, 'Read that specification.');
  const result = toolResult(messages);

  // The list_spec test above is the control: there, the same path recorded `isError: false`.
  assert.equal(result.isError, true, `a refusal was recorded as a success: ${textOf(result.content)}`);
  assert.match(textOf(result.content), /read_spec/, 'the error does not name the tool that refused');
});

/**
 * T2 — the registry's schemas, validated by pi before any handler runs.
 *
 * **There is no nested case, because the registry has none.** The spec asks for an enum, an optional
 * and a nested schema. No registered tool has an array- or object-typed property today, so there is
 * no nested schema to choose. The enum and the optional are real.
 *
 * **The database is the evidence the handler never ran.** Every handler call goes through `open`,
 * and `open` restores the dump on first use. A refusal with no `dpm.db` afterwards was pi's, not dpm's.
 */
test('pi validates the registry schemas itself: a bad enum or a bad optional never reaches the handler, and a good optional does [integration]', limitFor(3), async (t) => {
  const refused = async (call) => {
    const model = await scriptedModel(t, [callsTool(...call), answers('done')]);
    const scratch = scratchProject(t, model.baseUrl);
    const result = toolResult((await runPrompt(scratch, 'Go.')).messages);

    assert.equal(result.isError, true, `${call[0]} accepted ${JSON.stringify(call[1])}: ${textOf(result.content)}`);
    assert.equal(opened(scratch), false, `${call[0]} reached its handler with arguments its own schema refuses`);
  };

  await refused([`${PREFIX}create_adr`, {
    parent_id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', slug: 'x', title: 'x', decision: 'x', status: 'not-a-status',
  }]);
  await refused([`${PREFIX}list_spec`, { limit: 0 }]);

  const model = await scriptedModel(t, [callsTool(`${PREFIX}list_spec`, { limit: 1 }), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);
  const result = toolResult((await runPrompt(scratch, 'Go.')).messages);

  assert.equal(result.isError, false, `a valid optional was refused: ${textOf(result.content)}`);
  assert.equal(JSON.parse(textOf(result.content)).items.length, 1, 'the optional reached the handler and was ignored');
});

test('no tool the extension registers carries a prompt snippet or prompt guidelines (R3, T4)', () => {
  const registered = [];
  const pi = { registerTool: (definition) => registered.push(definition), on: () => {} };

  register(pi, advertisedTools(), () => []);
  registerGate(pi);

  assert.equal(registered.length, advertisedTools().length + 1, 'the recorder did not see every registration');

  const carrying = registered
    .filter((definition) => 'promptSnippet' in definition || 'promptGuidelines' in definition)
    .map((definition) => definition.name);

  assert.deepEqual(carrying, [], 'these would rebuild the system prompt whenever they are activated');
});
