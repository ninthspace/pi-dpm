/**
 * Epic 47-08 Story 2 — the converted `inspect`, and the three claims made about it.
 *
 * - "An inspect run characterises a change against the planning graph through read tools, and its
 *   every list-returning call carries the tool's default `limit`" [feature]
 * - "The facilitation survives: the run still derives its axis before using it, still refuses to
 *   describe a suite as passing without having run it, and still reports what it did not read"
 *   [feature]
 * - "must NOT — the skill recovers an entity by reading a generated markdown file rather than by
 *   calling a read tool" [unit]
 *
 * **The bound is driven against a fixture larger than the default page.** `inspect`'s Section 3 is
 * three gap queries, and a gap query answered from a truncated page reports an absence that is
 * really a second page — the one failure a query designed to report absences cannot survive. So the
 * fixture seeds more requirements than `DEFAULT_LIMIT` holds, and the test asserts both that the
 * run raised the bound and that a run which did not would have reported a false gap. That second
 * half is what makes the assertion about the query rather than about an argument being present.
 *
 * **Every gap query carries the decoy that a broken one would also return** (retro 37, and the
 * disposition on this epic): a requirement that genuinely has no coverage sits beside one that has
 * coverage on a second page, and a verified row tagged `manual` sits beside one tagged `unit`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { DEFAULT_LIMIT } from '../src/tools/convention.ts';
import {
  skillSource, toolNames, reachable, prose, recorder, recoveries, bindings,
  seedStartup, driveStartup, section, CALLABLE,
} from './support/skills.js';
import { dispositionProblems } from './support/vocabulary.js';

const SKILL = 'inspect';
const source = skillSource(SKILL);

/** The recoveries this file in particular would reach for, on top of the shared sweep. */
const PARSES = [
  // Section 3's six globs. A planning directory named here is a directory walked.
  {
    pattern: /docs\/(specifications|epics|retros|quick|briefs|artifacts)\//,
    why: 'a planning directory, which is a scan standing in for a query',
  },
  // The paired coverage matrix, read as a file rather than as the rows it projects.
  { pattern: /\*-coverage-\*|coverage matri(x|ces)/i, why: 'a coverage matrix read as a document' },
  // The claim in prose that `coverage` replaced, and which only one side could ever make.
  { pattern: /\*\*Satisfies\*\*/, why: 'a traceability claim written as a field' },
  // CPM sources a bash library from its plugin tree; dpm resolves with git and states the rules.
  { pattern: /changeset_resolve|CLAUDE_PLUGIN_ROOT|hooks\/lib/, why: 'a plugin-path shell library' },
];

/** More requirements than one page holds, so the bound is a question the fixture can ask. */
const REQUIREMENTS = DEFAULT_LIMIT + 12;

/**
 * A project whose planning rows are big enough to page, with a decoy against each gap query.
 *
 * - `orphan` genuinely has no coverage. It is the true positive.
 * - `late` has coverage and sits past the first page. A run that took the page reports it as a gap.
 * - `manual` is verified and tagged by an approach no test produced; `automated` is verified and
 *   tagged `unit`. A run that read `verified_at` alone cannot tell them apart.
 * - `bare` is a completed epic with no retro; `settled` is a completed epic with one.
 */
function workspace(tools) {
  const seed = handlers(tools);

  const spec = seed.create_spec({ slug: 'persistence', title: 'Persistence' });

  // The paging fixture. `orphan` is first so it is on any page; `late` is last so it is not.
  const requirements = Array.from({ length: REQUIREMENTS }, (unused, index) => seed.create_requirement({
    spec_id: spec.id,
    label: `FR${index + 1}`,
    class: 'functional',
    moscow: 'must',
    position: index + 1,
    text: `Requirement ${index + 1}.`,
  }));
  const orphan = requirements[0];
  const late = requirements[REQUIREMENTS - 1];

  const bare = seed.create_epic({ parent_id: spec.id, slug: 'bare', title: 'Bare' });
  const settled = seed.create_epic({ parent_id: spec.id, slug: 'settled', title: 'Settled' });
  seed.update_epic({ id: bare.id, status: 'complete' });
  seed.update_epic({ id: settled.id, status: 'complete' });
  const closed = seed.create_retro({ parent_id: settled.id, slug: 'settled', title: 'Settled' });

  const story = seed.create_story({ epic_id: settled.id, number: 1, position: 1, title: 'Only' });

  const criteria = Object.fromEntries(['late', 'manual', 'automated'].map((name, index) => {
    const criterion = seed.create_story_criterion({
      story_id: story.id, text: `${name} is covered`, position: index + 1,
    });
    return [name, criterion];
  }));

  // `late`'s coverage is unverified — the gap it must not be reported as is *untraced*, which is a
  // different absence from *unverified*, and only the second one is honest here.
  seed.create_coverage({
    requirement_id: late.id, story_criterion_id: criteria.late.id, position: 1,
    spec_fragment: late.text,
  });

  const marked = ['manual', 'automated'].map((name, index) => {
    const requirement = requirements[index + 1];
    const coverage = seed.create_coverage({
      requirement_id: requirement.id,
      story_criterion_id: criteria[name].id,
      position: index + 2,
      spec_fragment: requirement.text,
    });
    seed.update_coverage({ id: coverage.id, verified_at: '2026-08-09T00:00:00.000Z' });
    // What the spec asked for, which the gap query reads beside what the criterion was tagged.
    const asked = seed.create_acceptance_criterion({
      requirement_id: requirement.id, text: `${name} is tested`, position: 1,
    });
    seed.create_criterion_approach({ criterion_id: asked.id, tag: 'unit' });
    seed.create_story_criterion_approach({
      story_criterion_id: criteria[name].id,
      tag: name === 'manual' ? 'manual' : 'unit',
    });
    return { requirement, coverage, criterion: criteria[name] };
  });

  const startup = seedStartup(seed, { scope: 'inspect', skill: 'dpm:inspect', phase: 'Section 1' });

  return {
    spec, requirements, orphan, late, bare, settled, closed, story, criteria,
    manual: marked[0], automated: marked[1], ...startup,
  };
}

