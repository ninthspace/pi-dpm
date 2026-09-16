/**
 * Epic 04-03 Story 2 — the bindings that go quiet with the criterion they hang off.
 *
 * Epic 04-01 delivered the mark; this is what the mark does to the rows underneath it. FR6a's claim
 * is that a binding to a criterion nobody is claiming any more accounts for nothing, so the
 * supersession has to reach `coverage` — and reach it without destroying anything, because the
 * record of what the epic once bound is the reason supersession is a mark and not a rewrite.
 *
 * **The interesting criterion is the last one, and it is about a constraint rather than a feature.**
 * `coverage.retired_reason` is paired with `retired_at` by a `CHECK`, and every other retirement in
 * the system satisfies that pair because a caller was refused until they supplied a reason. This is
 * the one path with no caller: the trigger composes the reason itself, from a column on another
 * table that is paired by a `CHECK` of its own. Nothing states that dependency where either half
 * lives, so the test states it — and its control is the constraint refusing the write the trigger
 * must not make.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { claimState } from '../src/coverage/claim.ts';
import { triggerNames } from './support/introspection.js';

const AT = '2026-08-27T00:00:00Z';

const REASON = 'FR6a folded this clause into the requirement above it.';

/** What the trigger writes: its own prefix, then the supersession's own reason. */
const COMPOSED = `The criterion this bound was superseded: ${REASON}`;

/**
 * The tool surface, by name. Every write in this file goes through it or through the trigger.
 *
 * The clock is pinned to `AT` because the coverage tools stamp the verification mark from it.
 */
function surface(t) {
  const db = planning(t);

  return { db, call: handlers(spineTools(db, { now: () => AT })) };
}

/**
 * A claimed requirement with three verified bindings: two on one criterion, one on another.
 *
 * **Two bindings on the criterion that gets superseded**, because criterion 1 says *every* binding
 * hanging off it — a fixture with one cannot tell "retires the bindings" from "retires a binding",
 * and the trigger's `WHERE` clause is exactly where that distinction would be lost. **One on a
 * second criterion of the same story**, because criterion 4 is about the rows the supersession must
 * not touch, and the story is the boundary a wrong `WHERE` would use instead of the criterion.
 *
 * The claim is made last and through the tool, so the hash beside it is the server's over the set as
 * it then stood — which is what makes the withdrawal below observable as a claim being *cleared*
 * rather than a claim never having been recorded.
 */
function claimed(call) {
  const spec = call.create_spec({ slug: 'supersession', title: 'Coverage binding supersession' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'criterion', title: 'Criterion' });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR6a', class: 'functional', position: 0,
    text: "A superseded criterion's bindings stop counting toward its requirement's coverage without the rows being destroyed.",
  });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Go quiet', position: 0 });

  const [overtaken, standing] = ['It is done the old way.', 'It is done the way that stands.']
    .map((text, position) => call.create_story_criterion({ story_id: story.id, text, position }));

  const bind = (criterion, spec_fragment, position) => {
    const row = call.create_coverage({
      requirement_id: requirement.id, spec_fragment, story_criterion_id: criterion.id, position,
    });

    return call.update_coverage({ id: row.id, verified: true });
  };

  const bindings = [
    bind(overtaken, 'A superseded criterion', 0),
    bind(overtaken, 'stop counting toward', 1),
    bind(standing, 'without the rows being destroyed', 2),
  ];

  bindings.forEach((row) => assert.ok(row.binding_hash, 'the fixture did not record a verification'));

  const claim = call.update_requirement({ id: requirement.id, coverage_claimed: true });

  assert.ok(claim.coverage_claim_hash, 'the fixture did not record a claim');
  assert.equal(claim.coverage_claimed_at, AT, 'the claim carries a time the caller chose');

  return { requirement, story, overtaken, standing, bindings, claim };
}

/** Supersede a criterion, which is the only write any test here makes. */
const supersede = (call, criterion, reason = REASON) => call.update_story_criterion({
  id: criterion.id, superseded_at: AT, superseded_reason: reason,
});

/** Run something that must be refused, and hand back the error so its message can be read. */
function refused(run, message) {
  let caught;

  try {
    run();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, message ?? 'the call was accepted when it should have been refused');

  return caught;
}

// --- Criterion 1: every binding, each carrying a reason that names the supersession ---------------

test('superseding a criterion retires every binding under it, with a composed reason [integration]', (t) => {
  const { db, call } = surface(t);
  const { overtaken, bindings } = claimed(call);

  assert.ok(triggerNames(db).includes('coverage_retire_on_criterion_supersession'),
    'the trigger is absent by name, so whatever passes below is something else doing the work');

  supersede(call, overtaken);

  for (const binding of bindings.slice(0, 2)) {
    const row = call.read_coverage({ id: binding.id });

    assert.equal(row.retired_at, AT, 'a binding under the superseded criterion is still live');

    // The reason names the supersession, and names *this* supersession: the prefix alone would pass
    // a trigger that wrote a constant, and a constant is a reason nobody can act on.
    assert.equal(row.retired_reason, COMPOSED);
    assert.match(row.retired_reason, /FR6a folded this clause/,
      "the trigger dropped the criterion's own reason and wrote only its prefix");
  }
});

