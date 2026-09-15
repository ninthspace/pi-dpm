/**
 * The handoff — a skill run ended where the skill says, and continued in a fresh context.
 *
 * **Why a run needs one at all.** One context per run grows with the work, not with the step. The
 * sixth MTPLX epics run took its prompt from 25k tokens to 75k over the first of four epics, and the
 * server ran out of memory at 86k, before the second epic had a story. The fifth ran out at 113k. A
 * bigger machine or a smaller model moves that line and does not remove it; a spec with more epics
 * crosses it again. A run that hands off at the end of each unit of work holds one unit in context,
 * whatever the model and however many units there are.
 *
 * **A tool marks it, and a command carries it out**, because pi gives a tool no way to replace the
 * session. `newSession` is on the command context only — pi calls those methods "only safe in
 * user-initiated commands". So `handoff` records what to continue and the turn ends; once the agent
 * has settled, the extension sends `/dpm-continue <skill> <arguments>`, which is a command, and the
 * command opens the new session and invokes the skill there with the arguments it was first given.
 * The same command is how a person continues a run by hand.
 *
 * **The new session is told it is a continuation, and which session it continues.** Its model has
 * seen nothing, and Session Startup can only adopt a predecessor whose id it knows. The note names
 * the old harness session id and the adoption call, so the run resumes from the session's `state`
 * and the rows — the resume path the skills already have — rather than starting a second run.
 *
 * **Where to hand off is the skill's decision, not this module's.** Only the skill knows what a unit
 * of its work is and what has to be in `state` before its context goes.
 *
 * **Once a handoff is accepted, the extension ends the turn; the model is not trusted to.** The
 * seventh MTPLX epics run handed off cleanly after its first epic. After its second, told to end its
 * turn, the model called `handoff` again, then wrote "Continued run: adopted the session, re-read the
 * spec" — none of which it had done — and went on with the third epic in the context the handoff
 * was meant to empty, writing that epic's stories without a gate. The session never settled, so the
 * continuation never ran. So an accepted handoff blocks every later call in its session.
 *
 * **And the loop is stopped by the tool's result, not by an abort.** The handoff's result, and every
 * call refused after it, carry pi's `terminate`, which ends the agent loop once every result in the
 * batch has it — before another request is sent. The first version aborted as the turn ended instead,
 * and by then pi had already opened the next request: the resumed epics7 run logged that request as
 * a model error, cancelled a second after it began. A `terminate` cannot reach a call made before the
 * handoff in the same message, whose result is already final, so a handoff that shares its message
 * still aborts as the turn ends; the Handoff procedure asks for a message of its own.
 */

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';

import { skillInvoked } from './activation.ts';
import { PREFIX } from './adapter.ts';
import { skillMessage } from './commands.ts';

/** The tool a skill calls to end its run here and continue it in a fresh context. */
export const HANDOFF = 'handoff';

/** The command that opens the fresh context and invokes the skill in it. */
export const CONTINUE = 'dpm-continue';

/** The custom message type the continuation note is recorded under in the new session. */
export const NOTE = 'dpm-handoff';

/** A skill and the arguments it was given. */
export type Invocation = { readonly skill: string; readonly args: string };

/**
 * The skill a prompt invokes, with its arguments, or `null` when it invokes none.
 *
 * @param text Raw input, before pi expands it.
 * @returns {Invocation | null}
 */
export function invocation(text: string): Invocation | null {
  const skill = skillInvoked(text);

  if (skill === null) return null;

  return { skill, args: text.slice(`/skill:${skill}`.length).trim() };
}

/**
 * What `/dpm-continue` was given: a skill name, then that skill's own arguments.
 *
 * @param args
 * @returns {Invocation | null} `null` when no skill is named.
 */
export function continued(args: string): Invocation | null {
  const trimmed = args.trim();

  if (trimmed === '') return null;

  const space = trimmed.search(/\s/);

  return space === -1
    ? { skill: trimmed, args: '' }
    : { skill: trimmed.slice(0, space), args: trimmed.slice(space).trim() };
}

/** The command the extension sends once a handed-off turn has settled. */
export const continueCommand = ({ skill, args }: Invocation): string =>
  (args === '' ? `/${CONTINUE} ${skill}` : `/${CONTINUE} ${skill} ${args}`);

/**
 * What the continued run is told before its skill opens.
 *
 * @param predecessor The harness session id of the run that handed off.
 * @returns {string}
 */
