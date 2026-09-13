/**
 * Thinking per skill, and each skill's steps — the level a skill runs at, the ids a run records as
 * it moves between steps, and the reminder that keeps it moving.
 *
 * **Two MTPLX runs of `/dpm-spec` are why a skill has a level at all.** With thinking on throughout,
 * the run took 4680s. With it off throughout, it took 2806s, and the steps that need judgement got
 * worse: acceptance criteria that restate their requirement, trade-offs recorded against option ids
 * the model made up. So a skill says what level it wants rather than inheriting whatever was left.
 *
 * **One level per skill, set when the skill starts — not one per step.** The level used to follow the
 * step, and the fifth MTPLX run showed what that costs: every change of level throws away the
 * server's prompt cache. The Qwen template writes the effort into the first line of the system prompt,
 * and MTPLX renders earlier turns differently with thinking on than off, so the whole context is
 * processed again — 25,456 tokens in 308s at the first change, 46,558 in 794s at the second, and
 * growing with every step after it. When the skill starts, the context is the system prompt and the
 * tools, which that first request processes anyway, so the change costs nothing.
 *
 * **Declared in front matter, read with the reader that already exists.** Every skill declares
 * `thinking: <level>`; a skill whose run moves through steps also declares `phases: recap functional
 * …`, in the order the body runs them. pi ignores keys it does not know, and the body is left alone,
 * so the declaration and the procedure cannot drift into one another's wording.
 *
 * **A run that stops moving its phase is reminded where a step can end.** The third MTPLX run named
 * `recap`, then `functional`, and then no phase at all for eight gates. A step ends only when a gate
 * is answered, so every answer to `question` carries the current phase and the id after it, in a
 * tool result the model has to read to go on.
 *
 * **An id the skill does not declare is refused; the order is not checked.** A refusal carries the
 * list, so a run that passed `Section 4` corrects itself on the next call. Order is left alone because
 * "the next step" is not well defined: some steps are conditional, `retro` and `library` have modes,
 * and `do` repeats its steps for every task. `complete` is accepted from every skill as the phase a
 * finished run records.
 *
 * **Recorded when the call succeeds, not when it is made.** A session call that dpm refuses recorded
 * no phase, so the reminder does not move past it.
 *
 * **The level outlives the run.** A skill often ends on a question answered in the next prompt, and
 * resetting to the user's level at that point would change it mid-skill. The next skill replaces it;
 * `/thinking` still works in between.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DiscoveredSkill } from '../../src/plugin/skills.ts';

import { frontMatter } from '../../src/plugin/skills.ts';
import { PREFIX } from './adapter.ts';
import { GATE } from './gate.ts';

export type ThinkingLevel = Parameters<ExtensionAPI['setThinkingLevel']>[0];

/** Every level pi accepts. A model that supports fewer has the level clamped by pi, not here. */
export const LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** The phase a finished run records. Every skill accepts it and none declares it. */
export const FINAL = 'complete';

/** The calls that name the step about to start. */
export const MOVES: readonly string[] = [`${PREFIX}create_session`, `${PREFIX}update_session`];

/** The call that hands back the step an earlier run had reached. */
export const ADOPT = `${PREFIX}adopt_session`;

/** A skill's declaration: the level it runs at, and its step ids — none for a skill without steps. */
export type Plan = { readonly level: ThinkingLevel; readonly phases: readonly string[] };

/**
 * A skill's plan, or `null` when its front matter declares none.
 *
 * Refuses rather than skips a malformed declaration: an extension that loaded with one skill's level
 * silently missing would run that skill at whatever level was left over, which is the failure this
 * module exists to remove.
 *
 * @param skill
 * @returns {Plan | null}
 */
export function planFor(skill: Pick<DiscoveredSkill, 'name' | 'content'>): Plan | null {
  const { phases, thinking } = frontMatter(skill.content);

  if (thinking === undefined) {
    if (phases !== undefined) throw new Error(`${skill.name}: declares phases and no thinking level`);

    return null;
  }

  if (!(LEVELS as readonly string[]).includes(thinking)) {
    throw new Error(`${skill.name}: "${thinking}" is not a thinking level (${LEVELS.join(', ')})`);
  }

  const ids = (phases ?? '').split(/\s+/).filter((id) => id !== '');

  for (const id of ids) {
    if (id.includes(':')) {
      throw new Error(`${skill.name}: phase "${id}" carries a level; the skill has one, in thinking`);
    }

    if (id === FINAL) throw new Error(`${skill.name}: "${FINAL}" is every skill's final phase and is not declared`);
  }

  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);

  if (repeated.length > 0) throw new Error(`${skill.name}: phase ids repeat (${repeated.join(', ')})`);
  if (phases !== undefined && ids.length === 0) throw new Error(`${skill.name}: declares phases and lists none`);

  return { level: thinking as ThinkingLevel, phases: ids };
}

