/**
 * What a story has to have accounted for before it closes, from three MTPLX dpm-do runs.
 *
 * Both refusals here are about states in which **every individual row was correct**, which is why
 * nothing caught them at the time and why neither is a schema constraint.
 *
 * A story was marked complete with its third task still `pending`, and the work existed — the file
 * that task describes is on disk, holding the checks it asks for. Nobody had skipped anything; the
 * row was never flipped, and no query compared the two. Whether a task was *done* is not knowable
 * from here. Whether it was *accounted for* is, and that is the whole of what this refuses.
 *
 * The other is narrower and the more interesting one. A story closed carrying two criteria whose
 * bindings were deliberately left unverified — correctly, because both were `target` rows about the
 * machine the tool will eventually run on, which nobody can verify from a development box. The
 * model's judgement was right and its record said nothing: an empty `status_note`, and a reader
 * left to reconstruct from the coverage rows why a complete story has unverified work beneath it.
 * So the note is what is demanded, not the verification — a server can tell whether a reason was
 * given and cannot tell whether it was a good one.
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

  return { db, call: handlers(spineTools(db, { now: () => AT })) };
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

/** A spec with one requirement, an epic, one story, two tasks, and one criterion bound to FR1. */
function story(call) {
  const spec = call.create_spec({ slug: 'closings', title: 'Closings' });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional', moscow: 'must', position: 0,
    text: 'The tool reports what it verified and what it did not.',
  });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'closing', title: 'Closing' });
  const only = call.create_story({ epic_id: epic.id, number: 1, title: 'Report', position: 0 });
  const tasks = [1, 2].map((number) => call.create_task({
    story_id: only.id, number, title: `Task ${number}`, position: number - 1,
  }));
  const criterion = call.create_story_criterion({
    story_id: only.id, text: 'The report names what it did not verify.', position: 0,
  });
  const binding = call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'what it did not',
    story_criterion_id: criterion.id, position: 0,
  });

  return { spec, requirement, epic, story: only, tasks, criterion, binding };
}

test('a story refuses to close over a pending task, and names the tasks', (t) => {
  const { call } = surface(t);
  const { story: only, tasks, binding } = story(call);

  call.update_coverage({ id: binding.id, verified: true });

  const caught = refused(() => call.update_story({ id: only.id, status: 'complete' }));

  assert.match(caught.message, /2 tasks of this story are still pending — 1 Task 1, 2 Task 2/);
  assert.equal(call.read_story({ id: only.id }).status, 'pending', 'the refusal wrote the status anyway');

  call.update_task({ id: tasks[0].id, status: 'complete' });

  // Down to one, and it is named on its own — the count and the verb agree with the rows.
  assert.match(refused(() => call.update_story({ id: only.id, status: 'complete' })).message,
    /1 task of this story is still pending — 2 Task 2/);

  // **Withdrawn is the other way out, and it is the point of the refusal rather than a hole in
  // it.** A task nobody is going to do is a decision, and the rule asks only that the decision be
  // recorded somewhere a query can reach.
  call.update_task({ id: tasks[1].id, status: 'withdrawn' });

  assert.equal(call.update_story({ id: only.id, status: 'complete' }).status, 'complete');
});

test('a story closing over an unverified binding is refused unless it says why', (t) => {
  const { call } = surface(t);
  const { story: only, tasks } = story(call);

  for (const task of tasks) call.update_task({ id: task.id, status: 'complete' });

  const caught = refused(() => call.update_story({ id: only.id, status: 'complete' }));

  assert.match(caught.message, /1 live binding under this story is unverified — FR1/);
  assert.match(caught.message, /close the story with a status_note saying why they stand unverified/);
  assert.equal(call.read_story({ id: only.id }).status, 'pending');

  // The note arrives in the same call as the status, which is the shape a run actually writes.
  const closed = call.update_story({
    id: only.id,
    status: 'complete',
    status_note: 'FR1 is a target row — unverifiable from the development box.',
  });

  assert.equal(closed.status, 'complete');
});

test('verifying the binding closes the story with no note at all', (t) => {
  const { call } = surface(t);
  const { story: only, tasks, binding } = story(call);

  for (const task of tasks) call.update_task({ id: task.id, status: 'complete' });
  call.update_coverage({ id: binding.id, verified: true });

  // The rule is about work left unaccounted for, so a story that verified what it bound owes
  // nothing — a note demanded of every story would be a note nobody reads.
  const closed = call.update_story({ id: only.id, status: 'complete' });

  assert.equal(closed.status, 'complete');
  assert.equal(closed.status_note, null);
});

test('a note already on the story counts, and a blank one does not', (t) => {
  const { call } = surface(t);
  const { story: only, tasks } = story(call);

  for (const task of tasks) call.update_task({ id: task.id, status: 'complete' });

  // Whitespace is not a reason. The run this comes from left the column empty, and a rule that
  // took `' '` for an answer would be satisfied by exactly the record that prompted it.
  assert.match(refused(() => call.update_story({ id: only.id, status: 'complete', status_note: '   ' })).message,
    /unverified — FR1/);

  // Noted in one call and closed in a later one: a story is not refused for saying it twice.
  call.update_story({ id: only.id, status_note: 'FR1 stands unverified until the target box exists.' });

  assert.equal(call.update_story({ id: only.id, status: 'complete' }).status, 'complete');
});

test('a retired or superseded binding is not work left unverified', (t) => {
  const { call } = surface(t);
  const { story: only, tasks, binding } = story(call);

  for (const task of tasks) call.update_task({ id: task.id, status: 'complete' });

  // The same rows every other count in dpm passes over. A binding somebody retired is one somebody
  // already decided about, and holding a story open on it would make the retirement unreachable.
  call.retire_coverage({ id: binding.id, reason: 'bound to the wrong criterion' });

  assert.equal(call.update_story({ id: only.id, status: 'complete' }).status, 'complete');
});

test('only a close is asked, and only of a story', (t) => {
  const { call } = surface(t);
  const { story: only, tasks } = story(call);

  // Every other move is untouched: the rule is about what closing means, not about the column.
  assert.equal(call.update_story({ id: only.id, status: 'withdrawn' }).status, 'withdrawn');
  assert.equal(call.update_story({ id: only.id, title: 'Renamed' }).title, 'Renamed');
  assert.equal(call.update_story({ id: only.id, status: 'pending' }).status, 'pending');

  // And a task closes on its own say-so — it is the leaf, and has nothing beneath it to account
  // for. `deliveryTools` builds both tables and is handed a closing condition for only one.
  assert.equal(call.update_task({ id: tasks[0].id, status: 'complete' }).status, 'complete');
});