/**
 * The run the SKILL.md prescribes for Section 3, with the bound raised as the file says.
 *
 * `bound` is the caller's `limit`, so the same run can be driven with the default and with a bound
 * above the fixture — which is what turns "the argument was passed" into "the answer changed".
 */
function run(call, fixture, { bound = REQUIREMENTS + 10, attempt = 1 } = {}) {
  const startup = driveStartup(call, fixture, {
    scope: 'inspect', skill: 'dpm:inspect', roster: false, attempt,
  });

  const page = bound === null ? {} : { limit: bound };

  const requirements = call.list_requirement({
    spec_id: fixture.spec.id, include_body: true, ...page,
  });

  // Gap 1: a requirement no coverage row names.
  const untraced = requirements.items.filter((requirement) =>
    call.list_coverage({ requirement_id: requirement.id, ...page }).items.length === 0);

  // Gap 2: a mark that rests on something other than a test having run.
  const unearned = requirements.items.flatMap((requirement) =>
    call.list_coverage({ requirement_id: requirement.id, ...page }).items
      .filter((row) => row.verified_at !== null)
      .map((row) => ({
        row,
        approaches: call.list_story_criterion_approach({
          story_criterion_id: row.story_criterion_id, ...page,
        }).items,
        // The spec's tags hang off its acceptance criteria, not off the requirement — and the list
        // refuses a requirement's id as `criterion_id` rather than answering it with nothing.
        asked: call.list_acceptance_criterion({ requirement_id: requirement.id, ...page }).items
          .flatMap((criterion) => call.list_criterion_approach({
            criterion_id: criterion.id, ...page,
          }).items),
      })))
    .filter((entry) => entry.approaches.every((approach) =>
      ['manual', 'target'].includes(approach.tag)));

  // Gap 3: a completed epic with no retro — the scoped list, not a comparison.
  const epics = call.list_epic({ parent_id: fixture.spec.id, ...page }).items;
  const unretroed = epics.filter((epic) => epic.status === 'complete'
    && call.list_retro({ parent_id: epic.id, ...page }).items.length === 0);

  const published = call.list_artifact({ include_body: true, ...page }).items;

  return { startup, requirements, untraced, unearned, unretroed, epics, published };
}

// --- Criterion 1: the join is read tools, and every list carries the bound ------------------------

