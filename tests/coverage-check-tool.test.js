/**
 * `check_coverage`, and the "also delivered by" rows an MTPLX epics run could write and not remove.
 *
 * The run's gap check skipped two environmental requirements and called all sixteen covered, missed
 * an unbound criterion, and miscounted tasks, rejections and bindings. It also wrote a coverage_story
 * row naming a story in another epic, which register entry 4 reports and which no tool could delete.
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

/**
 * A spec with one requirement in each standing, two epics of one story each, and criteria that are
 * bound, unbound, warranted and superseded.
 */
function project(call) {
  const spec = call.create_spec({ slug: 'gaps', title: 'Gaps' });
  const requirement = (label, extra) => call.create_requirement({
    spec_id: spec.id, label, class: 'functional', position: Number(label.replace(/\D/g, '')) + (label.startsWith('ENV') ? 10 : 0),
    text: `${label} requires the tool to answer in one pass and within a second.`, ...extra,
  });

  const fr1 = requirement('FR1', { moscow: 'must' });
  const fr2 = requirement('FR2', { moscow: 'should' });
  const fr3 = requirement('FR3', { moscow: 'wont' });
  const fr4 = requirement('FR4', { moscow: 'must', exclusion: 'deferred' });
  const env1 = requirement('ENV1', { class: 'environmental_requirement' });

  const passes = call.create_acceptance_criterion({ requirement_id: fr1.id, text: 'One pass is made.', position: 0 });
  const second = call.create_acceptance_criterion({ requirement_id: fr1.id, text: 'It answers within a second.', position: 1 });

  const adr = call.create_adr({ parent_id: spec.id, slug: 'why', title: 'Why', decision: 'Because.' });
  call.create_adr_option({ adr_id: adr.id, name: 'Taken', chosen: true, position: 0 });
  call.update_adr({ id: adr.id, decision_status: 'accepted' });

  const [core, extras] = ['core', 'extras'].map((slug) => call.create_epic({ parent_id: spec.id, slug, title: slug }));
  const [first, other] = [core, extras].map((epic) => call.create_story({
    epic_id: epic.id, number: 1, title: `${epic.slug} story`, position: 0,
  }));
  const sibling = call.create_story({ epic_id: core.id, number: 2, title: 'core sibling', position: 1 });

  const criterion = (story, text, position, extra = {}) => call.create_story_criterion({
    story_id: story.id, text, position, ...extra,
  });

  const bound = criterion(first, 'The tool reads the input once.', 0);
  const rejection = criterion(first, 'a second pass over the input is made', 1, { polarity: 'must_not' });
  const warranted = criterion(first, 'The decision is honoured.', 2, { warrant_adr_id: adr.id });
  const withdrawn = criterion(other, 'An old criterion.', 0);

  const binding = call.create_coverage({
    requirement_id: fr1.id, spec_fragment: 'answer in one pass', story_criterion_id: bound.id, position: 0,
  });

  // A binding on FR2 withdrawn again, and a criterion superseded with its own: neither may count.
  const stale = call.create_coverage({
    requirement_id: fr2.id, spec_fragment: 'within a second', story_criterion_id: withdrawn.id, position: 0,
  });
  call.retire_coverage({ id: stale.id, reason: 'bound to the wrong criterion' });
  call.update_story_criterion({ id: withdrawn.id, superseded_at: AT, superseded_reason: 'Restated.' });

  call.create_story_criterion_approach({ story_criterion_id: bound.id, tag: 'feature' });
  call.create_task({ story_id: first.id, number: 1, title: 'Read once', position: 0 });
  call.create_task({ story_id: other.id, number: 1, title: 'Extras', position: 0 });
  call.create_dependency({ kind: 'blocks', source_story_id: first.id, target_story_id: other.id });

  return {
    spec, fr1, fr2, fr3, fr4, env1, passes, second, core, extras, first, other, sibling,
    bound, rejection, warranted, binding,
  };
}

// --- check_coverage ------------------------------------------------------------------------------

test('check_coverage gives every requirement its standing, counted from live bindings', (t) => {
  const { call } = surface(t);
  const { spec } = project(call);

  const report = call.check_coverage({ spec_id: spec.id });
  const standing = Object.fromEntries(report.requirements.map((row) => [row.label, [row.standing, row.coverage]]));

  assert.deepEqual(standing, {
    FR1: ['covered', 1],
    FR2: ['warning', 0], // its only binding was retired
    FR3: ['excluded', 0],
    FR4: ['excluded', 0], // a must-have, deferred
    ENV1: ['gap', 0], // environmental, whatever its band — the requirement the run skipped
  });
  assert.equal(report.requirements.find((row) => row.label === 'FR4').exclusion, 'deferred');
  assert.equal(report.requirements.find((row) => row.label === 'FR3').exclusion, 'wont');
  assert.deepEqual(report.warnings, ['FR2 (should) has no live coverage']);
});

test('check_coverage names every criterion neither bound nor warranted, and only those', (t) => {
  const { call } = surface(t);
  const { spec, rejection } = project(call);

  const report = call.check_coverage({ spec_id: spec.id });

  // The rejection is unbound although its story's positive criterion is bound; the warranted one is
  // finished work; the superseded one is no longer the story's.
  assert.deepEqual(report.unaccounted_criteria, [{
    id: rejection.id, epic: 'core', story: 1, story_title: 'core story',
    polarity: 'must_not', text: 'a second pass over the input is made',
  }]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.gaps, [
    'ENV1 has no live coverage',
    "core story 1: 'a second pass over the input is made' is neither bound nor warranted",
  ]);
});

