/**
 * The gate — the tool every dpm skill decides through. Spec §6.2, R5–R9.
 *
 * **The name is not chosen here.** `shared/skill-conventions.md` says "the host's tool is
 * `question`, and every gate in every skill goes through it", and all 23 bodies are written to that
 * sentence. A tool under any other name means editing every one of them for nothing (R9).
 *
 * **The shape is the one the conventions describe, not the one pi's example takes.** pi's
 * `examples/extensions/question.ts` asks one question with optional descriptions. The conventions'
 * Gate Presentation section says `questions` is an array, each entry requiring `question`, `header`
 * (30 characters at most) and `options`, each option requiring a `label` and a `description`, with
 * `multiple` the only optional field. A skill tuned against that shape and handed the example's would
 * spend a round trip per gate finding out, so the schema below is the section, transcribed.
 *
 * **Built on `select` and `input`, not on a custom TUI component.** The example draws its own panel
 * through `ctx.ui.custom`, which exists only in the terminal: RPC mode returns `undefined` from it.
 * The dialog methods work in both — pi renders them in the terminal and forwards them over RPC as
 * `extension_ui_request` — so one path serves both modes and the tests can drive it from outside.
 * The cost is presentation: a picker line holds `label — description` rather than a label with a
 * description underneath.
 *
 * **What the user sees in the transcript is the tool row.** `renderCall` prints each question with
 * its options and `renderResult` the answers, so a gate leaves the decision in the scrollback rather
 * than only in a dialog that closes (R7). The render-then-gate discipline is the skills'; this only
 * avoids undoing it.
 *
 * **No UI is a thrown error, not an answer.** In print and JSON mode nobody can reply, and pi's example
 * returns a message saying so — which is recorded as a *successful* call, so a model under pressure
 * reads it as permission to go on. Throwing is what sets `isError` (R2), and a stopped run is better
 * than a silently approved gate (R8). A dismissed dialog is refused the same way, for the same
 * reason.
 *
 * **A gate with nothing rendered before it is blocked, whatever the model does.** The conventions
 * ask for the render first, but a model with reasoning on can write its whole draft into the think
 * block and call `question` with no text at all. Gates 7, 8 and 18 of the first MTPLX `/dpm-spec`
 * run did exactly that, and each was approved without the user ever seeing the draft. So the
 * `tool_call` hook refuses the call when the message calling it has no text. The cost is the
 * conventions' exception for a selection-only gate, which under pi needs a sentence of framing.
 *
 * **A gate asking for approval needs the draft itself, not a sentence about it.** Gates 4 and 5 of
 * the resumed seventh MTPLX epics run had text — "I'll draft story 2's criteria from the
 * requirement's language…", 468 and 272 characters — and no criteria and no tags. Both were approved
 * unseen. Across the 45 gates of the sixth and seventh epics runs, those two are the only ones whose
 * render held neither a list item nor a table row; every draft the user did see had one or the other.
 * So a gate with an option whose label starts "Approve" is refused unless its message has one. A
 * selection keeps its one line of framing, since its choices are the options.
 *
 * **A decision already approved is not asked again before anything is written.** The same run then
 * asked "Story 2 criteria" seven times in a row, each approved and none written: its replayed
 * reasoning had invented a user message saying story 1's criteria were approved, and every turn read
 * the newest answer as that one. The session's history was all there; the model misread it. So once
 * a question is answered with its first option — the recommended one, which is what the skills put
 * first — the same `header` is refused until a write lands, and the refusal names the answer. An
 * answer asking for changes, or one the user typed, leaves the header free to be asked again.
 */

import type { ExtensionAPI, ExtensionUIContext, ToolDefinition } from '@earendil-works/pi-coding-agent';

/** The name the corpus calls, fixed by `skill-conventions.md`. */
export const GATE = 'question';

/** The conventions' limit on `header`, enforced by the schema so pi refuses it before any dialog opens. */
export const HEADER_LIMIT = 30;

/** The free-text path, appended to every gate (R6). The conventions tell skills not to write their own "Other". */
export const OWN_ANSWER = 'Type your own answer';

/** How a multiple-choice gate is closed once something is chosen. */
export const DONE = 'Done choosing';

export type GateOption = { readonly label: string; readonly description: string };

export type GateQuestion = {
  readonly question: string;
  readonly header: string;
  readonly options: readonly GateOption[];
  readonly multiple?: boolean;
};

