/**
 * Story 2 — the vocabularies as a *feature*, rather than as a schema that permits one.
 *
 * `dpm/tests/vocabulary.test.js` covers what Epic 47-01 built: the terms are closed, domain-scoped,
 * and retirement is enforced in both directions by triggers derived from the references. All of it
 * is asserted through SQL, because when it was written there was no other way to write a row.
 *
 * This file asserts the half FR24 actually promises a project. "Extensible per project" and
 * "retirable" are claims about what someone can *do*, and a rule reachable only by opening the
 * database with a SQL client is not a feature — it is a constraint on a feature that does not
 * exist. So every write below goes through the tool surface, which is also FR3's requirement that
 * the surface be the only write path.
 *
 * **Three assertions are enumerations rather than examples**, for the reason Story 1's parity
 * check is: the must-NOT is that *any* vocabulary is extensible but not retirable, and a test
 * naming four tables cannot fail for a fifth. The retirable tables are read out of the live schema
 * by the column that makes them retirable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { renderDocument } from '../src/projection/index.ts';
import { observationsOf } from '../src/projection/load.ts';
import { conformance } from './support/conformance.js';

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

/** The whole of the DDL, so "without a schema migration" is a comparison rather than a claim. */
const schemaOf = (db) => db
  .prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name')
  .all()
  .map((row) => `${row.type} ${row.name}: ${row.sql}`)
  .join('\n');

/** A spec, an epic and a retro on it — what an observation needs to hang off. */
function retro(call) {
  const spec = call.create_spec({ slug: 'vocab', title: 'Vocabularies' });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'terms', title: 'Terms' });
  const record = call.create_retro({
    parent_id: epic.id, slug: 'terms', title: 'Retro on the terms',
  });

  return { spec, epic, retro: record };
}

/**
 * The tables that carry `retired_at` and are **not** vocabularies, so the retire *verb* does not
 * apply to them and the update tool is the intended path.
 *
 * A vocabulary is a roster something is offered from, and its retire tool exists so that retiring is
 * one deliberate act with a reason rather than a column an ordinary update could set — or clear. The
 * three below are none of them: an `observation` is a retro lesson that has been spent or has
 * graduated to the library, retired by `dpm:retro retire` setting the column; an `artifact` is a
 * published page this project no longer points anyone at, retired by `dpm:artifact` doing the same;
 * a `coverage` row is one binding of a fragment to a criterion, withdrawn when the binding turns out
 * wrong or its criterion is superseded. All three are records rather than rosters, and none is
 * offered as a choice to a run.
 *
 * **`coverage` is here for that reason and not because its retire tool is late.** One arrives with
 * `retire_coverage`, and the check below is an `ok` rather than an equality, so the entry stays true
 * either way: what it says is that nothing offers a binding from a roster, which no tool can change.
 *
 * Named here rather than skipped inline so the two checks below cannot drift apart, and so adding a
 * fourth is a decision with a place to write the reason down.
 */
const NOT_A_VOCABULARY = new Set(['observation', 'artifact', 'coverage']);

/**
 * Every table a term can be retired in, found by the column that makes retirement possible.
 *
 * Read from the schema and not listed, because the must-NOT is about *any* vocabulary — a fifth
 * one added later is exactly the case a written list cannot fail for.
 */
function retirable(db) {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
    .filter((table) => db.prepare(`PRAGMA table_info(${table})`).all()
      .some((column) => column.name === 'retired_at'))
    .sort();
}

/**
 * Vocabularies the registry offers and cannot retire — a create tool, and no retire tool beside it.
 *
 * One reader, because four checks below ask this question of four different registries: the live
 * one, one with a tool removed, and two built to drive a must-NOT. Written out at each site they
 * would eventually disagree about what counts, which is the state the enumeration exists to catch.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Set<string>} named The tool names to judge against, live or planted.
 * @param {Set<string>} [excluded] Tables the retire *verb* does not apply to.
 * @returns {string[]}
 */
function unretirable(db, named, excluded = NOT_A_VOCABULARY) {
  return retirable(db)
    .filter((table) => !excluded.has(table))
    .filter((table) => named.has(`create_${table}`) && !named.has(`retire_${table}`));
}

// --- Criterion 1: a project-added category is usable without a schema migration -----------------

