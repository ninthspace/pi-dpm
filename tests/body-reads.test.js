/**
 * Epic 47-12 Story 1 — every read of a body-carrying tool, classified by what its step does.
 *
 * - "Every mention of a body-carrying tool across the 23 skill files carries a classification —
 *   *renders or quotes stored text* (needs the body) or *needs only identity or a typed column*
 *   (does not) — with its reason, enumerated against the live tool registry" [unit]
 * - "The classification covers the skills the proximity sweep reported clean on the same terms as
 *   those it flagged; no site is excluded because `include_body` appears elsewhere in the same
 *   file" [unit]
 * - "must NOT — a site is classified from the presence of `include_body` nearby rather than from
 *   what the step does with the rows" [unit]
 *
 * **The must-NOT is the one this story exists for, and it is not hypothetical.** The proximity sweep
 * that opened the epic found 37 sites across 15 skills and reported six clean. Reading the steps
 * moved sites in both directions: two of those six carry real defects, and seven of `inspect`'s
 * flagged sites need no body at all. A check that could not tell those apart would have shipped both
 * errors while reporting a number.
 *
 * So the must-NOT is **driven rather than swept for** — retro 39's disposition, and necessary here
 * for its exact reason: this file's own prose says `include_body` many times, so a pattern sweep for
 * the prohibition would fire on the prohibition. Each limb below is instead a claim about the
 * classification's *content*, checkable against what it says, with a source that is wrong on purpose
 * beside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlanningDatabase } from './support/planning-database.js';
import { spineTools } from '../src/tools/index.ts';
import { CALLABLE, skillNames } from './support/skills.js';
import {
  CLASSIFICATION, SHARED, asks, blocks, corpus, key, quoted, resolve, sites, withheld,
} from './support/body-reads.js';

/** The six the proximity sweep of 2026-08-11 reported clean. Two of them were not. */
const REPORTED_CLEAN = ['dpm-artifact', 'dpm-clean', 'dpm-consult', 'dpm-discover', 'dpm-library',
  'dpm-party'];

/** Above what the corpus plausibly holds, for a read that must not be truncated. */
const BOUND = 500;

// --- Criterion 1: every site classified, in both directions, with a reason ----------------------

test('every mention of a withholding tool carries a classification and a reason', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);
  const names = withheld(tools);

  const { entries, unclassified, stale } = resolve(names);

  assert.deepEqual(unclassified, [],
    'a read of a body-carrying tool that nobody has judged — the shape a new skill arrives in');
  assert.deepEqual(stale, [],
    'a judgement about a site that has moved or gone, still sitting there looking like coverage');

  for (const entry of entries) {
    assert.equal(typeof entry.needs, 'boolean', `${entry.key} carries no judgement`);
    assert.ok(entry.why.length > 25, `${entry.key} carries no reason worth the name: ${entry.why}`);
  }

  // **Non-vacuity, and it is three separate claims because three separate things could be empty.**
  // A registry yielding no withholding tools, a corpus walk finding no skills, and a site extractor
  // matching nothing each produce a clean run of the loop above.
  assert.ok(names.size >= 30, `only ${names.size} withholding tools — the registry read has drifted`);
  assert.equal(skillNames().length, 23, 'the corpus is not the 23 skills this plugin ships');
  assert.ok(entries.length >= 100, `only ${entries.length} sites — the extraction has drifted`);

  // **The generated half is present, which is why the set is derived rather than written down.**
  // `list.js` copies each list tool's `body` from its matching read tool, so a transcribed list
  // would carry the read tools and miss twenty list tools beside them — and would report a corpus
  // in which two thirds of these sites do not exist.
  assert.ok(names.has('read_requirement'), 'the declared half of the withholding set is missing');
  assert.ok(names.has('list_requirement'), 'the generated half is missing — the set was transcribed');

  // And the control on `withheld` itself: `body: []` is not withholding. Every document kind
  // declares it, so reading it as truthy would bury the real entries under sixty whose reason is
  // "there is no body to ask for".
  assert.equal(names.has('read_spec'), false, '`body: []` is being read as a withheld column');
});

// --- Criterion 2: the skills the sweep called clean are covered on the same terms ---------------

