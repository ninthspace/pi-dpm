/**
 * Epic 01-02 Story 2 — the effective MCP tool naming under v2, and the surface underneath it.
 *
 * Two claims that sound alike and are not. **How a tool is addressed** changed with the host:
 * Claude Code dispatched a plugin-bundled server's tools as `mcp__plugin_<plugin>_<server>__<tool>`
 * and v2 renders `<server key>_<tool>`. **What the tools are** did not change at all, and that is
 * the one this file can check hardest.
 *
 * The naming itself was established by running a beta host — its criterion is tagged `manual` for
 * that reason, and a test that asserted a prefix string would be asserting what somebody typed.
 * What is checkable here is the second-order thing: that the observation was written down before
 * the twenty-three skill bodies get rewritten against it, and that the rendering rule the section
 * records is applied consistently by the code that has to apply it.
 *
 * **The surface comparison has a real oracle, and that is the whole of its value.**
 * `tests/fixtures/v070-tool-surface.json` is what the *released* v0.7.0 advertises — captured by
 * running `bin/dpm-mcp.js` out of the installed marketplace package, not by writing down what this
 * repository produces. Every other schema test in this suite compares the port against itself and
 * would go on passing if a description had been reworded consistently. `parity-v070.test.js` holds
 * the must-NOT that stops this fixture being rewritten when it disagrees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SERVER_NAME } from '../src/plugin/registration.ts';
import { spineTools } from '../src/tools/index.ts';
import { openPlanningDatabase } from './support/planning-database.js';

const ROOT = join(import.meta.dirname, '..');
const ORACLE = join(ROOT, 'tests', 'fixtures', 'v070-tool-surface.json');

/**
 * The rendering v2 performs, as the recorded section states it.
 *
 * Written here as code because the section is prose and prose cannot be run. What makes this more
 * than a restatement is the substitution: it was **observed**, by registering a second server under
 * the key `dpm-odd.name x` and reading back `dpm-odd_name_x_adopt_session`. The hyphen survived and
 * the dot and the space did not, which is the rule below and is not what a reader would guess from
 * "identifier-safe".
 */
const rendered = (server, tool) => `${server.replaceAll(/[^A-Za-z0-9_-]/g, '_')}_${tool}`;

test('the rendering rule is the one observed against the beta host [integration]', () => {
  // The observation, in the two cases that establish it. Both are quoted from the probe's output.
  assert.equal(rendered('dpm', 'adopt_session'), 'dpm_adopt_session');
  assert.equal(rendered('dpm-odd.name x', 'adopt_session'), 'dpm-odd_name_x_adopt_session');

  // The hyphen is the half a reader gets wrong, so it is asserted on its own rather than left
  // inside the compound case above.
  assert.equal(rendered('a-b', 'x'), 'a-b_x', 'the hyphen was replaced, and the host does not');
  assert.equal(rendered('a.b', 'x'), 'a_b_x');

  // And the name dpm registers under is the one the prefix is built from, read from the entry
  // rather than written out — a rename there is a rename of every tool the skills call.
  assert.equal(SERVER_NAME, 'dpm');
  assert.equal(rendered(SERVER_NAME, 'create_spec'), 'dpm_create_spec');

  // **Not the old form.** This is what the skill port has to change, and stating it here means the
  // difference is recorded in something that runs rather than only in prose.
  assert.notEqual(rendered(SERVER_NAME, 'create_spec'), 'mcp__plugin_dpm_dpm__create_spec');
});

