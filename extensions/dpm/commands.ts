/**
 * `/dpm-*` — one command per skill, each a route to `/skill:dpm-*`. Spec §6.3, R10–R11.
 *
 * **Why the commands exist when pi already registers `/skill:dpm-spec`.** They are the names the
 * skills use for each other ("recommend `dpm-retro` on the epic"), the names OpenCode users type,
 * and the only ones that can offer argument completions. What they must not be is a second
 * behaviour. So a handler does nothing but send the `/skill:` form, and `activation.ts` sees that
 * form the same way whichever route produced it (R11).
 *
 * **A command whose skill pi has not loaded fails loudly.** The extension and the skills reach pi
 * separately — the extension through `-e` or a package, the skills through a `skills` setting —
 * and they can be configured apart. Without this check, `/skill:dpm-spec` with no skill behind it
 * passes through pi unexpanded, and the model receives the literal text of a command.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { DiscoveredSkill } from '../../src/plugin/skills.ts';

/**
 * pi's completion item, read off `registerCommand` rather than imported from `pi-tui`, which pi's
 * shrinkwrap nests where the type checker does not look.
 */
type AutocompleteItem = NonNullable<Awaited<ReturnType<
  NonNullable<Parameters<ExtensionAPI['registerCommand']>[1]['getArgumentCompletions']>
>>>[number];

/**
 * The skills that take an enumerable argument, and its values (R10).
 *
 * **Named rather than derived, and held to the body instead.** No skill declares its arguments in
 * front matter, and parsing them out of prose would be a guess at a format nothing enforces.
 * `pi-skills.test.js` checks each value against the skill's own body, so a mode that is renamed
 * there fails a test rather than completing to something the skill no longer accepts.
 */
export const COMPLETIONS: Readonly<Record<string, readonly string[]>> = {
  'dpm-retro': ['learn', 'retire', 'triage'],
};

/** The message a command sends: the skill's `/skill:` form, with arguments if there are any. */
export const skillMessage = (skill: string, args: string): string =>
  (args.trim() ? `/skill:${skill} ${args.trim()}` : `/skill:${skill}`);

/**
 * A skill's completions for the typed prefix, or `null` when it has none or none match.
 *
 * @param skill
 * @returns {((prefix: string) => AutocompleteItem[] | null) | undefined}
 */
export function completionsFor(skill: string): ((prefix: string) => AutocompleteItem[] | null) | undefined {
  const values = COMPLETIONS[skill];

  if (values === undefined) return undefined;

  return (prefix) => {
    const items = values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));

    return items.length > 0 ? items : null;
  };
}

/**
 * Register a command for every skill.
 *
 * The handler waits for the agent to be idle before sending. A command typed during a run would
 * otherwise have to choose between steering that run and queueing behind it, and a skill's opening
 * turn is neither.
 *
 * @param pi
 * @param skills As `discoverSkills` read them from this package.
 * @param skillsDirectory Named in the refusal, so the fix is in the message.
 */
export function registerCommands(pi: ExtensionAPI, skills: readonly DiscoveredSkill[], skillsDirectory: string): void {
  for (const skill of skills) {
    const getArgumentCompletions = completionsFor(skill.name);

    pi.registerCommand(skill.name, {
      ...(skill.description === undefined ? {} : { description: skill.description }),
      ...(getArgumentCompletions === undefined ? {} : { getArgumentCompletions }),

      handler: async (args, ctx) => {
        const loaded = pi.getCommands().some((command) => command.source === 'skill' && command.name === `skill:${skill.name}`);

        if (!loaded) {
          throw new Error(`dpm: /${skill.name} has no skill behind it — pi has not loaded the skill "${skill.name}". `
            + `Add ${skillsDirectory} to the "skills" setting.`);
        }

        await ctx.waitForIdle();
        pi.sendUserMessage(skillMessage(skill.name, args), { expandPromptTemplates: true });
      },
    });
  }
}
