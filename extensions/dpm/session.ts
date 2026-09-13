/**
 * The session-id announcement — `src/plugin/session-id.ts` on pi's events. Spec §6.3, R12.
 *
 * The skills' Session Startup procedure asks for "the harness's session id", and the model has no
 * way to know it unless it is told. Left to itself, a run makes one up, and the resume path that
 * depends on the id cannot work. The sentence is `announcement()` from the OpenCode plugin,
 * unchanged, so both hosts say the same thing.
 *
 * **Announced on the turn a dpm skill opens, not when the session starts.** The spec names
 * `session_start`, but that event carries no turn: a message sent from it either triggers a turn of
 * its own or waits for whatever the user types next. That would put dpm's sentence into sessions
 * that never run a dpm skill, which the OpenCode plugin was careful not to do. So `activation.ts`
 * arms the announcement when a skill is invoked, and `before_agent_start` attaches it to that turn.
 *
 * **R12 still holds, and holds more simply.** The id is read from the session manager when the turn
 * starts, not saved at `session_start`, so a session reached by `new`, `resume` or `fork` announces
 * its own id with no per-reason handling. `session_start` does one thing: it disarms, so an
 * announcement armed in one session can never be delivered into the next.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { announcement } from '../../src/plugin/session-id.ts';

/** The custom message type the announcement is recorded under in the session. */
export const ANNOUNCEMENT = 'dpm-session-id';

/**
 * Wire the announcement, and return the switch that arms it for the next turn.
 *
 * `display: false` because this is for the model, as OpenCode's synthetic part was. It is still
 * written to the session file, so it can be read back later.
 *
 * `note` rides in the same message, after the sentence, so the skill's phase ids reach the model
 * on the turn that needs them without a second message of dpm's in the turn.
 *
 * @param pi
 * @returns {{ arm: (note?: string | null) => void }}
 */
export function announceSession(pi: ExtensionAPI): { arm: (note?: string | null) => void } {
  let armed = false;
  let pending: string | null = null;

  pi.on('session_start', () => {
    armed = false;
  });

  pi.on('before_agent_start', (_event, ctx) => {
    if (!armed) return undefined;
    armed = false;

    const sentence = announcement(ctx.sessionManager.getSessionId());

    return {
      message: {
        customType: ANNOUNCEMENT,
        content: pending === null ? sentence : `${sentence}\n\n${pending}`,
        display: false,
      },
    };
  });

  return {
    arm: (note = null) => {
      armed = true;
      pending = note;
    },
  };
}