test('check_coverage sets each must-have\'s spec criteria beside its covering criteria, and judges neither', (t) => {
  const { call } = surface(t);
  const { spec, fr1, passes, second, bound } = project(call);

  const report = call.check_coverage({ spec_id: spec.id });

  // FR1 alone: FR4 is a must-have but deferred.
  assert.deepEqual(report.must_have_criteria.map((row) => row.label), ['FR1']);

  const [entry] = report.must_have_criteria;

  assert.equal(entry.text, fr1.text);
  assert.deepEqual(entry.spec_criteria, [
    { id: passes.id, polarity: 'must', text: 'One pass is made.' },
    { id: second.id, polarity: 'must', text: 'It answers within a second.' },
  ]);
  // The time limit reaches no story, and saying so is the caller's reading of these two lists.
  assert.deepEqual(entry.covering_criteria, [{
    story_criterion_id: bound.id, epic: 'core', story: 1, story_title: 'core story',
    polarity: 'must', text: 'The tool reads the input once.', spec_fragment: 'answer in one pass',
  }]);
});

test('check_coverage counts the breakdown from its rows', (t) => {
  const { call } = surface(t);
  const { spec, binding, sibling } = project(call);

  call.create_coverage_story({ coverage_id: binding.id, story_id: sibling.id });

  assert.deepEqual(call.check_coverage({ spec_id: spec.id }).counts, {
    requirements: 5,
    requirements_in_scope: 3,
    epics: 2,
    stories: 3,
    story_criteria: 3, // the superseded one is not counted
    must_not: 1,
    warranted: 1,
    tags: 1,
    tasks: 2,
    coverage: 1, // the retired binding is not counted
    coverage_story: 1,
    dependencies: 1,
  });
});

test('check_coverage refuses an id that is not a spec, and names what it is', (t) => {
  const { call } = surface(t);
  const { core } = project(call);

  assert.match(refused(() => call.check_coverage({ spec_id: core.id })).message,
    /spec_id '.+' names no spec — it is a epic/);
  assert.match(refused(() => call.check_coverage({ spec_id: 'no-such-spec' })).message,
    /spec_id 'no-such-spec' names no spec$/);
});

test('a spec with nothing broken down reports its must-haves as gaps and every count as zero', (t) => {
  const { call } = surface(t);
  const spec = call.create_spec({ slug: 'empty', title: 'Empty' });

  call.create_requirement({ spec_id: spec.id, label: 'FR1', class: 'functional', moscow: 'must', position: 0, text: 'It works.' });

  const report = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(report.gaps, ['FR1 has no live coverage']);
  assert.equal(report.counts.stories, 0);
  assert.equal(report.counts.dependencies, 0);
});

// --- requirement_label ---------------------------------------------------------------------------

test('every coverage row names its requirement by label, whichever tool returns it', (t) => {
  const { call } = surface(t);
  const { fr1, bound, binding } = project(call);

  // The run that retired two correct bindings held only ids; each of these answers names FR1 instead.
  assert.equal(binding.requirement_label, 'FR1', 'create_coverage');
  assert.equal(call.read_coverage({ id: binding.id }).requirement_label, 'FR1', 'read_coverage');
  assert.deepEqual(
    call.list_coverage({ story_criterion_id: bound.id }).items.map((row) => [row.requirement_id, row.requirement_label]),
    [[fr1.id, 'FR1']],
    'list_coverage',
  );
  assert.equal(call.update_coverage({ id: binding.id, position: 3 }).requirement_label, 'FR1', 'update_coverage');
  assert.equal(call.retire_coverage({ id: binding.id, reason: 'withdrawn for the test' }).requirement_label, 'FR1',
    'retire_coverage');
});

// --- coverage_story ------------------------------------------------------------------------------

test('a coverage_story row naming a story in another epic is refused, and nothing is written', (t) => {
  const { call } = surface(t);
  const { binding, other, extras, core } = project(call);

  const crossed = refused(() => call.create_coverage_story({ coverage_id: binding.id, story_id: other.id }));

  assert.match(crossed.message, new RegExp(`story ${other.id} is in epic ${extras.id}`));
  assert.match(crossed.message, new RegExp(`binds a criterion of epic ${core.id}`));
  assert.match(crossed.message, /needs a criterion of its own, bound with create_coverage/);
  refused(() => call.read_coverage_story({ coverage_id: binding.id, story_id: other.id }),
    'the refused row was written anyway');
  assert.equal(call.check_integrity({}).entries.find((entry) => entry.entry === 4).held, true);
});

test('a coverage_story row naming a sibling story is written, and can be deleted', (t) => {
  const { call } = surface(t);
  const { binding, sibling } = project(call);

  const key = { coverage_id: binding.id, story_id: sibling.id };

  // Spread, because a row comes back from `node:sqlite` with a null prototype.
  assert.deepEqual({ ...call.create_coverage_story(key) }, key);

  const deleted = call.delete_coverage_story(key);

  assert.deepEqual({ ...deleted }, key, 'the row is returned as it was');
  refused(() => call.read_coverage_story(key), 'the deleted row is still readable');
  assert.equal(call.read_coverage({ id: binding.id }).id, binding.id, 'and the binding it extended stands');
  assert.match(refused(() => call.delete_coverage_story(key)).message, /delete_coverage_story: no coverage_story/);
});

test('a cross-epic row already in the database can be deleted', (t) => {
  const { db, call } = surface(t);
  const { binding, other } = project(call);

  // As a restore or an older server could leave it: past the tool, so past its refusal.
  db.prepare('INSERT INTO coverage_story (coverage_id, story_id) VALUES (?, ?)').run(binding.id, other.id);
  assert.equal(call.check_integrity({}).entries.find((entry) => entry.entry === 4).held, false);

  call.delete_coverage_story({ coverage_id: binding.id, story_id: other.id });

  assert.equal(call.check_integrity({}).entries.find((entry) => entry.entry === 4).held, true);
});
