/**
 * Story 1 — the tools themselves, and the four ways this surface can be wrong while looking right.
 *
 * The story's enumeration criterion lives in `parity.test.js`, where it belongs: it is a property
 * of the registry against the schema. What is here is the behaviour that enumeration cannot see —
 * a tool can exist, be registered, be counted, and still do the wrong thing.
 *
 * **The second criterion is the one with a history.** `006-review-retro.sql` records that an
 * earlier draft of `observation` had `CHECK ((retro_id IS NULL) <> (story_id IS NULL))`, which
 * makes gathering a story-level observation into a retro *destroy* its origin, because the only
 * way to satisfy the constraint is to clear `story_id`. The schema was fixed; the tool can
 * reintroduce it, and an update tool that wrote every column it knows about would — so the
 * assertion below is on the promotion, and its mutation is the write-everything update.
 *
 * The other three are the mutations this story planned to run: a `review` built as though root
 * numbering meant no parent, a milestone joined to a document of another spec, and a document of
 * a structured kind written without its detail row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { documentTools } from '../src/tools/spine/document.ts';
import { DETAIL } from '../src/tools/spine/detail.ts';

function surface(t) {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  return { db, tools, call: handlers(tools) };
}

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

/** A spec, an epic and a story — what most of the new types hang off. */
function roots(call) {
  const spec = call.create_spec({ slug: 'dpm', title: 'dpm SQLite persistence' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'parity', title: 'Parity and search' });
  const story = call.create_story({
    epic_id: epic.id, number: 1, title: 'Give the rest their tools', position: 0,
  });

  return { spec, epic, story };
}

// --- Criterion 2: an observation keeps its origin when it is gathered into a retro ---------------

test('an observation written against a story keeps its story_id when a retro gathers it', (t) => {
  const { call } = surface(t);
  const { spec, epic, story } = roots(call);

  // Written during the story, before any retro exists. This is the `**Retro**:` field CPM records
  // per story, which is the same fact as a retro observation recorded earlier.
  const observed = call.create_observation({
    story_id: story.id,
    text: 'The kinds come from document_kind, so a seeded kind cannot arrive without tools.',
    position: 0,
  });

  assert.equal(observed.story_id, story.id);
  assert.equal(observed.retro_id, null);
  assert.equal(observed.retro_kind, null);

  // The retro is written afterwards and gathers it. The `retro_kind` companion comes with
  // `retro_id` and is not a caller argument, so the pairing `CHECK` cannot be got wrong from here.
  const retro = call.create_retro({ parent_id: epic.id, slug: 'parity', title: 'Parity retro' });
  const gathered = call.update_observation({
    id: observed.id,
    retro_id: retro.id,
    position: 2,
    synthesis: 'Read the vocabulary; do not restate it.',
  });

  assert.equal(gathered.retro_id, retro.id);
  assert.equal(gathered.retro_kind, 'retro');

  // The whole criterion. The origin survived promotion, so which story produced the lesson is
  // still a query and not something a reader has to reconstruct from the prose.
  assert.equal(gathered.story_id, story.id);

  const byOrigin = call.read_observation({ id: observed.id, include_body: true });

  assert.equal(byOrigin.story_id, story.id);
  assert.equal(byOrigin.retro_id, retro.id);

  // And the reverse direction: an observation written straight into a retro has no origin to
  // lose, which is the case that makes `story_id` nullable rather than merely usually set.
  const direct = call.create_observation({
    retro_id: retro.id, text: 'The enumeration reads the live schema.', position: 3,
  });

  assert.equal(direct.story_id, null);
  assert.equal(direct.retro_id, retro.id);
  assert.equal(spec.kind, 'spec');
});

test('the mutation: an update that wrote every column would clear the origin', (t) => {
  const { db, call } = surface(t);
  const { epic, story } = roots(call);

  const observed = call.create_observation({
    story_id: story.id, text: 'origin', position: 0,
  });
  const retro = call.create_retro({ parent_id: epic.id, slug: 'r', title: 'R' });

  // What `update_observation` would do if it wrote its whole field list rather than the
  // columns the call names — the shape an update tool falls into when it mirrors its create tool.
  // Run directly against the table, because the tool as written cannot express it.
  db.prepare('UPDATE observation SET retro_id = ?, retro_kind = ?, story_id = ? WHERE id = ?')
    .run(retro.id, 'retro', null, observed.id);

  assert.equal(call.read_observation({ id: observed.id }).story_id, null);

  // The control, on a second observation through the tool: same promotion, origin intact. Without
  // this the assertion above would only show that SQL can clear a column.
  const second = call.create_observation({ story_id: story.id, text: 'origin', position: 1 });

  call.update_observation({ id: second.id, retro_id: retro.id, position: 4 });

  assert.equal(call.read_observation({ id: second.id }).story_id, story.id);
});

