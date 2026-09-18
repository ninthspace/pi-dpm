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

  // The clock is pinned to `AT`: the coverage tools stamp the verification mark from it.
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
  const fr3 = requirement('FR3', { moscow: 'wont', exclusion: 'out_of_scope' });
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
  assert.equal(report.requirements.find((row) => row.label === 'FR3').exclusion, 'out_of_scope');
  // FR3 and FR4 are excluded and so are passed over by the criterion warning as by everything
  // else here; FR1 is the only requirement in scope that anybody wrote acceptance criteria for.
  assert.deepEqual(report.warnings, [
    'FR2 (should) has no live coverage',
    'FR2 (should) has no acceptance criterion',
    'ENV1 (no band) has no acceptance criterion',
  ]);
});

test('check_coverage names every criterion neither bound nor warranted, and only those', (t) => {
  const { call } = surface(t);
  const { spec, rejection, warranted } = project(call);

  // Tagged, so the only gaps left are the ones this test is about.
  for (const criterion of [rejection, warranted]) {
    call.create_story_criterion_approach({ story_criterion_id: criterion.id, tag: 'feature' });
  }

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
    untagged: 2,
    tasks: 2,
    coverage: 1, // the retired binding is not counted
    coverage_story: 1,
    dependencies: 1,
  });
});

test('check_coverage names every live criterion with no approach tag as a gap, and a tag clears it', (t) => {
  const { call } = surface(t);
  const { spec, rejection, warranted } = project(call);

  // The seventh MTPLX epics run: a story's tags gate approved, no tag written, and a check that passed.
  const before = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(before.untagged_criteria.map((criterion) => [criterion.id, criterion.epic, criterion.story]), [
    [rejection.id, 'core', 1],
    [warranted.id, 'core', 1], // accounted for by its warrant, and still untested without a tag
  ]);
  assert.ok(before.gaps.includes("core story 1: 'The decision is honoured.' has no approach tag"), before.gaps.join('\n'));

  call.create_story_criterion_approach({ story_criterion_id: warranted.id, tag: 'feature' });

  const after = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(after.untagged_criteria.map((criterion) => criterion.id), [rejection.id]);
  assert.equal(after.gaps.some((gap) => gap.includes('The decision is honoured.')), false);
});

test('check_coverage counts one epic\'s bindings without moving the spec\'s standings', (t) => {
  const { call } = surface(t);
  const { spec, core, extras, binding } = project(call);

  const whole = call.check_coverage({ spec_id: spec.id });
  const scoped = call.check_coverage({ spec_id: spec.id, epic_id: core.id });

  // The count the summary needs: this epic's live rows, and how many carry a ✓.
  assert.deepEqual(
    { bindings: scoped.epic.bindings, verified: scoped.epic.verified, stories: scoped.epic.stories },
    { bindings: 1, verified: 0, stories: 2 },
  );
  assert.deepEqual(scoped.epic.by_requirement, [{ label: 'FR1', bindings: 1, verified: 0 }]);

  const stamped = call.update_coverage({ id: binding.id, verified: true });

  assert.equal(stamped.verified_at, AT, 'the mark is stamped from the server clock');
  assert.equal(call.check_coverage({ spec_id: spec.id, epic_id: core.id }).epic.verified, 1);

  // The other epic's only binding was retired, so it counts nothing — and neither epic's scope
  // changes which requirements the spec reports as gaps.
  assert.equal(call.check_coverage({ spec_id: spec.id, epic_id: extras.id }).epic.bindings, 0);
  assert.deepEqual(scoped.requirements, whole.requirements, 'the epic scope moved a requirement standing');
  assert.deepEqual(scoped.gaps, whole.gaps);
  assert.equal(whole.epic, null, 'an unscoped report carries an epic block');
});

