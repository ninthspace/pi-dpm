/**
 * Epic 02-03 Story 1 — `read_shared_document`, the tool ADR 02-01 puts the shared documents behind.
 *
 * Twenty-four references in twenty-three skill bodies open by reading `dpm/shared/*.md`, and the
 * mechanism that made those resolve — `resolveSupportingPaths`, a registration-time rewrite of the
 * reference to an absolute path — cannot run on v1, which reads `SKILL.md` verbatim off disk. It is
 * already rejected on v2 as `external_directory`. So the conventions are reaching the model on
 * neither host, and the shape of that failure is what these tests are aimed at: **an absent file
 * read returns nothing and raises nothing**, and a skill carries on without its conventions.
 *
 * The tool replaces it because a tool call is loud. That property is only worth what its refusal is
 * worth, which is why criterion 1 is half about the content and half about what happens to a name
 * that names nothing — a tool answering an unknown name with empty content would have reproduced
 * the silent omission one layer in, and every test here would still have passed.
 *
 * **The tests take a `root` rather than reading this checkout wherever they can.** Asserting the
 * real `shared/` against the real `shared/` says only that `readFileSync` works twice. What says
 * the tool is a name-to-document mechanism is a directory whose contents the test chose — a third
 * document that exists in no source file, served by the same call with no line added for it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { SHARED_DIRECTORY } from '../src/plugin/root.ts';
import { ADVICE, sharedDocumentTools } from '../src/tools/shared.ts';
import { spineTools } from '../src/tools/index.ts';
import { openPlanningDatabase } from './support/planning-database.js';
import { filesUnder } from './support/sources.js';
import { packageTree } from './support/package-tree.js';

const ROOT = join(import.meta.dirname, '..');
const SHARED = join(ROOT, SHARED_DIRECTORY);

/** The two documents the package ships, read from the directory rather than named here. */
const NAMED = ['skill-conventions', 'status-model'];

/**
 * The tool, built over a root of the caller's choosing.
 *
 * **The profile is pinned empty rather than inherited**, so every assertion below is about the base
 * document. `DPM_PROFILE` set in a contributor's shell would otherwise append an overlay to the
 * content and turn the byte-equality tests red for a reason that has nothing to do with them. The
 * profile tests at the foot of this file pass their own.
 */
const built = (root, profile = '') =>
  sharedDocumentTools({ ...(root ? { root } : {}), profile })[0];

const read = (name, root, profile) => built(root, profile).handler({ name });

// --- Criterion 1: the bytes, and the refusal ------------------------------------------------------

test('the tool returns the byte content of the named shared document [unit]', () => {
  // **The oracle is the file**, not a snippet of it — a test asserting that the answer contains a
  // remembered heading passes for a truncated read, which is precisely the half-answer this
  // mechanism exists to make impossible.
  const answer = read('skill-conventions');

  assert.equal(answer.content, readFileSync(join(SHARED, 'skill-conventions.md'), 'utf8'));
  assert.equal(answer.name, 'skill-conventions');

  // The control on that equality: it is over something, and it can come out false. Without this a
  // tool returning `undefined` against a file read that also returned `undefined` would pass.
  assert.ok(answer.content.length > 1000,
    `the conventions came back as ${answer.content.length} characters, which is not a document`);
  assert.notEqual(answer.content, read('status-model').content);
});

test('an unknown name is refused, and the refusal names what exists [unit]', () => {
  // **This is the criterion, not an edge case.** A tool answering an unknown name with empty
  // content puts the silent omission back — inside the tool boundary this time, where the loudness
  // the tool was chosen for was supposed to live.
  assert.throws(() => read('conventions'), (error) => {
    assert.match(error.message, /no shared document is called 'conventions'/);

    // Named rather than counted, and both of them: a caller told only *no* is left exactly where a
    // failed file read would have left them.
    for (const name of NAMED) assert.match(error.message, new RegExp(name));

    return true;
  });

  // Not an empty answer, not a null, not a resolved promise — the three ways a refusal decays into
  // the thing it was written to prevent.
  for (const unknown of ['conventions', '', 'status_model', 'skill-conventions.md']) {
    assert.throws(() => read(unknown), Error, `'${unknown}' was answered rather than refused`);
  }

  // And the refusal is not so wide that everything is refused, which is the way this test passes
  // while the tool is broken.
  for (const name of NAMED) assert.ok(read(name).content.length > 0);
});

test('a name that climbs out of the shared directory is refused [unit]', () => {
  // `name` becomes part of a path, so `../README` has to go somewhere. The interesting case is the
  // one that names a file **that exists** — a check filtering on odd characters passes every test
  // written with a path that was never going to resolve anyway.
  assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').length > 0,
    'the escape below aims at a file that is not there, so it proves nothing');

  for (const escape of ['../README', '../../README', join(ROOT, 'README')]) {
    assert.throws(() => read(escape), /no shared document is called/);
  }
});

