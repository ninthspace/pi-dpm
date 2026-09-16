/**
 * Epic 04-01 Story 5 — marking a story criterion superseded rather than rewriting it.
 *
 * FR6's whole point is that the epic goes on recording what it delivered. So the assertions here
 * are as much about what the call leaves alone as about what it writes: the criterion's `text`, and
 * the verification marks on every binding under the same story.
 *
 * **Two of the five criteria are about triggers that must *not* fire, and neither is shown by
 * nothing happening.** A database where no write can ever clear a mark passes both. What shows them
 * is the trigger doing its job on the very next line — the text edit that does clear the mark, and
 * clears only the one it is scoped to.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';

const AT = '2026-08-27T00:00:00Z';

/**
 * The tool surface, by name. Every read and every write in this file goes through it.
 *
 * The clock is pinned to `AT` because the coverage tools stamp the verification mark from it.
 */
function surface(t) {
  const db = planning(t);
  const tools = spineTools(db, { now: () => AT });

  return { db, tools, call: handlers(tools) };
}

/**
 * A story with two criteria, each bound to the same requirement and each verified.
 *
 * Two, because criterion 4 is about the criterion that was *not* superseded — a fixture with one
 * has nothing for that assertion to look at.
 */
function story(call) {
  const spec = call.create_spec({ slug: 'supersession', title: 'Coverage binding supersession' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'schema', title: 'Schema' });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR6', class: 'functional', position: 0,
    text: 'A story criterion an amendment has overtaken can be marked superseded rather than rewritten.',
  });
  const built = call.create_story({ epic_id: epic.id, number: 1, title: 'Mark it', position: 0 });

  const criteria = ['The mark is set.', 'The text is left alone.'].map((text, position) =>
    call.create_story_criterion({ story_id: built.id, text, position }));

  const bindings = criteria.map((criterion, position) => call.create_coverage({
    requirement_id: requirement.id,
    spec_fragment: position === 0 ? 'can be marked superseded' : 'rather than rewritten',
    story_criterion_id: criterion.id,
    position,
  }));

  // Verified through the tool, so the hash beside each mark is the server's — which is what makes
  // a cleared mark below observable as a cleared *pair* rather than one column going null.
  const verified = bindings.map((binding) => call.update_coverage({ id: binding.id, verified: true }));

  verified.forEach((row) => assert.ok(row.binding_hash, 'the fixture did not record a verification'));

  return { requirement, story: built, criteria, bindings };
}

/** Whether a binding still carries its mark, read back through the tool. */
const marked = (call, binding) => {
  const row = call.read_coverage({ id: binding.id });

  return row.verified_at !== null && row.binding_hash !== null;
};

/**
 * Run something that must be refused, and hand back the error so the message can be read.
 *
 * The shape `vocabulary-tools.test.js` and its siblings use. `assert.throws` returns undefined, so
 * a refusal whose message is the point cannot be asserted through it.
 */
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

// --- Criterion 1: the pair is set together, and the text is untouched -----------------------------

test('update_story_criterion sets the pair and leaves the text exactly as it was [integration]', (t) => {
  const { call } = surface(t);
  const { criteria } = story(call);

  // `include_body`, because `read_story_criterion` withholds `text` without it — while the update
  // tool declares no body and returns it. Comparing the two without asking would compare a string
  // against `undefined` and pass on a call that blanked the column.
  const before = call.read_story_criterion({ id: criteria[0].id, include_body: true });

  const superseded = call.update_story_criterion({
    id: criteria[0].id,
    superseded_at: AT,
    superseded_reason: 'FR6 moved the obligation into the requirement above it.',
  });

  assert.equal(superseded.superseded_at, AT);
  assert.equal(superseded.superseded_reason, 'FR6 moved the obligation into the requirement above it.');

  // **The second half of the criterion, and the reason the whole feature exists.** Rewriting the
  // text to match an amended requirement is what this mark is an alternative to, so a call that
  // quietly normalised, trimmed or blanked it would deliver the opposite of FR6.
  assert.equal(superseded.text, before.text);
  assert.equal(call.read_story_criterion({ id: criteria[0].id, include_body: true }).text,
    before.text);
  assert.equal(superseded.polarity, before.polarity, 'and nothing else on the row moved either');
  assert.equal(superseded.position, before.position);
});

test('the same call goes on updating text, polarity and position [unit]', (t) => {
  const { call } = surface(t);
  const { criteria } = story(call);

  // The control on the assertion above. Without it, a tool that ignored every argument would pass
  // "the text is unchanged" and the criterion would be satisfied by a tool that does nothing.
  const edited = call.update_story_criterion({
    id: criteria[1].id, text: 'The text is edited.', polarity: 'control', position: 4,
  });

  assert.equal(edited.text, 'The text is edited.');
  assert.equal(edited.polarity, 'control');
  assert.equal(edited.position, 4);
  assert.equal(edited.superseded_at, null, 'and editing a criterion does not supersede it');
});

// --- Criterion 2: the live set, and the reader who wants the overtaken criterion -------------------

test('list_story_criterion omits a superseded criterion until asked for it [integration]', (t) => {
  const { call } = surface(t);
  const { story: built, criteria } = story(call);

  const live = () => call.list_story_criterion({ story_id: built.id }).items.map((item) => item.id);
  const all = () => call.list_story_criterion({ story_id: built.id, include_superseded: true })
    .items.map((item) => item.id);

  assert.deepEqual(live(), [criteria[0].id, criteria[1].id]);

  call.update_story_criterion({
    id: criteria[0].id, superseded_at: AT, superseded_reason: 'Overtaken by an amendment.',
  });

  assert.deepEqual(live(), [criteria[1].id], 'a superseded criterion is still offered as live');
  assert.deepEqual(all(), [criteria[0].id, criteria[1].id]);

  // And it is still readable by id, which is what makes this a mark rather than a deletion.
  assert.equal(call.read_story_criterion({ id: criteria[0].id }).superseded_at, AT);
});

