/**
 * Epic 04-02 Story 3 — the claim over a retired set.
 *
 * FR3: a retired binding leaves the set a completeness claim accounts for, and a claim standing over
 * that set at the moment of retirement is withdrawn. Two halves, and they are two files:
 * `FRAGMENTS` in `src/coverage/claim.js` excludes retired rows from the digest, and
 * `requirement_unclaim_on_coverage_retire` in `026-retired-claim.sql` withdraws the claim when a row
 * leaves.
 *
 * **The assertion that proves they are one set is the re-claim.** Either half alone passes most of
 * what is below: qualify the hash and omit the trigger and a stale claim reads as current; add the
 * trigger and leave the hash unqualified and the claim goes but cannot be re-made, because the
 * digest still covers the row somebody just retired. Only "retire, then claim again, and read
 * `current: true`" fails on both mistakes.
 *
 * **Three of the eight criteria are controls, and each separates the feature working from the check
 * having stopped looking.** A trigger that unclaimed every requirement in the project, a `bound`
 * count that returned zero, and a migration that never cleared any claim would each satisfy the
 * positive criteria on their own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { databaseAtVersion, versionBefore, vocabularyAsOf } from './support/migration.js';
import { registerCreators } from './support/creators.js';
import { triggerNames } from './support/introspection.js';
import { claimDigestOverEveryBoundRow } from './support/hashes.js';
import { applyVocabulary } from '../src/schema/seeds/index.ts';
import { migrate } from '../src/schema/migrate.ts';
import { claimState } from '../src/coverage/claim.ts';
import { spineTools } from '../src/tools/index.ts';
import { create } from './fixtures/index.js';
import { childDocument, rootDocument } from './fixtures/planning.js';

const AT = '2026-08-27T00:00:00Z';

/** The surface, with a pinned clock. */
function surface(t) {
  const db = planning(t);

  return { db, call: handlers(spineTools(db, { now: () => AT })) };
}

/**
 * A requirement with three bindings, all verified, and the claim over them.
 *
 * Three rather than one, because criterion 1 is about retiring *one of three* — a fixture with a
 * single binding cannot tell "the claim went because the set changed" from "the claim went because
 * the set emptied".
 */
function claimed(call, { slug, label }) {
  const spec = call.create_spec({ slug, title: `Spec ${slug}` });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'retire', title: 'Retiring a binding' });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Withdraw', position: 0 });
  const requirement = call.create_requirement({
    spec_id: spec.id, label, class: 'functional', position: 0,
    text: 'A retired binding leaves the set a claim accounts for, and the claim is withdrawn.',
  });

  const fragments = [
    'A retired binding leaves the set a claim accounts for',
    'and the claim is withdrawn',
    'leaves the set',
  ];

  const criteria = fragments.map((_, position) => call.create_story_criterion({
    story_id: story.id, text: `Criterion ${position}`, position,
  }));

  const bindings = fragments.map((spec_fragment, position) => {
    const binding = call.create_coverage({
      requirement_id: requirement.id,
      spec_fragment,
      story_criterion_id: criteria[position].id,
      position,
    });

    return call.update_coverage({ id: binding.id, verified: true });
  });

  bindings.forEach((row) => assert.ok(row.binding_hash, 'the fixture recorded no verification'));

  call.update_requirement({ id: requirement.id, coverage_claimed: true });

  return { requirement, criteria, bindings };
}

/** Whether a binding still carries its mark, read back through the tool. */
const marked = (call, binding) => {
  const row = call.read_coverage({ id: binding.id });

  return row.verified_at !== null && row.binding_hash !== null;
};

// --- Criterion 1: retiring one of three withdraws the claim ---------------------------------------