test('a term the plugin never seeded is added and used, and the schema is untouched', (t) => {
  const { db, call } = surface(t);
  const { retro: record } = retro(call);

  const before = schemaOf(db);
  const version = db.prepare('SELECT MAX(version) AS at FROM schema_version').get().at;

  // A category CPM's prose does not have and dpm does not seed. This is the append FR24's
  // evolution clause is about: the project has a kind of observation the plugin never anticipated.
  const term = call.create_taxonomy({
    id: 'observation:tooling-friction',
    domain: 'observation',
    name: 'Tooling Friction',
    singular: 'Tooling friction',
    position: 7,
  });

  const observation = call.create_observation({
    retro_id: record.id, position: 0,
    text: 'The retire tool is a separate verb, and that is why a mistyped update cannot undo one.',
  });

  const attached = call.create_observation_category({
    observation_id: observation.id, taxonomy_id: term.id,
  });

  assert.equal(attached.taxonomy_id, 'observation:tooling-friction');
  assert.deepEqual(
    call.read_observation_category({ observation_id: observation.id, taxonomy_id: term.id }),
    attached,
  );

  // The whole point of the criterion, and the only assertion that can carry it: not one byte of
  // DDL differs, and the migration runner was never involved. A vocabulary that needed a column,
  // a CHECK or a new table per project would be extensible in name only.
  assert.equal(schemaOf(db), before, 'adding a term altered the schema');
  assert.equal(db.prepare('SELECT MAX(version) AS at FROM schema_version').get().at, version);

  // And it is offered, not merely stored. A term reachable only by the key you already know is
  // not a vocabulary a skill can put in front of anyone.
  const offered = call.list_taxonomy({ domain: 'observation', limit: 100 });

  assert.ok(offered.items.some((row) => row.id === term.id), 'the added term is not in the roster');
  assert.ok(offered.items.every((row) => row.domain === 'observation'), 'the domain scope leaked');
});

test('the domain prefix is required, because it is the key two databases agree on', (t) => {
  const { call } = surface(t);

  assert.match(
    refused(() => call.create_taxonomy({
      id: 'tooling-friction', domain: 'observation', name: 'Tooling Friction', position: 7,
    })).message,
    /does not begin with 'observation:'/,
  );
});

// --- Criterion 2: two categories round-trip, and the projection shows both ----------------------

test('an observation carrying two categories appears under both in the projection', (t) => {
  const { db, call } = surface(t);
  const { epic, retro: record } = retro(call);

  // One seeded term and one the project added, so the pair cannot both be coming from the seed.
  call.create_taxonomy({
    id: 'observation:tooling-friction', domain: 'observation',
    name: 'Tooling Friction', singular: 'Tooling friction', position: 7,
  });

  const observation = call.create_observation({
    retro_id: record.id, position: 0,
    text: 'The join is the requirement: this observation is a testing gap and a tooling one at once.',
  });

  for (const taxonomy_id of ['observation:testing-gaps', 'observation:tooling-friction']) {
    call.create_observation_category({ observation_id: observation.id, taxonomy_id });
  }

  // The round trip, through the loader the templates use rather than through raw SQL.
  const [loaded] = observationsOf(db, record.id);

  assert.deepEqual(loaded.categories.sort(), ['Testing gap', 'Tooling friction']);

  // And the projection. This is the half that makes the criterion worth having: the compound
  // headings in the real corpus — `Testing gap / pattern`, `Pattern reuse + testing` — were
  // invented because one column could hold one category, and prose is where the cost showed up.
  const { text } = renderDocument(db, record.id);

  assert.match(text, /Testing gap/);
  assert.match(text, /Tooling friction/);
  assert.match(text, /Testing gap · Tooling friction/,
    'both categories are present but not rendered as one attribution');

  // The mutation that matters is the one-column design, and it is asserted rather than described:
  // with either row removed the projection carries a single category and the compound is gone.
  db.prepare('DELETE FROM observation_category WHERE taxonomy_id = ?')
    .run('observation:tooling-friction');

  const single = renderDocument(db, record.id).text;

  assert.match(single, /Testing gap/);
  assert.equal(/Tooling friction/.test(single), false);
  assert.equal(/ · /.test(single), false);

  // Restored, so the epic's own retro of this work does not have to trust the paragraph above.
  call.create_observation_category({
    observation_id: observation.id, taxonomy_id: 'observation:tooling-friction',
  });

  assert.match(renderDocument(db, record.id).text, /Testing gap · Tooling friction/);
});

