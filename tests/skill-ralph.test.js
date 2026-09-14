/**
 * Epic 47-09 Story 4 — the converted `ralph`, and the three claims made about it.
 *
 * - "A ralph run carries its loop state in `session` rows, and a resume under a new session id
 *   adopts the prior row rather than reading a progress file" [feature]
 * - "The facilitation survives: pre-flight still probes the stop hook and branches on what it finds,
 *   and a detected previous run is still offered as a resume rather than restarted over" [feature]
 * - "must NOT — the skill recovers an entity by reading a generated markdown file rather than by
 *   calling a read tool" [unit]
 *
 * **The first criterion is about a run nobody is watching**, which is what makes its failure mode
 * worth naming: a resume that silently begins again looks exactly like a first pass over unfinished
 * work. So the test drives both answers to the same gate — Resume and Start fresh — against the same
 * fixture, and asserts the two leave *different* rows behind. A run that ignored the gate would pass
 * either one alone.
 *
 * **The second criterion names a shell probe, which is not a tool and cannot be driven through the
 * registry.** What is driven is the branch: each of the probe's four exit codes is fed to the
 * pre-flight and the decision it produced is asserted, so "branches on what it finds" is checked
 * rather than described. The probe's own behaviour belongs to the ralph plugin and is its suite's.
 *
 * **The completion check is a traversal now, and that is the largest single subtraction here.** Six
 * exit codes from one shell script collapse into three answers the rows already hold, and the fourth
 * reading — untraced requirements — is the one epic scope cannot produce at all. Both are driven.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import {
  skillSource, toolNames, prose, instructions, recorder, recoveries, sweep, bindings, reachable,
  seedStartup, driveStartup, SQL, CONSTRUCTIONS, CALLABLE,
} from './support/skills.js';

const SKILL = 'ralph';
const source = skillSource(SKILL);

/** Above what any of these fixtures holds. */
const BOUND = 200;

/** This launch's session id, and the one the previous run was recorded under. */
const SELF = 'session-ralph-now';
const PRIOR = 'session-ralph-before';

/**
 * Three iterations that measured the same thing at the same commit against the same tree — the
 * stall the iteration record exists to make visible, and the state a resume has to carry forward.
 */
const STALLED = JSON.stringify({
  mode: 'epic',
  iterations: [
    { n: 12, counts: '4 of 9 verified', commit: 'a1b2c3d', tree: '3931245 0' },
    { n: 13, counts: '4 of 9 verified', commit: 'a1b2c3d', tree: '3931245 0' },
    { n: 14, counts: '4 of 9 verified', commit: 'a1b2c3d', tree: '3931245 0' },
  ],
});

/** The recoveries this file in particular would reach for, on top of the shared sweep. */
const PARSES = [
  { pattern: /\.cpm-ralph-log|iteration log file/i, why: 'an iteration log file, which is now the session state' },
  { pattern: /coverage-rollup|rollup_script|--verdict/i, why: 'the roll-up script, whose verdict is now a traversal' },
  { pattern: /exit code [0-5]\b|`[0-5]` \|/i, why: "a shell script's exit-code contract" },
  { pattern: /\bepic_glob\b|space[- ]separated/i, why: 'a path list assembled for a command line' },
  { pattern: /\[plan\]|\[unit\]|\[integration\]|\[target\]/, why: 'a bracket tag parsed out of a heading or a bullet' },
  { pattern: /basename/i, why: 'a filename comparison, which is what `parent_id` replaced' },
];

/**
 * A spec with two epics, one of them finished, and one requirement nothing covers.
 *
 * The shape is chosen so every reading the completion check makes has something to be wrong about:
 *
 * - `working` — pending, two stories, one of them flagged for formal planning. Its criteria carry
 *   coverage rows, one verified and one not, so the epic-scope reading has both answers in it.
 * - `finished` — complete, and its one row verified. It must not appear in the run's working set,
 *   which is the half a status filter that read "not superseded" would get wrong.
 * - `hosted` — a story criterion whose only approach is `target`. Unverifiable from here, and the
 *   difference between "keep working" and "stop".
 * - `untraced` — a requirement with no coverage row at all. Invisible to epic scope by construction,
 *   which is the point of asserting it separately.
 */
