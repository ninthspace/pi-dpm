/**
 * Epic 47-08 Story 1 — the converted `status`, and the four claims made about it.
 *
 * - "A status run reports across specs, epics, stories and tasks from queries, with no directory
 *   walk and no file read" [feature]
 * - "Retro-waived and archived items are excluded by `WHERE` clauses over columns, not by grepping
 *   for markers" [integration]
 * - "The facilitation survives: an unrecognised status is still flagged rather than guessed and
 *   still counts as not-done, and the optional artifact is still never produced unless asked for
 *   and separately confirmed" [feature]
 * - "must NOT — the skill recovers an entity by reading a generated markdown file rather than by
 *   calling a read tool" [unit]
 *
 * **Every read assertion here carries the decoy the wrong query would also return** (retro 37, and
 * the disposition on this epic). A roll-up is counts, and a count is the one result shape that
 * looks right while being wrong: an archived epic, a waived one, a second spec's epics and a retro
 * belonging to another epic are all seeded, so a run that skipped a clause returns a *number*
 * rather than an error.
 *
 * **The first criterion's "writes nothing" half is asserted on the recorder, not on the prose.**
 * `status` is the first converted skill with no session row, so what makes it read-only is that no
 * mutating tool appears in `used` at all — a claim the recorder can make and a file cannot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import {
  skillSource, toolNames, reachable, section, prose, recorder, recoveries, bindings,
  seedStartup, driveStartup,
} from './support/skills.js';

const SKILL = 'status';
const source = skillSource(SKILL);

/** The recoveries this file in particular would reach for, on top of the shared sweep. */
const PARSES = [
  // The four globs CPM's Phase 1 walks. A directory named here is a directory walked.
  {
    pattern: /docs\/(briefs|specifications|epics|discussions|retros|architecture)\//,
    why: 'a planning directory, which is a scan standing in for a query',
  },
  // The progress-file scan, which is `list_session` in every conversion including this one.
  { pattern: /\.dpm-progress|\.cpm-progress/, why: 'a progress file globbed for active sessions' },
  // CPM shells out to a script because coverage lives in per-epic markdown. Here it is rows.
  { pattern: /coverage-rollup|CLAUDE_PLUGIN_ROOT/, why: 'a script that parses coverage matrices' },
  // The status-with-a-tail parse. `status` is a closed set and `status_note` is its own column.
  {
    pattern: /leading token|up to the first delimiter/,
    why: 'a status parsed out of a string, which is two columns',
  },
];

/**
 * A project with something to report — and with a decoy against every clause the run depends on.
 *
 * - `archived` is an epic swept out of the working set. A run with no `WHERE` counts it.
 * - `waived` is complete and carries `retro_waived_at`. A run reading markers recommends a retro.
 * - `elsewhere` is a second spec with an epic of its own, so an unscoped roll-up over-counts.
 * - `stray` is a retro parented to `elsewhere`'s epic, so a run matching parents in itself rather
 *   than scoping the list attributes it to the wrong epic.
 * - `noted` carries a `status_note` that reads like a status the vocabulary does not have.
 * - `orphan` is complete, unwaived and has no retro. It is what makes the waiver load-bearing:
 *   the two epics differ in that column and nothing else, so "waived is settled" is a comparison
 *   rather than a property of the only complete epic in the fixture.
 */
