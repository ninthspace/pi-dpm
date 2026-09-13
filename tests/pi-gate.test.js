/**
 * The gate — `question`, in the shape the skills are written against. Spec §6.2, R5–R9.
 *
 * Two halves. The dialog logic is tested directly against a recorder, which is fast and covers every
 * branch. Then the tool is tested through the pi CLI: in RPC mode, where a client answers the
 * dialogs, and in JSON mode, where nobody can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  answerText, ask, choiceFor, DONE, GATE, HEADER_LIMIT, OWN_ANSWER, PARAMETERS, registerGate, wrap,
} from '../extensions/dpm/gate.ts';
import {
  answers, callsTool, limitFor, ROOT, runJson, runPrompt, scratchProject, scriptedModel, textOf, toolResults,
} from './support/pi.js';

const CONVENTIONS = readFileSync(join(ROOT, 'shared', 'skill-conventions.md'), 'utf8');

const APPROVE = {
  question: 'Approve the requirement set?',
  header: 'Requirements',
  options: [
    { label: 'Approve (Recommended)', description: 'Record them as drafted' },
    { label: 'Request changes', description: 'Revise before recording' },
  ],
};

const PERSPECTIVES = {
  question: 'Which perspectives should review it?',
  header: 'Perspectives',
  multiple: true,
  options: [
    { label: 'Architect', description: 'Structure and seams' },
    { label: 'Tester', description: 'What would fail' },
    { label: 'Operator', description: 'What it costs to run' },
  ],
};

/** Dialogs that answer from a script and record what they were shown. */
function scripted(picks) {
  const shown = [];
  const queue = [...picks];

  return {
    shown,
    select: async (title, options) => {
      shown.push({ method: 'select', title, options });
      const pick = queue.shift();

      return typeof pick === 'function' ? pick(options) : pick;
    },
    input: async (title) => {
      shown.push({ method: 'input', title });

      return queue.shift();
    },
  };
}

// --- The dialog logic -------------------------------------------------------------------------------

