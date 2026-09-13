/**
 * Per-step thinking — each skill's steps, the level each one wants, and the session call that moves
 * a run between them.
 *
 * **Two MTPLX runs of `/dpm-spec` are the argument.** With thinking on throughout, the run took 4680s
 * and spent 53,719 characters reasoning through steps that only transcribe what a gate already
 * settled. With it off throughout, it took 2806s, and the steps that need judgement got worse:
 * acceptance criteria that restate their requirement, trade-offs recorded against option ids the
 * model made up. Neither setting is right for a whole skill, so a skill says which of its steps get
 * which.
 *
 * **Declared in front matter, read with the reader that already exists.** `phases: recap:off
 * decisions:high …` lists the steps in the order the body runs them. A skill with no steps worth
 * telling apart declares `thinking: <level>` instead. pi ignores keys it does not know, and the body
 * is left alone, so the declaration and the procedure cannot drift into one another's wording.
 *
 * **The signal is the call a run already makes.** Session Startup has every run move `phase` on as
 * a step closes, so the call that names the next step is the moment to change the level. pi reads the
 * level again before each request, including inside a run already under way, which a skill always is
 * — its gates are tool calls.
 *
 * **A run that never makes the call is reminded where a step can end.** The third MTPLX run named
 * `recap`, then `functional`, and then no phase at all for eight gates, so its ADRs were decided at
 * `functional`'s level. A step ends only when a gate is answered, so every answer to `question`
 * carries the current phase and the id after it. The reminder lands after the approval and before the
 * next draft, which is exactly where the level has to change, and it is in a tool result the model
 * has to read to go on.
 *
 * **An id the skill does not declare is refused; the order is not checked.** A refusal carries the
 * list, so a run that passed `Section 4` corrects itself on the next call rather than running a
 * judgement step at a transcription step's level. Order is left alone because "the next step" is not
 * well defined: some steps are conditional, `retro` and `library` have modes, and `do` repeats its
 * steps for every task. `complete` is accepted from every skill as the phase a finished run records,
 * and it changes no level.
 *
 * **Applied when the call succeeds, not when it is made.** A session call that dpm refuses recorded
 * no phase, and a level changed for it would describe a step the row says was never started.
 *
 * **The level outlives the run.** A skill often ends on a question answered in the next prompt, and
 * resetting to the user's level at that point would drop a judgement step to it mid-skill. The next
 * skill replaces it; `/thinking` still works in between.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { DiscoveredSkill } from '../../src/plugin/skills.ts';

import { frontMatter } from '../../src/plugin/skills.ts';
import { PREFIX } from './adapter.ts';
import { GATE } from './gate.ts';

export type ThinkingLevel = Parameters<ExtensionAPI['setThinkingLevel']>[0];

/** Every level pi accepts. A model that supports fewer has the level clamped by pi, not here. */
export const LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** Where a phased skill starts: Session Startup lists sessions and reads the library, which is recording work. */
export const START: ThinkingLevel = 'off';

/** The phase a finished run records. Every skill accepts it, none declares it, and it sets no level. */
export const FINAL = 'complete';

/** The calls that name the step about to start. */
export const MOVES: readonly string[] = [`${PREFIX}create_session`, `${PREFIX}update_session`];

/** The call that hands back the step an earlier run had reached. */
export const ADOPT = `${PREFIX}adopt_session`;

export type Phase = { readonly id: string; readonly level: ThinkingLevel };

/** A skill's declaration: the level it opens at, and its steps — none for a `thinking:` skill. */
export type Plan = { readonly start: ThinkingLevel; readonly phases: readonly Phase[] };

function levelFrom(value: string, where: string): ThinkingLevel {
  if (!(LEVELS as readonly string[]).includes(value)) {
    throw new Error(`${where}: "${value}" is not a thinking level (${LEVELS.join(', ')})`);
  }

  return value as ThinkingLevel;
}

/**
 * A skill's plan, or `null` when its front matter declares none.
 *
 * Refuses rather than skips a malformed declaration: an extension that loaded with one skill's steps
 * silently missing would run that skill at whatever level was left over, which is the failure this
 * module exists to remove.
 *
 * @param skill
 * @returns {Plan | null}
 */
export function planFor(skill: Pick<DiscoveredSkill, 'name' | 'content'>): Plan | null {
  const { phases, thinking } = frontMatter(skill.content);

  if (phases !== undefined && thinking !== undefined) {
    throw new Error(`${skill.name}: declares both phases and thinking; a skill has steps or it has one level`);
  }

  if (thinking !== undefined) return { start: levelFrom(thinking, skill.name), phases: [] };
  if (phases === undefined) return null;

  const parsed = phases.split(/\s+/).filter((entry) => entry !== '').map((entry) => {
    const [id, level, ...rest] = entry.split(':');

    if (!id || level === undefined || rest.length > 0) {
      throw new Error(`${skill.name}: phase "${entry}" is not written as id:level`);
    }

    if (id === FINAL) throw new Error(`${skill.name}: "${FINAL}" is every skill's final phase and is not declared`);

    return { id, level: levelFrom(level, `${skill.name} phase ${id}`) };
  });

  const ids = parsed.map((phase) => phase.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);

  if (repeated.length > 0) throw new Error(`${skill.name}: phase ids repeat (${repeated.join(', ')})`);
  if (parsed.length === 0) throw new Error(`${skill.name}: declares phases and lists none`);

  return { start: START, phases: parsed };
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

const listed = (plan: Plan) => `${plan.phases.map((phase) => phase.id).join(', ')}, then \`${FINAL}\` when the run is finished`;

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
      + `${plan.phases[0]!.id} or a later one — with ${PREFIX}create_session or ${update}.`;
  }

  const index = plan.phases.findIndex((phase) => phase.id === current);
  const next = plan.phases[index + 1];

  if (next === undefined) {
    return `Phase: \`${current}\`, the last. If this answer finishes the run, call ${update} with phase `
      + `\`${FINAL}\`.`;
  }

  return `Phase: \`${current}\`. If this answer closes that step, call ${update} with phase \`${next.id}\` `
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
 * Wire the guard, the level changes and the reminder, and return the switch that starts a skill's plan.
 *
 * @param pi
 * @param declared Each skill's plan, as `plans` read them.
 * @returns {{ activate: (skill: string) => string | null }} `activate` sets the opening level and
 *   returns the note for the announcement.
 */
export function registerPhases(pi: ExtensionAPI, declared: Readonly<Record<string, Plan>>): {
  activate: (skill: string) => string | null
} {
  let running: string | null = null;
  let current: string | null = null;

  const known = (phase: unknown): phase is string => running !== null && typeof phase === 'string'
    && (phase === FINAL || declared[running]!.phases.some((entry) => entry.id === phase));

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

    if (plan.phases.length === 0 || !known(phase)) return undefined;

    current = phase;

    const level = plan.phases.find((entry) => entry.id === phase)?.level;

    if (level !== undefined) pi.setThinkingLevel(level);

    return undefined;
  });

  return {
    activate(skill) {
      const plan = Object.hasOwn(declared, skill) ? declared[skill]! : null;

      running = plan === null ? null : skill;
      current = null;
      if (plan === null) return null;

      pi.setThinkingLevel(plan.start);

      return phaseNote(plan);
    },
  };
}
