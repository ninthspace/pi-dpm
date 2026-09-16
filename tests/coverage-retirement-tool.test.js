/**
 * Epic 04-01 Story 4 — `retire_coverage`, and the two things no tool may do to a coverage row.
 *
 * Story 1 gave `coverage` the retirement pair and narrowed its natural key to the live rows. This is
 * the verb that reaches them, and the reason it is a verb of its own rather than two more fields on
 * `update_coverage` is asserted here rather than only argued in the module: a caller cannot express
 * `retired_at` at all, from either tool.
 *
 * **Two of the four criteria are must-NOTs about absence, and each has a control.** "No tool deletes
 * a coverage row" is not shown by no test deleting one — it passes on a surface that has such a tool
 * and nobody called it. What shows it is a sweep over the registry and over the one helper that can
 * issue a `DELETE`, each driven through a planted example that it must flag.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openPlanningDatabase as planning, handlers } from './support/planning-database.js';
import { sweepSourcesUnder, withoutComments } from './support/sources.js';
import { spineTools } from '../src/tools/index.ts';
import { boundCoverage as bound } from './fixtures/planning.js';

const SOURCES = join(import.meta.dirname, '..', 'src');

const AT = '2026-08-27T00:00:00Z';

/** The surface, with a pinned clock so what `retire_coverage` supplies is readable back. */
function surface(t) {
  const db = planning(t);
  const tools = spineTools(db, { now: () => AT });

  return { db, tools, call: handlers(tools) };
}

/**
 * Run something that must be refused, and hand back the error so the message can be read.
 *
 * The same shape `vocabulary-tools.test.js` and six other suites use. `assert.throws` returns
 * undefined, so a refusal whose *message* is the point cannot be asserted through it.
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

// --- Criterion 1: the pair is set together, and read_coverage returns both ------------------------

test('retire_coverage sets both columns and read_coverage returns them [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = bound(db);
  const row = call.create_coverage(binding());

  assert.equal(row.retired_at, null, 'a binding is live when it is created');

  const retired = call.retire_coverage({ id: row.id, reason: 'bound to the wrong fragment' });

  assert.equal(retired.retired_at, AT, 'the timestamp is the server clock, not a caller argument');
  assert.equal(retired.retired_reason, 'bound to the wrong fragment');

  // Through the read tool, because the criterion names it — a row is retired when the surface says
  // so, not when a `SELECT` in a test says so.
  const read = call.read_coverage({ id: row.id });

  assert.equal(read.retired_at, AT);
  assert.equal(read.retired_reason, 'bound to the wrong fragment');

  // The reason is required, so a retirement with no record of why is refused at the boundary.
  const second = call.create_coverage({ ...binding(), spec_fragment: 'stays readable afterwards' });

  refused(() => call.retire_coverage({ id: second.id }));
  assert.equal(call.read_coverage({ id: second.id }).retired_at, null, 'and nothing was written');
});

test('retiring twice is refused with the date the decision was made [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = bound(db);
  const row = call.create_coverage(binding());

  call.retire_coverage({ id: row.id, reason: 'the fragment was wrong' });

  assert.match(
    refused(() => call.retire_coverage({ id: row.id, reason: 'again' })).message,
    /already retired at 2026-08-27T00:00:00Z/,
  );

  // The first reason stands. A second retirement that overwrote it would replace the record of why
  // with the record of the mistake.
  assert.equal(call.read_coverage({ id: row.id }).retired_reason, 'the fragment was wrong');
});

test('a retired binding keeps its verification, because the ✓ was true of the text [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = bound(db);
  const row = call.create_coverage({ ...binding(), verified: true });

  assert.ok(row.binding_hash, 'the server computed a hash over the bound texts');

  const retired = call.retire_coverage({ id: row.id, reason: 'the criterion was superseded' });

  assert.equal(retired.verified_at, AT, 'retiring a binding must not clear its mark');
  assert.equal(retired.binding_hash, row.binding_hash);
});

test('the retired binding frees its key, so a corrected one can take it [integration]', (t) => {
  const { db, call } = surface(t);
  const { binding } = bound(db);
  const first = call.create_coverage(binding());

  refused(() => call.create_coverage(binding()));

  call.retire_coverage({ id: first.id, reason: 'bound to the wrong fragment' });

  const replacement = call.create_coverage(binding());

  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.retired_at, null);
});

// --- Criterion 2: the live set, and the reader who wants the withdrawal ---------------------------

test('list_coverage omits a retired binding and returns it with include_retired [integration]', (t) => {
  const { db, call } = surface(t);
  const { requirement, binding } = bound(db);
  const row = call.create_coverage(binding());

  const live = () => call.list_coverage({ requirement_id: requirement.id }).items;
  const all = () => call.list_coverage({ requirement_id: requirement.id, include_retired: true }).items;

  assert.equal(live().length, 1);

  call.retire_coverage({ id: row.id, reason: 'bound to the wrong fragment' });

  assert.deepEqual(live(), [], 'a retired binding is still offered as live');
  assert.deepEqual(all().map((item) => item.id), [row.id]);

  // Scoped the other way too, since `story_criterion_id` is the direction `/dpm:do` walks when it
  // records verifications — a retired binding must not be handed to it there either.
  assert.deepEqual(call.list_coverage({ story_criterion_id: row.story_criterion_id }).items, []);
});

// --- Criterion 3: update_coverage cannot reach either column --------------------------------------

test('update_coverage declares neither retirement column and refuses both [unit]', (t) => {
  const { tools, call, db } = surface(t);
  const update = tools.find((tool) => tool.name === 'update_coverage');

  for (const column of ['retired_at', 'retired_reason']) {
    assert.equal(Object.hasOwn(update.inputSchema.properties, column), false,
      `update_coverage offers ${column}, so a mistyped update could set or undo a retirement`);
  }

  // The refusal a caller actually meets, rather than only the absence from the schema. Both
  // directions: setting one, and clearing one that is set.
  const { binding } = bound(db);
  const row = call.create_coverage(binding());

  assert.match(
    refused(() => call.update_coverage({ id: row.id, retired_at: AT })).message,
    /unknown argument/,
  );

  call.retire_coverage({ id: row.id, reason: 'bound to the wrong fragment' });

  assert.match(
    refused(() => call.update_coverage({ id: row.id, retired_at: null })).message,
    /unknown argument/,
  );
  assert.equal(call.read_coverage({ id: row.id }).retired_at, AT, 'the retirement stands');
});

// --- Criterion 5, the control: update_coverage still updates what it is for -----------------------

test('update_coverage still sets position and records verification on the same row [unit]', (t) => {
  const { db, call } = surface(t);
  const { binding } = bound(db);
  const row = call.create_coverage(binding());

  // The control on the must-NOT above. Without it, a tool that refused *every* argument would pass
  // the refusal assertions and the criterion would be satisfied by a broken tool.
  const moved = call.update_coverage({ id: row.id, position: 3 });

  assert.equal(moved.position, 3);

  const verified = call.update_coverage({ id: row.id, verified: true });

  assert.equal(verified.verified_at, AT, 'the mark is stamped from the server clock');
  assert.ok(verified.binding_hash, 'and the server computed the hash that accompanies the mark');

  // And it goes on working on a row that is retired, which is what makes the two concerns separate
  // rather than one gate: a withdrawn binding can still be reordered in the register that holds it.
  call.retire_coverage({ id: row.id, reason: 'the criterion was superseded' });

  assert.equal(call.update_coverage({ id: row.id, position: 5 }).position, 5);
});

// --- Criterion 4: nothing deletes a coverage row --------------------------------------------------

/** Every registry tool that removes rather than retires, by the verb its name begins with. */
const deleters = (tools) => tools.filter((tool) => tool.name.startsWith('delete_'));