test('a won\'t-have with no exclusion is refused, however the row arrives at that state', (t) => {
  const { db, call } = surface(t);
  const { spec, fr2 } = project(call);

  const create = (extra) => call.create_requirement({
    spec_id: spec.id, label: 'FR9', class: 'functional', position: 9,
    text: 'FR9 requires nothing of this release.', ...extra,
  });

  assert.match(refused(() => create({ moscow: 'wont' })).message,
    /a won't-have says why it is out — exclusion must be 'deferred' or 'out_of_scope'/);

  const settled = create({ moscow: 'wont', exclusion: 'deferred' });

  // Both directions into the same end state: demoting a requirement to `wont` while naming no
  // reason, and clearing the reason off one that is already `wont`. An argument-level check sees
  // the first and misses the second.
  assert.match(refused(() => call.update_requirement({ id: fr2.id, moscow: 'wont' })).message,
    /a won't-have says why it is out/);
  assert.match(refused(() => call.update_requirement({ id: settled.id, exclusion: null })).message,
    /a won't-have says why it is out/);

  // Nothing else is demanded: a could-have with no exclusion is undecided rather than wrong, and
  // is what the warning is for.
  assert.equal(create({ moscow: 'could', label: 'FR10', position: 10 }).exclusion, null);

  // And the refusal wrote nothing — FR2 keeps the band it had.
  assert.equal(call.read_requirement({ id: fr2.id }).moscow, 'should');
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM requirement WHERE label = 'FR9'").get().n, 1,
    'the refused create left a row behind',
  );
});

test('a won\'t-have already holding no exclusion still reads as excluded', (t) => {
  const { db, call } = surface(t);
  const { spec } = project(call);

  // Written under the schema and around the tool, which is how every such row in an existing
  // project got there — three of them in the tally-speed spec. The refusal above is about what a
  // run may write from now on; `standing` still has to read what is already on disk, or upgrading
  // dpm would turn a settled won't-have into a warning in every project that has one.
  db.prepare(`INSERT INTO requirement (id, spec_id, label, class, moscow, text, position)
              VALUES ('01M2TSK0LEGACYWONTHAVE0000', ?, 'FR8', 'functional', 'wont',
                      'FR8 requires nothing of this release.', 8)`).run(spec.id);

  const report = call.check_coverage({ spec_id: spec.id });
  const legacy = report.requirements.find((row) => row.label === 'FR8');

  assert.equal(legacy.exclusion, 'wont', 'the band still stands in for the reason it never carried');
  assert.equal(legacy.standing, 'excluded');
  assert.ok(!report.warnings.some((warning) => warning.startsWith('FR8')), 'and it is not warned about');
});

test('check_coverage names a requirement whose bindings are all verified and which claims nothing', (t) => {
  const { call } = surface(t);
  const { spec, fr1, binding } = project(call);

  // Bound and unverified: the claim is not owed yet, and saying so would fire on every requirement
  // from the moment it was bound until the moment it was finished.
  assert.deepEqual(call.check_coverage({ spec_id: spec.id }).claimable, []);

  call.update_coverage({ id: binding.id, verified: true });

  const owed = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(owed.claimable, [{ id: fr1.id, label: 'FR1', coverage: 1 }]);
  assert.ok(owed.warnings.includes('FR1 has 1 live binding, all verified, and no completeness claim'));
  assert.equal(owed.ok, false, 'ENV1 is still a gap');
  assert.ok(!owed.gaps.some((gap) => gap.includes('FR1')), 'an unmade claim is not a gap');

  call.update_requirement({ id: fr1.id, coverage_claimed: true });

  // And it clears — the list is a work list, not a census. `verified` and `claimed` are on the
  // requirement row too, so a caller reading the standings sees the same thing without the join.
  const claimed = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(claimed.claimable, []);
  assert.deepEqual(
    claimed.requirements.find((row) => row.label === 'FR1'),
    { ...claimed.requirements.find((row) => row.label === 'FR1'), coverage: 1, verified: 1, claimed: true },
  );
});

test('check_coverage names an in-scope requirement with no acceptance criterion, and a criterion clears it', (t) => {
  const { call } = surface(t);
  const { spec, fr2, env1 } = project(call);

  const before = call.check_coverage({ spec_id: spec.id });

  // FR3 (won't) and FR4 (deferred) are excluded and so are passed over, as everywhere else here.
  assert.deepEqual(before.uncriteriated.map((row) => row.label), ['FR2', 'ENV1']);
  assert.deepEqual(before.uncriteriated.find((row) => row.label === 'ENV1'), {
    id: env1.id, label: 'ENV1', moscow: null, class: 'environmental_requirement',
  });

  call.create_acceptance_criterion({ requirement_id: fr2.id, text: 'It answers within a second.', position: 0 });

  assert.deepEqual(call.check_coverage({ spec_id: spec.id }).uncriteriated.map((row) => row.label), ['ENV1']);
});

test('check_coverage names one criterion\'s text declared by two stories, and folds whitespace to see it', (t) => {
  const { call } = surface(t);
  const { spec, other, bound } = project(call);

  assert.deepEqual(call.check_coverage({ spec_id: spec.id }).duplicated_criteria, []);

  // The same sentence in another story, re-wrapped — the shape an epics run produced for FR3's
  // standard-output criterion, written into one story and again into another.
  const copy = call.create_story_criterion({
    story_id: other.id, text: 'The tool reads\n  the input once.', position: 1,
  });

  const report = call.check_coverage({ spec_id: spec.id });

  assert.deepEqual(report.duplicated_criteria, [{
    text: 'The tool reads the input once.',
    criteria: [
      { id: bound.id, epic: 'core', story: 1, story_title: 'core story' },
      { id: copy.id, epic: 'extras', story: 1, story_title: 'extras story' },
    ],
  }]);
  assert.ok(report.warnings.some((warning) =>
    warning.includes("'The tool reads the input once.' is declared by 2 stories")));
  assert.ok(!report.gaps.some((gap) => gap.includes('declared by')), 'a duplicate is reported, not refused');
});

test('a repeat inside one story is refused at the write, and the report is the other half of that rule', (t) => {
  const { call } = surface(t);
  const { spec, first } = project(call);

  // The two halves meet here. Within a story the guard in `tools/index.ts` refuses the second
  // copy outright, because one story has no reason to hold a check twice. Across stories it is a
  // judgement about the breakdown — two stories may genuinely share one criterion — so the report
  // names it and lets the caller decide. Neither half covers the other, and this asserts both.
  assert.match(refused(() => call.create_story_criterion({
    story_id: first.id, text: 'The tool reads the input once.', position: 3,
  })).message, /this story already has that criterion at position 0/);

  assert.deepEqual(call.check_coverage({ spec_id: spec.id }).duplicated_criteria, []);
});

test('check_coverage refuses an epic that is not this spec\'s, and an id that is no epic', (t) => {
  const { call } = surface(t);
  const { spec } = project(call);
  const elsewhere = call.create_spec({ slug: 'other', title: 'Other' });
  const stray = call.create_epic({ parent_id: elsewhere.id, slug: 'stray', title: 'Stray' });

  assert.match(refused(() => call.check_coverage({ spec_id: spec.id, epic_id: stray.id })).message,
    /epic 'stray' \(.+\) is not an epic of this spec/);
  assert.match(refused(() => call.check_coverage({ spec_id: spec.id, epic_id: spec.id })).message,
    /epic_id '.+' names no epic/);
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
