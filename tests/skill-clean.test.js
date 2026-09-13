/**
 * Epic 47-09 Story 3 — the converted `clean`, and the three claims made about it.
 *
 * - "A clean run selects stale `session` rows by age and removes them, with no filename stem to glob
 *   and no session-suffix convention to match" [integration]
 * - "The facilitation survives: every candidate is still listed before anything is asked, only what
 *   was named and confirmed is deleted, and the skill is still unreachable from an autonomous loop"
 *   [feature]
 * - "must NOT — the skill recovers an entity by reading a generated markdown file rather than by
 *   calling a read tool" [unit]
 *
 * **The first criterion is two halves and the second half is an absence**, so it is asserted in two
 * places. That stale rows go is a fact about a run; that nothing globbed a stem or matched a
 * session-suffix convention to find them is a fact about the file, because a run cannot demonstrate
 * the absence of a step it was never written to take.
 *
 * **Staleness has to be a `WHERE` clause and not a label the run applies**, which is what the fresh
 * row is in the fixture for: a run that read `updated_at` back and compared it itself would pass an
 * assertion about which rows were deleted while leaving `updated_before` unexercised. The stale set
 * is therefore taken from a second call rather than from a filter here.
 *
 * **The delete order is load-bearing and runs opposite to the intuition.** A predecessor is the row
 * carrying `superseded_by`, so the row something points *at* is the later one — the live end of a
 * chain cannot go while its predecessor survives. The fixture holds a two-link chain, both ends
 * stale, and a probe drives the refusal directly so the ordering rule is checked rather than merely
 * described.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import {
  skillSource, toolNames, prose, instructions, recorder, recoveries, sweep, bindings, reachable,
  SQL, CONSTRUCTIONS, section, CALLABLE,
} from './support/skills.js';
import { dispositionProblems } from './support/vocabulary.js';

const SKILL = 'clean';
const source = skillSource(SKILL);

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

/** Above what any of these fixtures holds. */
const BOUND = 200;

/** When the run happens, and the cutoff three days before it. */
const NOW = '2026-08-10T12:00:00.000Z';
const CUTOFF = '2026-08-07T12:00:00.000Z';

/** The harness's id for the run doing the cleaning. */
const SELF = 'session-self';

/**
 * The recoveries this file in particular would reach for, on top of the shared sweep.
 *
 * Every one of them names a piece of the subsystem this conversion deletes: a filename stem two
 * hooks and a skill all had to agree on, a session id spliced into that filename, a companion file
 * paired by shared suffix, and `stat` standing in for a column.
 */
const PARSES = [
  { pattern: /\.cpm-|cpm-progress|compact-summary/i, why: 'a filename stem, which is what a row replaced' },
  { pattern: /\bstem\b|filename convention|session suffix|session-suffix/i, why: 'a filename convention' },
  { pattern: /\bstat\b|\bmtime\b|modification time/i, why: 'a filesystem timestamp, where age is a column' },
  { pattern: /\bcompanion\b|orphan(ed)? (file|summary)/i, why: 'a companion file paired by filename' },
  { pattern: /\brm\b|\bunlink\b|\brmdir\b/i, why: 'a file removal, where this deletes a row' },
  { pattern: /\bsentinel\b/i, why: 'the once-per-session marker that gated the old safety net' },
];

/**
 * Six session rows, chosen so that every decision the run makes has a neighbour it must not touch.
 *
 * - `ancient` and `old` — both well past the cutoff, and both offered. `old` is the one the user
 *   refuses, which is what makes per-row gating observable rather than asserted.
 * - `chainOld` → `chainNew` — a resumed run, both ends stale. `chainOld` carries `superseded_by`,
 *   so `chainNew` is the row something points at and cannot go first.
 * - `fresh` — inside the cutoff. Listed, never offered, and the control for `updated_before`:
 *   without it this row is indistinguishable from the stale ones in everything the run reads.
 * - `self` — the run's own row. Listed, never offered, still there at the end.
 */