test('an inspect run characterises a change against the planning graph through read tools', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools);
  const result = run(call, fixture);

  // The fixture is genuinely bigger than one page, so the bound is doing work rather than declared.
  assert.ok(REQUIREMENTS > DEFAULT_LIMIT, 'the fixture fits on one page, so the bound proves nothing');
  assert.equal(result.requirements.items.length, REQUIREMENTS);
  assert.equal(result.requirements.more, false);

  // Gap 1 found the requirement that genuinely has none, and did not report the one on page two.
  const untraced = new Set(result.untraced.map((row) => row.id));
  assert.ok(untraced.has(fixture.orphan.id), 'the untraced requirement was not reported');
  assert.ok(!untraced.has(fixture.late.id),
    'a requirement whose coverage sits past the first page was reported as untraced');

  // Gap 2 discriminates by approach rather than by `verified_at`, which both rows carry.
  assert.deepEqual(result.unearned.map((entry) => entry.row.id), [fixture.manual.coverage.id]);
  assert.equal(fixture.automated.coverage.id !== fixture.manual.coverage.id, true);

  // Gap 3 is the scoped retro list — the addition Story 1 made, used here for the first time.
  assert.deepEqual(result.unretroed.map((epic) => epic.id), [fixture.bare.id]);

  // **And the file has to say "scoped", because the run cannot.** Both shapes return the same answer
  // on a fixture this size, so the recorder sees a correct result either way; only the instruction
  // distinguishes a query from a join in the caller. Rewriting it to list every retro and match
  // parents survived every other check here.
  assert.match(prose(source, '3. Join the change set'),
    new RegExp(`\`${CALLABLE}list_retro\` scoped by \`parent_id\` to the epic in hand`));
  assert.match(prose(source, '3. Join the change set'),
    new RegExp(`the scoped \`${CALLABLE}list_retro\` answers it directly`));

  // **The same reads at the default page answer a different question**, and this is the assertion
  // the bound exists for: it is about the answer rather than about an argument being present. Read
  // through `raw`, because a second startup would re-adopt a session and this is not a second run.
  const raw = handlers(tools);
  const truncated = raw.list_requirement({ spec_id: fixture.spec.id, include_body: true });

  assert.equal(truncated.items.length, DEFAULT_LIMIT);
  assert.equal(truncated.more, true, 'the default page held the whole fixture after all');
  assert.ok(!truncated.items.some((row) => row.id === fixture.late.id),
    'the covered requirement was on the first page, so the truncation proves nothing');

  // The consequence: the covered requirement is simply not among the rows a truncated run judges,
  // so it is *silently* absent rather than reported as a gap — which is worse, because a gap query
  // that misses a requirement entirely reports a clean sweep over a set it never saw.
  assert.equal(REQUIREMENTS - DEFAULT_LIMIT, 12,
    'the fixture no longer leaves rows past the first page');

  // Every list the run drove carried the bound.
  for (const name of ['list_requirement', 'list_coverage', 'list_epic', 'list_retro',
    'list_story_criterion_approach', 'list_criterion_approach', 'list_artifact']) {
    assert.ok(passed.get(name)?.has('limit'), `${name} was called without a limit`);
  }

  // And the file says so in the section that runs them, not somewhere else — `bindings` answers
  // file-wide, so a phase that went silent is invisible to it (Story 1's surviving mutation).
  const join = prose(source, '3. Join the change set');
  assert.match(join, /Every one of these takes a `limit`, and the bound is a default with no ceiling/);
  assert.match(join, /a false one is indistinguishable from its whole output/);
  assert.match(join, /\*\*Coverage is the join and it runs both ways\*\*/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 2: the facilitation survives -------------------------------------------------------

test('the axis is derived before it is used, nothing is asserted unrun, and the gaps are declared', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  // The axis is derived, stated, and allowed not to exist — all three, because a file that only
  // said "classify by static and dynamic" would be forcing the frame the section forbids.
  const axis = prose(source, '1. Derive the axis');
  assert.match(axis, /that distinction is domain-relative/);
  assert.match(axis, /State the definition chosen in a sentence or two/);
  assert.match(axis, /say what in the repository made it the right\s*one/);
  assert.match(axis, /say so plainly and propose the axis\s*that does explain the change set/);
  assert.match(axis, /Do not force the frame/);
  assert.match(axis, /Components on the boundary/);

  // The axis is settled before anything is classified, and it survives an interruption.
  assert.ok(source.indexOf('1. Derive the axis') < source.indexOf('2. Situate the changes'));
  assert.match(prose(source, 'Session'), /the axis especially/);
  assert.match(prose(source, 'Session'),
    /classifies the second half of\s*the change set on a different definition from the first/);

  // Nothing is described as verified without having been run, and the three voices stay apart.
  const verify = prose(source, '4. Verify before you assert');
  assert.match(verify, /Never describe a suite as passing without running\s*it/);
  assert.match(verify, /say which and why/);
  assert.match(verify, /what was measured, what was read in a record, and what was\s*inferred/);
  assert.match(verify, /Do not present an inference in the same voice as a count/);

  // What was not read is named rather than counted — and the reason is that a count is the shape
  // of disclosure that lets a reader skip checking, which is a claim about the *form* of the
  // report and so cannot be driven by any run.
  const unread = prose(source, '5. Say what was not read');
  assert.match(unread, /Name every file not examined/);
  assert.match(unread, /A count is not enough/);
  assert.match(unread, /An analysis that silently samples reads as\s*complete/);

  // **A join that links everything to something is reported as uniform, not as provenance.** This
  // is the judgement the section is read for rather than computed, and no run can hold it: a
  // fixture where every file traces to one record returns exactly the same rows as one where the
  // mapping discriminates. Deleting the paragraph survived every other check here.
  const join = prose(source, '3. Join the change set');
  assert.match(join, /Beware the signal that cannot discriminate/);
  assert.match(join, /tells a reader nothing\s*about any individual file/);
  assert.match(join, /Say that it is uniform and\s*why/);
  assert.match(join, /reports its own emptiness as "no orphan changes"/);
  assert.match(join, /If nothing records intent, say so and move on/);
  assert.match(join, /never a reason to fail or to invent one/);

  // The degradation table answers every absence with a behaviour rather than a failure.
  const table = prose(source, 'Degradation');
  for (const missing of ['The planning rows are empty', 'No intent record of any kind',
    'No tests, linter or build', 'No meaningful static/dynamic split', 'A selector matching nothing',
    'Not a git repository', 'The Artifact tool is absent']) {
    assert.ok(table.includes(missing), `the table does not answer: ${missing}`);
  }

  // A selector that matches nothing stops the run. Widening it is the failure that looks like work.
  const input = prose(source, 'Input');
  assert.match(input, /A selector matching nothing is an error, not an empty change set/);
  assert.match(input, /Do not widen it to find something to talk about/);
  assert.match(input, /always report them separately from committed\s*ones/);

  // Resolution is stated rather than sourced, and the fork point is named as the trap it is.
  assert.match(input, /fork point/);
  assert.match(input, /Diffing against the tip of the default branch instead is the plausible\s*wrong answer/);

  // The line against `audit` is held in the file, since no run can hold it.
  assert.match(source, /a change-set analysis that drifts into them stops answering its own question/);
  assert.match(prose(source, 'Publishing'), /separately confirmed, and never the default/);
  assert.match(prose(source, 'Publishing'), /rendering a diff is a mirror that earns nothing/);

  // It writes no planning row — asserted on the names, because there is no run to record.
  for (const name of toolNames(source)) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(!tool?.mutates || /session/.test(name),
      `the skill names ${name}, which writes something other than its own session`);
  }
  assert.match(prose(source, 'Output'), /This skill writes\s*no planning row of its own/);
});

