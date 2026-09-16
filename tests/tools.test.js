/**
 * Story 2 — typed create, read and update tools for the spine.
 *
 * Three of the four criteria are positive and one is a must-NOT, and the must-NOT is the one that
 * shapes the file. "The `requirement` create tool does not infer a class from `label`" cannot be
 * established by reading the code for a regex — an inference can be written a dozen ways, and a
 * test that greps for one of them passes against the other eleven while looking thorough. So it
 * is asserted behaviourally and in both directions: `class` is refused when absent, and a label
 * of every shape the corpus uses is stored against a class deliberately at odds with it. A tool
 * that inferred anything would have to disagree with at least one of them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { defineTool, validate, ToolError } from '../src/tools/convention.ts';
import { insert } from '../src/tools/crud.ts';
import { dispatch, methods } from '../src/server/mcp.ts';

/** A live database and its registry, keyed by name. Every test starts here. */
function surface(t) {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db, { now: () => STAMP });

  return { db, tools, call: handlers(tools) };
}

const STAMP = '2026-08-08T12:00:00.000Z';

/** The seven Story 2's criterion enumerates, plus the eighth the third criterion names. */
const SPINE = ['spec', 'requirement', 'story_criterion', 'epic', 'story', 'task', 'coverage'];
const ALSO = 'acceptance_criterion';

/** The eight this story owns. Every use below matches a whole tool name, so the order is display. */
const TYPES = [...SPINE, ALSO];

/** A whole chain, so every type has something real to hang off. */
function chain(call) {
  const spec = call.create_spec({ slug: 'dpm', title: 'dpm SQLite persistence' });
  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional',
    text: 'Every CPM artefact type is a table with typed columns', position: 0,
  });
  const acceptance_criterion = call.create_acceptance_criterion({
    requirement_id: requirement.id, text: 'a row exists', position: 0,
  });
  const epic = call.create_epic({ parent_id: spec.id, slug: 'spine', title: 'Spine tools' });
  const story = call.create_story({
    epic_id: epic.id, number: 2, title: 'Expose typed tools', position: 1,
  });
  const task = call.create_task({
    story_id: story.id, number: 3, title: 'Implement', description: 'do it', position: 2,
  });
  const story_criterion = call.create_story_criterion({
    story_id: story.id, text: 'creating each type produces a row', position: 0,
  });
  const coverage = call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'is a table',
    story_criterion_id: story_criterion.id, position: 0,
  });

  return { spec, requirement, acceptance_criterion, epic, story, task, story_criterion, coverage };
}

/** Run a call that must be refused, and hand back the error. `assert.throws` returns nothing. */
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

// --- The surface itself -------------------------------------------------------------------------

test('every spine type has create, read and update, and the count is derived', (t) => {
  const { tools } = surface(t);

  const verbs = new Map();
  for (const { name } of tools) {
    const [verb, ...rest] = name.split('_');
    const type = rest.join('_');
    if (!verbs.has(type)) verbs.set(type, new Set());
    verbs.get(type).add(verb);
  }

  // A subset rather than an equality, because a later story adding a fourth verb to a type is not
  // this criterion failing — Story 4 added `list` to all eight. What this asserts is that the
  // three are present for every type, which is what the criterion says.
  for (const type of TYPES) {
    const present = verbs.get(type) ?? new Set();

    for (const verb of ['create', 'read', 'update']) {
      assert.ok(present.has(verb), `${type} has no ${verb} tool`);
    }
  }

  // Derived from the registry rather than restated. A literal here would be a second place for
  // the count to live, and the epic's own prose has drifted on exactly that three cycles running.
  //
  // Scoped to the spine, because the registry no longer holds only spine tools: Story 3 added
  // the cross-cutting three, which are one tool each and would make `× 3` false. Filtering by
  // what this story is about is the fix; raising the number would have made the next story's
  // additions break it again.
  // **Matched whole rather than by suffix.** A suffix test was correct while `story` was the only
  // table ending in `story`; Epic 47-05 added `coverage_story`, whose create and read tools then
  // counted as the spine's own and made this equality fail against a registry that was right.
  // Building the names from the two lists cannot alias.
  const spineNames = tools
    .map((tool) => tool.name)
    .filter((name) => TYPES.some((type) =>
      ['create', 'read', 'update'].some((verb) => name === `${verb}_${type}`)));

  assert.equal(spineNames.length, TYPES.length * 3);
  assert.equal(TYPES.length, SPINE.length + 1, 'seven spine types plus acceptance_criterion');
});

