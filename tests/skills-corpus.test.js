/**
 * Epic 47-06 Story 4 — the three converted skills as a corpus, and as a pipeline.
 *
 * - "None of the three skill files contains a filename pattern under `docs/`, a glob, a
 *   number-allocation procedure, or a progress-file lifecycle" [unit]
 * - "None of the three skill files contains a SQL keyword or a `sqlite3` invocation" [unit]
 * - "A spec written by `spec`, broken down by `epics`, and executed by `do` produces one connected
 *   graph — requirements to criteria to coverage to stories — with no step reading what the
 *   previous one wrote from disk" [feature]
 * - "must NOT — a skill's progress state is a file rather than a `session` row" [integration]
 *
 * **The first two are greps, and this is the one place where that is the requirement rather than a
 * proxy for it** — FR3 says so in those terms, and FR25 lists the constructions by name. Every
 * other criterion in this epic is behavioural for the usual reason.
 *
 * **SQL is matched as syntax, never as a word list.** The three files are English prose about a
 * planning tool, so `from`, `where`, `select`, `table` and `order` all occur in ordinary sentences
 * — a keyword sweep reports twenty hits per file and is then either read as noise or narrowed until
 * it finds nothing. What FR3 forbids is a statement, so the shared `SQL` set matches statement
 * shapes, and where the shape alone is not enough it matches case as well; the reasoning and its
 * one gap are on that constant. Both controls run here rather than beside it — real statements that
 * must be caught, and real sentences from *these* files that must not, which is the half that
 * cannot be shared because it is what each corpus is made of.
 *
 * **The third criterion is why this story exists.** Each conversion test proves its own skill
 * writes through tools; only running the three in sequence proves none of them recovers the
 * previous stage's work. So each stage below is handed **one id and nothing else** — the whole of
 * what a real handoff carries — and has to reach everything else through the tool surface. A stage
 * that needed a second parameter would be a stage that could not find something, which is exactly
 * the recovery the epic removes, expressed as a function signature.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import {
  skillSource, toolNames, reachable, recorder, recoveries, sweep, SQL, CONSTRUCTIONS,
} from './support/skills.js';

/** The epic's corpus. Named here because the epic's scope is these three, not the twenty-two. */
const CORPUS = ['spec', 'epics', 'do'];

const sources = new Map(CORPUS.map((name) => [name, skillSource(name)]));

// --- Criterion 1: no filename pattern, glob, allocation procedure or progress file ---------------

test('no skill in the corpus names a path, a glob, an allocation or a progress file', () => {
  assert.equal(sources.size, 3, 'the corpus is not the three files this epic converts');

  for (const [name, source] of sources) {
    assert.deepEqual(sweep(source, CONSTRUCTIONS), [], `${name} carries a construction FR25 removes`);
    assert.deepEqual(recoveries(source), [], `${name} recovers something rather than calling a tool`);
  }

  // The control, and the reason the sweep above means anything: the same reading applied to the
  // constructions themselves finds every one of them. Without it a typo'd pattern reports a clean
  // corpus indistinguishably from a clean one.
  const planted = 'Glob docs/epics/*-epic-*.md, take the next available number, increment it and '
    + 'zero-pad it, then read the progress file at docs/plans/.cpm-progress-{session_id}.md, '
    + 'parsing **Status**: from its front matter with the Read tool.';

  assert.ok(sweep(planted, CONSTRUCTIONS).length >= 3, 'the construction sweep is not reading');
  assert.ok(recoveries(planted).length >= 6, 'the recovery sweep is not reading');
});

// --- Criterion 2: no SQL keyword, no sqlite3 -----------------------------------------------------

