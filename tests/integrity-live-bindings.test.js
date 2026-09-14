/**
 * Epic 04-04 Story 1 — entry 9 names the bindings somebody still has to decide about.
 *
 * FR2's position is that the register is a work list, not a census. A binding whose fragment its
 * requirement no longer contains is a question for a person; retiring it *is* the answer, and it
 * carries the reason on the row. An entry that went on naming the retired one would put a settled
 * decision back in front of the next reader on every check, and an entry nobody can ever clear is
 * an entry nobody reads.
 *
 * **Both rejections here are claims about a named set rather than about quiet.** "Entry 9 is clean"
 * is equally true of an entry that stopped looking, of a corpus that lost its bindings, and of a
 * check somebody deleted — so every assertion below names the binding ids entry 9 returns and
 * compares the whole list. What separates a narrowing from a blindness is the second broken
 * binding, live throughout, which the entry must go on naming after the first is retired.
 *
 * The un-narrowed query is run alongside as a control (`everyBrokenBinding`). It is the same
 * `WHERE` without `retired_at IS NULL`, so it names the retired row that entry 9 must not — which
 * is what shows the row is still there and still broken, and that the difference between the two
 * lists is the narrowing rather than anything the retirement destroyed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { checkIntegrity } from '../src/integrity/check.ts';
import { boundCoverage as bound } from './fixtures/planning.js';
import { namedBy } from './support/violations.js';

const AT = '2026-08-27T00:00:00Z';

/** The tool surface with a pinned clock, so a retirement's timestamp is readable back. */
function surface(t) {
  const db = planning(t);
  const tools = spineTools(db, { now: () => AT });

  return { db, call: handlers(tools) };
}

const AMENDED = 'The register names the bindings somebody still has to decide about.';

/**
 * A requirement quoting each fragment, and `amend` to delete them — entry 9's violation.
 *
 * **Bound first and amended after, because that is the only way the state now arises.**
 * `create_coverage` refuses a fragment its requirement does not contain, so a live binding that
 * entry 9 names is one whose requirement was rewritten under it. `binding()` binds the first.
 */
function broken(db, ...fragments) {
  const fixture = bound(db, { fragment: fragments[0], requirement: `${AMENDED} ${fragments.join('; ')}.` });
  const amend = () => db.prepare('UPDATE requirement SET text = ? WHERE id = ?')
    .run(AMENDED, fixture.requirement.id);

  return { ...fixture, amend };
}

/** The binding ids entry 9 names, through the check a person actually runs. */
const namedByEntryNine = (db) => namedBy(db, 9);

/**
 * The control: entry 9's query with the narrowing removed.
 *
 * A retired binding is expected here and nowhere else. Held as a query rather than as a mutation
 * of `register.js` so it runs on every pass — a control that only exists while somebody is
 * editing the source is one the next reader has to take on trust.
 */
function everyBrokenBinding(db) {
  return db.prepare(`
    SELECT coverage.id
      FROM coverage JOIN requirement ON requirement.id = coverage.requirement_id
     WHERE instr(requirement.text, coverage.spec_fragment) = 0
     ORDER BY coverage.id
  `).all().map((row) => row.id).sort();
}

// --- Criterion 1: a broken live binding is named --------------------------------------------------

test('entry 9 names a live binding whose fragment its requirement no longer contains [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, amend } = broken(db, 'a clause the amendment deleted');
  const row = call.create_coverage(binding());

  amend();

  assert.deepEqual(namedByEntryNine(db), [row.id], 'named, and named by its id rather than counted');
  assert.equal(checkIntegrity(db).ok, false, 'and the report as a whole does not pass');
});

// --- Criterion 2: retiring it clears the entry, and changes nothing else --------------------------