export type GateAnswer = { readonly header: string; readonly question: string; readonly answers: readonly string[] };

/** The two dialog methods the gate uses, so a test can hand it a recorder instead of a terminal. */
export type Dialogs = Pick<ExtensionUIContext, 'select' | 'input'>;

/** What the model is told when a gate is blocked for having no text in its own message. */
export const UNRENDERED = `${GATE}: the message calling ${GATE} has no text, so the user would be asked to decide `
  + 'something they cannot see. Write what is being decided in the reply text of the message that calls '
  + `${GATE} — not in reasoning, and not only in an earlier message — then call ${GATE} again. A gate `
  + 'straight after another gate or after writes renders its own draft too: a draft worked out in reasoning '
  + 'is not shown until it is copied into the reply.';

/** What the model is told when a gate asking for approval has no draft in its message. */
export const UNLISTED = `${GATE}: this gate asks for approval, and the message calling it has no draft in it — no `
  + 'list item and no table row, only prose about the draft. Put the items being approved in the reply text '
  + `of this message, each a list item or a table row, then call ${GATE} again.`;

/**
 * What the model is told when it asks a decision already approved, with nothing written since.
 *
 * @param header The question's header, which is what identifies a decision across gates.
 * @param gate Which answered gate of this session approved it.
 * @param answer The label the user chose.
 * @returns {string}
 */
export const repeated = (header: string, gate: number, answer: string): string =>
  `${GATE}: "${header}" was answered at gate ${gate} of this session — "${answer}" — and nothing has been `
  + 'written since, so it is not asked again. Carry that answer out: write what it approved, then go on to '
  + 'the next step.';

/** Whether a question asks for approval: an option whose label starts "Approve". */
export const asksApproval = (question: { readonly options?: readonly GateOption[] }): boolean =>
  (Array.isArray(question.options) ? question.options : []).some((option) => /^\s*approve\b/i.test(option?.label ?? ''));

/** Whether a render holds a draft's items: a list item or a table row, each on a line of its own. */
export const listsDraft = (text: string): boolean =>
  /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(text) || /^\s*\|.*\|\s*$/m.test(text);

/** A session entry, as far as the guard reads one. */
type BranchEntry = {
  readonly type: string;
  readonly message?: { readonly role: string; readonly content?: unknown; readonly toolCallId?: string };
};

/**
 * The text of the assistant message calling the gate: the latest assistant message on the branch.
 *
 * **The render has to be in the calling message, not merely somewhere since the last gate.** This
 * read back to the last answered gate, so that a skill could render, record, then gate. The fourth
 * MTPLX run showed what that let through: "All eight FRs are recorded. On to Section 3." in one
 * message, then a gate whose message held the NFR draft in reasoning and no text at all. The earlier
 * line satisfied the guard, and the user was asked to approve NFRs nobody showed them.
 *
 * **Nothing good was blocked by the stricter rule in the runs there are.** Across three MTPLX runs,
 * all 38 gates whose render the user saw had it in the calling message. All three that had text only
 * in an earlier message had their draft in that message's reasoning.
 *
 * **Except the results of the calling message's own earlier calls.** A message that renders, updates
 * the session and then gates has the update's result on the branch by the time this runs, so reading
 * a tool result as "no caller" refused a gate whose render was right there. The second MTPLX epics
 * run lost two gates that way — 2,135 and 1,515 characters of render — and the model, told its
 * message had no text, retried with none. So a tool result is passed over when the assistant message
 * reached next made that call; a user message, or a result answering some other message's call,
 * still means there is no calling message to read.
 *
 * @param branch The session branch, root first, as `sessionManager.getBranch()` returns it.
 * @param callId The gate's own tool call id, when known — the calling message has to hold it.
 * @returns {string}
 */
export function renderedWithGate(branch: readonly BranchEntry[], callId?: string): string {
  const passed: string[] = [];

  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i]!;

    if (entry.type === 'compaction') return '';

    const message = entry.type === 'message' ? entry.message : undefined;

    if (message === undefined) continue;

    if (message.role === 'toolResult' && message.toolCallId) {
      passed.push(message.toolCallId);
      continue;
    }

    if (message.role !== 'assistant') return '';

    const content = Array.isArray(message.content)
      ? message.content as { type?: string; text?: string; id?: string }[]
      : [];
    const calls = new Set(content.filter((block) => block.type === 'toolCall').map((block) => block.id));

    if (passed.some((id) => !calls.has(id))) return '';
    if (callId !== undefined && !calls.has(callId)) return '';

    return content
      .filter((block) => block.type === 'text' && block.text?.trim())
      .map((block) => block.text!.trim())
      .join('\n');
  }

  return '';
}