// --- Parentage: root-numbered and parented are independent ----------------------------------------

test('a review and a retro are root-numbered and still record what they were about', (t) => {
  const { call } = surface(t);
  const { spec, epic } = roots(call);

  const review = call.create_review({
    parent_id: epic.id, slug: 'parity', title: 'Review of parity and search',
  });

  // Root-numbered — it has a number of its own and no sequence — and parented all the same.
  assert.equal(review.numbering, 'root');
  assert.ok(Number.isInteger(review.number));
  assert.equal(review.sequence, null);
  assert.equal(review.parent_id, epic.id);
  assert.equal(review.parent_kind, 'epic');

  // The same kind under its other permitted parent, because `document_kind_parent` lists two and
  // a tool that had hard-coded one would pass the assertion above.
  const onSpec = call.create_review({ parent_id: spec.id, slug: 'spec', title: 'Spec review' });

  assert.equal(onSpec.parent_kind, 'spec');

  const retro = call.create_retro({ parent_id: epic.id, slug: 'parity', title: 'Parity retro' });

  assert.equal(retro.numbering, 'root');
  assert.equal(retro.parent_id, epic.id);

  // A parent of a kind the allow-list does not admit is refused by the composite foreign key,
  // which is where that rule lives — the tool does not keep a second copy of it.
  const wrong = refused(() => call.create_review({
    parent_id: retro.id, slug: 'nope', title: 'A review of a retro',
  }));

  assert.match(wrong.message, /FOREIGN KEY/);
});

test('the mutation: a review built as though root numbering meant no parent', (t) => {
  const { call } = surface(t);
  const { spec } = roots(call);

  // The control, on the registry as built.
  assert.equal(call.create_review({
    parent_id: spec.id, slug: 'real', title: 'A review of the spec',
  }).parent_id, spec.id);

  // The mutation gets a database of its own: `document.(kind, parent_kind)` references the
  // allow-list, so emptying it in a database that already holds a review is refused by the
  // reference rather than producing the factory this is trying to build.
  const db = openPlanningDatabase(t);

  // `documentTools` derives parentage from `document_kind_parent`. Emptied of `review`'s rows, the
  // factory builds exactly what the pre-Story-1 `child: false` would have: no `parent_id`
  // argument, and both parent columns fixed at NULL.
  db.prepare("DELETE FROM document_kind_parent WHERE kind = 'review'").run();

  const [create] = documentTools(
    { db, now: () => '2026-08-09T00:00:00.000Z', newId: () => 'mutant-review' },
    { kind: 'review', detail: DETAIL.review },
  );

  assert.equal(Object.hasOwn(create.inputSchema.properties, 'parent_id'), false);

  const orphan = refused(() => create.handler({
    parent_id: spec.id, slug: 'orphan', title: 'A review of nothing',
  }));

  // The argument is not merely ignored — it is refused, because `additionalProperties` is false.
  // A tool that silently dropped it would write the orphan and report success.
  assert.match(orphan.message, /unknown argument 'parent_id'/);
});

// --- AD7's detail: both rows or neither -----------------------------------------------------------

test('a structured kind writes its document and its detail row together', (t) => {
  const { db, call } = surface(t);
  const { spec } = roots(call);

  const adr = call.create_adr({
    parent_id: spec.id, slug: 'ulids', title: 'ULIDs as surrogate keys',
    decision: 'Every id is a ULID minted by the tool surface.',
  });

  assert.equal(adr.kind, 'adr');
  assert.equal(adr.decision, 'Every id is a ULID minted by the tool surface.');
  assert.equal(adr.decision_status, 'proposed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM adr').get().n, 1);

  // The read returns the pair as one row, so a caller never has to know the detail table exists.
  assert.equal(call.read_adr({ id: adr.id }).decision_status, 'proposed');

  // An update reaching both tables, in one call and one transaction. The option comes first
  // because an accepted ADR has exactly one chosen, which `DETAIL.adr`'s guard checks here.
  call.create_adr_option({ adr_id: adr.id, name: 'A ULID', chosen: true, position: 0 });

  const accepted = call.update_adr({
    id: adr.id, decision_status: 'accepted', status: 'complete',
  });

  assert.equal(accepted.decision_status, 'accepted');
  assert.equal(accepted.status, 'complete');

  const quick = call.create_quick({ slug: 'sweep', title: 'A quick sweep' });
  const library = call.create_library({
    slug: 'standards', title: 'Coding standards', doc_type: 'coding-standards',
  });

  assert.equal(quick.closed_at, null);
  assert.equal(library.doc_type, 'coding-standards');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM library_document').get().n, 1);
});