test('the naming is recorded on the epic before any skill prose is rewritten [integration]', () => {
  // **Read from the projection rather than from the database**, because the projection is what a
  // reader rewriting the skills will actually open, and a section recorded but never published
  // would satisfy a database read while being invisible to the person it was written for.
  const projection = readFileSync(
    join(ROOT, 'docs', 'epics', '01-02-epic-plugin-entry.md'), 'utf8',
  );

  assert.match(projection, /effective MCP tool naming under OpenCode v2/,
    'the epic carries no section recording the naming');
  assert.match(projection, /dpm-odd_name_x_adopt_session/,
    'the section does not carry the observation the substitution rule was read from');
  assert.match(projection, /mcp__plugin_dpm_dpm__create_spec/,
    'the section does not say what the old form was, so a rewrite has nothing to rewrite from');

  // **The half that said "before", and it has been spent.** This used to assert that the skill
  // prose still named the old form, so the section above was genuinely ahead of the rewrite rather
  // than a note written afterwards — with a comment saying the rewrite is what would fail it. Epic
  // 01-03 story 2 rewrote all twenty-three bodies and the shared conventions with them, and the
  // assertion failed exactly as written. What replaces it is the opposite claim, which is the one
  // worth keeping now: nothing in the prose names the old form any more.
  const conventions = readFileSync(join(ROOT, 'shared', 'skill-conventions.md'), 'utf8');

  assert.doesNotMatch(conventions, /mcp__plugin_dpm_dpm__/,
    'the shared conventions still name Claude Code\'s prefix');
  assert.match(conventions, new RegExp(rendered(SERVER_NAME, 'list_taxonomy')),
    'and they name no v2 tool either, so the reading above found nothing in either direction');
});

// --- The surface itself, against v0.7.0's own output ---------------------------------------------

/**
 * Tools this port advertises that v0.7.0 did not, one line each with what added it.
 *
 * **This list is the whole of the reshape epic 02-03 made here, and the reason is worth stating
 * once.** Until story 1 of 02-03 the assertion below was an equality: the ported surface *is*
 * v0.7.0's, 183 tools, name for name. That was true while the port was only a port, and it stops
 * being expressible the moment the port adds anything — which ADR 02-01 requires it to do, because
 * the shared documents have to reach the model through a tool call and no tool of v0.7.0's serves
 * them.
 *
 * The cheap way out was to regenerate `v070-tool-surface.json`. `parity-v070.test.js` forbids
 * exactly that, and is right to: rewriting the oracle is how any parity finding gets disposed of
 * without a line of the test being deleted. So the oracle is untouched and the *shape* of the claim
 * changes instead, to the one actually worth keeping — **v0.7.0's surface is a floor, not a
 * ceiling**. Every one of its 183 must still be present and byte-identical; anything else present
 * must be named here.
 *
 * That is `suite-integrity.test.js`'s `INHERITED`/`ADDED` shape, deliberately, and for the same
 * reason: the property being defended is that the surface may not grow *silently*. A tool added
 * without a line here still fails.
 */
const ADDED = [
  'check_coverage', // an epics run's hand-assembled gap check skipped two requirements and miscounted
  'delete_coverage_story', // a cross-epic "also delivered by" row was reported and could not be removed
  'delete_dependency', // an edge recorded backwards could be noticed by an epics run and not corrected
  'read_shared_document', // 02-03 story 1 — ADR 02-01, the shared documents through the server
  'retire_observation', // an MTPLX do run recorded one story's observation twice and could withdraw neither
];

/**
 * Fields whose wording deliberately departs from v0.7.0's, each naming the old text and the new.
 *
 * **`ADDED`'s shape applied to the other way a surface drifts.** That list exists because the port
 * may not *grow* silently; this one because it may not *reword* silently either, and until now the
 * byte-for-byte comparison below was the only thing saying so — which made every deliberate
 * correction look exactly like an accidental one, and left rewriting the oracle as the obvious way
 * out. `parity-v070.test.js` forbids that and is right to.
 *
 * **An entry is a pin, not an exemption**, which is the whole difference between this and a skip
 * list. `was` is checked against the oracle, so an entry that no longer describes a real
 * divergence fails rather than lingering. `now` is applied to the oracle's copy before the
 * comparison, so the field is still compared byte-for-byte — against this text instead of v0.7.0's.
 * A second edit to a declared field fails the same way an undeclared one does.
 */