test('retiring that binding removes it from entry 9, which then holds [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, criterion, requirement, amend } = broken(db, 'a clause the amendment deleted');
  const row = call.create_coverage(binding());

  amend();

  assert.deepEqual(namedByEntryNine(db), [row.id], 'the entry fires before the retirement');

  call.retire_coverage({ id: row.id, reason: 'the pivot deleted the clause this quoted' });

  const report = checkIntegrity(db);

  assert.deepEqual(namedByEntryNine(db), [], 'entry 9 no longer names it');
  assert.equal(report.ok, true, 'and the register holds true');
  assert.deepEqual(report.violations, [], 'with nothing else reported in its place');
  assert.deepEqual(report.orphans, [], 'and no row left dangling');

  // "Nothing else in the database changed": the row is still there, still bound to the same two
  // ends, still quoting the same fragment. Retirement is not deletion, so the record of what the
  // binding was survives the decision to stop counting it.
  // `include_body`, because `spec_fragment` is withheld without it — and comparing a withheld
  // value against the expected string would pass on a retirement that blanked the column, which
  // is the one thing this assertion is here to catch.
  const read = call.read_coverage({ id: row.id, include_body: true });

  assert.deepEqual(
    {
      requirement_id: read.requirement_id,
      story_criterion_id: read.story_criterion_id,
      spec_fragment: read.spec_fragment,
      retired_at: read.retired_at,
    },
    {
      requirement_id: requirement.id,
      story_criterion_id: criterion.id,
      spec_fragment: 'a clause the amendment deleted',
      retired_at: AT,
    },
    'the binding is still readable as the record that it once existed',
  );

  // The control. The row is still broken and still in the table — what changed is which query
  // claims it, which is the whole of this story.
  assert.deepEqual(
    everyBrokenBinding(db),
    [row.id],
    'the un-narrowed reading still finds it, so entry 9 went quiet by narrowing rather than by loss',
  );
});

// --- Criterion 3 (must NOT): a retired sound binding is not named ---------------------------------

test('entry 9 does not name a retired binding whose fragment still matches [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, amend } = broken(db, 'a clause the amendment deleted');

  // One fixture, two bindings on the same requirement: this fragment survives the amendment, so
  // the binding stays sound, and retiring it is a decision about a criterion rather than about a
  // fragment that stopped matching.
  const sound = call.create_coverage({
    ...binding(),
    spec_fragment: 'somebody still has to decide about',
  });
  // The control for the rejection: the entry is still looking. A second binding, broken by the
  // amendment and live, is named in the same breath — so the sound one's absence is a judgement
  // about that row rather than an entry that has stopped reading.
  const live = call.create_coverage({ ...binding(), position: 1 });

  call.retire_coverage({ id: sound.id, reason: 'the criterion it named was superseded' });
  amend();

  assert.deepEqual(namedByEntryNine(db), [live.id], 'the entry names the one that is broken, and not the sound retirement');
  assert.deepEqual(
    everyBrokenBinding(db),
    [live.id],
    'the retired row is absent from the un-narrowed reading too — it was never broken',
  );
});

// --- Criterion 4 (control): a second broken binding is still named --------------------------------

test('a second broken binding is named after the first is retired [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, amend } = broken(db, 'a clause the amendment deleted', 'a second clause the amendment deleted');
  const first = call.create_coverage(binding());
  const second = call.create_coverage({
    ...binding(),
    spec_fragment: 'a second clause the amendment deleted',
    position: 1,
  });

  amend();

  assert.deepEqual(namedByEntryNine(db), [first.id, second.id].sort(), 'both are named while live');

  call.retire_coverage({ id: first.id, reason: 'the pivot deleted the clause this quoted' });

  // The discriminating assertion of the story. An entry that stopped looking, an entry whose
  // check was deleted, and an entry narrowed correctly all report nothing for the first binding;
  // only the third goes on naming the second.
  assert.deepEqual(
    namedByEntryNine(db),
    [second.id],
    'entry 9 going quiet about the first is the retirement, not the entry ceasing to look',
  );
  assert.equal(checkIntegrity(db).ok, false, 'so the register still does not pass');

  assert.deepEqual(
    everyBrokenBinding(db),
    [first.id, second.id].sort(),
    'and both rows are still in the table, both still broken',
  );
});