test('the skills the proximity sweep reported clean are classified like every other', (t) => {
  const db = openPlanningDatabase(t);
  const names = withheld(spineTools(db));
  const { entries } = resolve(names);

  for (const skill of REPORTED_CLEAN) {
    assert.ok(entries.some((entry) => entry.file === skill),
      `${skill} was reported clean and has no classified site — it was taken on the sweep's word`);
  }

  // **The substance of the criterion**: reading them found defects the sweep did not. Named
  // individually rather than counted, because a count would still pass if a later edit fixed one
  // and broke another, and because these two are the evidence that the sweep's clean list was wrong.
  // Both are asserted through the whole chain — classified as needing, and given the argument — so
  // reverting either the judgement or the fix fails here.
  for (const name of ['dpm-artifact · list_artifact · Input', 'dpm-consult · read_agent · Commands']) {
    const entry = entries.find((row) => row.key === name);

    assert.ok(entry, `${name} is no longer a site`);
    assert.equal(entry.needs, true, `${name} was read as needing the body and no longer is`);
    assert.equal(asks(entry), true, `${name} was reported clean, found to need a body, and fixed`);
  }

  // **No site is excluded because `include_body` appears elsewhere in the same file.** `consult`
  // names the argument in most of its blocks and carries one that does not, so a file-scoped check
  // reports every `consult` site as asking. This is retro 38's recorded false pass, asserted as a
  // fact about this corpus rather than as a rule the corpus is assumed to follow.
  const consult = entries.filter((entry) => entry.file === 'dpm-consult');
  const quiet = consult.find((entry) => entry.key === 'dpm-consult · list_agent · Input');

  assert.match(quiet.source, /include_body/, 'the premise has gone: `consult` never names it');
  assert.equal(asks(quiet), false,
    'every `consult` block now names the argument, so the two readings agree and prove nothing');
});

// --- Criterion 3 (must NOT): classification is not read off proximity --------------------------

test('must NOT — a site is classified from what its step does, never from a nearby `include_body`', (t) => {
  const db = openPlanningDatabase(t);
  const names = withheld(spineTools(db));
  const { entries } = resolve(names);

  // **If the classification were read off the block, these two sets would be empty by
  // construction.** One of them now is, and for a reason that is not the proxy: Story 2 gave every
  // site that needed a body the argument, so a site needing one its step never asks for is a defect
  // the corpus no longer has. The disagreement therefore rests on the other direction, which no
  // amount of fixing can empty — a step that reads a foreign key next to one that reads text keeps
  // its `include_body` and keeps not needing it — and on the planted sources below.
  const asksAndDoesNotNeed = entries.filter((entry) => !entry.needs && asks(entry));
  const needsAndDoesNotAsk = entries.filter((entry) => entry.needs && !asks(entry));

  assert.ok(asksAndDoesNotNeed.length >= 4,
    'no site is classified as not needing a body while its block names the argument — '
    + 'the classification agrees with the proxy everywhere, which is what it must not do');
  assert.equal(needsAndDoesNotAsk.length, 0,
    `${needsAndDoesNotAsk.length} sites still need a body their step never asks for: `
    + needsAndDoesNotAsk.map((entry) => entry.key).join(', '));

  // Named, because the interesting half is the first: each of these is a step that divides the
  // labour between a list and a read, or names the argument for a different read entirely.
  assert.deepEqual(asksAndDoesNotNeed.map((entry) => entry.key).sort(), [
    'dpm-architect · list_document_section · Input',
    'dpm-brief · list_document_section · Phase 1: Problem recap',
    'dpm-consult · list_agent · Startup',
    'dpm-library · list_document_section · 1. Read what is there',
    'dpm-pivot · list_coverage · Where the cascade reaches',
    'dpm-pivot · list_document_section · Phase 2: Amend',
    'dpm-review · list_coverage · Step 1: Read what is under review',
    'dpm-status · list_coverage · Phase 3b: Spec coverage roll-up (only for a spec)',
  ]);

  // **And the construction itself, driven against sources written to break it.** `asks` reads the
  // block a mention sits in; a character window or a whole-file match would answer differently on
  // each of the three below, which is the whole reason the block is the unit.
  const planted = [
    '1. Call `<T>list_agent`, then `<T>read_agent` with `include_body` for the voice.',
    '2. Call `<T>list_task` for the work, in `number` order.',
    '',
    'A paragraph mentioning `<T>list_observation` and nothing else.',
  ].join('\n').replaceAll('<T>', CALLABLE);

  const planted_sites = sites(planted, new Set(['list_agent', 'read_agent', 'list_task', 'list_observation']));

  assert.equal(planted_sites.length, 4, 'the planted source did not yield the four sites it holds');

  const at = (tool) => planted_sites.find((site) => site.tool === tool);

  assert.equal(asks(at('list_agent')), true, 'a mention in the block that names the argument');
  assert.equal(asks(at('read_agent')), true, 'the read the argument belongs to');
  assert.equal(asks(at('list_task')), false,
    'the argument reached the next numbered item — the false pass retro 38 recorded');
  assert.equal(asks(at('list_observation')), false, 'the argument reached a later paragraph');
});