function workspace(tools) {
  const seed = handlers(tools);

  const spec = seed.create_spec({ slug: 'persistence', title: 'Persistence' });
  const elsewhere = seed.create_spec({ slug: 'billing', title: 'Billing' });

  const open = seed.create_epic({ parent_id: spec.id, slug: 'spine', title: 'Spine' });
  const done = seed.create_epic({ parent_id: spec.id, slug: 'authoring', title: 'Authoring' });
  const waived = seed.create_epic({ parent_id: spec.id, slug: 'reads', title: 'Reads' });
  const archived = seed.create_epic({ parent_id: spec.id, slug: 'legacy', title: 'Legacy' });
  const noted = seed.create_epic({ parent_id: spec.id, slug: 'folded', title: 'Folded' });
  const orphan = seed.create_epic({ parent_id: spec.id, slug: 'parity', title: 'Parity' });
  const far = seed.create_epic({ parent_id: elsewhere.id, slug: 'invoices', title: 'Invoices' });

  // Two stories on the open epic, one done — so "3 of 4" is a count and not a boolean.
  seed.create_story({ epic_id: open.id, number: 1, position: 1, title: 'One', status: 'complete' });
  seed.create_story({ epic_id: open.id, number: 2, position: 2, title: 'Two' });
  const closing = seed.create_story({
    epic_id: done.id, number: 1, position: 1, title: 'Only', status: 'complete',
  });
  seed.create_task({ story_id: closing.id, number: 1, position: 1, title: 'Task', status: 'complete' });

  seed.update_epic({ id: done.id, status: 'complete' });
  seed.update_epic({
    id: waived.id,
    status: 'complete',
    retro_waived_at: '2026-08-10T00:00:00.000Z',
    retro_waived_reason: 'nothing to synthesise',
  });
  seed.update_epic({ id: archived.id, status: 'complete', archived_at: '2026-08-01T00:00:00.000Z' });
  seed.update_epic({ id: noted.id, status_note: 'Superseded — folded into Spine' });
  seed.update_epic({ id: orphan.id, status: 'complete' });

  // The retro that belongs to `done`, and the stray one that belongs to another spec's epic.
  // Named `epicRetro` because `seedStartup` returns a `retro` of its own, and the spread below
  // would take whichever was written last — a collision that reads as a wrong answer, not a clash.
  const epicRetro = seed.create_retro({ parent_id: done.id, slug: 'authoring', title: 'Authoring' });
  const stray = seed.create_retro({ parent_id: far.id, slug: 'invoices', title: 'Invoices' });

  const requirement = seed.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional', moscow: 'must', position: 1,
    text: 'Every skill writes through a typed tool.',
  });
  const untraced = seed.create_requirement({
    spec_id: spec.id, label: 'FR2', class: 'functional', moscow: 'must', position: 2,
    text: 'A run in a session with no server says so.',
  });
  seed.create_requirement({
    spec_id: spec.id, label: 'FR3', class: 'functional', moscow: 'wont', position: 3,
    text: 'A second storage backend.', exclusion: 'out_of_scope',
  });

  const criterion = seed.create_story_criterion({
    story_id: closing.id, text: 'the write goes through the tool', position: 1,
  });
  const coverage = seed.create_coverage({
    requirement_id: requirement.id, story_criterion_id: criterion.id, position: 1,
    spec_fragment: 'Every skill writes through a typed tool.',
  });
  seed.update_coverage({ id: coverage.id, verified: true });

  const startup = seedStartup(seed, { scope: 'status', skill: 'dpm:status', phase: 'startup' });

  return {
    spec, elsewhere, open, done, waived, archived, noted, orphan, far, epicRetro, stray,
    requirement, untraced, ...startup,
  };
}

/**
 * The run the SKILL.md prescribes: the library check, the inventory, the per-epic roll-up, the
 * session scan, and — when a spec is in focus — the coverage roll-up.
 *
 * There is no session block and no retro block, which is the claim the flags carry.
 */
function run(call, fixture, { spec = null } = {}) {
  const startup = driveStartup(call, fixture, {
    scope: 'status', skill: 'dpm:status', roster: false, session: false, retro: false,
  });

  // Phase 1: the inventory is the lists, and the bound is above what the project holds.
  const inventory = Object.fromEntries(['spec', 'epic', 'problem_brief', 'product_brief', 'adr',
    'retro', 'discussion', 'review', 'audit', 'quick', 'runbook', 'library']
    .map((kind) => [kind, call[`list_${kind}`]({ limit: 200 })]));

  // No `.filter()` on `archived_at`. The clause is the tool's; a filter here would pass with or
  // without it, and the archived epic would be excluded by this test rather than by the query.
  const epics = inventory.epic.items.map((epic) => {
    const stories = call.list_story({ epic_id: epic.id, limit: 200 }).items;

    return {
      epic,
      stories,
      complete: stories.filter((story) => story.status === 'complete').length,
      tasks: stories.flatMap((story) => call.list_task({ story_id: story.id, limit: 200 }).items),
      // The scoped list, not a comparison over every retro in the project.
      retros: call.list_retro({ parent_id: epic.id, limit: 200 }).items,
    };
  });

  const needRetro = epics.filter(({ epic, retros }) => epic.status === 'complete'
    && epic.retro_waived_at === null && retros.length === 0);

  // A note that reads like a status is collected for a callout; the count still goes by `status`.
  const flagged = epics.filter(({ epic }) => epic.status_note !== null && epic.status_note !== undefined);

  const sessions = call.list_session({ limit: 200 }).items;

  if (!spec) {
    return { startup, inventory, epics, needRetro, flagged, sessions, coverage: null };
  }

  // Phase 3b: three states from the rows, and the ruled-out set from `exclusion`.
  const requirements = call.list_requirement({ spec_id: spec, include_body: true, limit: 200 }).items;

  const coverage = requirements.filter((requirement) => requirement.exclusion === null)
    .map((requirement) => {
      const rows = call.list_coverage({ requirement_id: requirement.id, limit: 200 }).items;
      const verified = rows.filter((row) => row.verified_at !== null);

      return {
        requirement,
        rows,
        state: rows.length === 0 ? 'untraced'
          : (verified.length === rows.length ? 'delivered' : 'in progress'),
      };
    });

  return {
    startup,
    inventory,
    epics,
    needRetro,
    flagged,
    sessions,
    coverage,
    excluded: requirements.filter((requirement) => requirement.exclusion !== null),
  };
}