test('a category from another domain is refused, so the join cannot widen the scoping', (t) => {
  const { call } = surface(t);
  const { retro: record } = retro(call);

  const observation = call.create_observation({
    retro_id: record.id, position: 0, text: 'A severity is not a category.',
  });

  refused(() => call.create_observation_category({
    observation_id: observation.id, taxonomy_id: 'severity:warning',
  }), 'a severity was accepted in a category slot');
});

// --- Criterion 3: retirement preserves what exists and stops what is new ------------------------

test('retiring a taxonomy term, a test approach and a dependency kind spares existing rows', (t) => {
  const { call } = surface(t);
  const { spec, epic, retro: record } = retro(call);

  // One row of each kind, written while every term is live.
  const observation = call.create_observation({
    retro_id: record.id, position: 0, text: 'Written before the term was retired.',
  });
  call.create_observation_category({
    observation_id: observation.id, taxonomy_id: 'observation:testing-gaps',
  });

  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR24', class: 'functional',
    text: 'Vocabularies are seeded, extensible and retirable', position: 0,
  });
  const criterion = call.create_acceptance_criterion({
    requirement_id: requirement.id, text: 'a retired term keeps its rows', position: 0,
  });
  call.create_criterion_approach({ criterion_id: criterion.id, tag: 'unit' });

  const other = call.create_epic({ parent_id: spec.id, slug: 'later', title: 'Later' });
  call.create_dependency({
    kind: 'blocks', source_document_id: epic.id, target_document_id: other.id,
  });

  const retiredTaxonomy = call.retire_taxonomy({ id: 'observation:testing-gaps' });
  const retiredApproach = call.retire_test_approach({ tag: 'unit' });
  const retiredKind = call.retire_dependency_kind({ kind: 'blocks' });

  for (const row of [retiredTaxonomy, retiredApproach, retiredKind]) {
    assert.ok(row.retired_at, 'the retire tool did not stamp a date');
  }

  // Half one: what already referenced the term is untouched and still readable. A retirement that
  // took its rows with it would be a delete with a gentler name.
  assert.deepEqual(
    { ...call.read_observation_category({
      observation_id: observation.id, taxonomy_id: 'observation:testing-gaps',
    }) },
    {
      observation_id: observation.id,
      taxonomy_id: 'observation:testing-gaps',
      // The scoping half of the composite key, defaulted by the column rather than passed. It is
      // asserted rather than ignored because it is what stops a severity filling a category slot.
      taxonomy_domain: 'observation',
    },
  );
  assert.deepEqual(
    { ...call.read_criterion_approach({ criterion_id: criterion.id, tag: 'unit' }) },
    { criterion_id: criterion.id, tag: 'unit' },
  );
  assert.equal(call.list_requirement({ spec_id: spec.id }).returned, 1);

  // Half two: nothing new may arrive against any of the three. Both halves, on every one of them,
  // because each can pass while the other fails — a term that kept its rows and accepted new ones
  // is not retired, and one that refused new rows by cascading the old ones away is worse.
  const second = call.create_observation({
    retro_id: record.id, position: 1, text: 'Written after.',
  });

  refused(() => call.create_observation_category({
    observation_id: second.id, taxonomy_id: 'observation:testing-gaps',
  }), 'a retired category accepted a new row');

  const later = call.create_acceptance_criterion({
    requirement_id: requirement.id, text: 'and refuses new ones', position: 1,
  });

  refused(() => call.create_criterion_approach({ criterion_id: later.id, tag: 'unit' }),
    'a retired test approach accepted a new row');

  refused(() => call.create_dependency({
    kind: 'blocks', source_document_id: other.id, target_document_id: epic.id,
  }), 'a retired dependency kind accepted a new edge');
});

test('a retired term drops out of the roster and stays readable by key', (t) => {
  const { call } = surface(t);

  call.retire_test_approach({ tag: 'unit' });

  const offered = call.list_test_approach({ limit: 100 }).items.map((row) => row.tag);

  assert.equal(offered.includes('unit'), false, 'a retired approach is still being offered');
  assert.ok(offered.length > 0, 'the roster emptied rather than losing one term');

  // Readable by key, and visible on request. Retirement is not a delete, and a projection that
  // has to render a row written years ago still needs the term's display form.
  assert.ok(call.read_test_approach({ tag: 'unit' }).retired_at);
  assert.ok(call.list_test_approach({ include_retired: true, limit: 100 })
    .items.some((row) => row.tag === 'unit'));
});