test('the trigger fires on the supersession and not on any write to the column [integration]', (t) => {
  const { call } = surface(t);
  const { overtaken, standing, bindings } = claimed(call);

  supersede(call, overtaken);

  // Un-superseding. `update_story_criterion` takes an explicit null to clear a column, so this is a
  // write to `superseded_at` in the other direction — and the guard the trigger needs, because
  // `AFTER UPDATE OF` does not distinguish them. Without it this call retires the binding that
  // *survived* the supersession, which is the opposite of what the mark asked for.
  call.update_story_criterion({ id: overtaken.id, superseded_at: null, superseded_reason: null });

  assert.equal(call.read_coverage({ id: bindings[2].id }).retired_at, null,
    'clearing a supersession retired a live binding, so the trigger fires in both directions');

  // The control on that: the guard is a `WHEN` clause and not an absent trigger, so the same call
  // shape must still retire when it sets the mark rather than clears it.
  supersede(call, standing);

  assert.equal(call.read_coverage({ id: bindings[2].id }).retired_at, AT,
    'nothing retires at all now, so the assertion above passed on a trigger that never fires');
});

// --- Criterion 2: still readable, with the fragment intact ----------------------------------------

test('the retired bindings stay readable under include_retired, fragments intact [integration]', (t) => {
  const { call } = surface(t);
  const { requirement, overtaken, bindings } = claimed(call);

  const fragments = (args) => call
    .list_coverage({ requirement_id: requirement.id, include_body: true, ...args })
    .items
    .map((item) => item.spec_fragment)
    .sort();

  const before = fragments({});

  supersede(call, overtaken);

  assert.deepEqual(fragments({}), ['without the rows being destroyed'],
    'a retired binding is still offered as live');
  assert.deepEqual(fragments({ include_retired: true }), before,
    'a fragment was lost or rewritten, so the row stopped being the record of what was bound');

  // And the rows themselves are still there — the count is the assertion that separates retirement
  // from the delete this feature exists to avoid.
  assert.equal(call.read_coverage({ id: bindings[0].id, include_body: true }).spec_fragment,
    'A superseded criterion');
});

// --- Criterion 3: out of the claimed set, and the claim withdrawn ---------------------------------

test('a requirement claimed before the supersession is unclaimed by it [integration]', (t) => {
  const { db, call } = surface(t);
  const { requirement, overtaken } = claimed(call);

  assert.deepEqual(claimState(db, requirement.id), { claimed: true, current: true, bound: 3 },
    'the fixture did not leave a standing claim over three bindings');

  supersede(call, overtaken);

  // **The must-NOT, in the two places it has to hold.** `bound` is the number a reader acts on and
  // the claim columns are what a roll-up trusts; a change that reached one and not the other would
  // report a requirement as covered by rows it had stopped counting.
  assert.deepEqual(claimState(db, requirement.id), { claimed: false, current: false, bound: 1 });

  // The claim can be made again over what remains, which is the half of FR3 that stops the
  // withdrawal above being a claim nothing can ever restore.
  call.update_requirement({ id: requirement.id, coverage_claimed: true });

  assert.deepEqual(claimState(db, requirement.id), { claimed: true, current: true, bound: 1 });
});

// --- Criterion 4: the retirement follows the criterion, not the story -----------------------------

test('bindings on a live criterion of the same story are untouched [integration]', (t) => {
  const { call } = surface(t);
  const { overtaken, standing, bindings } = claimed(call);

  supersede(call, overtaken);

  const survivor = call.read_coverage({ id: bindings[2].id });

  assert.equal(survivor.retired_at, null, 'the retirement followed the story rather than the criterion');
  assert.equal(survivor.retired_reason, null);

  // Its verification stands too. Retirement keeps a mark — the ✓ was true of the text it was taken
  // over — so a surviving binding losing one would mean something else fired.
  assert.equal(survivor.verified_at, AT);
  assert.ok(survivor.binding_hash);

  // The criterion itself is untouched, and readable: `read_story_criterion` withholds `text` without
  // `include_body`, so this comparison has to ask for it or it compares two undefineds.
  const live = call.read_story_criterion({ id: standing.id, include_body: true });

  assert.equal(live.superseded_at, null);
  assert.equal(live.text, 'It is done the way that stands.');
});

// --- Criterion 5: the pair the trigger has to satisfy with no caller to refuse --------------------

test('the composed reason satisfies the paired constraint the trigger cannot be refused by [integration]', (t) => {
  const { db, call } = surface(t);
  const { overtaken, bindings } = claimed(call);

  supersede(call, overtaken);

  // The audit over the whole table rather than over the rows this test knows about: the constraint
  // is `(retired_at IS NULL) = (retired_reason IS NULL)`, and what it forbids is a row where one is
  // set and the other is not, in either direction.
  const unpaired = db
    .prepare('SELECT count(*) AS n FROM coverage WHERE (retired_at IS NULL) <> (retired_reason IS NULL)')
    .get().n;

  assert.equal(unpaired, 0, 'a coverage row holds a retirement with half its pair');

  // **The control, and without it this test asserts nothing.** A schema whose `CHECK` had been lost
  // in the rebuild would pass everything above — the trigger writes both columns, so the pair holds
  // whether or not anything is enforcing it. What shows the constraint is live is it refusing the
  // write the trigger must not make: a retirement with no reason.
  refused(
    () => db.prepare('UPDATE coverage SET retired_at = ?, retired_reason = NULL WHERE id = ?')
      .run(AT, bindings[2].id),
    'the paired CHECK on coverage is gone, so the pairing above held by luck',
  );

  // And the dependency this trigger rests on, stated where it is load-bearing rather than only in
  // the migration's prose: `superseded_reason` is paired on its own table, which is the whole reason
  // the composed reason above can never be null. A migration that unpaired it would break the
  // trigger from one table away, and this is the assertion that would say so.
  refused(
    () => db.prepare('UPDATE story_criterion SET superseded_at = ?, superseded_reason = NULL WHERE id = ?')
      .run(AT, bindings[2].story_criterion_id),
    "story_criterion's supersession pair is unenforced, so the trigger can compose a null reason",
  );
});