const REWORDED = [
  {
    tools: ['create_coverage_story'],
    at: ['description'],
    was: 'Create the record that a story also delivers a coverage row.',
    now: 'Create the record that a story also delivers a coverage row. Refuses a story in another epic '
      + 'than the criterion the coverage row binds: work in another epic is a criterion of that story, '
      + 'bound on its own.',
    // An MTPLX epics run named a story of another epic, which register entry 4 reports and nothing
    // could then remove. The refusal is the write's; the description is how a caller learns it first.
    why: 'the tool now refuses a cross-epic story, and a caller should read that before it is refused',
  },
  {
    // Both session tools take the same `FIELDS` object, so one edit moves two entries here.
    tools: ['create_session', 'update_session'],
    at: ['inputSchema', 'properties', 'skill', 'description'],
    was: 'The CPM skill running, e.g. cpm:do',
    now: 'The dpm skill running, e.g. dpm:do',
    // The description is read by the model deciding what to pass. v0.7.0's names the product dpm
    // was forked from and a skill prefix no host here serves, so a run following it would write
    // `cpm:do` into a row every dpm skill then reads back.
    why: 'it named CPM\'s skill prefix, and the model passing it is choosing dpm\'s',
  },
  {
    // All four criterion tools take the same `fields` object in `criterionTools`.
    tools: ['create_acceptance_criterion', 'create_story_criterion', 'update_acceptance_criterion', 'update_story_criterion'],
    at: ['inputSchema', 'properties', 'polarity', 'description'],
    was: "'must_not' is a type here, not the words 'must NOT' at the front of the text",
    now: "'must_not' is a type here, and the document writes 'must NOT — ' before the text, so the text "
      + "names the rejected outcome as though it happened: 'a raw stack trace reaches the user', not 'the "
      + "tool does not print a stack trace' and not 'must NOT print a stack trace'",
    // v0.7.0's says only what the text must not start with. Three MTPLX specs each followed it and
    // still rendered wrongly: two wrote "tally does not print…", a double negative under the
    // prefix, and one cut "must not" out of the middle, leaving "tally print a traceback".
    why: 'it forbade the prefix without saying what the text is, and specs rendered as double negatives',
  },
  {
    tools: ['create_dependency'],
    at: ['description'],
    was: 'Link two documents or stories with a typed edge, reading source-blocks-target. On a supersedes '
      + 'edge the source is the superseded end and the target replaces it. Refuses an edge that would '
      + 'close a cycle over a kind that gates work, and one whose ends are document kinds its own kind '
      + 'does not admit.',
    now: 'Link two documents or stories with a typed edge, reading source-blocks-target: on a blocks edge '
      + 'the source must finish before the target can start, so the waiting end is the target. On a '
      + 'supersedes edge the source is the superseded end and the target replaces it. Refuses an edge '
      + 'that would close a cycle over a kind that gates work, and one whose ends are document kinds its '
      + 'own kind does not admit.',
    // An MTPLX epics run wrote every story edge of an epic with the waiting story as the source.
    why: '"source-blocks-target" alone was read backwards, and the sentence naming which end finishes first is checkable',
  },
];

/**
 * Arguments whose *shape* deliberately departs from v0.7.0's, as one property renamed.
 *
 * **The third way a surface drifts, and `ADDED`'s shape once more.** `REWORDED` pins the text at a
 * path and compares it with `assert.equal`, which is right for a description and cannot express
 * this: a rename removes one key and adds another, so there is no single value to compare. An entry
 * says which key went, which arrived, and what the new one declares.
 *
 * **A pin, not an exemption**, on `REWORDED`'s terms. `from` is checked to be a property v0.7.0
 * really advertised and `to` to be one it did not, so an entry describing a rename that has since
 * been reverted fails rather than sitting here exempting a field nobody is changing. The arrived
 * property is then compared byte-for-byte against `now`, so a second edit to it fails exactly as an
 * undeclared one does.
 */
