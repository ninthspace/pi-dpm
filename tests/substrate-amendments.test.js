/**
 * Epic 47-09 Story 8 — the substrate the amendments of 2026-08-10 asked for, and its four claims.
 *
 * Every one of the five amendments came out of a conversion: Epics 47-06 to 47-08 rewrote eighteen
 * skills against the tool surface, and each skill that reached for something the schema did not
 * hold recorded it rather than working around it. So these are consumer findings, and the tests
 * below are written from the consumer's side — through the tools a skill has, not against the DDL.
 *
 * - "`document`, `story` and `task` accept `superseded` and `withdrawn`, and a value outside the
 *   widened enum is still rejected by `CHECK` rather than coerced" [unit]
 * - "A blocker that is `superseded` or `withdrawn` leaves what it blocks unready, where the same
 *   blocker set to `complete` makes it ready" [integration]
 * - "must NOT — readiness treats any non-`pending` blocker status as satisfied, so abandoned work
 *   clears the way for what was waiting on it" [unit]
 * - "A `communication` document kind is seeded with a projection template, and the template
 *   enumeration still passes in both directions against the live `document_kind` table"
 *   [integration]
 * - "`library_document.source` round-trips a provenance and reads back NULL for a document written
 *   in the project" [unit]
 * - "`document_agent` accepts a participant on a `review` and on a `discussion`, and rejects one on
 *   any other kind" [integration]
 * - "An update told to clear a nullable column clears it, and an update that omits the column
 *   leaves it alone" [unit]
 * - "must NOT — an update accepts a clear, reports success and changes nothing, so *omitted* and
 *   *explicitly null* are indistinguishable at the tool boundary" [unit]
 *
 * **The two must-NOTs are what most of the length here is.** Both name a defect that passes every
 * positive assertion: a readiness clause reading `<> 'pending'` returns the blocked epic as ready
 * *and* returns the complete-blocker case correctly, and an update that drops an explicit null
 * returns the row it was asked to change with a success code. Neither is visible without the
 * control beside the positive case, which is why each pair is driven in one test rather than two.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { blockedBy, readyDocuments } from '../src/dependency/readiness.ts';
import { TEMPLATES, renderDocument } from '../src/projection/index.ts';

/** The four values `020-status-lifecycle.sql` admits, in the order its `CHECK` lists them. */
const STATUS = ['pending', 'complete', 'superseded', 'withdrawn'];

/** The two that are terminal without being completion — the pair the whole story is about. */
const RETIRED = ['superseded', 'withdrawn'];

/** The server clock, pinned: the coverage tools stamp the verification mark from it. */
const AT = '2026-08-10T00:00:00.000Z';

const surface = (t) => {
  const db = planning(t);

  return { db, call: handlers(spineTools(db, { now: () => AT })) };
};

/** A spec, an epic under it, and a story and task under that — one of every table with a status. */
function ladder(call, slug = 'substrate') {
  const spec = call.create_spec({ slug, title: 'Spec' });
  const epic = call.create_epic({ parent_id: spec.id, slug, title: 'Epic' });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Story', position: 0 });
  const task = call.create_task({ story_id: story.id, number: 1, title: 'Task', position: 0 });

  return { spec, epic, story, task };
}

// --- Criterion 1: the enum is four values, and still an enum -------------------------------------

test('document, story and task each take all four statuses and refuse a fifth', (t) => {
  const { db, call } = surface(t);
  const { spec, story, task } = ladder(call);

  const rows = [
    { table: 'document', id: spec.id, update: (status) => call.update_spec({ id: spec.id, status }) },
    { table: 'story', id: story.id, update: (status) => call.update_story({ id: story.id, status }) },
    { table: 'task', id: task.id, update: (status) => call.update_task({ id: task.id, status }) },
  ];

  for (const { table, id, update } of rows) {
    for (const status of STATUS) {
      assert.equal(update(status).status, status, `${table} would not take '${status}'`);
    }

    // **Still an enum, which is the half a widening quietly loses.** A `CHECK` dropped rather than
    // rewritten accepts all four and everything else besides, and every positive assertion above
    // passes against it.
    assert.throws(() => update('done'), /must be one of/,
      `${table} accepted a status outside the enum`);

    // And the refusal left the row where it was rather than coercing it to something legal.
    assert.equal(update('pending').status, 'pending');

    // **Asserted at the database and not only at the tool, because that is what the criterion
    // says.** The tool's `STATUS` list is a hand-copy of the `CHECK` and refuses 'done' on its
    // own — so a rebuild that dropped the constraint would leave every assertion above passing
    // while a restore, a dump replay or any statement not routed through a tool wrote whatever it
    // liked. A first draft of this test stopped at the tool and the mutation walked straight
    // through it.
    assert.throws(
      () => db.prepare(`UPDATE ${table} SET status = 'done' WHERE id = ?`).run(id),
      /CHECK constraint failed/,
      `${table}.status has no CHECK — the enum is the tool's alone`,
    );
  }
});