test('every tool declares the table it touches and what it can return', (t) => {
  const { db, tools } = surface(t);

  for (const tool of tools) {
    assert.ok(tool.table, `${tool.name} declares no table`);
    assert.ok(tool.reads.length > 0, `${tool.name} declares no reads`);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(Object.isFrozen(tool), `${tool.name} is mutable after definition`);
  }

  // The control: `reads` is what Story 5's reachability assertion consumes, so every name in it
  // has to be a table that exists — not merely a non-empty string. Checked against the live
  // schema rather than a list here, so adding a tool for a new table needs no edit to this test
  // and a typo in a `reads` entry still fails.
  const live = new Set(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name),
  );
  live.add('sqlite_schema');

  const unknown = [...new Set(tools.flatMap((tool) => tool.reads))]
    .filter((name) => !live.has(name));

  assert.deepEqual(unknown, [], 'a tool declares it reads something that is not a table');
  assert.ok(live.size > 10, 'and the schema it was checked against was actually read');
});

// --- Criterion 1: creating each type produces a row its read tool returns ------------------------

test('every type round-trips from create to its own read tool', (t) => {
  const { tools, call } = surface(t);
  const created = chain(call);

  for (const [type, row] of Object.entries(created)) {
    // With the body asked for, since Story 4 made the summary the default — the round-trip is a
    // claim about the whole row, so it has to ask for the whole row.
    const name = `read_${type}`;
    const { body } = tools.find((tool) => tool.name === name);
    const read = call[name](body.length > 0 ? { id: row.id, include_body: true } : { id: row.id });

    // **Every column the create returned, rather than the whole object.** Stated as an equality
    // over the two rows this failed the moment `reference` arrived beside them — a derived field
    // no create tool returns and no column of any table. That is a change detector rather than a
    // round-trip claim: the claim is that nothing the write stored comes back different, and a
    // read that carries something extra has not broken it. A column the read *dropped* still
    // fails, as `undefined` against the value the create wrote.
    const stored = Object.fromEntries(Object.keys(row).map((column) => [column, read[column]]));

    assert.deepEqual(stored, { ...row }, `${type} did not read back as it was written`);
  }

  assert.equal(Object.keys(created).length, SPINE.length + 1, 'the chain covered every type');
});

test('a read tool named for a kind refuses a document of another kind', (t) => {
  const { call } = surface(t);
  const { spec, epic } = chain(call);

  const error = refused(() => call.read_spec({ id: epic.id }));
  assert.match(error.message, /is a epic, not a spec/);

  // Both controls, because a read that refused everything would pass the assertion above.
  assert.equal(call.read_spec({ id: spec.id }).id, spec.id);
  assert.equal(call.read_epic({ id: epic.id }).id, epic.id);
});

test('reading something that is not there is a refusal, not an empty artefact', (t) => {
  const { call } = surface(t);
  chain(call);

  const error = refused(() => call.read_task({ id: 'no-such-id' }));
  assert.equal(error.rpc.code, -32602);
  assert.match(error.message, /no task with id 'no-such-id'/);
});

// --- Criterion 4 (must NOT): nothing is inferred from a label ------------------------------------

test('the requirement create tool refuses a call with no class', (t) => {
  const { call } = surface(t);
  const { spec } = chain(call);

  const error = refused(() => call.create_requirement({
    spec_id: spec.id, label: 'NFR3', text: 'a label that names its own class', position: 1,
  }));

  assert.match(error.message, /'class' is required/);
  assert.equal(error.rpc.code, -32602, 'refused at the tool boundary, not by the database');

  // The control: the identical call with `class` supplied is accepted. Without it, a tool that
  // refused every requirement would pass the assertion above.
  const accepted = call.create_requirement({
    spec_id: spec.id, label: 'NFR3', class: 'non_functional', text: 'x', position: 1,
  });
  assert.equal(accepted.class, 'non_functional');
});