// --- Criterion 1: the report comes from queries, and the run writes nothing -----------------------

test('a status run reports across specs, epics, stories and tasks from queries', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools);
  const result = run(call, fixture, { spec: fixture.spec.id });

  // The inventory counted both specs and the five live epics — the archived one is not among them.
  assert.equal(result.inventory.spec.items.length, 2);
  assert.equal(result.epics.length, 6, 'the epic inventory is not the live set');
  assert.ok(!result.epics.some(({ epic }) => epic.id === fixture.archived.id),
    'the archived epic was counted');

  // The roll-up is stories counted, not an epic status read twice.
  const open = result.epics.find(({ epic }) => epic.id === fixture.open.id);
  assert.equal(open.stories.length, 2);
  assert.equal(open.complete, 1, 'the completion count is not a count of complete stories');
  assert.equal(open.epic.status, 'pending');

  const done = result.epics.find(({ epic }) => epic.id === fixture.done.id);
  assert.equal(done.tasks.length, 1, 'the run reached no tasks');

  // **The decoy that catches a join in the caller.** `stray` is parented to another spec's epic and
  // shares nothing but the shape; a run listing every retro and matching parents itself has to get
  // that right, and a scoped list cannot get it wrong.
  assert.deepEqual(done.retros.map((row) => row.id), [fixture.epicRetro.id]);
  assert.equal(open.retros.length, 0, 'a retro was attributed to an epic that has none');
  assert.equal(result.inventory.retro.items.length, 3,
    'the project-wide retro count changed, so the scope came from somewhere other than the tool');

  // **Nothing was written.** No mutating tool was called at all, which is what makes this skill
  // read-only rather than a promise in its prose.
  const mutates = new Set(tools.filter((tool) => tool.mutates).map((tool) => tool.name));
  assert.deepEqual([...used].filter((name) => mutates.has(name)), [],
    'a read-only skill called a tool that writes');

  // And every call carried a bound above what the project holds, rather than taking the page.
  for (const name of ['list_epic', 'list_story', 'list_requirement']) {
    assert.ok(passed.get(name)?.has('limit'), `${name} was called without a limit`);
  }
  for (const page of Object.values(result.inventory)) {
    assert.equal(page.more, false, 'an inventory count was taken from a truncated page');
  }

  // **The bound is asserted on Phase 1's own text, not on the file.** `bindings` asks whether the
  // file names an argument the run passed, and answers file-wide — so Phase 3b naming `limit` for
  // the coverage read satisfies it while Phase 1 says nothing about the inventory being bounded.
  // Deleting that sentence survived every other check here, and this is what caught it.
  const inventory = prose(source, 'Phase 1');
  assert.match(inventory, /a `limit` above what the project plausibly holds/);
  assert.match(inventory, /A list that comes back with\s*`more` set is one whose count is wrong/);
  assert.match(inventory, /raise the `limit` and call again rather than reporting the page/);

  // The coverage roll-up is three states over rows, with the ruled-out set kept apart.
  const states = Object.fromEntries(result.coverage.map((entry) => [entry.requirement.label, entry.state]));
  assert.deepEqual(states, { FR1: 'delivered', FR2: 'untraced' });
  assert.deepEqual(result.excluded.map((row) => row.label), ['FR3']);

  const rollup = prose(source, 'Phase 3b');
  assert.match(rollup, /Never a proportion/);
  assert.match(rollup, /aggregation, not verification/);
  assert.match(rollup, /Render untraced first, before the counts/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 2: archived and waived are clauses over columns ------------------------------------

test('archived and retro-waived rows are excluded by a WHERE clause, not by a marker', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const raw = handlers(tools);

  const fixture = workspace(tools);

  // The clause is the tool's: the archived epic is absent by default and present when asked for.
  const live = raw.list_epic({ parent_id: fixture.spec.id, limit: 200 }).items;
  assert.ok(!live.some((row) => row.id === fixture.archived.id));

  const all = raw.list_epic({ parent_id: fixture.spec.id, include_archived: true, limit: 200 }).items;
  assert.ok(all.some((row) => row.id === fixture.archived.id));
  assert.equal(all.length, live.length + 1, 'the flag changed more than the archived row');

  // **Archival is orthogonal to status, and the fixture proves the two clauses are separate.** The
  // archived epic is `complete`; so is `done`, which is returned. A run that read archival off the
  // status would return both or neither.
  assert.equal(raw.read_epic({ id: fixture.archived.id }).status, 'complete');
  assert.ok(live.some((row) => row.id === fixture.done.id && row.status === 'complete'));

  // The waiver is a column pair the database keeps together, and it does not hide the epic.
  const waived = live.find((row) => row.id === fixture.waived.id);
  assert.equal(waived.retro_waived_at, '2026-08-10T00:00:00.000Z');
  assert.equal(waived.retro_waived_reason, 'nothing to synthesise');

  assert.throws(
    () => raw.update_epic({ id: fixture.open.id, retro_waived_at: '2026-08-10T00:00:00.000Z' }),
    /CHECK/,
    'an epic was waived with no reason',
  );

  // The scoped retro list is what answers "does this epic have one", for the waived epic and for
  // the unwaived one alike — neither has a retro, and only the column tells them apart.
  assert.equal(raw.list_retro({ parent_id: fixture.waived.id, limit: 200 }).items.length, 0);
  assert.equal(raw.list_retro({ parent_id: fixture.orphan.id, limit: 200 }).items.length, 0);
  assert.equal(raw.list_retro({ parent_id: fixture.done.id, limit: 200 }).items.length, 1);

  const { call } = recorder(tools);
  const result = run(call, fixture);

  // **`waived` and `orphan` differ in one column and nothing else** — both complete, both without a
  // retro — so exactly one of them being recommended is the column doing the work. Asserting only
  // that the waived epic is absent would pass on a run that recommended nothing at all.
  assert.deepEqual(result.needRetro.map(({ epic }) => epic.id), [fixture.orphan.id]);
  assert.equal(raw.read_epic({ id: fixture.waived.id }).status,
    raw.read_epic({ id: fixture.orphan.id }).status,
    'the two epics differ in status, so the waiver is not what separated them');

  // **The waiver can be lifted, and this assertion used to say it could not.** It described the
  // clear as "accepted and changes nothing", which is false-pass register #22 stated as a feature:
  // the call returned success and the column kept its value. Story 8 made an explicit null
  // distinguishable from an omitted argument, so a waiver decided in error is now reversible by the
  // tool that set it — which is the right shape for a triage call, and is why the recommendation
  // comparison above is two rows differing in one column rather than one row read twice.
  assert.equal(
    raw.update_epic({
      id: fixture.waived.id, retro_waived_at: null, retro_waived_reason: null,
    }).retro_waived_at,
    null,
    'a waiver could not be lifted through the tool that set it',
  );

  const phase = prose(source, 'Phase 1');
  assert.match(phase, /that is a `WHERE` clause rather than a rule this skill\s*remembers/);
  assert.match(phase, /Retro-waived epics are settled, and the column says so/);
  assert.match(phase, /Do not list every\s*retro in the project and match parents in the run/);
});