test('the mutation: a detail row that fails leaves no document row behind', (t) => {
  const { db, call } = surface(t);
  const { spec } = roots(call);

  // The cheap half: a missing `decision` never reaches the database at all.
  const omitted = refused(() => call.create_adr({
    parent_id: spec.id, slug: 'half', title: 'Half an ADR',
  }));

  assert.match(omitted.message, /'decision' is required/);

  // **The half the transaction exists for.** A review scoped to a story that does not exist passes
  // validation — every argument is a string of the right shape — and fails on a foreign key *in
  // the detail insert*, after the `document` row has already been written. Without the shared
  // transaction that document survives: a review with no `review` row, which no constraint in the
  // schema forbids and every reader of the pair has to guess at.
  const reviews = () => db.prepare("SELECT COUNT(*) AS n FROM document WHERE kind = 'review'").get().n;
  const before = reviews();

  const dangling = refused(() => call.create_review({
    parent_id: spec.id, slug: 'scoped', title: 'A review of a story that is not there',
    scope: 'story', scope_story_id: 'no-such-story',
  }));

  assert.match(dangling.message, /FOREIGN KEY/);
  assert.equal(reviews(), before, 'the document row outlived the detail row that failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review').get().n, 0);

  // The control: the same call with a story that exists writes both rows.
  const story = call.create_story({
    epic_id: call.create_epic({ parent_id: spec.id, slug: 'e', title: 'E' }).id,
    number: 1, title: 'S', position: 0,
  });
  const scoped = call.create_review({
    parent_id: spec.id, slug: 'scoped', title: 'A review of one story',
    scope: 'story', scope_story_id: story.id,
  });

  assert.equal(scoped.scope_story_id, story.id);
  assert.equal(reviews(), before + 1);
});

// --- Register entry 12: a document may only deliver a milestone of its own spec ------------------

test('a milestone join across two specs is refused, and one within a spec is not', (t) => {
  const { call } = surface(t);
  const { spec, epic } = roots(call);

  const milestone = call.create_milestone({
    spec_id: spec.id, label: 'M3', title: 'Parity and search', position: 2,
  });

  // The legal case first, and it is two levels deep: the epic's spec is found by walking
  // `parent_id`, not by reading a column the epic carries.
  assert.equal(call.create_document_milestone({
    document_id: epic.id, milestone_id: milestone.id,
  }).milestone_id, milestone.id);

  // The spec itself delivering its own milestone — the walk's zero-step case.
  assert.ok(call.create_document_milestone({
    document_id: spec.id, milestone_id: milestone.id,
  }));

  const other = call.create_spec({ slug: 'other', title: 'Another spec' });
  const otherEpic = call.create_epic({
    parent_id: other.id, slug: 'elsewhere', title: 'Elsewhere',
  });

  // Both foreign keys are satisfied and the row is still nonsense. Nothing in the schema can say
  // so, which is why the register carries it as entry 12 and why the refusal is here.
  const across = refused(() => call.create_document_milestone({
    document_id: otherEpic.id, milestone_id: milestone.id,
  }));

  assert.match(across.message, /integrity register entry 12/);
  assert.match(across.message, /M3/);
});

test('a trade-off on an option id that names nothing is refused with the options of the ADR written last', (t) => {
  const { call } = surface(t);
  const { spec } = roots(call);

  const refusal = (optionId) => {
    try {
      call.create_adr_option_tradeoff({ option_id: optionId, axis: 'cost', assessment: 'Cheap.' });
    } catch (error) {
      return error.message;
    }

    return assert.fail(`a trade-off on '${optionId}' was recorded`);
  };

  // Before any option exists there is nothing to offer, and the refusal says where an id comes from.
  assert.match(refusal('made-up'), /no ADR option has id 'made-up', and none are recorded yet/);

  const adr = call.create_adr({ parent_id: spec.id, slug: 'a', title: 'ADR', decision: 'd' });
  const kept = call.create_adr_option({ adr_id: adr.id, name: 'Keep', position: 0 });
  const moved = call.create_adr_option({ adr_id: adr.id, name: 'Move', position: 1 });

  // The shape the MTPLX run produced: a real id with a suffix the model added.
  const message = refusal(`${kept.id}-0`);

  assert.ok(message.includes(`no ADR option has id '${kept.id}-0', so nothing was recorded`), message);
  assert.ok(message.includes(`'${kept.id}' (Keep), '${moved.id}' (Move)`), message);

  // The control: the id it offered is accepted.
  assert.equal(call.create_adr_option_tradeoff({ option_id: kept.id, axis: 'cost', assessment: 'Cheap.' }).axis, 'cost');
});