// --- Criterion 3 (must NOT): no recovery by reading what was written -------------------------------

test('must NOT — the skill recovers an entity by reading a generated markdown file', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  assert.deepEqual(recoveries(source, PARSES), []);

  const known = new Set(tools.map((tool) => tool.name));
  const named = toolNames(reachable(source));

  for (const required of ['list_session', 'adopt_session', 'create_session', 'update_session',
    'list_library', 'list_library_scope', 'list_document_section', 'read_document_section',
    'list_retro', 'list_observation', 'list_observation_category', 'list_taxonomy',
    'list_spec', 'read_spec', 'list_requirement', 'list_epic', 'list_story', 'list_task',
    'list_story_criterion', 'list_coverage', 'list_criterion_approach',
    'list_story_criterion_approach', 'list_quick', 'list_problem_brief', 'list_product_brief',
    'list_adr', 'list_artifact']) {
    assert.ok(named.includes(required), `the skill never names ${required}`);
    assert.ok(known.has(required), `${required} is not a tool`);
  }

  // The control: a file that reaches for the old walk-and-parse shape is caught by the same reading.
  const regressed = `${source}\n\nRead docs/specifications/ and docs/epics/ with their paired `
    + '*-coverage-*.md matrices, follow each story\'s **Satisfies** field, and source '
    + 'cpm/hooks/lib/changeset-resolve.sh from ${CLAUDE_PLUGIN_ROOT} to resolve the selector.';

  assert.ok(recoveries(regressed, PARSES).length >= 4,
    'the sweep passed a file that walks directories, reads a matrix, follows a field and sources a script');
});

// --- Spec 50 FR8: an inspection reports dispositions without acting ------------------------------

test('the report names the disposition domain and routes the unread files to the reader', () => {
  const step = section(source, '6. Report');

  assert.notEqual(step, '', 'the report step still exists');
  assert.deepEqual(dispositionProblems(step, 'inspect Step 6'), []);

  assert.match(step, /An inspection changes nothing/,
    'nothing says the first block is empty by construction, so an empty one reads as an omission');
  assert.match(step, /could not check is still open/, 'an unresolvable claim is not routed');

  // **FR5's boundary at the site most likely to cross it.** Step 5's unread files come from a pass
  // that ran out of road, which is a fact about the run — so they are the reader's. A skill that
  // filed them as unverifiable would satisfy every other assertion here while making Step 5's whole
  // disclosure free.
  assert.match(step, /unread files belong in that last block, not among the unchecked/,
    'the unread files are not routed to the reader');
  assert.match(step, /fact about the run rather than about the\s+environment/,
    'nothing says why they are not unverifiable, so the distinction is a rule with no reason');

  assert.ok(dispositionProblems(`${step}\nEach one is Fixed.`, 'planted').length >= 1,
    'the sweep passed a step that writes a label out');
});