test('the schema is the Gate Presentation section, transcribed', () => {
  const entry = PARAMETERS.properties.questions.items;

  assert.deepEqual(PARAMETERS.required, ['questions']);
  assert.deepEqual(entry.required, ['question', 'header', 'options']);
  assert.deepEqual(entry.properties.options.items.required, ['label', 'description']);
  assert.deepEqual(Object.keys(entry.properties).filter((key) => !entry.required.includes(key)), ['multiple'],
    'the conventions name `multiple` as the only optional field');

  // Read from the section rather than restated, so the two cannot drift apart.
  const limit = CONVENTIONS.match(/`header`[^`]*?(\d+)\s+characters at most/);

  assert.ok(limit, 'the conventions no longer state a header limit this can read');
  assert.equal(HEADER_LIMIT, Number(limit[1]));
  assert.equal(entry.properties.header.maxLength, HEADER_LIMIT);
  assert.ok(CONVENTIONS.includes(`"${OWN_ANSWER}" option is added for you`),
    'the conventions promise a free-text option under another name');
  assert.match(CONVENTIONS, new RegExp(`host's tool is \\*\\*\`${GATE}\`\\*\\*`), 'R9 — the corpus names another tool');
});

test('a single-choice gate offers every option and a free-text path, and answers with the label', async () => {
  const ui = scripted([(options) => options[1]]);

  assert.deepEqual(await ask(ui, APPROVE), ['Request changes']);
  assert.deepEqual(ui.shown[0].options, [...APPROVE.options.map(choiceFor), OWN_ANSWER], 'R6 — no free-text path');
  assert.match(ui.shown[0].title, /Requirements: Approve the requirement set\?/);
});

test('an own answer is the text written, and an empty one is a dismissal rather than an answer', async () => {
  assert.deepEqual(await ask(scripted([OWN_ANSWER, '  Split FR3 first  ']), APPROVE), ['Split FR3 first']);
  assert.equal(await ask(scripted([OWN_ANSWER, '   ']), APPROVE), null);
  assert.equal(await ask(scripted([OWN_ANSWER, undefined]), APPROVE), null);
  assert.equal(await ask(scripted([undefined]), APPROVE), null);
});

test('a multiple-choice gate collects until Done, which is offered only once something is chosen', async () => {
  const ui = scripted([choiceFor(PERSPECTIVES.options[1]), OWN_ANSWER, 'Security', DONE]);

  assert.deepEqual(await ask(ui, PERSPECTIVES), ['Tester', 'Security']);

  const selects = ui.shown.filter((entry) => entry.method === 'select');

  assert.equal(selects[0].options.includes(DONE), false, 'Done was offered before anything was chosen');
  assert.equal(selects[1].options.includes(choiceFor(PERSPECTIVES.options[1])), false, 'a chosen option was offered again');
  assert.equal(selects.at(-1).options.at(-1), DONE);
  assert.match(selects.at(-1).title, /chosen: Tester, Security/);
});

test('a value the picker never offered is refused rather than guessed at', async () => {
  await assert.rejects(ask(scripted(['Approve']), APPROVE), /not one of the options offered/);
});

test('the answer text pairs each question with its answers', () => {
  assert.equal(
    answerText([
      { header: 'Requirements', question: APPROVE.question, answers: ['Approve (Recommended)'] },
      { header: 'Perspectives', question: PERSPECTIVES.question, answers: ['Tester', 'Security'] },
    ]),
    'User has answered your questions: "Approve the requirement set?"="Approve (Recommended)", '
      + '"Which perspectives should review it?"="Tester, Security". You can now continue with the user\'s answers in mind.',
  );
});

test('the transcript row shows each question and every option, within the width it is given (R7)', () => {
  let tool;

  registerGate({ registerTool: (definition) => { tool = definition; } });

  const theme = { fg: (_colour, text) => text, bold: (text) => text };
  const lines = tool.renderCall({ questions: [APPROVE, PERSPECTIVES] }, theme, {}).render(36);
  const joined = lines.join(' ');

  assert.ok(lines.every((line) => line.length <= 36), 'a line overruns the width');
  for (const expected of [APPROVE.question, PERSPECTIVES.question, 'Operator', OWN_ANSWER]) {
    assert.ok(joined.replace(/\s+/g, ' ').includes(expected), `the row does not show "${expected}"`);
  }

  // Arguments stream in; a row rendered before `questions` arrives must not throw.
  assert.deepEqual(tool.renderCall({}, theme, {}).render(36), []);

  const result = tool.renderResult({
    content: [], details: { answers: [{ header: 'Requirements', question: APPROVE.question, answers: ['Approve (Recommended)'] }] },
  }, {}, theme, {}).render(80);

  assert.deepEqual(result, ['✓ Requirements: Approve (Recommended)']);
});

test('wrap keeps every line within the width, cutting a word that cannot fit', () => {
  assert.deepEqual(wrap('one two three', 7), ['one two', 'three']);
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

// --- Through pi -------------------------------------------------------------------------------------

test('through pi in RPC mode, the client answers both questions and the model gets both answers [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [callsTool(GATE, { questions: [APPROVE, PERSPECTIVES] }), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const script = [
    choiceFor(APPROVE.options[0]),
    choiceFor(PERSPECTIVES.options[2]),
    OWN_ANSWER,
    'Security',
    DONE,
  ];

  const { messages, dialogs } = await runPrompt(scratch, 'Gate it.', {
    answer: () => ({ value: script.shift() }),
  });

  const [result] = toolResults(messages);

  assert.equal(result.isError, false, `the gate failed: ${textOf(result.content)}`);
  assert.equal(script.length, 0, `pi asked ${dialogs.length} dialogs, not the five scripted`);
  assert.deepEqual(dialogs.map((dialog) => dialog.method), ['select', 'select', 'select', 'input', 'select']);
  assert.ok(dialogs[0].options.includes(OWN_ANSWER), 'R6 — the free-text path did not reach the client');
  assert.match(textOf(result.content), /"Approve the requirement set\?"="Approve \(Recommended\)"/);
  assert.match(textOf(result.content), /"Which perspectives should review it\?"="Operator, Security"/);

  const returned = model.requests[1].messages.filter((entry) => entry.role === 'tool');

  assert.match(textOf(returned[0].content), /Operator, Security/, 'the answers did not reach the model');
});

test('through pi, a dismissed gate is an error rather than an answer [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [callsTool(GATE, { questions: [APPROVE] }), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages, dialogs } = await runPrompt(scratch, 'Gate it.', { answer: () => undefined });
  const [result] = toolResults(messages);

  assert.equal(dialogs.length, 1);
  assert.equal(result.isError, true, `a dismissal was recorded as a decision: ${textOf(result.content)}`);
  assert.match(textOf(result.content), /dismissed "Requirements"/);
});

test('through pi, a header over the limit is refused before any dialog opens [integration]', limitFor(), async (t) => {
  const header = 'x'.repeat(HEADER_LIMIT + 1);
  const model = await scriptedModel(t, [callsTool(GATE, { questions: [{ ...APPROVE, header }] }), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages, dialogs } = await runPrompt(scratch, 'Gate it.', { answer: () => ({ value: 'unused' }) });
  const [result] = toolResults(messages);

  assert.equal(result.isError, true, `an overlong header was accepted: ${textOf(result.content)}`);
  assert.deepEqual(dialogs, [], 'the user was shown a gate the schema refuses');
});

test('through pi in JSON mode, where nobody can answer, the gate fails loudly rather than deciding (R8) [integration]', limitFor(), async (t) => {
  const model = await scriptedModel(t, [callsTool(GATE, { questions: [APPROVE] }), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { records, stderr } = await runJson(scratch, 'Gate it.');
  const results = records
    .map((record) => record.message)
    .filter((message) => message?.role === 'toolResult');

  assert.ok(results.length > 0, `JSON mode reported no tool result\n--- stderr ---\n${stderr}`);
  assert.equal(results[0].isError, true, `the gate answered with no UI: ${textOf(results[0].content)}`);
  assert.match(textOf(results[0].content), /no UI/);
});
