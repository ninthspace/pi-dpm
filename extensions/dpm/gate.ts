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
 * `tool_call` hook refuses the call when no assistant text has been shown since the last answered
 * gate or the user's last message. Any text is enough: the check catches a gate with nothing above
 * it, and does not judge how much is there. The cost is the conventions' exception for a
 * selection-only gate, which under pi needs a sentence of framing.
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

/** What the model is told when a gate is blocked for having nothing above it. */
export const UNRENDERED = `${GATE}: nothing was rendered since the last gate. Write what is being decided in your reply text, `
  + `not in reasoning, then call ${GATE} again.`;

/** A session entry, as far as the guard reads one. */
type BranchEntry = {
  readonly type: string;
  readonly message?: { readonly role: string; readonly content?: unknown; readonly toolName?: string; readonly isError?: boolean };
};

/**
 * The assistant text shown since the last answered gate, the user's last message or a compaction,
 * whichever is latest.
 *
 * **A failed `question` call does not close the window.** A gate refused by its schema, or blocked
 * here, was never answered, so the render before it still stands above the retry. A render a few
 * tool calls back counts too, because skills often render, record, and then gate.
 *
 * @param branch The session branch, root first, as `sessionManager.getBranch()` returns it.
 * @returns {string}
 */
export function renderedSinceLastGate(branch: readonly BranchEntry[]): string {
  const texts: string[] = [];

  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i]!;

    if (entry.type === 'compaction') break;

    const message = entry.type === 'message' ? entry.message : undefined;

    if (message === undefined) continue;
    if (message.role === 'user') break;
    if (message.role === 'toolResult' && message.toolName === GATE && !message.isError) break;

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      texts.unshift(...(message.content as { type?: string; text?: string }[])
        .filter((block) => block.type === 'text' && block.text?.trim())
        .map((block) => block.text!.trim()));
    }
  }

  return texts.join('\n');
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
 */
export function registerGate(pi: ExtensionAPI): void {
  // Blocked before any dialog opens, so a gate with nothing above it never reaches the user. pi
  // brings the session up to date through the calling message before this runs.
  pi.on('tool_call', (event, ctx) => {
    if (event.toolName !== GATE) return undefined;
    if (renderedSinceLastGate(ctx.sessionManager.getBranch() as unknown as readonly BranchEntry[]) !== '') return undefined;

    return { block: true, reason: UNRENDERED };
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
