/**
 * `check_coverage` — a spec's gap check as one read, where a skill used to assemble it from dozens.
 *
 * **An MTPLX epics run did the check by hand and got it wrong in the ways a hand count goes wrong.**
 * It listed coverage for fourteen of sixteen requirements and reported all sixteen covered, while the
 * two it skipped were environmental and had nothing bound. It missed an unbound criterion, and every
 * count in its final tree was off by one or two. None of those is a judgement: which requirement has
 * no live binding, which criterion is neither bound nor warranted, how many tasks there are — each is
 * a query, and a query does not skip a row because the context was long.
 *
 * **What stays with the caller is the half that needs reading.** Whether a spec criterion is carried
 * by one of the story criteria covering its requirement is a comparison of two texts, and no column
 * says so. So the report puts both side by side for every must-have requirement and decides nothing
 * about them; the caller finds each counterpart or names the gap.
 *
 * **The rules are the ones already written elsewhere, not restated.** A criterion is accounted for by
 * `withAccountedFor`, which `list_story_criterion` also returns; a binding counts while
 * `retired_at` is NULL, which is what that rule reads too. A gap is a must-have or environmental
 * requirement with nothing live bound to it, and a should- or could-have one is a warning — the epics
 * skill's own terms. Excluded requirements, deferred or out of scope or won't-have, are listed and
 * never flagged.
 *
 * **An untagged criterion is a gap too.** The seventh MTPLX epics run approved a story's tags gate
 * and never wrote the tags, and this check passed it: four criteria with no test approach, found only
 * by a query afterwards. Step 3 tags every criterion, so a criterion without one is work skipped, and
 * which ones those are is a query like the rest.
 *
 * **An epic's roll-up is counted here too.** The first MTPLX dpm-do run closed an epic and reported
 * "12 of the 12 bindings that remain" where the rows held thirteen — it had added up the pages of
 * `list_coverage` by hand, exactly as the epics run had added up its coverage. `epic_id` scopes the
 * count and leaves the standings alone: which requirements are gaps is a question about the spec,
 * and one epic's rows never answer it.
 *
 * **Three warnings name work that is owed rather than a breakdown that is wrong**, and each comes
 * from a state the tally-speed chain reached with every row about it correct. A requirement whose
 * bindings are all verified and which carries no claim; a requirement nobody wrote an acceptance
 * criterion for; one criterion's sentence declared by two stories. None is a gap — a run passes
 * through the first of them every time, in the window between the last verification and the claim —
 * so none touches `ok`, and each is a query rather than a judgement, which is this file's whole
 * argument for asking it here instead of leaving it to a reader at the end of a long run.
 *
 * **Deliberately unbounded**, for `check_integrity`'s reason: a truncated gap report is a false pass.
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Context, Row, Tool } from '../convention.ts';

import { withAccountedFor } from '../../coverage/warrant.ts';
import { defineTool, ToolError } from '../convention.ts';

/** The spec's epics' stories, joined to their epic — every query below starts from these. */
const STORIES = `
  SELECT story.id, story.epic_id, story.number, story.title, epic.slug AS epic
    FROM story
    JOIN document AS epic ON epic.id = story.epic_id
   WHERE epic.kind = 'epic' AND epic.parent_id = ? AND epic.archived_at IS NULL
   ORDER BY epic.sequence, story.position, story.number
`;

const ENVIRONMENTAL = new Set(['environmental_requirement', 'environmental_restriction']);

/** `?, ?, ?` for a list, so an empty list still produces valid SQL through `IN (NULL)`. */
const marks = (values: unknown[]) => (values.length === 0 ? 'NULL' : values.map(() => '?').join(', '));

/** Why a requirement is out of the check, or null when it is in it. */
const excluded = (requirement: Row) => requirement.exclusion ?? (requirement.moscow === 'wont' ? 'wont' : null);

/** gap, warning, covered or excluded — the one place a requirement's standing is decided. */
function standing(requirement: Row, coverage: number) {
  if (excluded(requirement)) return 'excluded';
  if (coverage > 0) return 'covered';
  if (requirement.moscow === 'must' || ENVIRONMENTAL.has(requirement.class)) return 'gap';
  return 'warning';
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} specId
 * @returns {object}
 */