// --- Criterion 2: one mechanism, not one tool and one special case --------------------------------

test('both shipped documents are served by the identical call [unit]', () => {
  // Driven from the directory's own contents rather than from two hand-written cases. If the second
  // document had needed a line of its own, this loop is where the missing line would show.
  for (const name of NAMED) {
    const answer = read(name);

    assert.equal(answer.name, name);
    assert.equal(answer.content, readFileSync(join(SHARED, `${name}.md`), 'utf8'), name);
  }

  // The reading is over the directory and not over `NAMED`: a third document arriving in `shared/`
  // and never reaching the tool is the failure this criterion is really about, and a loop over a
  // hand-kept pair could not see it.
  assert.throws(() => read('nothing-of-the-sort'));
});

test('a document this package has never held is served with no line added for it [unit]', (t) => {
  // **The control that makes criterion 2 mean something.** Against the real `shared/` a tool with
  // two hard-coded branches is indistinguishable from a name-to-document mechanism — both answer
  // both names. Here the directory holds a third document that appears in no source file, so only
  // the mechanism can answer.
  const root = packageTree(t, {}, {
    'skill-conventions.md': 'planted conventions\n',
    'status-model.md': 'planted statuses\n',
    'invented-here.md': 'a document no branch was written for\n',
  });

  assert.equal(read('invented-here', root).content, 'a document no branch was written for\n');

  // And it serves the planted copies rather than this checkout's, which is the other half: the tool
  // reads the root it was given rather than reciting what it was built beside.
  assert.equal(read('skill-conventions', root).content, 'planted conventions\n');

  // The refusal follows the directory too — it lists what is there, not what this package ships.
  assert.throws(() => read('nothing-here', root), /invented-here/);
});

// --- Criterion 3: the same answer under both hosts ------------------------------------------------

test('the answer does not depend on the working directory the host spawned the server in [unit]', (t) => {
  // **This is what "identical under both hosts" reduces to on one machine.** The server process is
  // the same on v1 and v2 — ADR 01-02 — so the axis that actually differs is what the host hands
  // it, and the working directory is the part of that this tool could accidentally read. It resolves
  // its own package root instead.
  const before = read('skill-conventions').content;
  const elsewhere = tmpdir();
  const here = process.cwd();

  t.after(() => process.chdir(here));
  process.chdir(elsewhere);

  assert.equal(read('skill-conventions').content, before,
    'the tool answered differently from another working directory, so it is reading a host fact');

  // **The control, and without it the equality above is unfalsifiable.** `Context.root` defaults to
  // `'.'` — the working directory — which is exactly the root this tool would have taken had it
  // used the one every other tool is handed. Resolved across the same two directories it gives two
  // different answers, so the comparison above is over an axis that genuinely moved.
  assert.notEqual(join(here, SHARED_DIRECTORY), join(process.cwd(), SHARED_DIRECTORY),
    'the chdir did not move anything, so nothing above was tested');
});

test('the registry builds it with no host context at all [unit]', (t) => {
  // The other half of the same claim, read off the registry rather than the module: `spineTools`
  // is handed a `root`, and two wildly different ones must not reach this tool.
  const registered = (root) => spineTools(openPlanningDatabase(t), { root })
    .find((tool) => tool.name === 'read_shared_document');

  const one = registered('/some/project');
  const other = registered('/a/completely/different/project');

  assert.ok(one, 'read_shared_document is not in the registry');
  assert.equal(one.handler({ name: 'status-model' }).content,
    other.handler({ name: 'status-model' }).content);

  // Which is the same answer the module gives standing alone — so the registry adds nothing and
  // takes nothing away.
  assert.equal(one.handler({ name: 'status-model' }).content, read('status-model').content);
});

// --- Criterion 4 (must NOT): a second copy of either shared document ------------------------------

/**
 * Every file under a root whose content is byte-identical to one of the shared documents.
 *
 * **By content, not by filename.** A copy renamed is still a copy, and it is the worse kind: a
 * second `skill-conventions.md` is visible to anyone listing the tree, where `conventions-old.txt`
 * drifts for a year without being noticed. So the reading hashes and the filename plays no part.
 *
 * @param root The tree to sweep.
 * @param shared The shared directory within it, whose own files are the originals.
 * @returns {string[]} Root-relative paths of the duplicates, sorted.
 */