test('no skill in the corpus contains a SQL statement or a sqlite invocation', () => {
  for (const [name, source] of sources) {
    assert.deepEqual(sweep(source, SQL), [], `${name} reaches past the tool boundary FR3 draws`);
  }

  // The control: four real statements and a shell invocation, each caught by its own pattern.
  // Written out rather than asserted as a count, so a pattern that stopped matching is named.
  const statements = [
    'SELECT * FROM story WHERE epic_id = ?',
    'INSERT INTO coverage (id, requirement_id) VALUES (?, ?)',
    'UPDATE story SET status = ?',
    'DELETE FROM dependency WHERE id = ?',
    'CREATE TABLE thing (id TEXT)',
    'JOIN dependency_kind ON dependency_kind.kind = dependency.kind',
    'PRAGMA foreign_keys = ON',
    'sqlite3 .dpm/planning.db "..."',
  ];

  for (const statement of statements) {
    assert.equal(sweep(statement, SQL).length >= 1, true, `${statement} passed the SQL sweep`);
  }

  // And the other side of the control: the prose these files are actually made of does not match.
  // Every one of these sentences contains a word the naive keyword sweep would have fired on.
  for (const prose of [
    'Read the ones that apply and carry them into Sections 4 and 5.',
    'A table nothing writes is a table, not a capability.',
    'Ask which one this brief came from, and select the few most relevant.',
    'Where a criterion has no control, it has not been verified.',
    'The rows are ordered by position, and the order is display order only.',
  ]) {
    assert.deepEqual(sweep(prose, SQL), [], 'the SQL sweep fires on ordinary prose');
  }
});

// --- Criterion 4 (must NOT): progress state as a file --------------------------------------------

test('every skill carries its progress as a session row and none as a file', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const known = new Set(tools.map((tool) => tool.name));

  for (const [name, source] of sources) {
    const named = toolNames(reachable(source));

    // The positive half. All four are needed, and each for a different moment: list to find what
    // is open, adopt to inherit it across a resume, create to start, update to move it on.
    for (const tool of ['list_session', 'adopt_session', 'create_session', 'update_session']) {
      assert.ok(named.includes(tool), `${name} never calls ${tool}`);
      assert.ok(known.has(tool), `${tool} is not a tool`);
    }

    // The negative half, checked against the exact stem `/cpm:clean` and the stale-progress check
    // both glob for. A skill writing anything under that stem would be keeping the file alongside
    // the row, which is the state this criterion exists to make impossible to reach silently.
    assert.doesNotMatch(source, /\.cpm-progress|\.cpm-compact-summary/,
      `${name} writes a progress file beside the row`);
  }

  // Behaviourally, and not only in the prose: the row survives the resume the file used to.
  const call = handlers(tools);

  const before = call.create_session({
    id: 'session-one', skill: 'dpm:do', phase: 'Story 1 Task 2', state: '{"epic":"E"}',
  });
  const after = call.adopt_session({
    id: 'session-two', predecessor_id: before.id, include_body: true,
  });

  assert.equal(after.state, '{"epic":"E"}', 'the resumed run did not inherit what the last one held');
  assert.equal(call.read_session({ id: before.id }).superseded_by, after.id,
    'the old row still reads as open, so two sessions claim the same work');
});

// --- Criterion 3: the three run in sequence and leave one connected graph ------------------------

/**
 * The `spec` stage. Takes nothing, because a spec is where a project starts, and returns the one
 * id the next stage gets.
 */
function specStage(call) {
  const spec = call.create_spec({ slug: 'sessions', title: 'Sessions' });

  call.create_document_section({
    document_id: spec.id,
    heading: 'Scope Boundary',
    body: 'In scope: the session lifecycle. Out of scope: a password reset flow.',
    position: 0,
  });

  const requirements = [
    {
      label: 'FR1',
      class: 'functional',
      moscow: 'must',
      text: 'A user creates a session by submitting valid credentials, and reaches the dashboard.',
    },
    {
      label: 'ENV1',
      class: 'environmental_requirement',
      text: 'A test runner is available with no install step.',
    },
  ].map((fields, position) => call.create_requirement({ spec_id: spec.id, position, ...fields }));

  for (const [position, fields] of [
    { requirement: requirements[0], text: 'A valid credential pair returns a session token', tag: 'integration' },
    { requirement: requirements[0], text: 'a credential reaches a log line', polarity: 'must_not', tag: 'unit' },
    { requirement: requirements[1], text: 'The suite runs from one command', tag: 'feature' },
  ].entries()) {
    const { requirement, tag, ...rest } = fields;
    const criterion = call.create_acceptance_criterion({
      requirement_id: requirement.id, position, ...rest,
    });
    call.create_criterion_approach({ criterion_id: criterion.id, tag });
  }

  return spec.id;
}