// --- Criteria 2 and 3: only completion clears a blocker ------------------------------------------

test('a retired blocker goes on blocking, where the same blocker completed does not', (t) => {
  const { db, call } = surface(t);
  const spec = call.create_spec({ slug: 'readiness', title: 'Readiness' });
  const blocker = call.create_epic({ parent_id: spec.id, slug: 'first', title: 'First' });
  const blocked = call.create_epic({ parent_id: spec.id, slug: 'second', title: 'Second' });

  call.create_dependency({
    kind: 'blocks', source_document_id: blocker.id, target_document_id: blocked.id,
  });

  const ready = () => readyDocuments(db).map((row) => row.id);

  // The starting state, and the reason the assertions below are not vacuous: with a `pending`
  // blocker the blocked epic is held and the blocker itself is workable.
  assert.deepEqual(ready(), [blocker.id], 'a pending blocker should hold the epic waiting on it');

  // **The must-NOT, and it needs both statuses.** `superseded` means replaced and `withdrawn`
  // means dropped; neither is delivery, so the work waiting on them is still waiting. A clause
  // reading `blocker.status <> 'pending'` releases both here and passes every other case in this
  // test, which is why the release is asserted against rather than merely not asserted.
  for (const status of RETIRED) {
    call.update_epic({ id: blocker.id, status });

    assert.equal(ready().includes(blocked.id), false,
      `a '${status}' blocker was read as satisfied, so abandoned work cleared the way`);

    // And "why not" still names it, rather than the edge going quiet with the blocker.
    assert.deepEqual(blockedBy(db, blocked.id).map((row) => row.blocker_id), [blocker.id]);
  }

  // The positive half, driven last so the transition is what is observed rather than the state.
  call.update_epic({ id: blocker.id, status: 'complete' });

  assert.deepEqual(ready(), [blocked.id], 'completion did not release the epic waiting on it');
  assert.deepEqual(blockedBy(db, blocked.id), []);
});

test('a retired row is not itself offered as ready, which is the same reading turned around', (t) => {
  const { db, call } = surface(t);
  const spec = call.create_spec({ slug: 'own-status', title: 'Own status' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'abandoned', title: 'Abandoned' });

  assert.deepEqual(readyDocuments(db).map((row) => row.id), [epic.id]);

  // **The half the widening created rather than exposed.** Under a two-value enum "not complete"
  // and "pending" were the same set, so the row's own predicate could be written either way. With
  // four values `<> 'complete'` puts abandoned work back on the board as available to start —
  // the same false pass as the blocker case, pointed at the row instead of at its blocker.
  for (const status of RETIRED) {
    call.update_epic({ id: epic.id, status });

    assert.deepEqual(readyDocuments(db), [],
      `a '${status}' epic was offered as ready to work on`);
  }

  call.update_epic({ id: epic.id, status: 'pending' });
  assert.deepEqual(readyDocuments(db).map((row) => row.id), [epic.id],
    'and the exclusion is the status rather than something the updates did');
});

// --- Criterion 4: communication is a kind with a template ----------------------------------------