test('a label of any shape is stored against the class it was given, never one read off it', (t) => {
  const { call } = surface(t);
  const { spec } = chain(call);

  // Each pairing is deliberately at odds with what a parser would conclude from the label — the
  // four the shell implementations actually derived, one per class. An inference written any way
  // at all disagrees with at least one row here; a tool that stores what it is told agrees with
  // all four. That is the property, and it does not depend on how the inference was spelled.
  const contrary = [
    // `FR1` is taken — `chain()` created it, and `UNIQUE (spec_id, label)` is doing its job.
    { label: 'NFR3', class: 'functional' },
    { label: 'FR7', class: 'non_functional' },
    { label: 'ENVX2', class: 'environmental_requirement' },
    { label: 'ENV1', class: 'environmental_restriction' },
  ];

  contrary.forEach((pair, index) => {
    const written = call.create_requirement({
      spec_id: spec.id, ...pair, text: 'contrary', position: index + 10,
    });

    assert.equal(written.class, pair.class, `${pair.label} was reclassified`);
    assert.equal(written.label, pair.label, `${pair.label} was rewritten`);
    assert.equal(call.read_requirement({ id: written.id }).class, pair.class);
  });
});

// --- Criterion 3: the distinction survives label and text being withheld -------------------------

test('requirement type distinctions are columns, readable with label and text withheld', (t) => {
  const { call } = surface(t);
  const { spec } = chain(call);

  const written = call.create_requirement({
    spec_id: spec.id, label: 'FR9', class: 'environmental_restriction',
    moscow: 'wont', exclusion: 'out_of_scope', text: 'the prose nobody may parse', position: 2,
  });

  const read = call.read_requirement({ id: written.id });
  delete read.label;
  delete read.text;

  assert.deepEqual(
    { class: read.class, moscow: read.moscow, exclusion: read.exclusion },
    { class: 'environmental_restriction', moscow: 'wont', exclusion: 'out_of_scope' },
  );

  // And the read tool says which of its fields are the body, so Story 4's bound is a filter over
  // this shape rather than a change to it.
  assert.deepEqual(spineTools(openPlanningDatabase(t))
    .find((tool) => tool.name === 'read_requirement').body, ['text']);
});

test('criterion polarity is a column on both criterion tables, not a prefix in the text', (t) => {
  const { call } = surface(t);
  const { requirement, story } = chain(call);

  const pairs = [
    ['acceptance_criterion', { requirement_id: requirement.id }],
    ['story_criterion', { story_id: story.id }],
  ];

  for (const [table, parent] of pairs) {
    const written = call[`create_${table}`]({
      ...parent,
      // Deliberately without the `must NOT —` prefix the markdown corpus recognised it by.
      text: 'the tool accepts an argument the schema rejects',
      polarity: 'must_not',
      position: 5,
    });

    const read = call[`read_${table}`]({ id: written.id });
    delete read.text;

    assert.equal(read.polarity, 'must_not', `${table} lost its polarity when text was withheld`);

    // The control: the default is the other value, so `must_not` above was stored and not assumed.
    const plain = call[`create_${table}`]({ ...parent, text: 'plain', position: 6 });
    assert.equal(plain.polarity, 'must');
  }
});

test('an update that names one field leaves the others alone', (t) => {
  const { call } = surface(t);
  const { requirement } = chain(call);

  const negative = call.create_acceptance_criterion({
    requirement_id: requirement.id, text: 'x', polarity: 'must_not', position: 7,
  });

  // `polarity` declares `default: 'must'` in the published schema. If the validator materialised
  // that default rather than merely advertising it, this update would silently reset a must-NOT
  // criterion to a positive one — a data loss with no error and no argument naming it.
  const moved = call.update_acceptance_criterion({ id: negative.id, position: 8 });

  assert.equal(moved.polarity, 'must_not');
  assert.equal(moved.position, 8);

  // The control: asking for the change does make it.
  assert.equal(
    call.update_acceptance_criterion({ id: negative.id, polarity: 'control' }).polarity,
    'control',
  );
});

test('an update with nothing to change is refused rather than reported as done', (t) => {
  const { call } = surface(t);
  const { requirement } = chain(call);

  const error = refused(() => call.update_requirement({ id: requirement.id }));
  assert.match(error.message, /nothing to update/);

  assert.equal(call.update_requirement({ id: requirement.id, moscow: 'should' }).moscow,
    'should');
});