/**
 * Every declared plan, keyed by skill name.
 *
 * @param skills What `discoverSkills` found.
 * @returns {Record<string, Plan>}
 */
export function plans(skills: readonly Pick<DiscoveredSkill, 'name' | 'content'>[]): Record<string, Plan> {
  return Object.fromEntries(skills.flatMap((skill) => {
    const plan = planFor(skill);

    return plan === null ? [] : [[skill.name, plan]];
  }));
}

const listed = (plan: Plan) => `${plan.phases.join(', ')}, then \`${FINAL}\` when the run is finished`;

/**
 * What the model is told when the skill opens: the ids, since the body it reads has no front matter.
 *
 * @param plan
 * @returns {string | null} `null` for a skill with no steps, which has nothing to say.
 */
export function phaseNote(plan: Plan): string | null {
  if (plan.phases.length === 0) return null;

  return `This skill's phases, in order: ${listed(plan)}. Whenever a session call carries \`phase\`, `
    + 'pass the id of the phase about to start — no other value is accepted.';
}

/**
 * The refusal for an id the running skill does not declare.
 *
 * @param tool
 * @param skill
 * @param phase
 * @param plan
 * @returns {string}
 */
export function unknownPhase(tool: string, skill: string, phase: string, plan: Plan): string {
  return `${tool}: "${phase}" is not a phase of ${skill}, so nothing was recorded. Its phases, in order: `
    + `${listed(plan)}. Call again with the id of the phase about to start.`;
}

/**
 * What an answered gate adds: where the run is, and what to record if the answer ended that step.
 *
 * @param plan
 * @param current The phase last recorded in this run, or `null` when none has been.
 * @returns {string | null} `null` once the run has recorded `complete`, or for a skill with no steps.
 */
export function reminder(plan: Plan, current: string | null): string | null {
  if (plan.phases.length === 0 || current === FINAL) return null;

  const update = `${PREFIX}update_session`;

  if (current === null) {
    return `Phase: none recorded in this run yet. Before drafting, record the phase about to start — `
      + `${plan.phases[0]!} or a later one — with ${PREFIX}create_session or ${update}.`;
  }

  const next = plan.phases[plan.phases.indexOf(current) + 1];

  if (next === undefined) {
    return `Phase: \`${current}\`, the last. If this answer finishes the run, call ${update} with phase `
      + `\`${FINAL}\`.`;
  }

  return `Phase: \`${current}\`. If this answer closes that step, call ${update} with phase \`${next}\` `
    + '— or a later phase, if that step does not apply — before drafting anything for it. If the step '
    + 'goes on, carry on.';
}

/** The `phase` a successful adoption returned, read from the row it hands back. */
function adoptedPhase(content: readonly { type: string, text?: string }[]): unknown {
  try {
    return JSON.parse(content.map((block) => block.text ?? '').join('')).phase;
  } catch {
    return undefined;
  }
}

/**
 * Wire the guard and the reminder, and return the switch that starts a skill's plan.
 *
 * @param pi
 * @param declared Each skill's plan, as `plans` read them.
 * @returns {{ activate: (skill: string) => string | null }} `activate` sets the skill's level and
 *   returns the note for the announcement.
 */
export function registerPhases(pi: ExtensionAPI, declared: Readonly<Record<string, Plan>>): {
  activate: (skill: string) => string | null
} {
  let running: string | null = null;
  let current: string | null = null;

  const known = (phase: unknown): phase is string => running !== null && typeof phase === 'string'
    && (phase === FINAL || declared[running]!.phases.includes(phase));

  // A plan belongs to the session it was started in, as the announcement does.
  pi.on('session_start', () => {
    running = null;
    current = null;
  });

  pi.on('tool_call', (event) => {
    if (running === null || !MOVES.includes(event.toolName)) return undefined;

    const plan = declared[running]!;
    const { phase } = event.input as { phase?: unknown };

    if (plan.phases.length === 0 || phase === undefined || known(phase)) return undefined;

    return { block: true, reason: unknownPhase(event.toolName, running, String(phase), plan) };
  });

  pi.on('tool_result', (event) => {
    if (running === null || event.isError) return undefined;

    const plan = declared[running]!;

    if (event.toolName === GATE) {
      const text = reminder(plan, current);

      return text === null ? undefined : { content: [...event.content, { type: 'text' as const, text }] };
    }

    let phase: unknown;

    if (event.toolName === ADOPT) phase = adoptedPhase(event.content);
    else if (MOVES.includes(event.toolName)) phase = (event.input as { phase?: unknown }).phase;

    if (plan.phases.length > 0 && known(phase)) current = phase;

    return undefined;
  });

  return {
    activate(skill) {
      const plan = Object.hasOwn(declared, skill) ? declared[skill]! : null;

      running = plan === null ? null : skill;
      current = null;
      if (plan === null) return null;

      pi.setThinkingLevel(plan.level);

      return phaseNote(plan);
    },
  };
}