/**
 * The `epics` stage. **Takes the spec id and nothing else** — every requirement, criterion,
 * polarity and tag it propagates is reached through the tool surface, which is the half of the
 * criterion a per-skill test cannot make.
 */
function epicsStage(call, specId) {
  const spec = call.read_spec({ id: specId });

  // `include_body` is not optional here and the pipeline is what found that: the bound withholds
  // `text` by default, and a fragment has to be a verbatim slice of it. A stage that forgot it
  // would bind against `undefined` — which is the shape of every recovery bug this epic removes,
  // arriving through the tool surface instead of through a parse.
  const requirements = call.list_requirement({
    spec_id: spec.id, include_body: true, limit: 100,
  }).items;

  const epic = call.create_epic({ parent_id: spec.id, slug: 'lifecycle', title: 'Lifecycle' });

  call.create_coverage_matrix({
    parent_id: epic.id, slug: 'lifecycle-coverage', title: 'Coverage Matrix: Lifecycle',
  });

  const story = call.create_story({
    epic_id: epic.id, number: 1, title: 'Issue a session on valid credentials', position: 0, plan: 1,
  });

  call.create_task({
    story_id: story.id, number: 1, title: 'Add the session route', description: 'the route',
    position: 0,
  });

  let position = 0;

  for (const requirement of requirements) {
    for (const source of call.list_acceptance_criterion({
      requirement_id: requirement.id, include_body: true,
    }).items) {
      // Propagation, not invention: the polarity and the tags come off the spec's own rows.
      const criterion = call.create_story_criterion({
        story_id: story.id, text: source.text, polarity: source.polarity, position,
      });

      for (const { tag } of call.list_criterion_approach({ criterion_id: source.id }).items) {
        call.create_story_criterion_approach({ story_criterion_id: criterion.id, tag });
      }

      // The fragment is a verbatim slice of the requirement's own text, which the integrity check
      // is entitled to refuse if it is not.
      call.create_coverage({
        requirement_id: requirement.id,
        spec_fragment: requirement.text.split(' ').slice(1, 5).join(' '),
        story_criterion_id: criterion.id,
        position,
      });

      position += 1;
    }
  }

  return epic.id;
}

/**
 * The `do` stage. **Takes the epic id and nothing else** — readiness, the story, its tasks, its
 * criteria and the coverage rows to verify are all reached through tools.
 */
function doStage(call, epicId) {
  const worked = [];

  for (const story of call.list_story({ epic_id: epicId, ready: true }).items) {
    const whole = call.read_story({ id: story.id });

    for (const task of call.list_task({ story_id: story.id }).items) {
      call.update_task({ id: task.id, status: 'complete' });
    }

    for (const criterion of call.list_story_criterion({ story_id: story.id, include_body: true }).items) {
      call.list_story_criterion_approach({ story_criterion_id: criterion.id });

      for (const row of call.list_coverage({ story_criterion_id: criterion.id }).items) {
        call.update_coverage({ id: row.id, verified: true });
      }
    }

    call.update_story({ id: story.id, status: 'complete' });
    worked.push(whole);
  }

  return worked;
}