function workspace(tools) {
  const seed = handlers(tools);

  const spec = seed.create_spec({ slug: 'delivery', title: 'Delivery' });
  const traced = seed.create_requirement({
    spec_id: spec.id, position: 0, label: 'FR1', text: 'A run resumes.', class: 'functional',
  });
  const untraced = seed.create_requirement({
    spec_id: spec.id, position: 1, label: 'FR2', text: 'A run reports.', class: 'functional',
  });

  const working = seed.create_epic({ parent_id: spec.id, slug: 'loop', title: 'Loop' });
  const planned = seed.create_story({
    epic_id: working.id, number: 1, title: 'Resume', position: 0, plan: 1,
  });
  const plain = seed.create_story({ epic_id: working.id, number: 2, title: 'Report', position: 1 });

  const done = seed.create_story_criterion({
    story_id: planned.id, position: 0, text: 'A resume adopts the prior row.',
  });
  const open = seed.create_story_criterion({
    story_id: plain.id, position: 0, text: 'A run reports what it measured.',
  });
  const hosted = seed.create_story_criterion({
    story_id: plain.id, position: 1, text: 'The deployed host answers.',
  });

  seed.create_story_criterion_approach({ story_criterion_id: done.id, tag: 'integration' });
  seed.create_story_criterion_approach({ story_criterion_id: open.id, tag: 'unit' });
  seed.create_story_criterion_approach({ story_criterion_id: hosted.id, tag: 'target' });

  seed.create_coverage({
    requirement_id: traced.id,
    story_criterion_id: done.id,
    spec_fragment: 'A run resumes.',
    position: 0,
    verified_at: '2026-08-01T00:00:00.000Z',
  });
  seed.create_coverage({
    requirement_id: traced.id,
    story_criterion_id: open.id,
    spec_fragment: 'A run resumes.',
    position: 1,
  });
  seed.create_coverage({
    requirement_id: traced.id,
    story_criterion_id: hosted.id,
    spec_fragment: 'A run resumes',
    position: 2,
  });

  const finished = seed.create_epic({ parent_id: spec.id, slug: 'spine', title: 'Spine' });
  const shipped = seed.create_story({
    epic_id: finished.id, number: 1, title: 'Schema', position: 0,
  });
  seed.update_story({ id: shipped.id, status: 'complete' });
  seed.update_epic({ id: finished.id, status: 'complete' });

  // The previous run of this skill, stalled — what a resume has to find.
  seed.create_session({ id: PRIOR, skill: 'dpm:ralph', phase: 'iteration 14', state: STALLED });

  // **`seedStartup`'s own session is the decoy, and both its skill and its position are chosen.**
  // Under `dpm:ralph` it would be a second row this skill claims, and the resume's assertions would
  // be about whichever came last rather than about the run. Under `dpm:do` and created **after**
  // `PRIOR`, it is the row an unfiltered list returns: the run reads the newest match, so the filter
  // is what stands between it and the wrong session. Seeded first, the fixture would pass whether
  // or not `skill` filtered anything — which is how it was written, and a mutation emptying that
  // filter survived it.
  const startup = seedStartup(seed, {
    scope: 'ralph',
    skill: 'dpm:do',
    phase: 'pre-flight',
    live: ['A loop ran to its cap on work that was already finished.'],
  });

  return {
    spec, traced, untraced, working, finished, planned, plain, done, open, hosted, ...startup,
  };
}

/**
 * Pre-flight as the SKILL.md prescribes it, up to the point the prompt would be assembled.
 *
 * `probe` is the stop hook's exit code and `resume` the answer to 1e's gate. Both are inputs rather
 * than fixtures because both are decisions the run branches on, and a branch nothing exercises is a
 * branch that reads correctly and never fires.
 */
