/**
 * Epic 47-12 Story 2 — the reads that render text now ask for it.
 *
 * - "Every site classified as rendering or quoting stored text passes `include_body`" [unit]
 * - "`spec` §7 renders requirement text, criterion text and section bodies rather than labels and
 *   counts" [unit]
 * - "`epics` Step 3d quotes spec text and story criteria verbatim, and Step 4's reachability gate
 *   reads criterion text rather than counting rows" [unit]
 *
 * **Driven through the read, which is the half `body-reads.test.js` cannot do.** That file asks
 * whether each step's block names the argument; it would pass just as well if `include_body` were
 * misspelt, inert, or declared on a tool that returns the column either way. The claim a skill
 * actually depends on is that asking changes what comes back — so every assertion here calls the
 * handler twice and compares, and the first test derives *which* handlers from the same
 * classification the fix was scoped from, so a tool added to a needing site later is covered
 * without anyone remembering to add it.
 *
 * `PROBE` is reconciled against that derivation in both directions. A needing tool with no probe
 * fails rather than being skipped — the gap retro 39 recorded, where an enumeration that quietly
 * covers less than it claims reports the shortfall as a pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase, handlers } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { resolve, withheld } from './support/body-reads.js';

/** Above what this fixture holds, so no read here is truncated. */
const BOUND = 200;

/**
 * One row of every kind the corpus reads a body from, each body column carrying a sentence
 * distinctive enough that finding it in a response is not a coincidence.
 */
function fixture(call) {
  const spec = call.create_spec({ slug: 'body-withholding', title: 'Body withholding' });

  const requirement = call.create_requirement({
    spec_id: spec.id,
    label: 'FR13',
    class: 'functional',
    text: 'A read is bounded by default and the default is always raisable by the caller.',
    position: 0,
  });

  const criterion = call.create_acceptance_criterion({
    requirement_id: requirement.id,
    text: 'A read that does not ask for a body column returns every other column and omits that one.',
    position: 0,
  });

  const section = call.create_document_section({
    document_id: spec.id,
    heading: 'Constraints',
    body: 'The store has to survive a machine with no package manager.',
    position: 0,
  });

  const epic = call.create_epic({ parent_id: spec.id, slug: 'body-reads', title: 'Body reads' });
  const story = call.create_story({ epic_id: epic.id, number: 1, title: 'Ask for the body', position: 0 });

  const storyCriterion = call.create_story_criterion({
    story_id: story.id,
    text: 'The review page presents an approve control that posts to the gate and shows the spec beneath it.',
    position: 0,
  });

  const task = call.create_task({
    story_id: story.id,
    number: 1,
    title: 'Fix the render',
    position: 0,
    description: 'Pass include_body on each of the four reads Section 7 names.',
  });

  const coverage = call.create_coverage({
    requirement_id: requirement.id,
    spec_fragment: 'the default is always raisable',
    story_criterion_id: storyCriterion.id,
    position: 0,
  });

  const quick = call.create_quick({ slug: 'thin-render', title: 'Thin render' });
  const quickCriterion = call.create_quick_criterion({
    quick_id: quick.id,
    text: 'The rendered spec shows the text of every requirement it lists.',
    position: 0,
  });

  // A name the seeded roster does not already hold, so the fixture owns the row it asserts on.
  const agent = call.create_agent({
    name: 'body-witness',
    display_name: 'The Body Witness',
    icon: 'B',
    role: 'architecture',
    personality: 'Weighs a decision against what it forecloses rather than what it enables.',
    communication_style: 'States the trade-off first and the recommendation second.',
    position: 0,
  });

  const artifact = call.create_artifact({
    url: 'https://example.invalid/render',
    title: 'Rendered spec',
    description: 'The published render of the spec, produced after the approval gate.',
    published_at: '2026-08-11T00:00:00Z',
  });

  const observation = call.create_observation({
    story_id: story.id,
    text: 'A proximity sweep reported six skills clean and two of them were not.',
    synthesis: 'Proximity is not a reading; it agrees with the truth often enough to be trusted once.',
    position: 0,
  });

  const review = call.create_review({ slug: 'render-review', title: 'Render review', parent_id: epic.id });
  const finding = call.create_finding({
    review_id: review.id,
    position: 0,
    summary: 'Section 7 renders every label the spec has and nothing underneath any of them.',
    category_id: call.list_taxonomy({ domain: 'finding', limit: 50 }).items[0].id,
    severity_id: call.list_taxonomy({ domain: 'severity', limit: 50 }).items[0].id,
  });

  // Two chains rather than one, because `adopt_session` is the only tool below that writes: it
  // points the old row at the new one, so the same pair cannot be adopted twice and the two passes
  // need a pair each.
  const chain = (suffix) => ({
    earlier: call.create_session({
      id: `session-earlier-${suffix}`,
      skill: 'dpm:ralph',
      state: JSON.stringify({ iterations: [1, 2, 3] }),
    }),
    later: call.create_session({ id: `session-later-${suffix}`, skill: 'dpm:ralph' }),
  });

  const chains = [chain('a'), chain('b')];

  return {
    spec, requirement, criterion, section, epic, story, storyCriterion, task, coverage,
    quick, quickCriterion, agent, artifact, observation, review, finding, chains,
  };
}