// --- Rejection at the tool boundary (FR3's half that lands in this story) ------------------------

test('the boundary refuses what it can see, and names what it refused', (t) => {
  const { call } = surface(t);
  const { spec, story } = chain(call);

  const cases = [
    ['unknown argument', () => call.create_spec({ slug: 'x', title: 'X', number: 1 }),
      /unknown argument 'number'/],
    ['value outside the CHECK set', () => call.update_spec({ id: spec.id, status: 'done' }),
      /must be one of pending, complete, superseded, withdrawn — got 'done'/],
    ['wrong type', () => call.create_task({
      story_id: story.id, number: 'three', title: 'T', position: 0 }), /must be integer/],
    ['empty string where a value is needed', () => call.create_spec({ slug: '', title: 'X' }),
      /'slug' must not be empty/],
    ['a required argument omitted', () => call.create_story({
      epic_id: 'x', title: 'T', position: 0 }), /'number' is required/],
  ];

  for (const [label, run, expected] of cases) {
    const error = refused(run, label);

    assert.match(error.message, expected, label);
    assert.equal(error.rpc.code, -32602, `${label} reached the database instead of being refused`);
  }
});

test('a constraint only the database can check is still a refusal, not a crash', (t) => {
  const { call } = surface(t);
  const { requirement, story_criterion, coverage } = chain(call);

  // The tool boundary cannot know whether a parent exists or a binding is already taken; the
  // database can. Both must reach the caller as a bad call rather than as a broken server.
  const missing = refused(() => call.create_story_criterion({
    story_id: 'no-such-story', text: 't', position: 0 }));
  assert.equal(missing.rpc.code, -32602);
  assert.match(missing.message, /FOREIGN KEY/);

  const duplicate = refused(() => call.create_coverage({
    requirement_id: requirement.id, spec_fragment: coverage.spec_fragment,
    story_criterion_id: story_criterion.id, position: 99,
  }));
  assert.match(duplicate.message, /UNIQUE constraint failed/);

  // Two controls, and they are the pair that proves `position` is display order and no part of
  // identity: a different fragment at any position is accepted, and the same fragment at a
  // different position is not.
  assert.ok(call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'with typed columns',
    story_criterion_id: story_criterion.id, position: 99,
  }).id);
});

test('verification is set as a pair, and the hash is the servers rather than the callers', (t) => {
  const { call, tools } = surface(t);
  const { coverage, story_criterion } = chain(call);

  // The half-set state the `CHECK` used to be the only guard against is now unreachable from the
  // tool at all: `verified: true` completes itself, and the time it records is the server's rather
  // than whatever the caller believed it to be. What was a refusal is the ordinary call.
  const whole = call.update_coverage({ id: coverage.id, verified: true });
  assert.equal(whole.verified_at, STAMP);

  // Recomputed here from the two bound texts rather than read from `binding.js`, so a change to
  // what is hashed or to the separator between the halves fails this rather than agreeing with
  // itself. `is a table` is the fragment `chain` binds.
  const expected = createHash('sha256')
    .update(`is a table\\u0000${story_criterion.text}\\u0000`)
    .digest('hex');

  assert.equal(whole.binding_hash, expected,
    'the hash is not over the fragment and the criterion text it binds');

  // And both halves are gone from the arguments of both coverage tools, which is what makes the
  // pair evidence: a caller who can supply either can supply anything, and the `CHECK` accepts any
  // string at all. The time matters for the same reason the digest does — it can be backdated.
  for (const name of ['create_coverage', 'update_coverage']) {
    const tool = tools.find((entry) => entry.name === name);

    assert.ok(!('binding_hash' in tool.inputSchema.properties),
      `${name} lets the caller choose the digest that vouches for its own claim`);
    assert.ok(!('verified_at' in tool.inputSchema.properties),
      `${name} lets the caller choose the time its own claim was made`);
  }

  // The other direction, and the reason the hash is read off the stored row: editing the criterion
  // clears the pair (FR21's trigger), and re-verifying yields a hash over the *new* text.
  call.update_story_criterion({ id: story_criterion.id, text: 'creating each type writes a row' });
  const again = call.update_coverage({ id: coverage.id, verified: true });

  assert.notEqual(again.binding_hash, expected, 'the ✓ came back over text that had moved');
});