const RESHAPED = [
  {
    // Both coverage tools take the same `STATE` object, so one edit moves two entries here.
    tools: ['create_coverage', 'update_coverage'],
    from: 'verified_at',
    to: 'verified',
    now: {
      type: 'boolean',
      description: 'Record the verification, or clear it with false. The server stamps the time from '
        + 'its own clock and computes the binding hash that accompanies it',
    },
    // An MTPLX do run sent `verified_at: "2026-09-15T19:17:00Z"` — a plausible time it had never read
    // off a clock, in the column a later reader trusts to say when the check happened. A time chosen
    // by the party making the claim can be backdated, exactly as a hash it chose would attest to
    // nothing; both halves of the pair are the server's now, and the caller says only *that* it
    // verified.
    why: 'the caller supplied the time of its own verification, and the server now stamps it',
  },
  {
    tools: ['update_requirement'],
    from: 'coverage_claimed_at',
    to: 'coverage_claimed',
    now: {
      type: 'boolean',
      description: 'Claim that the bound coverage rows account for this requirement whole, or '
        + 'withdraw the claim with false. The server stamps the time from its own clock and '
        + 'computes the hash over the bound set that accompanies it',
    },
    // The same defect one table up, found in the same run: the model shelled out to `date -u` for
    // this one, which is the right instinct and was required by nothing. A claim whose own
    // timestamp is typed by the claimant is the shape `coverage_claim_hash` was withheld over, and
    // the two columns are written together by `claimComplete` — so one of the pair being the
    // server's and the other the caller's was never a position this file could defend.
    why: 'the caller supplied the time of its own claim, and the server now stamps it',
  },
];

/** The value at a path, or `undefined` where the path does not lead anywhere. */
const at = (object, path) => path.reduce((value, key) => (value === undefined ? value : value[key]), object);

/**
 * One oracle tool with every rewording declared for it applied.
 *
 * Structured-cloned rather than spread: the paths reach into nested objects, and a shallow copy
 * would write `now` through into the oracle this run parsed — leaving the `was` check above
 * comparing the new text against itself and passing on any wording whatever.
 *
 * @param {object} tool
 * @returns {object}
 */
function withRewordings(tool) {
  const applicable = REWORDED.filter((entry) => entry.tools.includes(tool.name));
  const renames = RESHAPED.filter((entry) => entry.tools.includes(tool.name));

  if (applicable.length === 0 && renames.length === 0) return tool;

  const copy = structuredClone(tool);

  for (const { at: path, now } of applicable) {
    at(copy, path.slice(0, -1))[path.at(-1)] = now;
  }

  // Applied to the same copy, and the property that arrives carries `now` rather than the text it
  // replaced — so the comparison below still reads every byte of it.
  for (const { from, to, now } of renames) {
    delete copy.inputSchema.properties[from];
    copy.inputSchema.properties[to] = now;
  }

  return copy;
}