function workspace(tools, clock) {
  const seed = handlers(tools);

  clock.set('2026-07-01T09:00:00.000Z');
  const ancient = seed.create_session({ id: 'session-ancient', skill: 'dpm:spec', phase: 'Step 2' });

  clock.set('2026-08-01T09:00:00.000Z');
  const old = seed.create_session({ id: 'session-old', skill: 'dpm:epics', phase: 'Step 4' });

  clock.set('2026-08-01T18:00:00.000Z');
  seed.create_session({ id: 'session-chain-a', skill: 'dpm:do', phase: 'Story 1' });

  // Adoption stamps both rows, so the chain is built first and the successor moved on afterwards —
  // otherwise the two share a timestamp and "oldest first" would be decided by the id tiebreak
  // rather than by the property under test.
  clock.set('2026-08-02T09:00:00.000Z');
  const chainOld = seed.adopt_session({ id: 'session-chain-b', predecessor_id: 'session-chain-a' });

  clock.set('2026-08-03T09:00:00.000Z');
  const chainNew = seed.update_session({ id: 'session-chain-b', phase: 'Story 2' });

  clock.set('2026-08-09T09:00:00.000Z');
  const fresh = seed.create_session({ id: 'session-fresh', skill: 'dpm:review', phase: 'Step 1' });

  clock.set(NOW);
  const self = seed.create_session({ id: SELF, skill: 'dpm:clean', phase: 'Step 1' });

  return {
    ancient, old, chainOld: { ...chainOld, id: 'session-chain-a' }, chainNew, fresh, self,
  };
}

/**
 * The run the SKILL.md prescribes: inventory, cutoff, marks, gate, delete.
 *
 * `approve` decides each offered row on its own. The default takes everything offered, so a test
 * about which rows are *eligible* is not also a test about who said yes.
 */
function run(call, { approve = () => true } = {}) {
  // Step 1: the inventory. No cutoff and no `include_archived`-style flag — every row, whatever its
  // age, because this is the exhaustive counterpart to the check every other skill runs at startup.
  const inventory = call.list_session({ limit: BOUND }).items;

  // Step 2: which of them are stale, from the tool's own `WHERE` rather than from a comparison here.
  const stale = new Set(
    call.list_session({ limit: BOUND, updated_before: CUTOFF }).items.map((row) => row.id),
  );

  const marked = inventory.map((row) => ({
    row,
    mine: row.id === SELF,
    stale: stale.has(row.id),
    superseded: row.superseded_by !== null,
  }));

  // Step 3: this session's own row is never offered; nothing else is pre-selected.
  const offered = marked.filter((entry) => !entry.mine && (entry.stale || entry.superseded));
  const named = offered.filter((entry) => approve(entry));

  // Step 4: oldest first, which is the order the inventory already came back in.
  const removed = [];
  const refused = [];

  for (const entry of named) {
    try {
      removed.push(call.delete_session({ id: entry.row.id }));
    } catch (error) {
      refused.push({ id: entry.row.id, message: error.message });
    }
  }

  return { inventory, marked, offered, removed, refused, stale };
}

/** A clock a fixture can move, so `updated_at` is a fact the test set rather than a wall time. */
function pinned(start) {
  let at = start;

  return { set: (value) => { at = value; }, now: () => at };
}

// --- Criterion 1: stale rows selected by age and removed ------------------------------------------