// --- Criterion 3: the facilitation survives -------------------------------------------------------

test('an unreadable status is flagged rather than guessed, and the page is never a default', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const raw = handlers(tools);

  const fixture = workspace(tools);
  const { call } = recorder(tools);
  const result = run(call, fixture);

  // **An off-vocabulary status cannot reach the report: it is refused at the write.** So the half of
  // CPM's callout that guarded against one is a guarantee here rather than a rule, and the test
  // records which half is which.
  assert.throws(
    () => raw.update_epic({ id: fixture.open.id, status: 'Superseded' }),
    /CHECK|status/,
    'a status outside the vocabulary was stored',
  );

  // What *can* reach it is a note that reads like a status — which is the shape the missing
  // vocabulary pushes a project into, and the reason the callout survives at all.
  const flagged = result.flagged.map(({ epic }) => epic.id);
  assert.deepEqual(flagged, [fixture.noted.id]);

  // And it counts by its column, not by its note. `noted` is `pending` and stays outstanding.
  const noted = result.epics.find(({ epic }) => epic.id === fixture.noted.id);
  assert.equal(noted.epic.status, 'pending');
  assert.ok(!result.needRetro.some(({ epic }) => epic.id === fixture.noted.id),
    'a note reading "Superseded" closed the epic');

  const report = prose(source, 'Phase 3');
  assert.match(report, /flagged, never guessed, and counts as not-done/);
  assert.match(report, /Do not read\s*a note as a status/);
  assert.match(report, /quoting the note verbatim/);

  // The two pages are separate, and neither is a default. Both statements are in the file because
  // neither can be driven: a run that never offers cannot be told from one that never was asked.
  const input = prose(source, 'Input');
  assert.match(input, /two different pages, so ask which/);
  assert.match(input, /offering one is not offering the\s*other/);
  assert.match(input, /naming no focus produces the whole-project report, and offers neither page/);

  const full = prose(source, 'Phase 4');
  assert.match(full, /Only when it was asked for/);
  assert.match(full, /offered, not published/);
  assert.match(full, /A declined offer leaves a complete run behind it/);
  assert.match(full, /separately confirmed, and never the default/);

  // Absence of the tool degrades, never fails — and writes nothing in its place.
  assert.match(full, /Nothing is written to disk in its place/);

  // The session block is absent from the file, and its absence is stated rather than left to be
  // noticed. Every other conversion opens one; this is the first that must not — so the claim is
  // read off the whole file rather than a section, being the preamble that precedes every heading.
  assert.match(source, /This skill writes nothing at all/);
  assert.match(source, /would be a resumable run that cannot be resumed/);
  assert.match(prose(source, 'Startup'), /\*\*No session\*\*: a report reads the rows and prints/);
  assert.match(prose(source, 'Startup'), /No retro to consume either/);
});