function preflight(call, fixture, { probe = 0, resume = true, mode = 'epic', id = SELF } = {}) {
  driveStartup(call, fixture, {
    scope: 'ralph', skill: 'dpm:ralph', roster: false, retro: false, session: false,
  });

  // 1a: what the run will work, from the rows. Archived epics never come back, and a retired or
  // completed one is excluded by its status rather than by a filename.
  const epics = (mode === 'spec'
    ? call.list_epic({ parent_id: fixture.spec.id, limit: BOUND })
    : call.list_epic({ limit: BOUND })).items.filter((epic) => epic.status === 'pending');

  const specs = epics.length === 0 ? call.list_spec({ limit: BOUND }).items : [];

  // 1b: clear the plan gates. A column, so there is nothing to find in a heading.
  const cleared = [];

  for (const epic of epics) {
    for (const story of call.list_story({ epic_id: epic.id, limit: BOUND }).items) {
      if (story.plan === 1) cleared.push(call.update_story({ id: story.id, plan: 0 }));
    }
  }

  // 1c: the hook, and which direction it fails in.
  const hook = { 0: 'continue', 1: 'ask', 2: 'warn', 3: 'gate' }[probe] ?? 'ask';

  // 1d: in spec mode the spec is asked before the project's own config.
  const tooling = mode === 'spec'
    ? call.list_requirement({ spec_id: fixture.spec.id, include_body: true, limit: BOUND }).items
      .filter((row) => row.class === 'environmental')
    : [];

  // 1e: a previous run of this skill, offered rather than restarted over.
  const previous = call.list_session({ skill: 'dpm:ralph', limit: BOUND }).items.at(-1);
  const carried = previous ? call.read_session({ id: previous.id, include_body: true }) : null;

  const session = resume && previous
    ? call.adopt_session({ id, predecessor_id: previous.id, include_body: true })
    : call.create_session({ id, skill: 'dpm:ralph', phase: 'pre-flight' });

  return { epics, specs, cleared, hook, tooling, previous, carried, session };
}

/**
 * The completion check the assembled prompt tells the loop to run: three answers from the rows in
 * epic scope, and a fourth that only spec scope can produce.
 */
function verdict(call, fixture, epics, { mode = 'epic' } = {}) {
  const rows = [];

  for (const epic of epics) {
    for (const story of call.list_story({ epic_id: epic.id, limit: BOUND }).items) {
      for (const criterion of call.list_story_criterion({ story_id: story.id, limit: BOUND }).items) {
        for (const row of call.list_coverage({
          story_criterion_id: criterion.id, limit: BOUND,
        }).items) {
          const approaches = call.list_story_criterion_approach({
            story_criterion_id: criterion.id, limit: BOUND,
          }).items.map((entry) => entry.tag);

          rows.push({ row, criterion, approaches });
        }
      }
    }
  }

  const unverified = rows.filter((entry) => entry.row.verified_at === null);
  const hosted = unverified.filter((entry) => entry.approaches.every((tag) => tag === 'target'));

  const untraced = mode === 'spec'
    ? call.list_requirement({ spec_id: fixture.spec.id, limit: BOUND }).items
      .filter((requirement) => call.list_coverage({
        requirement_id: requirement.id, limit: BOUND,
      }).items.length === 0)
    : [];

  if (unverified.length === 0) return { answer: 'promise', rows, unverified, hosted, untraced };
  if (unverified.length === hosted.length) return { answer: 'stop', rows, unverified, hosted, untraced };

  return { answer: 'continue', rows, unverified, hosted, untraced };
}

// --- Criterion 1: loop state in session rows, and a resume that adopts ----------------------------