// --- The rest of the surface, round-tripped -------------------------------------------------------

test('every remaining type creates and reads back through its own tools', (t) => {
  const { call, tools } = surface(t);
  const { spec, epic, story } = roots(call);

  const review = call.create_review({ parent_id: spec.id, slug: 'r', title: 'Review' });
  const retro = call.create_retro({ parent_id: epic.id, slug: 'r', title: 'Retro' });
  const audit = call.create_audit({ slug: 'a', title: 'Audit' });
  const quick = call.create_quick({ slug: 'q', title: 'Quick' });
  const library = call.create_library({ slug: 'l', title: 'Library', doc_type: 'architecture' });
  const adr = call.create_adr({ parent_id: spec.id, slug: 'a', title: 'ADR', decision: 'd' });
  const matrix = call.create_coverage_matrix({ parent_id: epic.id, slug: 'm', title: 'Matrix' });

  // The five kinds with neither a parent nor a detail table, which is most of them.
  for (const kind of ['problem_brief', 'product_brief', 'discussion', 'runbook']) {
    const made = call[`create_${kind}`]({ slug: kind, title: kind });

    assert.equal(call[`read_${kind}`]({ id: made.id }).kind, kind);
    assert.equal(made.parent_id, null);
  }

  // A coverage matrix is child-numbered under an epic that is itself child-numbered — the only
  // two-deep chain the seeded parentage allows, and the one `identifierOf` had to be widened for.
  assert.equal(matrix.numbering, 'child');
  assert.equal(matrix.parent_kind, 'epic');

  const option = call.create_adr_option({ adr_id: adr.id, name: 'Do nothing', position: 0 });
  const tradeoff = call.create_adr_option_tradeoff({
    option_id: option.id, axis: 'reversibility', assessment: 'Total.',
  });
  const agent = call.create_document_agent({
    document_id: review.id, document_kind: 'review', agent: 'architect',
  });
  const criterion = call.create_quick_criterion({
    quick_id: quick.id, text: 'it holds', position: 0,
  });
  const scope = call.create_library_scope({ document_id: library.id, scope: 'do' });
  const section = call.create_document_section({
    document_id: spec.id, heading: 'Data Model', body: 'prose', position: 0,
  });
  const finding = call.create_finding({
    review_id: review.id, position: 0, category_id: 'finding:hidden-complexity',
    severity_id: 'severity:warning', summary: 'It is deeper than it looks.',
  });
  const auditFinding = call.create_audit_finding({
    audit_id: audit.id, position: 0, dimension_id: 'audit_dimension:test-debt',
    file: 'dpm/src/tools/entity.js', line: 1, severity_id: 'severity:suggestion',
    summary: 'The factory docblock predates the guard hook it now describes.',
  });
  const application = call.create_retro_application({
    retro_id: retro.id, applied_to_id: epic.id, disposition: 'applied', theme: 'Testing gaps',
    note: 'The sweep now derives its key from what each read tool requires.',
  });
  const artifact = call.create_artifact({
    url: 'https://example.invalid/a', title: 'A', published_at: '2026-08-09T00:00:00.000Z',
  });
  const published = call.create_artifact_document({
    artifact_id: artifact.id, document_id: spec.id,
  });

  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR10', class: 'functional', text: 'every type', position: 0,
  });
  const storyCriterion = call.create_story_criterion({
    story_id: story.id, text: 'every table has a create tool', position: 0,
  });
  const coverage = call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'every type',
    story_criterion_id: storyCriterion.id, position: 0,
  });
  const alsoBy = call.create_coverage_story({ coverage_id: coverage.id, story_id: story.id });

  // Read back through the tools rather than the table, because a create that wrote a row the read
  // tool cannot find is the half of FR3 an insert-only assertion misses.
  assert.equal(call.read_adr_option({ id: option.id }).name, 'Do nothing');
  assert.equal(call.read_adr_option_tradeoff({
    option_id: option.id, axis: 'reversibility', include_body: true,
  }).assessment, 'Total.');
  assert.equal(call.read_document_agent({ document_id: review.id, agent: 'architect' }).agent,
    agent.agent);
  assert.equal(call.read_quick_criterion({ id: criterion.id }).met, null);
  assert.equal(call.read_library_scope({ document_id: library.id, scope: 'do' }).scope,
    scope.scope);
  assert.equal(call.read_document_section({ id: section.id }).heading, 'Data Model');
  assert.equal(call.read_finding({ id: finding.id }).status, 'open');
  assert.equal(call.read_audit_finding({ id: auditFinding.id }).line, 1);
  assert.equal(call.read_retro_application({ id: application.id }).disposition, 'applied');
  assert.equal(call.read_artifact({ id: artifact.id }).title, 'A');
  assert.equal(call.read_artifact_document({
    artifact_id: artifact.id, document_id: spec.id,
  }).document_id, published.document_id);
  assert.equal(call.read_coverage_story({
    coverage_id: coverage.id, story_id: story.id,
  }).story_id, alsoBy.story_id);

  // `theme` and `note` are `NOT NULL DEFAULT ''`, so an omitted argument has to arrive as the
  // default and not as NULL — the case that made the factory stop writing every column explicitly.
  const bare = call.create_retro_application({
    retro_id: retro.id, applied_to_id: spec.id, disposition: 'deferred',
  });

  assert.equal(bare.theme, '');
  assert.equal(bare.note, '');

  // A boolean argument reaches the column as 0 or 1, which is the only thing SQLite will store.
  assert.equal(call.update_adr_option({ id: option.id, chosen: true }).chosen, 1);

  // Nothing in this test named a tool that the registry does not have, and nothing was skipped
  // for want of one: every type reached above is a create tool the enumeration also counts.
  assert.ok(tools.length > 100, `only ${tools.length} tools were registered`);
});