test('every tool v0.7.0 advertised is still advertised, byte for byte [integration]', (t) => {
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8'));
  const ported = spineTools(openPlanningDatabase(t))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(ported.map((tool) => [tool.name, tool]));

  // Controls first, because a deep-equal of two empty lists is the passing answer here too.
  assert.equal(oracle.length, 183, `the oracle holds ${oracle.length} tools, and v0.7.0 advertised 183`);
  assert.ok(ported.length > 0, 'the registry built nothing to compare');

  // **The set, before the schemas**, in both directions and reported as names — a tool that was
  // added or lost is reported as that, rather than as a diff of two 168KB structures with one entry
  // out of step.
  assert.deepEqual(oracle.map((tool) => tool.name).filter((name) => !byName.has(name)), [],
    'a tool v0.7.0 advertised is no longer advertised by the port');
  assert.deepEqual(ported.map((tool) => tool.name)
    .filter((name) => !oracle.some((tool) => tool.name === name)), ADDED,
    'the port advertises a tool that v0.7.0 did not and that no story accounts for');

  // **Each declared rewording is checked against the oracle before it is allowed to license one.**
  // An entry whose `was` is not what v0.7.0 actually said describes a divergence that is not there
  // — left behind by a revert, or written from memory — and would otherwise sit in the list
  // exempting a field nobody is changing.
  for (const entry of REWORDED) {
    assert.ok(entry.why, `the rewording of ${entry.tools.join(' and ')} is declared without a reason`);
    assert.notEqual(entry.was, entry.now, `${entry.tools.join(' and ')} declare a rewording that changes nothing`);

    for (const name of entry.tools) {
      const tool = oracle.find((candidate) => candidate.name === name);

      assert.ok(tool, `${name} is reworded and is not a tool v0.7.0 advertised`);
      assert.equal(at(tool, entry.at), entry.was,
        `${name} is declared as reworded from text v0.7.0 does not carry at ${entry.at.join('.')}`);
    }
  }

  // **And each declared rename against the same oracle**, for the reason the rewordings are checked:
  // an entry left behind by a revert would otherwise go on licensing a change nobody is making.
  for (const entry of RESHAPED) {
    assert.ok(entry.why, `the rename of ${entry.tools.join(' and ')} is declared without a reason`);
    assert.notEqual(entry.from, entry.to, `${entry.tools.join(' and ')} declare a rename that renames nothing`);

    for (const name of entry.tools) {
      const tool = oracle.find((candidate) => candidate.name === name);

      assert.ok(tool, `${name} is reshaped and is not a tool v0.7.0 advertised`);

      const properties = tool.inputSchema.properties;

      assert.ok(Object.hasOwn(properties, entry.from),
        `${name} is declared as renaming ${entry.from}, which v0.7.0 does not advertise`);
      assert.equal(Object.hasOwn(properties, entry.to), false,
        `${name} is declared as renaming ${entry.from} to ${entry.to}, which v0.7.0 already advertised`);
    }
  }

  // Then everything: description text and input schema, tool by tool, so a failure names the tool.
  // **Matched by name rather than by index**, which the equality above could take for granted and
  // this cannot: an added tool sorting into the middle would otherwise offset every comparison
  // after it and report 180 failures for one addition.
  //
  // The comparison is against the oracle **with the declared rewordings applied**, so a declared
  // field is still compared byte-for-byte — to `now` rather than to v0.7.0's text. Nothing is
  // skipped, and a second edit to a declared field fails exactly as an undeclared one does.
  for (const expected of oracle.map(withRewordings)) {
    const declared = REWORDED.some((entry) => entry.tools.includes(expected.name));

    assert.deepEqual(byName.get(expected.name), expected, declared
      ? `${expected.name} differs from v0.7.0 somewhere other than the rewording REWORDED declares`
      : `${expected.name} differs from what v0.7.0 advertised`);
  }

  // The controls on the comparison, and they are what the reshape put most at risk: the reading has
  // to be able to tell two surfaces apart in **both** directions. A subset check passes trivially
  // over an empty oracle, and a `deepEqual` over structures that had both become `undefined` would
  // report perfect parity.
  const reworded = new Map(byName);

  reworded.set(oracle[0].name, { ...oracle[0], description: `${oracle[0].description} (planted)` });
  assert.notDeepEqual(reworded.get(oracle[0].name), oracle[0],
    'a reworded description is not noticed by this comparison');

  const lost = new Map(byName);

  lost.delete(oracle[0].name);
  assert.deepEqual(oracle.map((tool) => tool.name).filter((name) => !lost.has(name)),
    [oracle[0].name], 'the reading does not notice a tool that is no longer advertised');

  // And the additions list is held to the same standard it holds the surface to: an entry naming a
  // tool that is not there is a line nobody removed, which would quietly widen the allowance.
  assert.deepEqual(ADDED.filter((name) => !byName.has(name)), [],
    'ADDED names a tool the port does not advertise');
});

test('the oracle is v0.7.0 output rather than a copy of this repository [unit]', () => {
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8'));

  // It cannot be *proved* from inside the tree that a fixture was captured from the release — what
  // can be checked is that it is a full surface rather than a stub, and that it carries the shape
  // a real `tools/list` reply has. `parity-v070.test.js` carries the part with teeth: the file may
  // never be modified or deleted, which is how a disagreement would otherwise be disposed of.
  for (const tool of oracle) {
    assert.ok(tool.name, 'a tool in the oracle has no name');
    assert.ok(tool.description, `${tool.name} has no description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} has no object input schema`);
    assert.equal(tool.inputSchema.additionalProperties, false,
      `${tool.name} accepts additional properties, which no dpm tool does`);
  }

  // And it is sorted, which is what makes the index-wise comparison above legitimate.
  assert.deepEqual(oracle.map((tool) => tool.name),
    [...oracle.map((tool) => tool.name)].sort((a, b) => a.localeCompare(b)));
});