function duplicatesOf(root, shared) {
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const originals = new Map();

  // **The originals are the documents `shared/` serves, which is the flat layer and not the tree
  // under it.** `filesUnder` recurses, so an overlay in `shared/advice/<profile>/` was registering
  // itself as an original and then matching itself as a copy — a self-report, and one that would
  // have masked the reading this function exists for. Narrowed here rather than filtered at the
  // call site, so the overlay stays *eligible* to be caught: paste the base conventions into an
  // overlay and it is a byte-identical copy of an original, reported like any other.
  for (const path of filesUnder(shared).filter((path) => dirname(path) === shared)) {
    originals.set(digest(path), path);
  }

  return filesUnder(root)
    .filter((path) => dirname(path) !== shared && originals.has(digest(path)))
    .map((path) => relative(root, path))
    .sort();
}

test('the duplicate reading finds a renamed second copy, by path [unit]', (t) => {
  // **Red first.** A must-NOT asserted against a tree that has never held the thing is an assertion
  // rather than a verification: the reading has to be seen finding what it is looking for before
  // its silence over the real tree means anything.
  const root = packageTree(t, {}, {
    'skill-conventions.md': readFileSync(join(SHARED, 'skill-conventions.md'), 'utf8'),
  });

  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'conventions-old.txt'),
    readFileSync(join(SHARED, 'skill-conventions.md')));

  assert.deepEqual(duplicatesOf(root, join(root, SHARED_DIRECTORY)),
    [join('docs', 'conventions-old.txt')],
    'the reading missed a byte-identical copy under a different name');

  // And it is quiet over the same tree once the copy is gone — otherwise it reports every file.
  writeFileSync(join(root, 'docs', 'conventions-old.txt'), 'something else entirely\n');
  assert.deepEqual(duplicatesOf(root, join(root, SHARED_DIRECTORY)), []);
});

test('must NOT — a second copy of either shared document exists anywhere in the tree [unit]', () => {
  // Reported by path, as the criterion asks. A count would say a duplicate exists and leave the
  // reader to find it, which is the position `shared/` was in before this epic.
  assert.deepEqual(duplicatesOf(ROOT, SHARED), [],
    'a byte-identical copy of a shared document is in the tree — the tool is one reader of two files');

  // The controls on that emptiness, both directions. The sweep reaches a lot of files, and the
  // originals it compares against are the two that exist.
  assert.ok(filesUnder(ROOT).length > 100, 'the sweep walked almost nothing');

  // **`shared/advice/` is excluded here and nowhere else.** An overlay is named after the document
  // it extends, so `advice/opus/skill-conventions.md` sits beside `skill-conventions.md` under a
  // name that matches — and it is not a second copy of it: it holds the model-specific half, is
  // appended to the base rather than served instead of it, and the duplicate sweep above is over
  // the whole tree and still reports nothing, which is what says so. Excluding them from this
  // *census* keeps the assertion about the documents the package serves; leaving them in the sweep
  // is what would catch an overlay that had been filled with a copy of its own base.
  const documents = filesUnder(SHARED)
    .map((path) => relative(SHARED, path))
    .filter((path) => !path.startsWith(`${ADVICE}/`) && !path.startsWith(`${ADVICE}\\`))
    .sort();

  assert.deepEqual(documents, NAMED.map((name) => `${name}.md`));
});

// --- The advice overlay: model guidance that is added, never edited in ---------------------------

/**
 * A package tree with an advice overlay planted under `shared/advice/<profile>/`.
 *
 * `packageTree` writes flat names into `shared/`, so the nested directories are made here rather
 * than by widening it for one caller.
 */
function withAdvice(t, documents, advice) {
  const root = packageTree(t, {}, documents);

  for (const [path, source] of Object.entries(advice)) {
    const file = join(root, SHARED_DIRECTORY, ADVICE, path);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }

  return root;
}

test('with no profile the base document is served whole and unchanged [unit]', (t) => {
  // **The default is the whole of the default.** An overlay that leaked into an unprofiled read
  // would be model guidance reaching every run of every model — the state this seam exists to end,
  // reintroduced by the seam itself.
  const root = withAdvice(t, {
    'skill-conventions.md': 'base conventions\n',
    'status-model.md': 'statuses\n',
  }, { 'opus-5/skill-conventions.md': 'answers run long\n' });

  const answer = read('skill-conventions', root);

  assert.equal(answer.content, 'base conventions\n');
  assert.equal(answer.profile, null);
});