test('a clean run takes the stale rows by age and leaves the rest standing', (t) => {
  const db = openPlanningDatabase(t);
  const clock = pinned(NOW);
  const tools = spineTools(db, { now: clock.now });
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools, clock);
  const raw = handlers(tools);

  const result = run(call);

  // The cutoff picked out exactly the rows past it — including the fresh row's exclusion, which is
  // the half that fails silently if `updated_before` is never passed.
  assert.deepEqual([...result.stale].sort(), [
    'session-ancient', 'session-chain-a', 'session-chain-b', 'session-old',
  ]);

  assert.deepEqual(result.removed.map((row) => row.id), [
    'session-ancient', 'session-old', 'session-chain-a', 'session-chain-b',
  ], 'the stale rows were not removed oldest first');
  assert.deepEqual(result.refused, []);

  // And they are gone from the working set, while the two that were never offered are not.
  const left = raw.list_session({ limit: BOUND }).items.map((row) => row.id);

  assert.deepEqual(left, ['session-fresh', SELF]);
  assert.equal(raw.read_session({ id: fixture.fresh.id }).phase, 'Step 1');
  assert.equal(raw.read_session({ id: SELF }).skill, 'dpm:clean');

  // A delete hands back the row it removed, which is the only thing left to report it by.
  assert.equal(result.removed[0].skill, 'dpm:spec');
  assert.equal(result.removed[0].phase, 'Step 2');

  // **The order property, driven rather than described.** Rebuilt here because the chain the run
  // walked is gone, and the refusal is the reason the rule is worth stating: the live end of a
  // chain cannot go while the row pointing at it survives.
  raw.create_session({ id: 'probe-a', skill: 'dpm:do', phase: 'Story 1' });
  raw.adopt_session({ id: 'probe-b', predecessor_id: 'probe-a' });

  assert.throws(() => raw.delete_session({ id: 'probe-b' }), /delete_session:/,
    'the live end of a chain was deleted out from under its predecessor');

  raw.delete_session({ id: 'probe-a' });
  assert.equal(raw.delete_session({ id: 'probe-b' }).id, 'probe-b',
    'and once the predecessor is gone the successor goes too');

  // An absent row is a refusal, not a silent success — the same shape `update` guards against.
  assert.throws(() => raw.delete_session({ id: 'probe-a' }), /no session with id 'probe-a'/);

  // The second half of the criterion is an absence, so it is read off the file.
  assert.deepEqual(recoveries(source, PARSES), []);

  const cutoff = prose(source, 'Step 2: Which of them are stale');
  assert.match(cutoff, /`updated_before` set to the cutoff/);
  assert.match(cutoff, /three days before now/);
  assert.match(cutoff, /selected by a `WHERE` clause on `updated_at`/);

  // The ordering rule against the step, its rationale against the section — the probe above proves
  // the database enforces it, and these prove the file is the reason a run gets it right.
  const removal = instructions(source, 'Step 4: Delete what was confirmed');
  assert.match(removal,
    new RegExp(`\`${CALLABLE}delete_session\` once per confirmed row, oldest first`));
  assert.match(removal, /A refusal on one row is not a reason to stop/);
  assert.match(prose(source, 'Step 4: Delete what was confirmed'),
    /deleting the live end of a chain while its predecessor\s+survives is refused/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 2: the facilitation survives -------------------------------------------------------

test('everything is listed, only what was named goes, and no loop can reach it', (t) => {
  const db = openPlanningDatabase(t);
  const clock = pinned(NOW);
  const tools = spineTools(db, { now: clock.now });
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools, clock);
  const raw = handlers(tools);

  // One row refused while three others in the same run are approved.
  const result = run(call, { approve: (entry) => entry.row.id !== 'session-old' });

  // **Exhaustive**: every row is in the inventory, including the two that are never offered. That is
  // what separates this skill from the staleness check at every other skill's startup, which shows
  // only what is past the cutoff.
  assert.deepEqual(result.inventory.map((row) => row.id), [
    'session-ancient', 'session-old', 'session-chain-a', 'session-chain-b',
    'session-fresh', SELF,
  ]);
  assert.equal(result.marked.length, 6);
  assert.equal(result.marked.filter((entry) => entry.stale).length, 4);
  assert.equal(result.marked.filter((entry) => entry.superseded).length, 1);

  // **Nothing pre-selected, and this session's own row not offered at all.**
  assert.deepEqual(result.offered.map((entry) => entry.row.id), [
    'session-ancient', 'session-old', 'session-chain-a', 'session-chain-b',
  ]);
  assert.ok(!result.offered.some((entry) => entry.mine), 'the run offered to delete itself');
  assert.equal(raw.read_session({ id: SELF }).phase, 'Step 1');

  // **Only what was named**: the refused row is untouched, in a run where its neighbours went.
  const kept = raw.read_session({ id: fixture.old.id });

  assert.equal(kept.skill, 'dpm:epics');
  assert.equal(kept.phase, 'Step 4');
  assert.deepEqual(result.removed.map((row) => row.id), [
    'session-ancient', 'session-chain-a', 'session-chain-b',
  ]);
  assert.deepEqual(raw.list_session({ limit: BOUND }).items.map((row) => row.id), [
    'session-old', 'session-fresh', SELF,
  ]);

  // **Unreachable from an autonomous loop**, asserted where it can actually be broken: no other
  // skill in the corpus names this one. A rule in this file alone is a rule the file that would
  // violate it never reads.
  const callers = readdirSync(SKILLS, { withFileTypes: true })
    // The directory is `dpm-clean` since the prefix moved onto the tree. Compared against the bare
    // name, clean was never excluded, which went unseen until its description named `/dpm-clean`.
    .filter((entry) => entry.isDirectory() && entry.name !== `dpm-${SKILL}`)
    .filter((entry) => /dpm:clean|\/clean\b|\/dpm-clean\b/.test(readFileSync(join(SKILLS, entry.name, 'SKILL.md'), 'utf8')))
    .map((entry) => entry.name);

  assert.deepEqual(callers, [], 'another skill invokes clean — an autonomous loop can reach it');

  assert.match(source, /no autonomous loop reaches it/);
  assert.match(source, /`dpm-ralph` and anything else running\s*unattended never invokes it/);
  assert.match(source, /This skill is stateless/);

  // Every gap is `\s+`: `instructions` keeps a continuation line's indent, so an assertion written
  // against today's wrapping stops constraining anything once a word above it changes.
  const ask = instructions(source, 'Step 3: Ask, then confirm');
  assert.match(ask, /Nothing is\s+pre-selected/);
  assert.match(ask, /Only what is named and\s+confirmed is deleted/);
  assert.match(ask, /a row that was listed and not named stays/);

  const listing = prose(source, 'Step 1: The inventory');
  assert.match(listing, /Every row comes back, whatever its age/);
  assert.match(listing, /a filter here would make it a second copy of that/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 3 (must NOT): no recovery by reading a generated file --------------------------------

test('the clean skill recovers nothing by reading a generated file', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  assert.deepEqual(recoveries(source, PARSES), []);
  assert.deepEqual(sweep(source, SQL), []);
  assert.deepEqual(sweep(source, CONSTRUCTIONS), []);

  const known = new Set(tools.map((tool) => tool.name));
  const named = toolNames(reachable(source));

  for (const required of ['list_session', 'read_session', 'delete_session']) {
    assert.ok(named.includes(required), `the skill never names ${required}`);
    assert.ok(known.has(required), `${required} is not a tool`);
  }

  // A run whose state is a row has nothing to open a session of its own with, so the absence of the
  // create/adopt pair here is the stateless claim rather than an oversight.
  for (const absent of ['create_session', 'adopt_session', 'update_session']) {
    assert.ok(!named.includes(absent),
      `the skill names ${absent} — a skill that removes session rows does not open one`);
  }

  // The control: the same reading applied to the procedure this conversion deletes finds every part
  // of it. Without it a pattern that stopped matching reports a clean file indistinguishably.
  const regressed = `${source}\n\nGlob docs/plans/.cpm-progress-*.md and its compact-summary `
    + 'companion, pair them by the session suffix in the filename stem, stat each for its '
    + 'modification time, and rm the ones the sentinel has not already reported.';

  assert.ok(recoveries(regressed, PARSES).length >= 6,
    'the sweep passed a file that globs a filename stem, pairs companions by suffix, stats for age '
    + 'and removes files');
});

// --- Spec 50 FR8: the private wording is replaced, not supplemented ------------------------------

test('the output reports by disposition and keeps no wording of its own', () => {
  const output = section(source, 'Output');

  assert.notEqual(output, '', 'the output section still exists');
  assert.deepEqual(dispositionProblems(output, 'clean\'s Output'), []);

  // The three outcomes `clean` already produces, each routed by what it asks of the reader.
  assert.match(output, /deleted is gone from the database now/, 'a deletion is not routed');
  assert.match(output, /chose to keep was seen and\s+deliberately left/, 'a kept row is not routed');
  assert.match(output, /refused is waiting on the reader/, 'a refusal is not routed');

  // **The replacement half, and it is the half Story 4's first sweep rests on.** A section carrying
  // the shared rule *and* its own list has two vocabularies, which is the state this replaces.
  assert.doesNotMatch(output, /Report what was deleted, what was left/,
    'the private wording survives beside the shared rule');

  assert.ok(dispositionProblems(`${output}\nEach one is Fixed.`, 'planted').length >= 1,
    'the sweep passed a section that writes a label out');
});