test('communication is a seeded kind with a template, and the enumeration holds both ways', (t) => {
  const { db, call } = surface(t);

  const seeded = db.prepare('SELECT kind FROM document_kind ORDER BY kind').all()
    .map((row) => row.kind);

  assert.ok(seeded.includes('communication'), 'the kind was not seeded');

  // Both directions against the live table, which is what stops the template map and the seed
  // drifting apart: a kind with no template renders nothing, and a template for no kind is a
  // mapping nothing can reach.
  assert.deepEqual(seeded.filter((kind) => !TEMPLATES[kind]), [],
    'these seeded kinds have no projection template');
  assert.deepEqual(Object.keys(TEMPLATES).filter((kind) => !seeded.includes(kind)), [],
    'these templates name a kind the database does not carry');

  // And the template is reached rather than merely present. A `communication` is a title, an
  // audience and prose — no detail row — so what proves the wiring is its sections coming back.
  const note = call.create_communication({ slug: 'launch', title: 'Launch note' });

  call.create_document_section({
    document_id: note.id, position: 0, heading: 'Audience', body: 'Everyone shipping this week.',
  });

  const rendered = renderDocument(db, note.id);

  assert.equal(rendered.kind, 'communication');
  assert.equal(rendered.path, 'docs/communications/01-communication-launch.md',
    'the seed\'s `dir` and root numbering did not reach the path');
  assert.match(rendered.text, /# Launch note/);
  assert.match(rendered.text, /## Audience/);
  assert.match(rendered.text, /Everyone shipping this week\./);
});

// --- Criterion 5: a library document's provenance ------------------------------------------------

test('library_document.source round-trips, and is NULL for a document written here', (t) => {
  const { call } = surface(t);

  const imported = call.create_library({
    slug: 'style', title: 'House style', doc_type: 'coding-standards',
    source: 'https://example.invalid/house-style',
  });

  assert.equal(imported.source, 'https://example.invalid/house-style');
  assert.equal(call.read_library({ id: imported.id }).source, imported.source,
    'the provenance did not survive the read back');

  // **The NULL is the answer, not the absence of one.** A document written in this project has no
  // provenance, and that is the state the column exists to record — held as a `**Source**:` line
  // under a heading it would be a field parsed back out of prose, one section after the section
  // that removes them.
  const written = call.create_library({
    slug: 'domain', title: 'Domain terms', doc_type: 'domain',
  });

  assert.equal(written.source, null);
  assert.equal(call.read_library({ id: written.id }).source, null);

  // It is amendable, because a document written here can later be recognised as a copy of
  // something — and the update reaches the detail table without disturbing the document.
  const amended = call.update_library({ id: written.id, source: 'an internal wiki, 2024' });

  assert.equal(amended.source, 'an internal wiki, 2024');
  assert.equal(amended.title, 'Domain terms');
});

// --- Criterion 6: participants attach to two kinds and no others ---------------------------------

test('document_agent takes a participant on a review and a discussion, and on nothing else', (t) => {
  const { call } = surface(t);
  const spec = call.create_spec({ slug: 'panel', title: 'Panel' });
  const review = call.create_review({ parent_id: spec.id, slug: 'panel', title: 'Review' });
  const discussion = call.create_discussion({ slug: 'panel', title: 'Discussion' });

  for (const [document, kind] of [[review, 'review'], [discussion, 'discussion']]) {
    const row = call.create_document_agent({
      document_id: document.id, document_kind: kind, agent: 'architect',
    });

    assert.equal(row.agent, 'architect');
    assert.equal(row.document_kind, kind);
    assert.deepEqual(
      call.list_document_agent({ document_id: document.id }).items.map((item) => item.agent),
      ['architect'],
    );
  }

  // **A set of two is still a fixed target.** The `CHECK` refuses a third kind outright, before
  // any question of whether that document exists arises.
  assert.throws(
    () => call.create_document_agent({
      document_id: spec.id, document_kind: 'spec', agent: 'architect',
    }),
    /must be one of review, discussion/,
    'a participant attached to a spec',
  );

  // And the composite key is what makes the kind mean something: naming a legal kind for a
  // document that is not of it is refused by the foreign key, not stored as a plausible row.
  assert.throws(
    () => call.create_document_agent({
      document_id: spec.id, document_kind: 'review', agent: 'architect',
    }),
    /FOREIGN KEY/,
    'a spec was recorded as a review with a panel',
  );

  // The roster reference holds on the widened table exactly as it did on the narrow one.
  assert.throws(
    () => call.create_document_agent({
      document_id: discussion.id, document_kind: 'discussion', agent: 'nobody',
    }),
    /FOREIGN KEY/,
    'a persona the roster does not carry was stored as text',
  );
});

// --- Criteria 7 and 8: omitted is not null -------------------------------------------------------

test('an update clears a nullable column when told to, and leaves it alone when not', (t) => {
  const { call } = surface(t);
  const { spec } = ladder(call, 'clearing');

  call.update_spec({ id: spec.id, status: 'complete', status_note: 'folded into Story 10' });
  assert.equal(call.read_spec({ id: spec.id }).status_note, 'folded into Story 10');

  // **Omitted leaves it standing.** This is the half that was never broken and is asserted first,
  // because it is what the fix must not cost: a call naming `status` alone may not reset the note
  // to the `default` its schema advertises.
  assert.equal(call.update_spec({ id: spec.id, status: 'pending' }).status_note,
    'folded into Story 10', 'an omitted column was overwritten');

  // **The must-NOT, in the shape it actually arrived in.** A lone clear used to reach
  // `updateByKey` with an empty change set and be refused as "nothing to update" — loud, and not
  // the failure. The silent one is a clear travelling *beside* another change: the title moved,
  // the clear was dropped before the handler saw the argument, and the updated row came back with
  // a success code and the old note still on it.
  const cleared = call.update_spec({ id: spec.id, title: 'Renamed', status_note: null });

  assert.equal(cleared.title, 'Renamed');
  assert.equal(cleared.status_note, null, 'the clear was accepted, reported success and did nothing');
  assert.equal(call.read_spec({ id: spec.id }).status_note, null,
    'and the next read still returned the old value');

  // A clear on its own reaches the same end, rather than being refused for having nothing to do.
  call.update_spec({ id: spec.id, status_note: 'back again' });
  assert.equal(call.update_spec({ id: spec.id, status_note: null }).status_note, null);
});

test('a clear is refused where there is no legal way to clear, and named at the boundary', (t) => {
  const { call } = surface(t);
  const { spec, story } = ladder(call, 'refusals');

  // A required argument is required whether it is omitted or explicitly emptied, and the refusal
  // names the argument the caller sent rather than a column they never wrote.
  assert.throws(() => call.update_spec({ id: null, title: 'Renamed' }), /'id' is required/);
  assert.throws(
    () => call.create_story({ epic_id: null, number: 2, title: 'Story', position: 1 }),
    /'epic_id' is required/,
  );

  // A `NOT NULL` column is the database's refusal and stays the database's: restating it here
  // would be a second copy of a rule it already holds.
  assert.throws(() => call.update_story({ id: story.id, title: null }), /NOT NULL/);

  // And a clear is still checked for being *addressed* to something that exists.
  assert.throws(() => call.update_spec({ id: `${spec.id}x`, status_note: null }), /no document/);
});

test('a cleared reference takes its derived kind column with it', (t) => {
  const { call } = surface(t);
  const spec = call.create_spec({ slug: 'observations', title: 'Observations' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'work', title: 'Work' });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Story', position: 0 });
  const retro = call.create_retro({ parent_id: epic.id, slug: 'work', title: 'Retro' });

  const observation = call.create_observation({
    story_id: story.id, position: 0, text: 'The conversion is the consumer test.',
  });

  assert.equal(observation.retro_kind, null);

  const grouped = call.update_observation({ id: observation.id, retro_id: retro.id });

  assert.equal(grouped.retro_id, retro.id);
  assert.equal(grouped.retro_kind, 'retro', 'the kind column did not follow the reference in');

  // **The three states are the point.** `retro_kind` is never a caller argument, so clearing
  // `retro_id` while leaving the kind behind is a state the caller has no way to repair — and the
  // `CHECK` that pairs them refuses the whole call, which reads as the clear being illegal rather
  // than as the derivation being wrong. Setting, clearing and omitting are three answers here.
  const ungrouped = call.update_observation({ id: observation.id, retro_id: null });

  assert.equal(ungrouped.retro_id, null);
  assert.equal(ungrouped.retro_kind, null, 'the kind column was left behind by the clear');
  assert.equal(ungrouped.story_id, story.id, 'and the origin survived, as it must');
});

test('clearing a verification clears the binding recorded with it', (t) => {
  const { call } = surface(t);
  const spec = call.create_spec({ slug: 'coverage', title: 'Coverage' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'coverage', title: 'Epic' });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Story', position: 0 });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional', text: 'The system shall hold.', position: 0,
  });
  const criterion = call.create_story_criterion({
    story_id: story.id, text: 'It holds.', position: 0,
  });

  const row = call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'shall hold',
    story_criterion_id: criterion.id, position: 0, verified: true,
  });

  assert.ok(row.binding_hash, 'a verified row was written without its binding');

  // **A hash beside a cleared mark is the residue the decay triggers exist to prevent.** Nothing
  // reads it, and that is precisely the trouble: it is a record of a verification nobody made,
  // sitting where the check for a stale one looks.
  const unverified = call.update_coverage({ id: row.id, verified: false });

  assert.equal(unverified.verified_at, null);
  assert.equal(unverified.binding_hash, null, 'the binding outlived the verification it recorded');

  // Omitting it still leaves both alone, which is what makes the clear a decision rather than a
  // side effect of updating the row at all.
  call.update_coverage({ id: row.id, verified: true });
  const moved = call.update_coverage({ id: row.id, position: 1 });

  assert.equal(moved.verified_at, AT);
  assert.ok(moved.binding_hash);
});