test('an active profile appends its overlay under a heading, and names itself [unit]', (t) => {
  const root = withAdvice(t, {
    'skill-conventions.md': 'base conventions\n',
    'status-model.md': 'statuses\n',
  }, { 'opus-5/skill-conventions.md': 'answers run long\n' });

  const answer = read('skill-conventions', root, 'opus-5');

  // The base is served **whole**, and the overlay follows it. Composed rather than substituted is
  // the decision the file turns on: a profile serving its own copy would be a second statement of
  // every convention in the base, free to drift from it at the first edit.
  assert.ok(answer.content.startsWith('base conventions\n'),
    'the base document was replaced rather than extended');
  assert.match(answer.content, /## Model-specific guidance/);
  assert.match(answer.content, /answers run long/);

  // Named in the answer, so a run can say which advice it was given and a transcript records it.
  assert.equal(answer.profile, 'opus-5');

  // And the heading says the guidance is advice rather than a rule, which is the distinction the
  // whole seam rests on — a reader who takes it for a rule has lost the reason it is separable.
  assert.match(answer.content, /never a rule about what the record must hold/);
});

test('a profile with no overlay for a document serves that document unchanged [unit]', (t) => {
  // Advice is cross-cutting: a profile carries an overlay for the conventions every body reads and
  // usually nothing for the status vocabulary. A missing overlay is the ordinary case, not a fault.
  const root = withAdvice(t, {
    'skill-conventions.md': 'base conventions\n',
    'status-model.md': 'statuses\n',
  }, { 'opus-5/skill-conventions.md': 'answers run long\n' });

  const answer = read('status-model', root, 'opus-5');

  assert.equal(answer.content, 'statuses\n');
  assert.equal(answer.profile, 'opus-5', 'the profile is still what is active');
});

test('an unknown profile is refused when the tool is built, naming the profiles that exist [unit]', (t) => {
  const root = withAdvice(t, {
    'skill-conventions.md': 'base\n',
    'status-model.md': 'statuses\n',
  }, { 'opus-5/skill-conventions.md': 'advice\n', 'opus-5.1/skill-conventions.md': 'advice\n' });

  // **Refused at build, not on first read.** A run that planned half an epic before discovering its
  // conventions never arrived is the silent omission ADR 02-01 chose a tool to avoid, one level up.
  assert.throws(() => built(root, 'opsu'), (error) => {
    assert.match(error.message, /no advice profile named 'opsu'/);
    assert.match(error.message, /opus-5, opus-5\.1/, 'the refusal does not name the profiles that exist');

    return true;
  });

  // **Two releases of one model, and the resolver separates them.** A profile is a version, not a
  // family: the advice in it is an observed habit, and a habit does not carry forward to the next
  // release untested. So the match is exact — `opus-5` is not a prefix of anything, `opus-5.1` is
  // its own directory, and a dot in the name is a character like any other rather than a separator
  // the resolver reads meaning into. There is deliberately no fallback from `opus-5.1` to `opus-5`:
  // inheriting advice is asserting a measurement nobody took.
  assert.equal(read('skill-conventions', root, 'opus-5.1').profile, 'opus-5.1');
  assert.throws(() => built(root, 'opus'), /no advice profile named 'opus'/,
    'a family name resolved to a version, so advice would be inherited across releases');
  assert.throws(() => built(root, 'opus-5.2'), /no advice profile named 'opus-5\.2'/,
    'an unbuilt version resolved to an older one rather than being refused');

  // An empty value is not a name — it is how a variable that was unset in one shell and exported
  // empty in another reads, and both mean "no profile".
  assert.equal(read('skill-conventions', root, '').profile, null);
});

test('a package with no advice directory at all serves every document [unit]', (t) => {
  // The overlay is optional, and a tree that predates it is the common case rather than a broken
  // one — every install of dpm before this release.
  const root = packageTree(t, {}, { 'skill-conventions.md': 'base\n', 'status-model.md': 'statuses\n' });

  assert.equal(read('skill-conventions', root).content, 'base\n');
  assert.throws(() => built(root, 'opus-5'), /No profile exists/);
});

test('the shipped opus-5 overlay is advice, and the base conventions name no model [unit]', () => {
  // The two halves of the boundary, asserted against the real tree. `npm run skills` enforces the
  // second on every body; this is the one file where the first has to be true as well, because an
  // overlay that restated a record rule would put back the interleaving in a new place.
  const overlay = readFileSync(join(SHARED, ADVICE, 'opus-5', 'skill-conventions.md'), 'utf8');

  // **A version, not a family.** The heading has to carry the release, because the advice under it
  // is an observed habit of that release and the directory it sits in is what a run selects by.
  assert.match(overlay, /^# Opus 5/m, 'the overlay does not say which release it is for');

  // **The disclaimer is asserted on what the model receives, not on the file.** `overlay()` writes
  // it for every profile, so no author of a future overlay can leave it out — which is the whole
  // reason it is in the wrapper and not a convention each file is trusted to follow.
  assert.match(read('skill-conventions', undefined, 'opus-5').content,
    /never a rule about what the record must hold/);

  // And the base carries no model name, which is what makes deleting the overlay a complete
  // removal rather than the start of a search.
  assert.doesNotMatch(readFileSync(join(SHARED, 'skill-conventions.md'), 'utf8'), /\bopus\b/i);
});