export function coverageReport(db: DatabaseSync, specId: string, epicId: string | null = null) {
  const all = (sql: string, ...values: unknown[]) => db.prepare(sql).all(...values as SQLInputValue[]) as Row[];

  const spec = db.prepare('SELECT id, kind FROM document WHERE id = ?').get(specId) as Row | undefined;

  if (!spec || spec.kind !== 'spec') {
    throw new ToolError(`check_coverage: spec_id '${specId}' names no spec`
      + (spec ? ` — it is a ${spec.kind}` : ''));
  }

  const epics = all(`SELECT id FROM document
                      WHERE kind = 'epic' AND parent_id = ? AND archived_at IS NULL`, specId);
  const stories = all(STORIES, specId);
  const storyOf = new Map(stories.map((story) => [story.id, story]));
  const storyIds = stories.map((story) => story.id);

  const criteria = withAccountedFor(db, {
    items: all(`SELECT id, story_id, polarity, text, warrant_adr_id FROM story_criterion
                 WHERE superseded_at IS NULL AND story_id IN (${marks(storyIds)})
                 ORDER BY story_id, position`, ...storyIds),
  }) as { items: Row[] };
  const criterionOf = new Map(criteria.items.map((criterion) => [criterion.id, criterion]));
  const criterionIds = [...criterionOf.keys()];

  const requirements = all(`SELECT id, label, class, moscow, exclusion, text, coverage_claimed_at
                              FROM requirement
                             WHERE spec_id = ? ORDER BY position`, specId);
  const coverage = all(`SELECT coverage.id, coverage.requirement_id, coverage.spec_fragment,
                               coverage.story_criterion_id, coverage.verified_at
                          FROM coverage JOIN requirement ON requirement.id = coverage.requirement_id
                         WHERE requirement.spec_id = ? AND coverage.retired_at IS NULL
                         ORDER BY requirement.position, coverage.position`, specId);
  const specCriteria = all(`SELECT acceptance_criterion.id, requirement_id, polarity,
                                   acceptance_criterion.text
                              FROM acceptance_criterion
                              JOIN requirement ON requirement.id = acceptance_criterion.requirement_id
                             WHERE requirement.spec_id = ?
                             ORDER BY requirement.position, acceptance_criterion.position`, specId);

  /** Where a story criterion sits, in the words a breakdown uses. */
  const located = (criterionId: string) => {
    const criterion = criterionOf.get(criterionId);
    const story = criterion ? storyOf.get(criterion.story_id) : undefined;

    return story ? { epic: story.epic, story: story.number, story_title: story.title } : { epic: null, story: null };
  };

  const report = requirements.map((requirement) => {
    const rows = coverage.filter((row) => row.requirement_id === requirement.id);
    const verified = rows.filter((row) => row.verified_at !== null).length;

    return {
      id: requirement.id,
      label: requirement.label,
      class: requirement.class,
      moscow: requirement.moscow,
      exclusion: excluded(requirement),
      coverage: rows.length,
      verified,
      claimed: requirement.coverage_claimed_at !== null,
      standing: standing(requirement, rows.length),
    };
  });

  const unaccounted = criteria.items
    .filter((criterion) => criterion.accounted_for === false)
    .map((criterion) => ({ id: criterion.id, ...located(criterion.id), polarity: criterion.polarity, text: criterion.text }));

  // Must-haves only, as the skill scopes the comparison: both texts, and no verdict.
  const mustHaves = requirements
    .filter((requirement) => requirement.moscow === 'must' && !excluded(requirement))
    .map((requirement) => ({
      id: requirement.id,
      label: requirement.label,
      text: requirement.text,
      spec_criteria: specCriteria
        .filter((criterion) => criterion.requirement_id === requirement.id)
        .map(({ id, polarity, text }) => ({ id, polarity, text })),
      covering_criteria: coverage
        .filter((row) => row.requirement_id === requirement.id)
        .map((row) => ({
          story_criterion_id: row.story_criterion_id,
          ...located(row.story_criterion_id),
          polarity: criterionOf.get(row.story_criterion_id)?.polarity ?? null,
          text: criterionOf.get(row.story_criterion_id)?.text ?? null,
          spec_fragment: row.spec_fragment,
        })),
    }));

  const count = (sql: string, ...values: unknown[]) => (db.prepare(sql).get(...values as SQLInputValue[]) as { n: number }).n;
  const coverageIds = coverage.map((row) => row.id);

  const tagged = new Set(all(`SELECT DISTINCT story_criterion_id FROM story_criterion_approach
                               WHERE story_criterion_id IN (${marks(criterionIds)})`, ...criterionIds)
    .map((row) => row.story_criterion_id));
  const untagged = criteria.items
    .filter((criterion) => !tagged.has(criterion.id))
    .map((criterion) => ({ id: criterion.id, ...located(criterion.id), polarity: criterion.polarity, text: criterion.text }));

  // **Every binding verified, and nothing claiming the set.** A do-run claimed thirteen
  // requirements in one sweep and skipped the fourteenth: FR6, whose single binding was verified
  // and whose story was complete. Nothing reported it, because every row *about* FR6 was right —
  // the act that was missing was the claim over them, and a claim is the one thing no row implies
  // (`claim.ts` says why it cannot be derived). What can be derived is when one is owed, and that
  // is a query: live bindings, all verified, no `coverage_claimed_at`. Asked here rather than left
  // to a reader comparing two lists by eye at the end of a long run, which is how it was missed.
  const claimable = report
    .filter((requirement) => requirement.standing !== 'excluded'
      && requirement.coverage > 0
      && requirement.verified === requirement.coverage
      && !requirement.claimed)
    .map(({ id, label, coverage: bound }) => ({ id, label, coverage: bound }));

  // **A requirement nobody wrote an acceptance criterion for.** A spec run wrote criteria for FR1
  // through FR3, moved on to the NFR block, and left eleven of twenty-two requirements with none —
  // four of them live should-haves that were implemented and claimed anyway. No check saw it,
  // because coverage answers a different question: a story criterion discharges a *fragment*, and
  // never says what the requirement would have to do to count as satisfied. So a requirement with
  // bindings and no criteria reads as covered from every angle this report had before this line.
  //
  // Excluded requirements are passed over, as they are everywhere else here: a won't-have with no
  // criteria is a won't-have.
  const uncriteriated = requirements
    .filter((requirement) => !excluded(requirement)
      && !specCriteria.some((criterion) => criterion.requirement_id === requirement.id))
    .map(({ id, label, moscow, class: klass }) => ({ id, label, moscow, class: klass }));

  // **One criterion's sentence written twice, under two stories.** `coverage`'s natural key is
  // `(requirement_id, spec_fragment, story_criterion_id)`, so two stories declaring the same
  // sentence and binding it to the same fragment produce two legal rows — two obligations to a
  // roll-up, two things to verify, and one obligation in fact. An epics run wrote FR3's
  // standard-output criterion into story 1.3 and again into story 2.2, each with its own binding.
  //
  // **Reported and not refused, which is the half `create_story_criterion` cannot take.** Its
  // guard refuses a second copy *within* one story outright, because one story has no reason to
  // hold the same check twice. Across stories the same text is a judgement about the breakdown —
  // two stories genuinely sharing one criterion is a state the schema has a row for, in
  // `coverage_story` — and which of the pair is the copy is not a fact about the text. So the two
  // halves of one rule are enforced in the two places each can be settled, and neither covers the
  // other. Whitespace is folded so a re-wrapped copy is still a copy, which the guard's exact
  // match on `text` would miss; case is not folded, since these are prose.
  const byText = new Map<string, Row[]>();

  for (const criterion of criteria.items) {
    const key = criterion.text.replace(/\s+/g, ' ').trim();
    byText.set(key, [...byText.get(key) ?? [], criterion]);
  }

  const duplicated = [...byText.values()]
    .filter((group) => new Set(group.map((criterion) => criterion.story_id)).size > 1)
    .map((group) => ({
      text: group[0].text,
      criteria: group.map((criterion) => ({ id: criterion.id, ...located(criterion.id) })),
    }));

  // One epic's bindings, counted. The requirement standings above stay the spec's: an epic that
  // covers four of sixteen requirements has not turned the other twelve into gaps, and a report
  // that said so would be wrong in the direction that stops a run.
  const epicScope = epicId === null ? null : (() => {
    const epic = db.prepare(`SELECT id, slug, parent_id FROM document
                              WHERE id = ? AND kind = 'epic'`).get(epicId) as Row | undefined;

    if (!epic) throw new ToolError(`check_coverage: epic_id '${epicId}' names no epic`);

    if (epic.parent_id !== specId) {
      throw new ToolError(`check_coverage: epic '${epic.slug}' (${epicId}) is not an epic of this spec`);
    }

    const mine = coverage.filter((row) => located(row.story_criterion_id).epic === epic.slug);
    const byLabel = new Map<string, { label: string; bindings: number; verified: number }>();

    for (const row of mine) {
      const label = requirements.find((requirement) => requirement.id === row.requirement_id)?.label ?? row.requirement_id;
      const seen = byLabel.get(label) ?? { label, bindings: 0, verified: 0 };

      byLabel.set(label, {
        label,
        bindings: seen.bindings + 1,
        verified: seen.verified + (row.verified_at === null ? 0 : 1),
      });
    }

    return {
      id: epic.id,
      slug: epic.slug,
      stories: stories.filter((story) => story.epic === epic.slug).length,
      bindings: mine.length,
      verified: mine.filter((row) => row.verified_at !== null).length,
      by_requirement: [...byLabel.values()],
    };
  })();

  const gaps = [
    ...report.filter((requirement) => requirement.standing === 'gap')
      .map((requirement) => `${requirement.label} has no live coverage`),
    ...unaccounted.map((criterion) => `${criterion.epic} story ${criterion.story}: '${criterion.text}' is neither bound nor warranted`),
    ...untagged.map((criterion) => `${criterion.epic} story ${criterion.story}: '${criterion.text}' has no approach tag`),
  ];

  return {
    spec_id: specId,
    ok: gaps.length === 0,
    gaps,
    // **None of the three lists below reaches `gaps`, and that is a decision rather than an
    // oversight.** `ok` is read as "may this run close", and each names work that is owed rather
    // than a breakdown that is wrong: a requirement is claimable for the whole window between its
    // last binding being verified and the claim being made, which is an ordinary state in the
    // middle of a do-run and not a reason to stop one.
    warnings: [
      ...report.filter((requirement) => requirement.standing === 'warning')
        .map((requirement) => `${requirement.label} (${requirement.moscow ?? 'no band'}) has no live coverage`),
      ...claimable.map((requirement) =>
        `${requirement.label} has ${requirement.coverage} live binding${requirement.coverage === 1 ? '' : 's'}, `
        + 'all verified, and no completeness claim'),
      ...uncriteriated.map((requirement) =>
        `${requirement.label} (${requirement.moscow ?? 'no band'}) has no acceptance criterion`),
      ...duplicated.map((group) =>
        `'${group.text}' is declared by ${group.criteria.length} stories: `
        + `${group.criteria.map((criterion) => `${criterion.epic} story ${criterion.story}`).join(', ')}`),
    ],
    requirements: report,
    unaccounted_criteria: unaccounted,
    untagged_criteria: untagged,
    claimable,
    uncriteriated,
    duplicated_criteria: duplicated,
    epic: epicScope,
    must_have_criteria: mustHaves,
    counts: {
      requirements: requirements.length,
      requirements_in_scope: report.filter((requirement) => requirement.standing !== 'excluded').length,
      epics: epics.length,
      stories: stories.length,
      story_criteria: criterionIds.length,
      must_not: criteria.items.filter((criterion) => criterion.polarity === 'must_not').length,
      warranted: criteria.items.filter((criterion) => criterion.warrant_adr_id !== null).length,
      tags: count(`SELECT count(*) AS n FROM story_criterion_approach
                    WHERE story_criterion_id IN (${marks(criterionIds)})`, ...criterionIds),
      untagged: untagged.length,
      tasks: count(`SELECT count(*) AS n FROM task WHERE story_id IN (${marks(storyIds)})`, ...storyIds),
      coverage: coverage.length,
      coverage_story: count(`SELECT count(*) AS n FROM coverage_story
                              WHERE coverage_id IN (${marks(coverageIds)})`, ...coverageIds),
      dependencies: count(`SELECT count(*) AS n FROM dependency
                            WHERE source_story_id IN (${marks(storyIds)})
                               OR target_story_id IN (${marks(storyIds)})`, ...storyIds, ...storyIds),
    },
  };
}