test('retiring twice is reported rather than silently moving the date', (t) => {
  const { call } = surface(t);

  const first = call.retire_dependency_kind({ kind: 'supersedes' });
  const again = refused(() => call.retire_dependency_kind({ kind: 'supersedes' }));

  assert.match(again.message, /already retired at/);
  assert.equal(call.read_dependency_kind({ kind: 'supersedes' }).retired_at, first.retired_at);
});

test('retirement is not offered as a column an update can set or clear', (t) => {
  const { tools, call } = surface(t);
  const named = new Set(tools.map((tool) => tool.name));

  // Scoped to the tables that have a retire *verb*, and derived rather than listed. `observation`
  // is the one that carries both: `retire_observation` for a run taking back a duplicate, and the
  // column for `dpm-retro`, which sets it in the same call as `library_doc_id` so a promoted lesson
  // cannot be linked without being retired. The loop below is what that costs.
  const withVerb = tools.filter((tool) => tool.name.startsWith('update_')
    && named.has(tool.name.replace('update_', 'retire_')));

  // Named rather than counted. The set was "the four vocabularies" until spec 04 gave `coverage` a
  // retirement verb of its own, and a count says nothing about which table joined or left — the
  // failure this would have reported is "5, not 4", on a change that is either correct or a serious
  // mistake depending entirely on the name.
  assert.deepEqual(withVerb.map((tool) => tool.table).sort(),
    ['agent', 'coverage', 'dependency_kind', 'observation', 'taxonomy', 'test_approach'],
    'a table gained or lost a retirement verb');

  for (const tool of withVerb) {
    // **The exception, and it is the atomicity that buys it.** `dpm-retro` promotes a lesson by
    // writing `library_doc_id` with `retired_at` and `retired_reason` together, and a promotion
    // that linked the document in one call and retired the source in another would leave a lesson
    // offerable twice if the run stopped between them. So the column stays reachable here — where
    // every other table on this list would be accepting a way to undo its own retirement by
    // mistyping an update. `update_observation` is v0.7.0's besides, and the surface is a floor.
    if (tool.table === 'observation') continue;

    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'retired_at'), false,
      `${tool.name} offers retired_at, so a mistyped update could undo a retirement`);
  }

  // And the refusal a caller actually meets, rather than only the absence from the schema.
  assert.match(
    refused(() => call.update_agent({ name: 'pm', retired_at: null })).message,
    /unknown argument/,
  );
});

// --- must NOT: seeded and extensible, but not retirable ----------------------------------------

test('every retirable table has a create tool and a retire tool, enumerated from the schema', (t) => {
  const { db, tools } = surface(t);
  const named = new Set(tools.map((tool) => tool.name));
  const tables = retirable(db);

  // The control. Without it an enumeration that found nothing would pass, which is the shape the
  // must-NOT would take if `retired_at` were ever renamed.
  assert.deepEqual(tables,
    ['agent', 'artifact', 'coverage', 'dependency_kind', 'observation', 'taxonomy', 'test_approach']);

  for (const table of tables) {
    if (NOT_A_VOCABULARY.has(table)) continue;

    assert.ok(named.has(`create_${table}`), `${table} is seeded and cannot be extended`);
    assert.ok(named.has(`retire_${table}`), `${table} is extensible and cannot be retired`);
  }
});

test('a vocabulary whose retire tool is missing is named by the enumeration', (t) => {
  const { db, tools } = surface(t);

  // The must-NOT driven through the check: the state it forbids, built by removing one tool.
  const without = new Set(tools
    .map((tool) => tool.name)
    .filter((name) => name !== 'retire_dependency_kind'));

  assert.deepEqual(unretirable(db, without), ['dependency_kind']);

  // The control: undisturbed, the same sweep finds nothing.
  assert.deepEqual(unretirable(db, new Set(tools.map((tool) => tool.name))), []);
});

// --- Criterion 5: a project-added persona is in the roster, with no file anywhere ---------------

