/**
 * Three corrections an MTPLX epics run could not make, and the refusals that stop it needing to.
 *
 * The run wrote an epic's story edges the wrong way round and then had no way to remove them: the
 * right edge beside a wrong one closes a cycle and is refused. It read a story's approach tags back
 * through the list that holds the *spec's* tags, got nothing, and wrote them again. And a criterion
 * already recorded could be recorded a second time under the same story.
 *
 * Each test drives the tool surface, because each failure was a caller's reading of that surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';

const AT = '2026-09-14T00:00:00Z';

function surface(t) {
  const db = planning(t);

  return { db, call: handlers(spineTools(db)) };
}

/** A spec with one requirement and acceptance criterion, and an epic holding two stories. */
function epic(call) {
  const spec = call.create_spec({ slug: 'corrections', title: 'Corrections' });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional', position: 0,
    text: 'An edge recorded backwards can be corrected.',
  });
  const criterion = call.create_acceptance_criterion({
    requirement_id: requirement.id, text: 'The corrected edge is accepted.', position: 0,
  });
  const built = call.create_epic({ parent_id: spec.id, slug: 'edges', title: 'Edges' });
  const [first, second] = [1, 2].map((number) => call.create_story({
    epic_id: built.id, number, title: `Story ${number}`, position: number - 1,
  }));

  return { spec, requirement, criterion, epic: built, first, second };
}

/** Run something that must be refused, and hand back the error so the message can be read. */
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

// --- An edge recorded backwards --------------------------------------------------------------------

test('a backwards edge can be deleted, and the corrected edge is accepted after it', (t) => {
  const { call } = surface(t);
  const { first, second } = epic(call);

  // Story 1 must finish before story 2 — written the wrong way round, as the run wrote it.
  const backwards = call.create_dependency({
    kind: 'blocks', source_story_id: second.id, target_story_id: first.id,
  });

  const right = { kind: 'blocks', source_story_id: first.id, target_story_id: second.id };

  // The trap: with the wrong edge standing, the right one closes a cycle.
  assert.match(refused(() => call.create_dependency(right)).message, /close a cycle/);

  const deleted = call.delete_dependency({ id: backwards.id });

  assert.equal(deleted.id, backwards.id, 'the edge is returned as it was');
  assert.equal(deleted.source_story_id, second.id);
  refused(() => call.read_dependency({ id: backwards.id }), 'the deleted edge is still readable');

  const corrected = call.create_dependency(right);

  assert.deepEqual(
    call.list_dependency({ target_story_id: second.id }).items.map((edge) => edge.id),
    [corrected.id],
  );
  assert.deepEqual(call.list_dependency({ target_story_id: first.id }).items, []);
});

test('deleting an edge that does not exist is refused, not reported as done', (t) => {
  const { call } = surface(t);

  assert.match(refused(() => call.delete_dependency({ id: 'no-such-edge' })).message,
    /delete_dependency/);
});

test('create_dependency says which end finishes first', (t) => {
  const { db } = surface(t);
  const tool = spineTools(db).find((candidate) => candidate.name === 'create_dependency');

  assert.match(tool.description, /the source must finish before the target can start/);
});

// --- A list filter given another table's id -------------------------------------------------------

test('a list filter naming another table\'s row is refused, and points at the list that takes it', (t) => {
  const { call } = surface(t);
  const { requirement, criterion, first } = epic(call);
  const tagged = call.create_story_criterion({ story_id: first.id, text: 'It is tagged.', position: 0 });

  // A requirement's id where an acceptance criterion's belongs — the inspect test's own slip.
  const asRequirement = refused(() => call.list_criterion_approach({ criterion_id: requirement.id }));

  assert.match(asRequirement.message, /criterion_id '.+' names no acceptance_criterion row/);
  assert.match(asRequirement.message, /it is a requirement id/);
  assert.match(asRequirement.message, /list_acceptance_criterion takes it as requirement_id/);

  // A story criterion's id — the run's slip, reading its own tags back from the spec's list.
  const asStoryCriterion = refused(() => call.list_criterion_approach({ criterion_id: tagged.id }));

  assert.match(asStoryCriterion.message, /it is a story_criterion id/);
  assert.match(asStoryCriterion.message, /list_story_criterion_approach/);

  // An id no table holds is refused too, without an owner to name.
  const nowhere = refused(() => call.list_criterion_approach({ criterion_id: 'no-such-row' }));

  assert.match(nowhere.message, /names no acceptance_criterion row$/);

  // The control: the right id is answered, empty or not.
  assert.deepEqual(call.list_criterion_approach({ criterion_id: criterion.id }).items, []);
  assert.deepEqual(call.list_story_criterion_approach({ story_criterion_id: tagged.id }).items, []);
});

// --- A tag sent before its criterion existed ------------------------------------------------------

test('a write naming a row that does not exist says which reference names nothing', (t) => {
  const { call } = surface(t);
  const { first } = epic(call);
  const real = call.create_story_criterion({ story_id: first.id, text: 'It is tagged.', position: 0 });

  // The third epics run: criteria and their tags in one message, the tags naming ids never returned.
  const guessed = refused(() => call.create_story_criterion_approach({
    story_criterion_id: '01M2G4XK3VZM9YV8C6D3K4JH', tag: 'feature',
  }));

  assert.match(guessed.message, /FOREIGN KEY constraint failed/);
  assert.match(guessed.message,
    /story_criterion_id '01M2G4XK3VZM9YV8C6D3K4JH' names no story_criterion row/);
  assert.doesNotMatch(guessed.message, /tag '/, 'a reference that resolves was blamed');

  // A bad tag on a real criterion blames the tag and not the criterion.
  const badTag = refused(() => call.create_story_criterion_approach({
    story_criterion_id: real.id, tag: 'no-such-approach',
  }));

  assert.match(badTag.message, /tag 'no-such-approach' names no test_approach row/);
  assert.doesNotMatch(badTag.message, /story_criterion_id '/);

  // The control: the same tag on the criterion's returned id is written.
  assert.equal(call.create_story_criterion_approach({ story_criterion_id: real.id, tag: 'feature' }).tag, 'feature');
});

// --- A criterion written twice --------------------------------------------------------------------

test('a story refuses a second live criterion with the same text', (t) => {
  const { call } = surface(t);
  const { first, second } = epic(call);
  const text = 'The corrected edge is accepted.';

  const written = call.create_story_criterion({ story_id: first.id, text, position: 0 });

  const again = refused(() => call.create_story_criterion({ story_id: first.id, text, position: 1 }));

  assert.match(again.message, new RegExp(`already has that criterion at position 0 \\(${written.id}\\)`));
  assert.equal(call.list_story_criterion({ story_id: first.id }).items.length, 1, 'and nothing was written');

  // An edit onto a sibling's text is the same duplicate by another route.
  const other = call.create_story_criterion({ story_id: first.id, text: 'Something else.', position: 1 });

  refused(() => call.update_story_criterion({ id: other.id, text }));

  // Another story may say the same thing.
  assert.ok(call.create_story_criterion({ story_id: second.id, text, position: 0 }).id);

  // And a superseded criterion no longer holds its text: the story may state it afresh.
  call.update_story_criterion({
    id: written.id, superseded_at: AT, superseded_reason: 'Restated after an amendment.',
  });

  assert.ok(call.create_story_criterion({ story_id: first.id, text, position: 2 }).id);
});