test('the loop carries its state in a session row, and a resume adopts the prior one', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools);
  const raw = handlers(tools);

  const result = preflight(call, fixture, { resume: true });

  // The previous run was found by its skill and read for what it was carrying — not reconstructed
  // from anything on disk.
  assert.equal(result.previous.id, PRIOR);
  assert.equal(result.carried.state, STALLED);
  assert.equal(JSON.parse(result.carried.state).iterations.length, 3);

  // **Adoption is an `UPDATE`, and the chain has one live end by construction.** The state came
  // forward under the new id, and the old row points at it rather than being copied or removed.
  assert.equal(result.session.id, SELF);
  assert.equal(result.session.state, STALLED, 'the resume did not carry the prior state forward');
  assert.equal(result.session.skill, 'dpm:ralph');
  assert.equal(raw.read_session({ id: PRIOR }).superseded_by, SELF);
  assert.equal(raw.read_session({ id: PRIOR, include_body: true }).state, STALLED,
    'the predecessor was emptied rather than pointed at');

  // Nothing was deleted, and the run never opened a second row alongside the one it adopted.
  assert.ok(!used.has('delete_session'), 'a resume removed the row it resumed from');
  assert.ok(!used.has('create_session'), 'a resume opened a fresh row instead of adopting');

  // And the loop's memory is that row: the entry an iteration appends goes to `state`.
  const advanced = raw.update_session({
    id: SELF,
    state: JSON.stringify({
      ...JSON.parse(STALLED),
      iterations: [...JSON.parse(STALLED).iterations, { n: 15, counts: '5 of 9 verified' }],
    }),
  });

  assert.equal(JSON.parse(raw.read_session({ id: advanced.id, include_body: true }).state)
    .iterations.length, 4);

  assert.match(source, /The loop's memory is a `session` row/);
  assert.match(source, /a run resumed under a new session id adopts the old row\s+rather than starting over/);

  const resume = instructions(source, '1e. Resume detection');
  assert.match(resume, new RegExp(`\`${CALLABLE}adopt_session\` with this session's id, `
    + "the previous row's, and\\s+`include_body`"));
  assert.match(resume, /It hands\s+back the state and points the old row at this one/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 2: the facilitation survives -------------------------------------------------------

test('pre-flight probes the hook and branches, and a previous run is offered rather than replaced', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const { call, used, passed } = recorder(tools);

  const fixture = workspace(tools);
  const raw = handlers(tools);

  // **Every probe code reaches a different decision.** A branch on a code nothing exercises reads
  // correctly and never fires, which is the failure this half of the criterion is about.
  const runs = [0, 1, 2, 3].map((probe) =>
    preflight(call, fixture, { probe, resume: false, id: `${SELF}-${probe}` }));

  assert.deepEqual(runs.map((entry) => entry.hook), ['continue', 'ask', 'warn', 'gate']);
  assert.notEqual(runs[0].hook, runs[3].hook,
    'a fails-open hook was treated as a fails-closed one');

  // Pre-flight resolves what the run will work, and a completed epic is not in it.
  assert.deepEqual(runs[0].epics.map((epic) => epic.slug), ['loop']);

  // **The plan gate is cleared once and stays cleared.** The count is taken from the first pass
  // because the column is the state: a later pre-flight finds nothing to do, which is the property
  // a heading scan could not have — re-running it there rewrote text every time.
  assert.equal(runs[0].cleared.length, 1, 'the story flagged for formal planning was not cleared');
  assert.deepEqual(runs[3].cleared, [], 'a second pre-flight rewrote a story it had already cleared');
  assert.equal(raw.read_story({ id: fixture.planned.id }).plan, 0);
  assert.equal(raw.read_story({ id: fixture.planned.id }).title, 'Resume',
    'clearing the flag disturbed something else on the story');

  // **Start fresh leaves the previous row exactly where it was.** The run opened its own row and the
  // predecessor is neither superseded nor removed — which is what makes the gate a gate.
  assert.equal(raw.read_session({ id: PRIOR }).superseded_by, null);
  assert.equal(raw.read_session({ id: PRIOR, include_body: true }).state, STALLED);
  assert.ok(!used.has('delete_session'), 'start fresh deleted the run it declined to resume');
  assert.ok(used.has('create_session'));

  const fresh = runs[0];

  // **The completion check gives three answers, and the third is not the second.** With a
  // non-target row still open the loop keeps working; once that row is verified the only ones left
  // are target-only and the loop stops without the promise.
  const before = verdict(call, fixture, fresh.epics);

  assert.equal(before.answer, 'continue');
  assert.equal(before.unverified.length, 2);
  assert.equal(before.hosted.length, 1);

  raw.update_coverage({
    id: before.unverified.find((entry) => !entry.approaches.includes('target')).row.id,
    verified_at: '2026-08-10T00:00:00.000Z',
  });

  const after = verdict(call, fixture, fresh.epics);

  assert.equal(after.answer, 'stop', 'a run whose only open rows are target-only kept working');
  assert.equal(after.hosted.length, 1);
  assert.deepEqual(after.untraced, [], 'epic scope produced an untraced count it cannot know');

  // **And the reading epic scope cannot produce.** In spec mode the requirement nothing covers is
  // visible, which is the whole difference between "these epics are clean" and "the spec is
  // delivered".
  const spec = verdict(call, fixture, fresh.epics, { mode: 'spec' });

  assert.deepEqual(spec.untraced.map((row) => row.label), ['FR2']);

  const gate = prose(source, '1c. The stop hook, and which direction it fails in');
  assert.match(gate, /Registration is not the property that matters/);
  assert.match(gate, /the only way to ask it is to run the hook/);
  assert.match(gate, /the dangerous one wins/);
  assert.match(gate, /no name may be treated as\s+the dependency/);

  const offer = instructions(source, '1e. Resume detection');
  assert.match(offer, /gate on \*\*Resume\*\* \/ \*\*Start fresh\*\*/);
  assert.match(prose(source, '1e. Resume detection'), /Start fresh leaves the old row alone/);

  const relay = prose(source, 'The completion check is a traversal, and the loop relays it');
  assert.match(relay, /The loop relays; it does not compute/);
  assert.match(relay, /aggregation, not verification/);
  assert.match(relay, /Epic scope has no requirement list to compare against/);
  assert.match(relay, /can never say a spec is delivered/);
  assert.match(prose(source, 'Step 2: Prompt assembly'),
    /`ALL_EPICS_COMPLETE` in epic mode, `SPEC_DELIVERED` in\s+spec mode/);

  assert.match(prose(source, 'Stopping without the promise'),
    /A loop cannot stop by saying it is stopping/);

  assert.deepEqual(bindings(source, tools, { used, passed }), []);
});

// --- Criterion 3 (must NOT): no recovery by reading a generated file --------------------------------

test('the ralph skill recovers nothing by reading a generated file', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  assert.deepEqual(recoveries(source, PARSES), []);
  assert.deepEqual(sweep(source, SQL), []);
  assert.deepEqual(sweep(source, CONSTRUCTIONS), []);

  const known = new Set(tools.map((tool) => tool.name));
  const named = toolNames(reachable(source));

  for (const required of ['list_epic', 'list_spec', 'list_story', 'update_story', 'list_session',
    'read_session', 'adopt_session', 'update_session', 'list_requirement', 'list_coverage',
    'list_story_criterion', 'list_story_criterion_approach']) {
    assert.ok(named.includes(required), `the skill never names ${required}`);
    assert.ok(known.has(required), `${required} is not a tool`);
  }

  // The control: the same reading applied to the procedure this conversion deletes finds every part
  // of it. Without it a pattern that stopped matching reports a clean file indistinguishably.
  const regressed = `${source}\n\nGlob docs/epics/*-epic-*.md, compare each **Source spec** by `
    + 'basename, strip [plan] tags from the headings, append to docs/plans/.cpm-ralph-log-{session_id}.md, '
    + 'then run coverage-rollup.sh --epic {epic_glob} --verdict and branch on exit code 3.';

  assert.ok(recoveries(regressed, PARSES).length >= 8,
    'the sweep passed a file that globs epic files, compares source specs by basename, parses '
    + 'bracket tags, keeps an iteration log file and branches on a script exit code');
});