export const continuation = (predecessor: string): string =>
  `This run continues a dpm skill run handed off from the harness session ${predecessor}, so Session `
  + `Startup is a resume: call ${PREFIX}adopt_session with this run's session id as \`id\` and `
  + `${predecessor} as \`predecessor_id\`, passing \`include_body\`, and carry on from the phase and state it `
  + 'returns. What the earlier run settled is in that state and in the rows, and is not facilitated again.';

/** What the model is told when its handoff is accepted. */
export const handedOff = (skill: string): string =>
  `${HANDOFF}: accepted. This turn ends here — ${skill} continues in a fresh context, and that run `
  + 'adopts this session.';

/** The refusal for any call made in a session after its handoff was accepted. */
export const ALREADY_HANDED_OFF = `${HANDOFF}: this run has already handed off, so nothing more is done in `
  + 'this context. The run continues in a fresh one once this turn ends.';

/** What the model is told when there is no skill run to continue. */
export const NOTHING_RUNNING = `${HANDOFF}: no dpm skill was invoked in this session, so there is no run to `
  + 'continue. Nothing was handed off; carry on in this context.';

/**
 * Register the tool and the command.
 *
 * @param pi
 * @param skills The dpm skills, by name — the only ones either will continue.
 */
export function registerHandoff(pi: ExtensionAPI, skills: ReadonlySet<string>): void {
  let running: Invocation | null = null;
  let pending: string | null = null;

  // Both belong to the session they were set in, as the announcement and the phase plan do.
  pi.on('session_start', () => {
    running = null;
    pending = null;
  });

  pi.on('input', (event) => {
    const invoked = invocation(event.text);

    if (invoked !== null && skills.has(invoked.skill)) running = invoked;
  });

  pi.registerTool({
    name: HANDOFF,
    label: 'Handoff',
    description: 'End this skill run here and continue it in a fresh context, where it adopts this session. '
      + 'Record everything the rest of the run needs in the session state first: the fresh context has only '
      + 'that state and the rows.',
    parameters: { type: 'object', additionalProperties: false, properties: {} } as unknown as ToolDefinition['parameters'],
    executionMode: 'sequential',

    async execute() {
      if (running === null) throw new Error(NOTHING_RUNNING);

      pending = continueCommand(running);

      return {
        content: [{ type: 'text', text: handedOff(running.skill) }],
        details: { continues: pending },
        terminate: true,
      };
    },
  });

  // A call after an accepted handoff — a second `handoff`, or the next unit's work — is refused, and
  // refused terminating, so the batch it is in still ends the loop.
  pi.on('tool_call', () => (pending === null ? undefined : { block: true, reason: ALREADY_HANDED_OFF, terminate: true }));

  // Only for a handoff after other calls in its own message: their results were final before it ran,
  // so the loop goes on to another request, and this cuts that request off.
  pi.on('turn_end', (event, ctx) => {
    if (pending === null) return;

    const content = (event.message as { content?: unknown }).content;
    const calls = (Array.isArray(content) ? content : []).filter((block) => block?.type === 'toolCall');

    if (calls.findIndex((call) => call.name === HANDOFF) > 0) ctx.abort();
  });

  pi.on('agent_settled', () => {
    if (pending === null) return;

    const command = pending;

    pending = null;

    // Sent once this event has finished, not from inside it: the command replaces the session whose
    // event this handler is running in.
    setTimeout(() => pi.sendUserMessage(command, { expandPromptTemplates: true }), 0);
  });

  pi.registerCommand(CONTINUE, {
    description: `Continue a dpm skill run in a fresh context that adopts this session: /${CONTINUE} <skill> [arguments]`,

    handler: async (args, ctx) => {
      const target = continued(args);

      if (target === null || !skills.has(target.skill)) {
        throw new Error(`dpm: /${CONTINUE} continues a dpm skill, as /${CONTINUE} dpm-epics 01 — `
          + `"${args.trim()}" names none`);
      }

      await ctx.waitForIdle();

      const predecessor = ctx.sessionManager.getSessionId();

      await ctx.newSession({
        withSession: async (fresh) => {
          await fresh.sendMessage(
            { customType: NOTE, content: continuation(predecessor), display: false },
            { deliverAs: 'nextTurn' },
          );

          // Not awaited: the continued run is the new session's, and a command that waited for it
          // would hold every earlier session open until the last one finished.
          fresh.sendUserMessage(skillMessage(target.skill, target.args), { expandPromptTemplates: true })
            .catch((error: unknown) => fresh.ui.notify(`dpm: /${CONTINUE} could not start ${target.skill}: `
              + `${error instanceof Error ? error.message : String(error)}`, 'error'));
        },
      });
    },
  });
}