/**
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @returns {object[]}
 */
export function coverageCheckTools({ db }: Context): Tool[] {
  return [
    defineTool({
      name: 'check_coverage',
      table: 'coverage',
      description:
        "Report a spec's breakdown against its requirements, counted from the rows: each requirement's "
        + 'live coverage and standing (gap: must-have or environmental with none; warning: should or '
        + 'could with none; excluded: deferred, out of scope or won\'t), every live story criterion '
        + 'neither bound nor warranted, every one with no approach tag, each must-have\'s spec criteria beside the story criteria '
        + 'covering it for the caller to match, and the counts of epics, stories, criteria, tags, '
        + 'tasks, coverage and edges. Warns where work is owed rather than wrong: a requirement '
        + 'whose live bindings are all verified and which carries no completeness claim, one with '
        + 'no acceptance criterion, and one criterion\'s text declared by two stories. '
        + 'With `epic_id`, adds that epic\'s own binding count and how '
        + 'many are verified, per requirement — the roll-up number a skill would otherwise add up by '
        + 'hand. Deliberately unbounded.',
      reads: ['coverage', 'requirement', 'acceptance_criterion', 'story_criterion', 'story', 'document',
        'story_criterion_approach', 'task', 'coverage_story', 'dependency'],
      mutates: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          spec_id: { type: 'string', minLength: 1 },
          epic_id: {
            type: 'string',
            minLength: 1,
            description: "One epic of this spec, to count its own bindings — the epic summary's roll-up",
          },
        },
        required: ['spec_id'],
      },
      handler: (args) => coverageReport(db, args.spec_id, args.epic_id ?? null),
    }),
  ];
}