test('a persona the plugin never shipped joins the roster in position order', (t) => {
  const { db, call } = surface(t);

  const before = schemaOf(db);
  const seeded = call.list_agent({ limit: 100 }).items.map((row) => row.name);

  assert.ok(seeded.length >= 8, 'the seeded roster is smaller than the plugin ships');
  assert.equal(seeded.includes('archivist'), false);

  call.create_agent({
    name: 'archivist',
    display_name: 'Wren',
    icon: '🗄️',
    role: 'Archivist',
    personality: 'Keeps the record of what was decided and refuses to let it be quietly rewritten.',
    communication_style: 'Cites the artefact and the date, then stops.',
    position: 3,
  });

  const roster = call.list_agent({ limit: 100 }).items;

  // Appended — not replacing the ten, which is the operation `agents/roster.yaml` cannot express:
  // a file is overridden whole, so adding one persona means forking all of them and maintaining
  // the fork against every release.
  assert.deepEqual(roster.map((row) => row.name).filter((name) => seeded.includes(name)), seeded);
  assert.ok(roster.some((row) => row.name === 'archivist'));

  // In its place in the order, rather than on the end. A roster is offered to a human, and a
  // project that positions its own persona among the others meant it to appear there.
  assert.deepEqual(
    roster.map((row) => row.position),
    [...roster.map((row) => row.position)].sort((a, b) => a - b),
  );

  // No schema change and no file: the roster is a query. This is the whole of what dpm can assert
  // about the criterion — that `party`, `review` and `consult` then *offer* it completes when
  // those three skills read this table, in Epics 47-07 and 47-08.
  assert.equal(schemaOf(db), before);

  // The body split holds here too, so a roster listing does not carry two paragraphs per persona.
  const summary = call.list_agent({ limit: 100 }).items[0];

  assert.equal(Object.hasOwn(summary, 'personality'), false);
  assert.ok(call.read_agent({ name: 'archivist', include_body: true }).personality);
});

test('a retired persona leaves the roster and its past attributions still resolve', (t) => {
  const { db, call } = surface(t);

  const spec = call.create_spec({ slug: 'roster', title: 'Roster' });
  const review = call.create_review({
    parent_id: spec.id, slug: 'reads', title: 'Review of the reads',
  });

  call.create_document_agent({ document_id: review.id, document_kind: 'review', agent: 'pm' });
  call.retire_agent({ name: 'pm' });

  assert.equal(
    call.list_agent({ limit: 100 }).items.some((row) => row.name === 'pm'),
    false,
    'a retired persona is still being offered for new work',
  );

  // And the review it already sat on renders its name, not its roster key — the FR24 guarantee
  // stated where a reader would notice it failing.
  assert.match(renderDocument(db, review.id).text, /Jordan \(Product Manager\)/);
});

// --- Supersession's retirement tool, reached by the derived sweeps ------------------------------

test('the retirement tool is registered and the whole-registry sweep reaches it', (t) => {
  const { db, tools } = surface(t);
  const registered = tools.find((tool) => tool.name === 'retire_coverage');

  assert.ok(registered, 'retire_coverage is not in the live registry');
  assert.equal(registered.table, 'coverage');

  // Registered is not the same as reached, and the two look identical from a clean report. So the
  // sweep is driven on a registry holding one defective copy of this tool: if `retire_coverage`
  // were passed over, the planted defect would come back clean exactly as the real one does.
  const { problems } = conformance(db, tools);

  assert.deepEqual(problems, []);

  const defective = tools.map((tool) => (tool.name !== 'retire_coverage' ? tool : {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...tool.inputSchema.properties, withdrawal: { type: 'string', enum: ['x'] } },
    },
  }));

  assert.deepEqual(conformance(db, defective).problems,
    ["retire_coverage: 'withdrawal' declares an enum but is not a column of coverage"]);
});

test('must NOT — a column or tool this change added is exempted from a derived sweep', (t) => {
  const { db, tools } = surface(t);
  const named = new Set(tools.map((tool) => tool.name));

  // `coverage` is the one place this change's surface is named in an exclusion, and the exclusion
  // is about rosters rather than about a missing tool. Which means it must conceal nothing: run
  // the check the skip bypasses, over the table the skip names, and it passes on its own merits.
  assert.ok(NOT_A_VOCABULARY.has('coverage'));
  assert.ok(retirable(db).includes('coverage'));
  assert.ok(named.has('create_coverage') && named.has('retire_coverage'));

  // Driven rather than argued: with the entry deleted the enumeration takes `coverage` in and
  // still finds nothing, so nothing is resting on the skip. The other two entries are left alone —
  // they are records this change did not add, and neither has a retire tool.
  const included = new Set([...NOT_A_VOCABULARY].filter((table) => table !== 'coverage'));

  assert.deepEqual(unretirable(db, named, included), []);

  // The control. Without it the line above passes for the wrong reason — an enumeration that
  // stopped returning `coverage` would also find nothing to complain about.
  const withoutTool = new Set([...named].filter((name) => name !== 'retire_coverage'));

  assert.deepEqual(unretirable(db, withoutTool, included), ['coverage']);
});