test('spec, epics and do run in sequence and leave one connected graph', (t) => {
  const db = openPlanningDatabase(t);
  // Pinned, because the verification mark is stamped from the server clock rather than named.
  const tools = spineTools(db, { now: () => '2026-08-09T00:00:00.000Z' });
  const { call, used } = recorder(tools);

  const specId = specStage(call);
  const epicId = epicsStage(call, specId);
  const worked = doStage(call, epicId);

  // Everything below reads through the raw handlers. The recorded ones are the *pipeline's*, and
  // the last assertion in this test holds that set to what the three files name — so a read this
  // test performs to check the result would otherwise demand a skill prescribe a call no stage
  // makes. Walking the graph is the test's verification, not the run's.
  const raw = handlers(tools);

  // The graph, walked end to end from the one thing a later reader starts with — the spec — with
  // every hop a tool call. A break anywhere in the chain shows up as a zero here.
  const requirements = raw.list_requirement({
    spec_id: specId, include_body: true, limit: 100,
  }).items;
  assert.equal(requirements.length, 2);

  const chain = requirements.map((requirement) => {
    const accepted = raw.list_acceptance_criterion({ requirement_id: requirement.id }).items;
    const rows = raw.list_coverage({ requirement_id: requirement.id, include_body: true }).items;

    const stories = rows.map((row) => {
      const criterion = raw.read_story_criterion({ id: row.story_criterion_id, include_body: true });
      return raw.read_story({ id: criterion.story_id });
    });

    return { requirement, accepted, rows, stories };
  });

  for (const { requirement, accepted, rows, stories } of chain) {
    assert.ok(accepted.length > 0, `${requirement.label} lost its acceptance criteria`);
    assert.equal(rows.length, accepted.length,
      `${requirement.label} has ${rows.length} coverage rows for ${accepted.length} criteria`);

    for (const row of rows) {
      assert.equal(row.verified_at, '2026-08-09T00:00:00.000Z', 'a row the run never verified');
      assert.ok(row.binding_hash, 'a ✓ with no record of what it verified');
      assert.ok(requirement.text.includes(row.spec_fragment),
        'the fragment is not a verbatim slice of its requirement');
    }

    assert.ok(stories.every((story) => story.status === 'complete'));
  }

  // The polarity survived two hops. `epics` read it off the spec's row and wrote it on the story's;
  // a stage that had recovered the criterion from prose would have had to recognise a prefix, and
  // the value is what proves it did not.
  const rejections = chain
    .flatMap(({ rows }) => rows
      .map((row) => raw.read_story_criterion({ id: row.story_criterion_id, include_body: true })))
    .filter((criterion) => criterion.polarity === 'must_not');

  assert.equal(rejections.length, 1, 'the spec\'s rejection did not reach a story criterion');
  assert.match(rejections[0].text, /credential reaches a log line/);

  // `plan` survived the do stage's status write to the same row.
  assert.equal(worked.length, 1);
  assert.equal(worked[0].plan, 1, 'the planning mark was lost, and no title carries it');
  assert.doesNotMatch(worked[0].title, /\[[a-z]+\]/);

  // The number came from the allocator across both stages: the epic is `1` under its spec, and
  // nothing in the pipeline was handed one.
  assert.equal(raw.read_epic({ id: epicId }).sequence, 1);

  // FR14's own sweep over the graph the three stages built, which is a stronger closing statement
  // than any assertion here: a fragment bound to text that does not contain it, an orphaned row or
  // a cycle would be reported by the check rather than by this test's own reading.
  const report = raw.check_integrity({});
  assert.deepEqual(report.problems ?? [], []);

  // Every tool the pipeline drove is named by one of the three files. This is the corpus form of
  // the per-skill binding: a stage reaching for something no skill instructs would pass its own
  // conversion test, because that test drives only its own stage.
  const named = new Set(CORPUS.flatMap((name) => toolNames(reachable(sources.get(name)))));
  const orphans = [...used].filter((name) => !named.has(name)).sort();

  assert.deepEqual(orphans, [],
    'the pipeline called something no skill in the corpus tells a run to call');
});