/**
 * How to reach one row through each tool the classification names at a site that needs a body.
 * `find` picks the row under test out of a listing, because a listing returns everything of its
 * kind and the assertion is about one; a read has none and its response is the row. `again`
 * supplies separate arguments for the second pass where calling twice is not idempotent.
 *
 * The keys differ by kind and are not guessable — an agent is addressed by `name` and has no `id`
 * column at all — so each entry names its own rather than inheriting a convention.
 */
const PROBE = {
  adopt_session: (f) => ({
    args: { id: f.chains[0].later.id, predecessor_id: f.chains[0].earlier.id },
    again: { id: f.chains[1].later.id, predecessor_id: f.chains[1].earlier.id },
  }),
  read_session: (f) => ({ args: { id: f.chains[0].earlier.id } }),
  read_requirement: (f) => ({ args: { id: f.requirement.id } }),
  read_acceptance_criterion: (f) => ({ args: { id: f.criterion.id } }),
  read_story_criterion: (f) => ({ args: { id: f.storyCriterion.id } }),
  read_document_section: (f) => ({ args: { id: f.section.id } }),
  read_task: (f) => ({ args: { id: f.task.id } }),
  read_agent: (f) => ({ args: { name: f.agent.name } }),
  read_artifact: (f) => ({ args: { id: f.artifact.id } }),
  read_observation: (f) => ({ args: { id: f.observation.id } }),
  read_finding: (f) => ({ args: { id: f.finding.id } }),
  list_requirement: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.requirement.id }),
  list_acceptance_criterion: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.criterion.id }),
  list_story_criterion: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.storyCriterion.id }),
  list_document_section: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.section.id }),
  list_task: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.task.id }),
  list_coverage: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.coverage.id }),
  list_quick_criterion: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.quickCriterion.id }),
  list_agent: (f) => ({ args: { limit: BOUND }, find: (r) => r.name === f.agent.name }),
  list_artifact: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.artifact.id }),
  list_observation: (f) => ({ args: { limit: BOUND }, find: (r) => r.id === f.observation.id }),
};

/**
 * The one row under test, whether the tool returned it alone or among its siblings. A listing
 * that does not contain the seeded row fails here rather than yielding the envelope, which has
 * none of the columns under test and would read as a body withheld.
 */
function row(name, response, find) {
  if (!find) {
    assert.equal('items' in response, false, `${name} returned a listing where a row was expected`);

    return response;
  }

  const found = (response.items ?? []).find(find);

  assert.ok(found, `${name} did not return the seeded row`);

  return found;
}

// --- Criterion 1: the argument the fix added is the argument that returns the text ---------------

test('every tool a needing site names withholds its body, and releases it when asked', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const call = handlers(tools);
  const declared = new Map(tools.map((tool) => [tool.name, tool.body ?? []]));

  const { entries } = resolve(withheld(tools));
  const needed = [...new Set(entries.filter((entry) => entry.needs).map((entry) => entry.tool))].sort();

  // **Both directions, so the table cannot quietly cover less than the classification.**
  assert.deepEqual(needed, Object.keys(PROBE).sort(),
    'the probe table and the tools named at needing sites have diverged');
  assert.ok(needed.length >= 20, `only ${needed.length} tools are named at a site that needs a body`);

  const seeded = fixture(call);

  for (const name of needed) {
    const { args, again, find } = PROBE[name](seeded);
    const columns = declared.get(name);

    assert.ok(columns.length > 0, `${name} declares no body column, so it withholds nothing`);

    const plain = row(name, call[name]({ ...args }), find);
    const asked = row(name, call[name]({ ...(again ?? args), include_body: true }), find);

    for (const column of columns) {
      assert.equal(column in plain, false,
        `${name} returned ${column} to a read that did not ask for it — the fix was unnecessary`);
      assert.ok(column in asked,
        `${name} withheld ${column} from a read that did ask — the fix does not work`);
    }

    // At least one of them carries something, so "present" is not "present and null".
    assert.ok(columns.some((column) => typeof asked[column] === 'string' && asked[column].length > 0),
      `${name} released every body column empty, so the comparison above proves nothing`);
  }
});