test('the completeness claim is the callers, and neither half recording it is [unit]', (t) => {
  const { tools } = surface(t);
  const update = tools.find((entry) => entry.name === 'update_requirement');

  // The same pair as the coverage tools above, one table up. A claim is the one thing here no
  // computation can replace — but a claimant that also chose the time and the digest would be the
  // only witness to all three, and a claim dated before the set it was made over reads as current.
  for (const column of ['coverage_claimed_at', 'coverage_claim_hash']) {
    assert.ok(!(column in update.inputSchema.properties),
      `update_requirement lets the caller choose ${column} on its own claim`);
  }

  assert.equal(update.inputSchema.properties.coverage_claimed.type, 'boolean',
    'the claim is still a date the caller types rather than an act it declares');
});

// A local model binding a spec sent a fragment to the neighbouring requirement's id, and a gap check
// counting rows then called both requirements covered. The refusal names where the text is.
test('create_coverage refuses a fragment its requirement does not contain, naming the one that does', (t) => {
  const { call } = surface(t);
  const { spec, requirement, story_criterion } = chain(call);
  const other = call.create_requirement({
    spec_id: spec.id, label: 'FR2', class: 'functional', text: 'A grand total is printed last', position: 1,
  });

  const misfiled = refused(() => call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'A grand total is printed last',
    story_criterion_id: story_criterion.id, position: 1,
  }));

  assert.match(misfiled.message, new RegExp(`not in FR1's text; it is FR2's \\(${other.id}\\)`));

  const invented = refused(() => call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'is a database',
    story_criterion_id: story_criterion.id, position: 1,
  }));

  assert.match(invented.message, /not in FR1's text; no requirement of this spec contains it/);
  assert.equal(call.list_coverage({ requirement_id: requirement.id }).items.length, 1,
    'a refused write left a row behind');
});

test('every create tool enforces every argument it declares required', (t) => {
  const { call } = surface(t);
  const { spec, requirement, epic, story, story_criterion } = chain(call);

  // One valid call per create tool, and then each of its declared required arguments removed in
  // turn. **Written generically after a mutation got through the enumerated version**: dropping
  // `spec_fragment` from `create_coverage`'s required list broke nothing, because every test
  // that called it happened to supply one. A `required` entry nothing omits is a declaration, not
  // a constraint — and the gap is per-argument, so only a per-argument sweep closes it.
  const valid = {
    create_spec: { slug: 'v', title: 'V' },
    create_epic: { parent_id: spec.id, slug: 'v', title: 'V' },
    create_requirement: {
      spec_id: spec.id, label: 'FR99', class: 'functional', text: 't', position: 50 },
    create_acceptance_criterion: {
      requirement_id: requirement.id, text: 't', position: 50 },
    create_story_criterion: { story_id: story.id, text: 't', position: 50 },
    create_story: { epic_id: epic.id, number: 50, title: 'V', position: 50 },
    create_task: { story_id: story.id, number: 50, title: 'V', position: 50 },
    create_coverage: {
      requirement_id: requirement.id, spec_fragment: 'artefact type',
      story_criterion_id: story_criterion.id, position: 50 },
  };

  const { tools } = surface(t);

  // Scoped to the spine's own create tools. `create_dependency` is Story 3's and is swept by
  // that story's suite, where a valid edge needs two documents to hang off.
  const creates = tools.filter((tool) =>
    TYPES.some((type) => tool.name === `create_${type}`));

  assert.deepEqual(
    Object.keys(valid).sort(),
    creates.map((tool) => tool.name).sort(),
    'a spine create tool was added or renamed without a valid call to sweep it with',
  );

  let swept = 0;

  for (const tool of creates) {
    for (const argument of tool.inputSchema.required) {
      const { [argument]: dropped, ...without } = valid[tool.name];
      const error = refused(() => call[tool.name](without), `${tool.name} without ${argument}`);

      assert.match(error.message, new RegExp(`'${argument}' is required`));
      assert.equal(error.rpc.code, -32602);
      swept += 1;
    }
  }

  assert.ok(swept >= creates.length, 'the sweep found required arguments to drop');

  // The controls: every untouched call is accepted, so the refusals above are about the missing
  // argument and not about the fixture being unusable.
  for (const [name, args] of Object.entries(valid)) assert.ok(call[name](args).id, name);
});