// --- The reason-expiry control -------------------------------------------------------------------

test('a reason that quotes the file stops being true when the file stops saying it', (t) => {
  const db = openPlanningDatabase(t);
  const names = withheld(spineTools(db));
  const { entries } = resolve(names);

  const citing = entries.filter((entry) => quoted(entry.why).length > 0);

  assert.ok(citing.length >= 10,
    `only ${citing.length} reasons cite the step they are about — the control has nothing to hold`);

  for (const entry of citing) {
    for (const phrase of quoted(entry.why)) {
      assert.ok(entry.stepText.includes(phrase),
        `${entry.key} rests on a sentence its step no longer carries: ${JSON.stringify(phrase)}`);
    }
  }

  // The control on the control: an extraction that found no quotes, or a comparison that matched
  // anything, would pass the loop above against a corpus that had changed completely.
  assert.deepEqual(quoted('a reason citing *"the exact words"* and *"a second phrase"*'),
    ['the exact words', 'a second phrase']);
  assert.deepEqual(quoted('a reason that cites nothing at all'), []);
  assert.equal(citing[0].stepText.includes('a sentence no step in this corpus contains'), false);
});

// --- The block reading, which everything above rests on -----------------------------------------

test('a block is one instruction — its continuations included and its neighbours excluded', () => {
  const source = [
    '## A step',
    '',
    '1. The first item, which wraps',
    '   onto a second line.',
    '2. The second item.',
    '',
    'A paragraph, hard wrapped',
    'across two lines.',
    '',
    '### A deeper heading',
    'Text under it.',
  ].join('\n');

  const found = blocks(source);

  assert.deepEqual(found.map((block) => block.text), [
    '1. The first item, which wraps\n   onto a second line.',
    '2. The second item.',
    'A paragraph, hard wrapped\nacross two lines.',
    'Text under it.',
  ]);

  // Each block's `start` addresses the text it holds, which is what maps a mention to its block.
  for (const block of found) {
    assert.equal(source.slice(block.start, block.start + block.text.length), block.text);
  }

  // A heading is nobody's instruction. Without this a mention in a heading would be attributed to
  // whatever came before it, and would inherit an argument from an unrelated step.
  assert.equal(found.some((block) => block.text.startsWith('#')), false);
});

test('one tool named twice under one heading is two sites, and they are told apart', () => {
  const source = [
    '## Perspectives',
    '',
    `1. Load the roster with \`${CALLABLE}list_agent\`, passing \`include_body\`.`,
    '',
    `If \`${CALLABLE}list_agent\` returns nothing, skip and carry on.`,
  ].join('\n');

  const found = sites(source, new Set(['list_agent']));

  assert.equal(found.length, 2, 'the two mentions collapsed into one, so one of them is unjudged');
  assert.deepEqual(found.map((site) => site.ordinal), [1, 2]);
  assert.deepEqual(found.map((site) => key(SHARED, site)), [
    `${SHARED} · list_agent · Perspectives`,
    `${SHARED} · list_agent · Perspectives #2`,
  ]);

  // And they differ in the answer, which is why collapsing them would have been wrong.
  assert.equal(asks(found[0]), true);
  assert.equal(asks(found[1]), false);
});

// --- The enumeration is derived, and reads nothing when there is nothing to read ----------------

test('the enumeration comes from the registry, and an empty registry yields no sites', (t) => {
  const db = openPlanningDatabase(t);
  const tools = spineTools(db);

  // The vacuity the must-NOT's sibling in Story 3 turns into a failure. Here it is asserted as a
  // property of the extractor: with nothing declared as withholding, there is nothing to classify —
  // so a check that did not count its input would report a clean corpus from an empty one.
  assert.equal(withheld([]).size, 0);
  assert.equal(withheld(tools.map((tool) => ({ ...tool, body: [] }))).size, 0,
    'a registry declaring no body columns still yields withholding tools');

  for (const [, { sites: found }] of corpus(new Set())) {
    assert.deepEqual(found, []);
  }

  // The corpus is the tree rather than a list, so a skill added tomorrow is judged rather than
  // skipped. Read with a bound above what it holds, for the same reason every other read is.
  const walked = [...corpus(withheld(tools)).keys()];

  assert.ok(walked.length < BOUND);
  assert.deepEqual(walked, [...skillNames(), SHARED]);
  assert.equal(CLASSIFICATION.size, [...corpus(withheld(tools)).values()]
    .reduce((total, { sites: found }) => total + found.length, 0),
  'the classification and the corpus have drifted apart in size');
});