/** The parameters, as plain JSON Schema — pi validates it the same way it validates dpm's own tools. */
export const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      description: 'The decisions to ask for, asked in order. Render what is being decided in your message first; these carry only the decision.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'header', 'options'],
        properties: {
          question: { type: 'string', minLength: 1, description: 'The whole question.' },
          header: { type: 'string', minLength: 1, maxLength: HEADER_LIMIT, description: `A very short label, ${HEADER_LIMIT} characters at most.` },
          options: {
            type: 'array',
            minItems: 1,
            description: `The choices. "${OWN_ANSWER}" is added for you; do not write an "Other". Put a recommended option first and end its label with "(Recommended)".`,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'description'],
              properties: {
                label: { type: 'string', minLength: 1, description: 'A few words.' },
                description: { type: 'string', minLength: 1, description: 'What choosing it means.' },
              },
            },
          },
          multiple: { type: 'boolean', description: 'Allow more than one answer.' },
        },
      },
    },
  },
} as const;

/** How an option reads in a picker, which has one line for it. */
export const choiceFor = (option: GateOption): string => `${option.label} — ${option.description}`;

/** The dialog title: the header, so the user can place it, then the whole question. */
export const titleFor = (question: GateQuestion): string => `${question.header}: ${question.question}`;

/**
 * One question's answers, or `null` when the user dismissed it.
 *
 * An own answer left empty counts as dismissed rather than as an answer of nothing: a gate recorded
 * as decided with no decision in it is the silent approval R8 exists to prevent.
 *
 * @param ui
 * @param question
 * @param signal Aborts an open dialog when the run is cancelled.
 * @returns {Promise<string[] | null>}
 */
export async function ask(ui: Dialogs, question: GateQuestion, signal?: AbortSignal): Promise<string[] | null> {
  const options = signal === undefined ? undefined : { signal };
  const chosen: string[] = [];
  const remaining = [...question.options];

  for (;;) {
    const choices = [
      ...remaining.map(choiceFor),
      OWN_ANSWER,
      ...(question.multiple && chosen.length > 0 ? [DONE] : []),
    ];
    const title = question.multiple && chosen.length > 0
      ? `${titleFor(question)} (chosen: ${chosen.join(', ')})`
      : titleFor(question);

    const picked = await ui.select(title, choices, options);

    if (picked === undefined) return null;
    if (picked === DONE) return chosen;

    if (picked === OWN_ANSWER) {
      const written = (await ui.input(titleFor(question), undefined, options))?.trim();

      if (!written) return null;
      chosen.push(written);
    } else {
      const index = remaining.findIndex((option) => choiceFor(option) === picked);

      // A value the picker was never offered is the client's mistake, and guessing which option it
      // meant would be recording a decision nobody made.
      if (index === -1) throw new Error(`${GATE}: the answer "${picked}" is not one of the options offered`);
      chosen.push(remaining[index]!.label);
      remaining.splice(index, 1);
    }

    if (!question.multiple || remaining.length === 0) return chosen;
  }
}

/**
 * What the model is told, one `"question"="answer"` pair per question.
 *
 * Modelled on the wording OpenCode's own `question` tool returns, which is what the corpus has been
 * run against.
 *
 * @param answers
 * @returns {string}
 */
export const answerText = (answers: readonly GateAnswer[]): string =>
  `User has answered your questions: ${answers.map((a) => `"${a.question}"="${a.answers.join(', ')}"`).join(', ')}. `
  + 'You can now continue with the user\'s answers in mind.';