test('a column reaching the insert with no value is a refusal, never a bound-parameter crash', (t) => {
  const { db, call } = surface(t);
  const { requirement, story_criterion } = chain(call);

  // Reached directly rather than through a tool, because `validate` is what stops a caller
  // producing this — and the point is what happens if it ever does not. `node:sqlite` answers an
  // `undefined` binding with a bare `TypeError`, which `dispatch` renders as Internal error: the
  // caller is told the server broke. Found by mutating a `required` list, and worth its own guard
  // because the next way in will not be that mutation.
  const error = refused(() => insert(db, 'coverage', {
    id: 'x',
    requirement_id: requirement.id,
    spec_fragment: undefined,
    story_criterion_id: story_criterion.id,
    position: 0,
  }, 'create_coverage'));

  assert.ok(error instanceof ToolError, `a ${error.constructor.name} escaped instead`);
  assert.equal(error.rpc.code, -32602);
  assert.match(error.message, /no value supplied for coverage\.spec_fragment/);

  // The control: the same row with the fragment present is written.
  assert.equal(insert(db, 'coverage', {
    id: 'y',
    requirement_id: requirement.id,
    spec_fragment: 'present',
    story_criterion_id: story_criterion.id,
    position: 1,
  }, 'create_coverage').spec_fragment, 'present');
});

// --- Numbering ----------------------------------------------------------------------------------

test('numbers are allocated, never supplied, and child numbering restarts under each parent', (t) => {
  const { call } = surface(t);

  const first = call.create_spec({ slug: 'one', title: 'One' });
  const second = call.create_spec({ slug: 'two', title: 'Two' });

  assert.deepEqual([first.number, second.number], [1, 2]);
  assert.equal(first.sequence, null, 'a root-numbered kind stores no sequence');

  const under = (spec, slug) => call.create_epic({ parent_id: spec.id, slug, title: slug });

  assert.deepEqual([under(first, 'a').sequence, under(first, 'b').sequence], [1, 2]);
  assert.equal(under(second, 'c').sequence, 1, 'every spec restarts its epics at 1');
  assert.equal(under(second, 'c').number, null, 'a child-numbered kind stores no number');
});

test('a refused create consumes no number', (t) => {
  const { call } = surface(t);
  const spec = call.create_spec({ slug: 'one', title: 'One' });

  // The order inside the handler is what this asserts: everything that can fail is done before
  // `allocateNumber` runs, so a refusal cannot leave a gap in the sequence. FR5 tolerates a gap —
  // never-reused is the promise, not never-skipped — but a gap per failed call is still a number
  // burnt by a caller's typo, and the ordering that avoids it is easy to lose in a later edit.
  refused(() => call.create_epic({ parent_id: spec.id, slug: '', title: 'X' }));

  assert.equal(call.create_epic({ parent_id: spec.id, slug: 'a', title: 'A' }).sequence, 1);
});

test('a child is refused by name when its parent is absent, not by a foreign key', (t) => {
  const { call } = surface(t);

  // **This is the assertion that holds `parent_kind` to being derived**, and it took a mutation
  // to find. `parent_kind` exists so a child cannot claim a parent of the wrong sort, and the
  // tool fills it by reading the parent's own row. Hardcoding it to `'spec'` instead passed the
  // whole suite: `document_kind_parent` admits exactly one parent kind for `epic`, so for this
  // kind the constant and the derivation agree on every legal input, and the *only* observable
  // difference is what happens when the parent is not there at all — a lookup that must find a
  // row, against an insert that fails on a foreign key one step later having already taken a
  // number. The derivation proper becomes falsifiable in Epic 47-05, where `adr` and `retro`
  // have several legal parent kinds and a constant cannot be right for all of them.
  const error = refused(() => call.create_epic({
    parent_id: 'no-such-spec', slug: 'x', title: 'X',
  }));

  assert.match(error.message, /no document with id 'no-such-spec'/);
  assert.doesNotMatch(error.message, /FOREIGN KEY/,
    'the parent was never looked up — parent_kind cannot have been read from it');
});