// --- Criterion 2: `spec` §7 ---------------------------------------------------------------------

test('`spec` §7 renders requirement text, criterion text and section bodies', (t) => {
  const db = openPlanningDatabase(t);
  const call = handlers(spineTools(db));
  const seeded = fixture(call);

  // The three reads §7 names that withhold, called as it names them.
  const [requirement] = call.list_requirement({ spec_id: seeded.spec.id, limit: BOUND, include_body: true }).items;
  const [criterion] = call.list_acceptance_criterion({ requirement_id: seeded.requirement.id, limit: BOUND, include_body: true }).items;
  const [section] = call.list_document_section({ document_id: seeded.spec.id, limit: BOUND, include_body: true }).items;

  assert.equal(requirement.text, seeded.requirement.text);
  assert.equal(criterion.text, seeded.criterion.text);
  assert.equal(section.body, seeded.section.body);

  // **The failure has no error in it**, which is the whole reason §7 was wrong for as long as it
  // was. The same three reads without the argument return the same three rows, the same count and
  // the same labels — a render that is structurally complete and says nothing a user could approve.
  const thin = {
    requirement: call.list_requirement({ spec_id: seeded.spec.id, limit: BOUND }).items[0],
    criterion: call.list_acceptance_criterion({ requirement_id: seeded.requirement.id, limit: BOUND }).items[0],
    section: call.list_document_section({ document_id: seeded.spec.id, limit: BOUND }).items[0],
  };

  assert.equal(thin.requirement.label, 'FR13', 'the label went missing too, so the render would look broken');
  assert.equal(thin.section.heading, 'Constraints');
  assert.equal('text' in thin.requirement, false);
  assert.equal('text' in thin.criterion, false);
  assert.equal('body' in thin.section, false);
});

// --- Criterion 3: `epics` Step 3d and Step 4 -----------------------------------------------------

test('`epics` can quote a requirement verbatim and reach its criteria through coverage', (t) => {
  const db = openPlanningDatabase(t);
  const call = handlers(spineTools(db));
  const seeded = fixture(call);

  // **Step 3d** binds each coverage row to a verbatim fragment of the requirement's own text, so
  // the read Step 1 performs has to return that text for the fragment to exist at all.
  const [requirement] = call.list_requirement({ spec_id: seeded.spec.id, limit: BOUND, include_body: true }).items;

  assert.ok(requirement.text.includes(seeded.coverage.spec_fragment),
    'the fragment the fixture bound is not a substring of the text the read returned');

  // **Step 4's reachability gate** weighs whether a criterion names the affordance or only the
  // response, which is in the criterion's text and is reached through the coverage row.
  const [bound] = call.list_coverage({ requirement_id: requirement.id, limit: BOUND, include_body: true }).items;
  const reached = call.read_story_criterion({ id: bound.story_criterion_id, include_body: true });

  assert.equal(reached.text, seeded.storyCriterion.text);
  assert.match(reached.text, /presents an approve control/,
    'the criterion came back without the affordance clause the gate is looking for');

  // **What a body-less run would have to gate on.** The coverage row still arrives, still points at
  // a criterion, and still says nothing about what either of them requires — so the gate returns a
  // verdict in the same shape as a real one.
  const blind = call.list_coverage({ requirement_id: requirement.id, limit: BOUND }).items[0];

  assert.equal(blind.story_criterion_id, bound.story_criterion_id);
  assert.equal('spec_fragment' in blind, false);
  assert.equal('text' in call.read_story_criterion({ id: bound.story_criterion_id }), false);

  // **And the cost of guessing the fragment rather than reading it.** A non-substring is refused at
  // the write, naming the requirement it is not in, which is why Step 1 asks for the text rather
  // than leaving Step 3d to invent one.
  assert.throws(() => call.create_coverage({
    requirement_id: requirement.id,
    spec_fragment: 'bounded reads are raisable',
    story_criterion_id: bound.story_criterion_id,
    position: 1,
  }), /spec_fragment is not in FR13's text/, 'a guessed fragment was stored');

  const broken = call.check_integrity({}).entries
    .filter((entry) => !entry.held)
    .flatMap((entry) => entry.rows.map((failed) => ({ entry: entry.entry, id: failed.id })));

  assert.deepEqual(broken, [], 'the refused write left a row behind for the register to find');
});