/** Words laid into lines of at most `width` columns; a word longer than a line is cut. */
export function wrap(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    let line = '';

    for (let word of paragraph.split(' ')) {
      while (word.length > limit) {
        if (line) lines.push(line);
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
        line = '';
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}

type Component = ReturnType<NonNullable<ToolDefinition['renderCall']>>;
type Theme = Parameters<NonNullable<ToolDefinition['renderCall']>>[1];
type Colour = Parameters<Theme['fg']>[0];

/** A static block of text, wrapped to the width the transcript gives it. ANSI is applied after wrapping, so widths stay honest. */
const block = (theme: Theme, rows: ReadonlyArray<readonly [Colour, string]>): Component => ({
  render: (width: number) => rows.flatMap(([colour, text]) => wrap(text, width).map((line) => theme.fg(colour, line))),
  invalidate: () => {},
});

/**
 * Register the gate.
 *
 * `executionMode: 'sequential'` because two gates open at once would race for the same dialog.
 *
 * @param pi
 * @param writes The tools, by registered name, whose success spends the approvals before it.
 */
export function registerGate(pi: ExtensionAPI, writes: ReadonlySet<string> = new Set()): void {
  let answered = 0;
  const approved = new Map<string, { readonly gate: number; readonly answer: string }>();

  // Both belong to the session they were counted in, as the handoff's state does.
  pi.on('session_start', () => {
    answered = 0;
    approved.clear();
  });

  // Blocked before any dialog opens, so none of these reaches the user. pi brings the session up to
  // date through the calling message before this runs.
  pi.on('tool_call', (event, ctx) => {
    if (event.toolName !== GATE) return undefined;
    const branch = ctx.sessionManager.getBranch() as unknown as readonly BranchEntry[];
    const rendered = renderedWithGate(branch, event.toolCallId);

    if (rendered === '') return { block: true, reason: UNRENDERED };

    const input = (event.input as { questions?: unknown }).questions;
    const questions = (Array.isArray(input) ? input : []) as Partial<GateQuestion>[];

    if (questions.some(asksApproval) && !listsDraft(rendered)) return { block: true, reason: UNLISTED };

    for (const question of questions) {
      const earlier = question.header === undefined ? undefined : approved.get(question.header);

      if (earlier) return { block: true, reason: repeated(question.header!, earlier.gate, earlier.answer) };
    }

    return undefined;
  });

  pi.on('tool_result', (event) => {
    if (!event.isError && writes.has(event.toolName)) approved.clear();

    return undefined;
  });

  pi.registerTool({
    name: GATE,
    label: 'Question',
    description: 'Ask the user to decide. Render what is being decided in your message first; this carries only the decision.',
    parameters: PARAMETERS as unknown as ToolDefinition['parameters'],
    executionMode: 'sequential',

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        throw new Error(`${GATE}: this pi run has no UI (mode ${ctx.mode}), so nobody can answer. `
          + 'The gate was not asked and nothing was decided; stop here rather than proceeding.');
      }

      const answers: GateAnswer[] = [];

      for (const question of (params as { questions: GateQuestion[] }).questions) {
        const picked = await ask(ctx.ui, question, signal);

        if (picked === null) {
          throw new Error(`${GATE}: the user dismissed "${question.header}" without answering. `
            + 'Nothing was decided; do not proceed as though it were.');
        }
        answers.push({ header: question.header, question: question.question, answers: picked });
      }

      answered += 1;

      // The first option answered alone is the approval the skills put first. Anything else — changes
      // asked for, an answer typed, several chosen — leaves the decision open to be asked again.
      for (const [index, question] of (params as { questions: GateQuestion[] }).questions.entries()) {
        const picked = answers[index]!.answers;

        if (!question.multiple && picked.length === 1 && picked[0] === question.options[0]?.label) {
          approved.set(question.header, { gate: answered, answer: picked[0] });
        } else {
          approved.delete(question.header);
        }
      }

      return { content: [{ type: 'text', text: answerText(answers) }], details: { answers } };
    },

    renderCall(args, theme) {
      // Arguments stream in, so a render can arrive before `questions` is whole.
      const questions = (args as { questions?: Partial<GateQuestion>[] }).questions ?? [];

      return block(theme, questions.flatMap((question) => [
        ['toolTitle', `${GATE} · ${question.header ?? ''}`] as const,
        ['text', question.question ?? ''] as const,
        ...[...(question.options ?? []).map((option) => choiceFor(option as GateOption)), OWN_ANSWER]
          .map((choice, i) => ['muted', `  ${i + 1}. ${choice}`] as const),
      ]));
    },

    renderResult(result, _options, theme) {
      const answers = (result.details as { answers?: GateAnswer[] } | undefined)?.answers;

      if (!answers) {
        const first = result.content[0];

        return block(theme, [['warning', first?.type === 'text' ? first.text : '']]);
      }

      return block(theme, answers.map((a) => ['success', `✓ ${a.header}: ${a.answers.join(', ')}`] as const));
    },
  });
}