test('retiring one of three bindings clears the claim and its hash together [integration]', (t) => {
  const { db, call } = surface(t);
  const { requirement, bindings } = claimed(call, { slug: 'withdraw', label: 'FR3' });

  assert.deepEqual(claimState(db, requirement.id), { claimed: true, current: true, bound: 3 });

  call.retire_coverage({ id: bindings[1].id, reason: 'The pivot deleted the clause this quoted.' });

  // Both columns, from the row rather than through `claimState`, because the `CHECK` on
  // `requirement` forbids one without the other and a trigger clearing only the date would leave a
  // digest describing a set nothing claims.
  const stored = db.prepare('SELECT coverage_claimed_at, coverage_claim_hash FROM requirement WHERE id = ?')
    .get(requirement.id);

  assert.equal(stored.coverage_claimed_at, null);
  assert.equal(stored.coverage_claim_hash, null);
  assert.equal(claimState(db, requirement.id).claimed, false);

  // And the trigger that did it exists under the name the migration gives it, so a later rebuild
  // dropping it fails here rather than silently.
  assert.ok(triggerNames(db).includes('requirement_unclaim_on_coverage_retire'));
});

// --- Criterion 2: the claim can be re-made, and it hashes over what remains -----------------------

test('a claim made after the retirement is current over the remaining bindings [integration]', (t) => {
  const { db, call } = surface(t);
  const { requirement, bindings } = claimed(call, { slug: 'remake', label: 'FR3' });
  const before = db.prepare('SELECT coverage_claim_hash AS hash FROM requirement WHERE id = ?')
    .get(requirement.id).hash;

  call.retire_coverage({ id: bindings[1].id, reason: 'Bound to a clause that has gone.' });
  call.update_requirement({ id: requirement.id, coverage_claimed: true });

  // **This is the assertion that holds the two halves together.** With the trigger in place and the
  // hash unqualified, the re-claim would store a digest over three rows while the live set is two,
  // and `current` would still read true — so the second assertion is the one that discriminates: the
  // new digest must differ from the old, which it can only do if the retired row left the set.
  assert.deepEqual(claimState(db, requirement.id), { claimed: true, current: true, bound: 2 });

  const after = db.prepare('SELECT coverage_claim_hash AS hash FROM requirement WHERE id = ?')
    .get(requirement.id).hash;

  assert.notEqual(after, before, 'the digest is unchanged, so the retired row is still in the set');
});

// --- Criterion 3, with criterion 7 as its control -------------------------------------------------

test('a retired binding leaves the bound total and a live one stays in it [integration]', (t) => {
  const { db, call } = surface(t);
  const { requirement, bindings } = claimed(call, { slug: 'total', label: 'FR3' });

  call.retire_coverage({ id: bindings[0].id, reason: 'The fragment stopped mid-clause.' });
  assert.equal(claimState(db, requirement.id).bound, 2);

  call.retire_coverage({ id: bindings[1].id, reason: 'The same clause, from the other end.' });
  assert.equal(claimState(db, requirement.id).bound, 1);

  // Criterion 7's control, and without it `bound` returning zero unconditionally would satisfy every
  // line above. One binding is left live and it is still counted; the rows themselves are all three.
  assert.equal(claimState(db, requirement.id).bound, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM coverage WHERE requirement_id = ?')
    .get(requirement.id).n, 3, 'retirement removed a row rather than withdrawing it');
});

// --- Criterion 6: the withdrawal is scoped to its own requirement ---------------------------------

test('retiring a binding leaves another requirement\'s standing claim alone [integration]', (t) => {
  const { db, call } = surface(t);
  const mine = claimed(call, { slug: 'scoped-mine', label: 'FR3' });
  const theirs = claimed(call, { slug: 'scoped-theirs', label: 'FR3' });

  call.retire_coverage({ id: mine.bindings[0].id, reason: 'Bound to a clause that has gone.' });

  assert.equal(claimState(db, mine.requirement.id).claimed, false, 'the retirement withdrew nothing');

  // **The control that catches the trigger everyone writes first.** An unscoped
  // `UPDATE requirement SET coverage_claimed_at = NULL` passes every other test in this file and
  // withdraws every claim in the project on any retirement anywhere.
  assert.deepEqual(claimState(db, theirs.requirement.id), { claimed: true, current: true, bound: 3 });
});