test('a read or update tool named for a kind refuses a document of another kind', (t) => {
  const { call } = surface(t);
  const { spec, epic } = roots(call);

  const audit = refused(() => call.read_audit({ id: spec.id }));
  assert.match(audit.message, /is a spec, not a audit/);

  // The update refusal happens *before* the write. Checked by reading the document back: a check
  // that ran after the `UPDATE` would leave the spec's `updated_at` moved by a call that failed.
  const before = call.read_spec({ id: spec.id }).updated_at;
  const wrong = refused(() => call.update_retro({ id: epic.id, title: 'Not a retro' }));

  assert.match(wrong.message, /is a epic, not a retro/);
  assert.equal(call.read_spec({ id: spec.id }).updated_at, before);
  assert.equal(call.read_epic({ id: epic.id }).title, 'Parity and search');
});

// --- Withdrawal: a duplicate observation taken back, and the clock that says when ----------------

/** What the pinned surface below stamps — a value no caller passes, so it can only be the clock's. */
const WITHDRAWN = '2026-09-16T11:00:00.000Z';

/** The surface `surface` gives, with the clock pinned so a stamp can be asserted. */
function stamped(t) {
  const db = openPlanningDatabase(t);

  return { db, call: handlers(spineTools(db, { now: () => WITHDRAWN })) };
}

test('a duplicate observation is withdrawn by its own verb, stamped from the server clock', (t) => {
  const { call } = stamped(t);
  const { story } = roots(call);

  const kept = call.create_observation({ story_id: story.id, text: 'The harness was reused as-is.' });
  const duplicate = call.create_observation({
    story_id: story.id, position: 1, text: 'The harness was reused as-is.',
  });

  const gone = call.retire_observation({
    id: duplicate.id, reason: 'A second row saying what the first already says.',
  });

  assert.equal(gone.retired_at, WITHDRAWN, 'the withdrawal carries a time the caller chose');
  assert.equal(gone.retired_reason, 'A second row saying what the first already says.');

  // Readable afterwards, which is the whole difference between withdrawing and deleting: the reason
  // exists to be found, and a reader asking why a retro counted one observation and not two has
  // nowhere else to look.
  assert.equal(call.read_observation({ id: duplicate.id, include_body: true }).text,
    'The harness was reused as-is.');

  // And the row that was kept is untouched. A withdrawal reaching both would leave the story with
  // no observation at all — which `dpm-retro` reads as a story that observed nothing, not as one
  // whose record was taken back.
  assert.equal(call.read_observation({ id: kept.id }).retired_at, null);
});

test('retiring an observation twice is reported rather than silently moving the date', (t) => {
  const { call } = stamped(t);
  const { story } = roots(call);

  const observation = call.create_observation({ story_id: story.id, text: 'Recorded once.' });

  call.retire_observation({ id: observation.id, reason: 'Withdrawn.' });

  const again = refused(() => call.retire_observation({ id: observation.id, reason: 'Again.' }));

  assert.match(again.message, /already retired at/);
  assert.equal(call.read_observation({ id: observation.id }).retired_at, WITHDRAWN,
    'the second call moved the date the decision was made');
});
