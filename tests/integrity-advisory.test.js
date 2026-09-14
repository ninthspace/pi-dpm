/**
 * Epic 04-04 Story 2 — the entry that names a judgement, and the class that stops it refusing.
 *
 * A binding retired while its fragment still matched its requirement, and while its criterion was
 * still live, is not a fault: somebody withdrew it and wrote down why. Entry 9 must not name it —
 * that is story 1 — and something should, because a retirement nobody can find afterwards is a
 * decision that leaves no trace in the one place a reader looks for the state of the graph.
 *
 * **The register had one class of entry until this one, and the class is the story.** Every other
 * entry names corruption, and `restore` leans on that by refusing any dump `checkIntegrity`
 * reports on. So an ordinary entry here would have made a project's own dump un-restorable the
 * first time anyone retired a binding deliberately. `advisory: true` is what separates "reported"
 * from "refused"; `restore.test.js` holds that half, because it is a claim about the restorer.
 *
 * **Both rejections name a set rather than a silence.** "Entry 14 does not fire" is equally true
 * of an entry that stopped looking, so every assertion below compares the whole list of ids, and
 * each one has a row on the other side of the line to prove the entry is still reading.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { checkIntegrity } from '../src/integrity/check.ts';
import { REGISTER } from '../src/integrity/register.ts';
import { boundCoverage as bound } from './fixtures/planning.js';
import { forEntry, namedBy } from './support/violations.js';

const AT = '2026-08-27T00:00:00Z';

/** The surface, with a pinned clock so a retirement's timestamp is readable back. */
function surface(t) {
  const db = planning(t);
  const tools = spineTools(db, { now: () => AT });

  return { db, call: handlers(tools) };
}

/**
 * A requirement quoting both fragments, and `amend` to delete the broken one.
 *
 * One fixture per database, because `boundCoverage` allocates a spec by number. After `amend` the
 * sound fragment is a verbatim substring of the requirement's text and the broken one is not, which
 * is the whole difference the two entries turn on. Bound before the amendment, because
 * `create_coverage` refuses a fragment its requirement does not contain.
 */
const SOUND = 'a retirement somebody made while the binding was sound';
const BROKEN = 'a clause the amendment deleted';
const AMENDED = `The register names ${SOUND}, and entry 9 names the rest.`;

const fixture = (db) => {
  const built = bound(db, { fragment: BROKEN, requirement: `${AMENDED} It quotes ${BROKEN}.` });
  const amend = () => db.prepare('UPDATE requirement SET text = ? WHERE id = ?')
    .run(AMENDED, built.requirement.id);

  return { ...built, amend };
};

/** The binding ids one register entry names. Shared, because story 1's suite asks the same way. */
const named = (db, entry) => namedBy(db, entry);

// --- Criterion 1: the entry names it, and never blocks --------------------------------------------

test('a binding retired while sound is named by an advisory entry [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = fixture(db);
  const row = call.create_coverage({ ...binding(), spec_fragment: SOUND });

  assert.deepEqual(named(db, 14), [], 'a live binding is not a retirement, however sound');

  call.retire_coverage({ id: row.id, reason: 'the criterion was folded into another story' });

  const report = checkIntegrity(db);
  const found = forEntry(report, 14);

  assert.deepEqual(named(db, 14), [row.id], 'named by its id, not merely counted');
  assert.equal(found.advisory, true, 'and the finding says why it is not a fault');
  assert.equal(
    found.rows[0].retired_reason,
    'the criterion was folded into another story',
    'carrying the reason, which is the whole of what a reader is being shown',
  );

  // The half that made this story a pivot. `ok` is what `restore` refuses on and what a person
  // reads as "is this database broken?", and a decision somebody recorded is neither.
  assert.equal(report.ok, true, 'the database is not broken by a retirement somebody decided on');
});

// --- Criterion 2: the two entries are separate ----------------------------------------------------

test('a broken live binding is entry 9\'s and not entry 14\'s [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, amend } = fixture(db);

  const live = call.create_coverage(binding());
  const retired = call.create_coverage({ ...binding(), spec_fragment: SOUND, position: 1 });

  amend();
  call.retire_coverage({ id: retired.id, reason: 'the criterion was folded into another story' });

  // One database, two rows, two entries — which is what "separate" means. Asserted as two whole
  // lists rather than as two memberships, so an entry that named both would fail.
  assert.deepEqual(named(db, 9), [live.id], 'entry 9 names the broken live binding and nothing else');
  assert.deepEqual(named(db, 14), [retired.id], 'entry 14 names the sound retirement and nothing else');

  assert.equal(checkIntegrity(db).ok, false, 'and the blocking half of the pair still decides `ok`');
});

// --- Criterion 3 (must NOT): a broken binding's retirement is not a judgement to review ----------

test('entry 14 does not name a binding retired while its fragment no longer matched [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, amend } = fixture(db);
  const row = call.create_coverage(binding());

  amend();
  call.retire_coverage({ id: row.id, reason: 'the pivot deleted the clause this quoted' });

  assert.deepEqual(named(db, 14), [], 'a broken binding retired is entry 9 answered, not a judgement');
  assert.deepEqual(named(db, 9), [], 'and entry 9 has stopped naming it too, which is story 1');

  // The control for the rejection: the entry is still reading. A sound retirement in the same
  // database is named in the same breath, so the silence above is about that row.
  const sound = call.create_coverage({ ...binding(), spec_fragment: SOUND, position: 1 });

  call.retire_coverage({ id: sound.id, reason: 'the criterion was folded into another story' });

  assert.deepEqual(named(db, 14), [sound.id], 'the entry names the retirement that was a judgement');
});

// --- Criterion 4 (control): the entry reports, and refuses nothing at the write ------------------

test('retiring a sound binding still succeeds, and the entry reports it [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = fixture(db);
  const row = call.create_coverage({ ...binding(), spec_fragment: SOUND });

  const retired = call.retire_coverage({ id: row.id, reason: 'the criterion was folded into another story' });

  assert.equal(retired.retired_at, AT, 'the write went through — the entry is a report, not a guard');
  assert.equal(call.read_coverage({ id: row.id, include_body: true }).spec_fragment, SOUND,
    'and the binding is still readable, fragment and all');

  assert.deepEqual(named(db, 14), [row.id], 'reported afterwards rather than refused beforehand');
});

// --- A superseded criterion's retirement is the ordinary case, and not this entry's --------------

test('the retirement a supersession causes is not named by entry 14 [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding, criterion } = fixture(db);
  const row = call.create_coverage({ ...binding(), spec_fragment: SOUND });

  // Migration 027's trigger retires the bindings of a superseded criterion, so these arrive in
  // volume and every one of them is sound. Naming them would bury the retirements a person made
  // under the ones the database made, which is what `story_criterion.superseded_at IS NULL` is for.
  call.update_story_criterion({
    id: criterion.id,
    superseded_at: AT,
    superseded_reason: 'the amendment overtook it',
  });

  assert.equal(call.read_coverage({ id: row.id }).retired_at, AT, 'the trigger retired the binding');
  assert.deepEqual(named(db, 14), [], 'and the entry passes over it, because nobody chose it row by row');
});

// --- The class itself ----------------------------------------------------------------------------

test('exactly one register entry is advisory, and it is entry 14 [unit]', () => {
  assert.deepEqual(
    REGISTER.filter((entry) => entry.advisory === true).map((entry) => entry.entry),
    [14],
    'an entry that became advisory silently would stop refusing dumps it should refuse',
  );
});