// --- Criterion 5: no collateral damage to a sibling binding's verification -------------------------

test('retiring one binding clears no other binding\'s mark, and an edit clears one [integration]', (t) => {
  const { db, call } = surface(t);
  const { criteria, bindings } = claimed(call, { slug: 'collateral', label: 'FR3' });

  call.retire_coverage({ id: bindings[0].id, reason: 'Bound to a clause that has gone.' });

  assert.equal(marked(call, bindings[1]), true, 'a sibling binding lost its verification');
  assert.equal(marked(call, bindings[2]), true);
  assert.equal(marked(call, bindings[0]), true, 'and the retired row keeps its own — the ✓ was true');

  // The control on the must-NOT. All three lines above pass on a database where no write can clear a
  // mark at all; editing one criterion's text is the write that does, and it reaches exactly the
  // bindings on that criterion. Through the tool rather than by statement, because `spec_fragment`
  // is half the row's identity and no tool updates it — the criterion is the editable half.
  call.update_story_criterion({ id: criteria[1].id, text: 'Criterion 1, restated.' });

  assert.equal(marked(call, bindings[1]), false, 'coverage_unverify_on_criterion_edit did not fire');
  assert.equal(marked(call, bindings[2]), true, 'a criterion edit reached a row it does not name');
  assert.ok(db.prepare('SELECT count(*) AS n FROM coverage WHERE verified_at IS NOT NULL').get().n > 0);
});

// --- Criterion 4, with criterion 8 as its control -------------------------------------------------

const PREVIOUS = versionBefore('coverage-retirement');

test('an existing claim survives the upgrade, and a retirement afterwards still clears one [integration]', (t) => {
  const db = databaseAtVersion(t, PREVIOUS).connect();

  registerCreators();
  applyVocabulary(db, { vocabularies: vocabularyAsOf(db) });

  const spec = rootDocument(db, 'spec', { number: 4, slug: 'upgrade' });
  const epic = childDocument(db, 'epic', spec, { sequence: 1, slug: 'retire', title: 'Retire' });
  const story = create(db, 'story', { epic_id: epic.id, number: 1 });
  const requirement = create(db, 'requirement', {
    spec_id: spec.id, text: 'A claim made before the upgrade is still a claim after it.',
  });

  const bindings = ['A claim made before the upgrade', 'is still a claim after it']
    .map((spec_fragment, position) => {
      const criterion = create(db, 'story_criterion', {
        story_id: story.id, text: `Criterion ${position}`, position,
      });

      return create(db, 'coverage', {
        requirement_id: requirement.id, story_criterion_id: criterion.id, spec_fragment, position,
      });
    });

  // The claim as a pre-025 database holds it: the digest is whatever that release's `claimHash`
  // produced, which is why it is copied out of the row after the upgrade rather than computed here.
  // What criterion 4 asks is that nobody has to *re-make* it, and that is `current` staying true.
  db.prepare('UPDATE requirement SET coverage_claimed_at = ?, coverage_claim_hash = ? WHERE id = ?')
    .run(AT, claimDigestOverEveryBoundRow(db, requirement.id), requirement.id);

  migrate(db, { now: AT });

  assert.deepEqual(claimState(db, requirement.id), { claimed: true, current: true, bound: 2 },
    'the upgrade invalidated a claim, so every project with one has to make it again');

  // **Criterion 8, and it is what stops the line above meaning nothing.** "Claims survive a
  // migration" is satisfied by a build where claims are never cleared by anything. Retiring a
  // binding on the upgraded database has to clear this one.
  const tools = handlers(spineTools(db, { now: () => AT }));

  tools.retire_coverage({ id: bindings[0].id, reason: 'Bound to a clause that has gone.' });

  assert.equal(claimState(db, requirement.id).claimed, false,
    'the fifth trigger is absent or unscoped, so claims survive everything rather than the migration');
});