test('created and updated timestamps come from the server, not the caller', (t) => {
  const { call } = surface(t);
  const { spec } = chain(call);

  assert.equal(spec.created_at, STAMP);
  assert.equal(spec.updated_at, STAMP);

  refused(() => call.create_spec({ slug: 'x', title: 'X', created_at: '1999-01-01T00:00:00Z' }),
    'the caller was allowed to set its own created_at');
});

// --- The convention the whole surface rests on --------------------------------------------------

test('a tool cannot be defined without what the later stories will read from it', () => {
  const ok = {
    name: 'create_thing', table: 'thing', description: 'd', reads: ['thing'], mutates: true,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: () => ({}),
  };

  const broken = {
    'a name that is not a dpm tool name': { ...ok, name: 'createThing' },
    'no table': { ...ok, table: undefined },
    'no description': { ...ok, description: '' },
    'nothing declared in reads': { ...ok, reads: [] },
    'no handler': { ...ok, handler: undefined },
    // Undeclared rather than declared false, which is the point: Story 5 serves a database from a
    // newer plugin read-only, and a tool nobody classified would be served as one that writes.
    'no statement of whether it writes': { ...ok, mutates: undefined },
    'a schema that accepts unknown arguments': {
      ...ok, inputSchema: { type: 'object', properties: {} } },
    'a keyword the validator does not implement': {
      ...ok,
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { x: { type: 'string', pattern: '^a' } } },
    },
  };

  for (const [label, tool] of Object.entries(broken)) refused(() => defineTool(tool), label);

  assert.equal(defineTool(ok).name, 'create_thing', 'the control still defines');
});

test('validation is wrapped on, so a handler cannot receive what the schema forbids', () => {
  let seen;
  const tool = defineTool({
    name: 'create_thing', table: 'thing', description: 'd', reads: ['thing'], mutates: true,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { a: { type: 'string' } }, required: ['a'],
    },
    handler: (args) => {
      seen = args;
      return args;
    },
  });

  refused(() => tool.handler({ b: 1 }));
  assert.equal(seen, undefined, 'the handler ran on arguments the schema rejects');

  tool.handler({ a: 'x' });
  assert.deepEqual(seen, { a: 'x' });
});

test('validate refuses arguments that are not an object at all', () => {
  const schema = { type: 'object', additionalProperties: false, properties: {} };

  for (const bad of [null, 'string', 42, ['a']]) {
    const error = refused(() => validate(schema, bad, 'create_thing'));
    assert.ok(error instanceof ToolError);
  }

  assert.deepEqual(validate(schema, {}, 'create_thing'), {});
});

// --- Over the protocol --------------------------------------------------------------------------

test('a tool call comes back as MCP content, and a refusal as a JSON-RPC error', (t) => {
  const { tools, call } = surface(t);
  const table = methods(tools);
  const { spec } = chain(call);

  const ask = (name, args, id = 1) => dispatch(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, table);

  const answered = ask('read_spec', { id: spec.id });

  // `content` is what the protocol requires and what Story 1 could not catch the absence of:
  // with no tools registered, a `tools/call` that never ran was conformant by vacancy.
  assert.equal(answered.result.content[0].type, 'text');
  assert.equal(answered.result.structuredContent.id, spec.id);
  // Spread both sides: a row from `node:sqlite` has a null prototype and `JSON.parse` produces a
  // plain object, which strict deep-equal treats as different however identical the contents.
  assert.deepEqual(
    { ...JSON.parse(answered.result.content[0].text) },
    { ...answered.result.structuredContent },
    'the text and structured halves of one result disagree',
  );

  // A refused call is Invalid params, not Internal error — the difference between telling a
  // caller they got it wrong and telling them the server is broken.
  assert.equal(ask('create_requirement', { spec_id: spec.id, label: 'NFR3', text: 't',
    position: 0 }, 2).error.code, -32602);

  // And an unrecognised tool is a different failure again: Method not found.
  assert.equal(ask('create_nothing', {}, 3).error.code, -32601);
});

test('every registered tool is listed with the schema a caller is checked against', (t) => {
  const { tools } = surface(t);
  const listed = methods(tools)['tools/list']().tools;

  assert.deepEqual(listed.map((tool) => tool.name), tools.map((tool) => tool.name));

  for (const tool of listed) {
    assert.ok(tool.description, `${tool.name} is listed with no description`);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(tool.handler, undefined, `${tool.name} leaked its handler onto the wire`);
  }
});
