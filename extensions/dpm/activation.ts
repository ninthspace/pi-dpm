/**
 * Per-skill tool activation — `allowlist.ts`'s result through `pi.setActiveTools`. Spec §7.1, R13–R14.
 *
 * **The derivation is not reimplemented; it is the same function.** `allowances()` in
 * `src/plugin/allowlist.ts` reads each skill body and the shared conventions for `dpm_*` names, and
 * it touches the OpenCode SDK only through `import type`, which is erased. Calling it here makes
 * parity with the OpenCode allow-list (R14) a fact of construction. `pi-skills.test.js` still checks
 * it at the far end, in the request pi actually sends.
 *
 * **What OpenCode needed and this does not.** There, the narrowing was a session PATCH with a
 * ruleset whose order decided the outcome, read off a minified binary. Here it is one documented
 * call, which replaces the active set and takes effect on the next request.
 *
 * **Only dpm's tools are touched.** The active set is kept for every name without the `dpm_` prefix
 * — pi's built-ins, `question`, and anything another extension registered — and dpm's are replaced
 * with the skill's allowance. A second skill therefore narrows to its own set, not to the
 * intersection of both.
 *
 * **A session that runs no dpm skill keeps all of dpm's tools**, as it does on OpenCode. Narrowing
 * without a skill to narrow to would leave a plain session unable to reach any of them.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { PREFIX } from './adapter.ts';

/** `/skill:<name>`, followed by arguments or nothing. The shape `_expandSkillCommand` accepts. */
const SKILL_COMMAND = /^\/skill:([^\s]+)(?:\s|$)/;

/**
 * The skill a prompt invokes, or `null` when it invokes none.
 *
 * @param text Raw input, before pi expands it.
 * @returns {string | null}
 */
export function skillInvoked(text: string): string | null {
  return text.match(SKILL_COMMAND)?.[1] ?? null;
}

/**
 * The active set with dpm's tools replaced by `allowance`.
 *
 * @param active What `pi.getActiveTools()` returned.
 * @param allowance The skill's tools, as `allowances()` derived them.
 * @returns {string[]}
 */
export function narrowed(active: readonly string[], allowance: readonly string[]): string[] {
  return [...active.filter((name) => !name.startsWith(PREFIX)), ...allowance];
}

/**
 * Narrow to a skill's tools when it is invoked, and tell `onActivate` which skill it was.
 *
 * **Every route to a skill comes through here, which is how R11 is met.** Typing `/skill:dpm-spec`
 * reaches pi's `input` event. So does `/dpm-spec`, because its handler sends `/skill:dpm-spec` with
 * `expandPromptTemplates` (`commands.ts`), and pi raises `input` for that message before expanding
 * it. The two routes are one route from this point, so their activation cannot differ.
 *
 * @param pi
 * @param tools Each dpm skill's allowance, keyed by skill name.
 * @param onActivate Called after narrowing, with the skill's name.
 */
export function activateSkills(
  pi: ExtensionAPI,
  tools: Readonly<Record<string, readonly string[]>>,
  onActivate: (skill: string) => void,
): void {
  pi.on('input', (event) => {
    const skill = skillInvoked(event.text);

    // `Object.hasOwn`, because `in` would take `/skill:constructor` for one of dpm's.
    if (skill === null || !Object.hasOwn(tools, skill)) return;

    pi.setActiveTools(narrowed(pi.getActiveTools(), tools[skill]!));
    onActivate(skill);
  });
}