/**
 * Every `deleteById` call site in `src/`, as the table each names.
 *
 * `src/tools/crud.js` holds the only statement in dpm that can issue a `DELETE` against a spine
 * table, so what reaches it is the whole answer — and reading the *call sites* rather than the
 * registry catches a handler that deletes without being named `delete_anything`, which is the shape
 * this criterion is actually exposed to.
 */
const deletedTables = (sources) => sources
  .filter(({ name }) => !name.endsWith('crud.js'))
  .flatMap(({ text }) => [...withoutComments(text).matchAll(/deleteBy(?:Id|Key)\(\s*db\s*,\s*'([^']+)'/g)]
    .map(([, table]) => table));

test('no tool in the registered surface deletes a coverage row [unit]', (t) => {
  const { tools } = surface(t);

  // Three delete tools exist, and none is on `coverage`: a session is a working note with no history
  // to keep, and an edge and an "also delivered by" row are relationships rather than records
  // anything was verified against — which is exactly what a coverage row is not. `coverage_story`
  // extends a coverage row and deleting one leaves the binding standing.
  assert.deepEqual(deleters(tools).map((tool) => tool.name).sort(),
    ['delete_coverage_story', 'delete_dependency', 'delete_session']);
  assert.deepEqual(deleters(tools).filter((tool) => tool.table === 'coverage'), []);

  // The other half, over the call sites rather than the names.
  const sources = sweepSourcesUnder(SOURCES);

  assert.deepEqual(deletedTables(sources).sort(), ['coverage_story', 'dependency', 'session'],
    'something in src/ deletes a row through crud.js that is not a session, an edge or a coverage_story row');
  assert.ok(sources.length > 30, `only ${sources.length} sources were swept`);
});

test('both sweeps flag a planted deleter [unit]', (t) => {
  const { tools } = surface(t);

  // The controls, and they are what make the two answers above mean anything. A registry sweep whose
  // prefix never matched, and a source sweep whose pattern never matched, would each pass the test
  // above on a surface that deleted coverage rows freely.
  const planted = [...tools, { name: 'delete_coverage', table: 'coverage' }];

  assert.deepEqual(deleters(planted).filter((tool) => tool.table === 'coverage')
    .map((tool) => tool.name), ['delete_coverage']);

  assert.deepEqual(
    deletedTables([{ name: 'planted.js', text: "handler: () => deleteById(db, 'coverage', args.id, 'x')" }]),
    ['coverage'],
  );

  // And the source sweep does not complain about prose that explains the rule, which is why it
  // strips comments first — this file and `coverage.js` both discuss deleting coverage rows.
  assert.deepEqual(
    deletedTables([{ name: 'planted.js', text: "// deleteById(db, 'coverage', id, 'x')" }]),
    [],
  );
});