// --- Criterion 3: never half-set, whatever writes it ----------------------------------------------

test('a superseded_at with no reason is refused, from the tool and from a statement [unit]', (t) => {
  const { db, call } = surface(t);
  const { criteria } = story(call);
  const id = criteria[0].id;

  // Through the tool first, both directions: a date with no reason, and a reason with no date.
  refused(() => call.update_story_criterion({ id, superseded_at: AT }));
  refused(() => call.update_story_criterion({ id, superseded_reason: 'No date given.' }));

  assert.equal(call.read_story_criterion({ id }).superseded_at, null, 'and nothing was written');

  // **Then by statement, because the guarantee is the column's and not the boundary's.** A guard in
  // the handler would satisfy the two lines above and leave every other writer — a migration, a
  // fixture, a future tool — free to produce the state. The `CHECK` is what the criterion is about.
  const half = (sql) => refused(() => db.prepare(`UPDATE story_criterion SET ${sql} WHERE id = ?`).run(id));

  assert.match(half(`superseded_at = '${AT}'`).message, /CHECK constraint failed/);
  assert.match(half("superseded_reason = 'No date given.'").message, /CHECK constraint failed/);

  // The control: the pair together is accepted by the same statement, so the refusals above are the
  // pairing rather than a column that cannot be written at all.
  db.prepare("UPDATE story_criterion SET superseded_at = ?, superseded_reason = 'Both.' WHERE id = ?")
    .run(AT, id);

  assert.equal(call.read_story_criterion({ id }).superseded_reason, 'Both.');
});

// --- Criteria 4 and 5: what the mark does not clear -----------------------------------------------

test('superseding clears no verification, and a text edit clears exactly one [integration]', (t) => {
  const { call } = surface(t);
  const { criteria, bindings } = story(call);

  call.update_story_criterion({
    id: criteria[0].id, superseded_at: AT, superseded_reason: 'Overtaken by an amendment.',
  });

  assert.equal(marked(call, bindings[0]), true, 'the superseded criterion\'s own mark');
  assert.equal(marked(call, bindings[1]), true, 'and the mark on the criterion nobody touched');

  // **The control, and it is what makes the two lines above mean anything.** Both would pass on a
  // database where no write can clear a mark. Editing the text is the write that does clear one, and
  // it clears only the bindings on the criterion it names — so the sweep is shown to be able to see
  // a cleared mark, and shown not to see a cleared mark on the second criterion.
  call.update_story_criterion({ id: criteria[0].id, text: 'The mark is set, differently.' });

  assert.equal(marked(call, bindings[0]), false, 'the decay trigger did not fire on a text edit');
  assert.equal(marked(call, bindings[1]), true,
    'a text edit on one criterion cleared a mark on another criterion\'s binding');
});

test('passing the text back byte-identical leaves the mark standing [integration]', (t) => {
  const { call } = surface(t);
  const { criteria, bindings } = story(call);
  const text = call.read_story_criterion({ id: criteria[0].id, include_body: true }).text;

  // Criterion 5. `coverage_unverify_on_criterion_edit` is `AFTER UPDATE OF text … WHEN OLD.text <>
  // NEW.text`, so an edit that changed no bytes is not an edit. Without this, a trigger firing on
  // every write to the row would look identical to the correct one from the outside — and the mark
  // it cleared would read as decay rather than as a tool touching a column it was not asked about.
  const rewritten = call.update_story_criterion({
    id: criteria[0].id, text, superseded_at: AT, superseded_reason: 'Overtaken, and re-stated.',
  });

  assert.equal(rewritten.text, text);
  assert.equal(marked(call, bindings[0]), true, 'a write that changed no bytes cleared a mark');
  assert.equal(marked(call, bindings[1]), true);
});

// --- The split: create offers neither column ------------------------------------------------------

test('no create tool offers a supersession column, and the update tool does [unit]', (t) => {
  const { tools } = surface(t);
  const offers = (tool) => Object.keys(tool.inputSchema?.properties ?? {})
    .filter((field) => field === 'superseded_at' || field === 'superseded_reason');

  // The whole registry, not only the criterion tools: `endings` is a seam any table could reach for,
  // and the rule it exists to hold is that a row is never *born* superseded.
  //
  // **`create_document_section` is the one exception, and it is named rather than excluded.**
  // `entityTools` does not draw a create/update line over its fields — `mutable` governs the update
  // tool and everything is offered at create — so that tool takes `superseded_at` as a consequence
  // of the factory rather than as a decision anyone made. Nothing in this story changes it; naming
  // it is what stops the sweep below reading as "no factory anywhere does this".
  const creates = tools.filter((tool) => tool.name.startsWith('create_'));

  assert.ok(creates.length >= 30, `only ${creates.length} create tools — the sweep reads nothing`);
  assert.deepEqual(creates.filter((tool) => offers(tool).length > 0).map((tool) => tool.name),
    ['create_document_section']);

  // And the positive half, so the sweep above is not passing because nothing anywhere declares the
  // columns.
  assert.deepEqual(offers(tools.find((tool) => tool.name === 'update_story_criterion')),
    ['superseded_at', 'superseded_reason']);
  assert.deepEqual(offers(tools.find((tool) => tool.name === 'create_story_criterion')), [],
    'a criterion can be created already superseded');

  // The other criterion table has no endings at all, which is the asymmetry `endings` exists for: a
  // spec-side criterion is amended in the spec, and there is no epic underneath it to protect.
  assert.deepEqual(offers(tools.find((tool) => tool.name === 'update_acceptance_criterion')), []);
});