// --- Criterion 4 (must NOT): no recovery by reading what was written -------------------------------

test('must NOT — the skill recovers an entity by reading a generated markdown file', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  assert.deepEqual(recoveries(source, PARSES), []);

  const known = new Set(tools.map((tool) => tool.name));
  const named = toolNames(reachable(source));

  for (const required of ['list_library', 'list_library_scope', 'list_document_section',
    'read_document_section', 'list_spec', 'list_epic', 'list_story', 'list_task', 'list_retro',
    'list_session', 'list_requirement', 'list_coverage', 'list_adr', 'list_quick', 'list_audit',
    'list_review', 'list_discussion', 'list_runbook', 'list_problem_brief', 'list_product_brief',
    'list_criterion_approach', 'list_story_criterion_approach']) {
    assert.ok(named.includes(required), `the skill never names ${required}`);
    assert.ok(known.has(required), `${required} is not a tool`);
  }

  // **No write tool is named either**, which is the must-NOT's other half here. A read-only skill
  // that named one would have a route to using it, and the recorder can only catch a run that did.
  for (const name of toolNames(source)) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(!tool?.mutates, `the read-only skill names ${name}, which writes`);
  }

  // The control: a file that reaches for the old walk-and-parse shape is caught by the same reading.
  const regressed = `${source}\n\nGlob docs/epics/[0-9]*-epic-*.md and docs/retros/, read the `
    + '`**Status**:` field up to the first delimiter, glob docs/plans/.dpm-progress-*.md for active '
    + 'sessions, and run coverage-rollup.sh from ${CLAUDE_PLUGIN_ROOT} for the spec roll-up.';

  assert.ok(recoveries(regressed, PARSES).length >= 4,
    'the sweep passed a file that walks directories, parses a status, globs progress and shells out');
});
