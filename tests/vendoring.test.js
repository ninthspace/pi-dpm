/**
 * Epic 01-01 Story 1 — the vendored tree, and the floor it now stands on.
 *
 * Four of this story's six criteria are checkable here. The other two are not, for opposite
 * reasons, and both are worth naming so a reader does not go looking for them:
 *
 * - "`node --version` on the contributor's machine reports 24.0.0 or above" is already asserted,
 *   twice, by `baseline.test.js` and `reference-environment.test.js` — each against the
 *   interpreter actually running the suite. Restating it here would be a third copy of one
 *   number's consequences, and this file's whole subject is that the number lives in one place.
 * - "The runtime the host invokes on the user's machine reports 24.0.0 or above" is `[target]`.
 *   No assertion on this machine says anything about that one, and none is attempted.
 *
 * **The floor number is pinned exactly once, here.** Everything else in the suite asserts
 * *agreement* — that `package.json` names what `node-floor.js` enforces, that the running
 * interpreter clears it. Agreement tests all stay green if the constant is changed to something
 * wrong, which is precisely why one of them has to be a test of the constant itself.
 *
 * **The refusal is checked over all five executables, not one.** `publish-cli.test.js` says in
 * its own margin that the only behavioural test of the refusal path runs a *copy* of an entry
 * point, and that the same hole sits under `floor-entry.mjs` and `bin/dpm-mcp.ts`. The hole is
 * real and cannot be closed behaviourally: a machine that can run this suite is by definition a
 * machine above the floor, so no spawn of a real executable can reach its refusal branch. What
 * closes it instead is a pair — the mechanism proved behaviourally through a fixture that
 * substitutes the number, and the wiring proved structurally over each of the five files. Neither
 * half is sufficient; a green mechanism says nothing about a binary that forgot to call it, and
 * green wiring says nothing about a message that never mentions the version.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REQUIRED_NODE } from '../src/server/node-floor.ts';
import { runNode } from './support/run-node.js';
import {
  EXECUTABLES, filesUnder, moduleFilesUnder, packageManifest, unsanctionedDependencies,
  withoutComments,
} from './support/sources.js';

const ROOT = join(import.meta.dirname, '..');

/**
 * Immediate subdirectory names, sorted, with dot-directories left out.
 *
 * `support/skills.js` exports `skillNames`, which is this walk with a better argument attached,
 * and this file used it until the import turned out to be fatal: that module builds `CALLABLE` at
 * load time by reading `.claude-plugin/plugin.json`, which the fork does not vendor. Every suite
 * importing it therefore dies before its first assertion rather than failing one, and this file
 * would have joined them. The walk is nine lines; the coupling is Story 4's to cut, and when it is
 * cut this should go back to `skillNames`.
 */
const directoriesIn = (path) => readdirSync(join(ROOT, path), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

// --- The vendored tree ---------------------------------------------------------------------------

test('the repository holds the v0.7.0 tree it was forked from [integration]', () => {
  // **A floor with a named sample, for the reason the `tests/` assertion three paragraphs down
  // already gives.** This was an equality at a hundred, which was right while `src/` was purely
  // inherited and stopped being right the moment the port added to it: epic 01-02 puts the plugin
  // entry under `src/plugin/`, and an equality would have read that as the inherited tree being
  // wrong. What the criterion says is that the fork brought the whole v0.7.0 tree across, not that
  // nothing has been built on it since — so the floor carries the claim and the sample says which
  // tree cleared it. The four named are the load-bearing ones nothing in the port replaces.
  const modules = moduleFilesUnder(join(ROOT, 'src'));

  assert.ok(modules.length >= 100,
    `src/ holds ${modules.length} modules, below the hundred the fork inherited`);

  const relative = new Set(modules.map((path) => path.slice(path.indexOf('/src/') + 1)));
  for (const module of [
    'src/start.ts', 'src/dump/index.ts', 'src/guard/index.ts', 'src/projection/index.ts',
  ]) {
    assert.ok(relative.has(module), `${module} came across`);
  }

  assert.deepEqual(readdirSync(join(ROOT, 'bin')).sort(), EXECUTABLES,
    'bin/ holds the five executables, by name and not merely by count');

  // **A floor rather than an equality, and the sample is what makes the floor mean anything.**
  // The criterion is that the inherited tree is all here, not that nothing has been added to it —
  // this file is itself the hundred and thirty-fourth suite, and the port adds more in every story
  // after this one. A bare `>= 133` would hold over any hundred and thirty-three files, so the
  // named suites below are the part that says *which* tree arrived. They are the five this story's
  // own work reads, so a partial copy that dropped them would fail here rather than three stories on.
  const testFiles = filesUnder(join(ROOT, 'tests')).filter((path) => path.endsWith('.test.js'));
  assert.ok(testFiles.length >= 133,
    `tests/ holds ${testFiles.length} suites, below the hundred and thirty-three inherited`);

  const names = new Set(testFiles.map((path) => path.slice(path.lastIndexOf('/') + 1)));
  for (const suite of [
    'baseline.test.js', 'server.test.js', 'plugin.test.js',
    'reference-environment.test.js', 'publish-cli.test.js',
  ]) {
    assert.ok(names.has(suite), `tests/${suite} came across`);
  }

  const skills = directoriesIn('skills');
  assert.equal(skills.length, 23, 'skills/ holds twenty-three skill directories');

  // The control on that count: they are skills rather than twenty-three empty directories, which
  // is what a `cp` that copied the names and none of the contents would also have produced.
  for (const skill of skills) {
    assert.ok(existsSync(join(ROOT, 'skills', skill, 'SKILL.md')), `skills/${skill} holds a SKILL.md`);
  }

  // The two documents v0.7.0 shipped, which is what this test is about. `advice/` is a directory
  // this port added and holds no shared reference of its own — every overlay in it extends one of
  // the two below rather than standing beside them.
  assert.deepEqual(readdirSync(join(ROOT, 'shared')).filter((entry) => entry.endsWith('.md')).sort(),
    ['skill-conventions.md', 'status-model.md'],
    'and both shared references came across');
});

test('the manifest names this package and this floor [unit]', () => {
  const manifest = packageManifest();

  assert.equal(manifest.name, 'pi-dpm', 'the fork has its own name');
  assert.equal(manifest.engines.node, '>=24.0.0');

  // The one place the number itself is written down. Every other assertion in the suite compares
  // `package.json` against `REQUIRED_NODE` or the running interpreter against `REQUIRED_NODE`, and
  // all of those would hold with the constant set to 22.5.0 again.
  assert.equal(REQUIRED_NODE, '24.0.0', 'the code enforces the floor this story raised it to');
});

// --- The refusal, over all five executables ------------------------------------------------------

test('the refusal mechanism exits non-zero and names the version, on stderr [unit]', async () => {
  // The floor is supplied as an argument, which is the only way a machine above the real floor can
  // reach the refusal branch at all. Everything else — the check, the message, the exit — is the
  // module under test.
  const fixture = join(ROOT, 'tests', 'fixtures', 'floor-entry.mjs');

  const refused = await runNode([fixture, '999.0.0']);

  assert.notEqual(refused.code, 0, 'a runtime below the supplied floor is refused, non-zero');
  assert.match(refused.stderr, /requires Node >=999\.0\.0/, 'the version required, on stderr');
  assert.match(refused.stderr, new RegExp(process.versions.node.replaceAll('.', '\\.')),
    'and the version in hand, so the reader can see the gap');
  assert.doesNotMatch(refused.stderr, /SyntaxError|ERR_UNKNOWN_BUILTIN_MODULE/,
    'and not a syntax or module error, which is the failure the check exists to replace');
  assert.equal(refused.stdout, '',
    'and nothing on stdout, which belongs to the transport from the first byte');

  // The control: the same fixture, given a floor this runtime clears, starts. Without it the
  // assertions above would hold over a fixture that was simply broken.
  const started = await runNode([fixture, '1.0.0']);
  assert.equal(started.code, 0);
  assert.equal(started.stdout.trim(), 'started');
});

test('each of the five executables is wired to that mechanism, and reaches it first [unit]', () => {
  for (const name of EXECUTABLES) {
    const source = withoutComments(readFileSync(join(ROOT, 'bin', name), 'utf8'));
    const where = `bin/${name}`;

    assert.match(source, /import \{ assertNodeFloor \} from '\.\.\/src\/server\/node-floor\.ts'/,
      `${where} imports the check statically`);

    const guard = source.indexOf('assertNodeFloor()');
    assert.ok(guard > -1, `${where} calls the check`);

    // **The hoisting rule, which is the whole reason the check is a module reaching nothing.**
    // Every static import is evaluated before the first statement runs, so an entry point that
    // imported the server at the top would crash on `node:sqlite` before the refusal could print.
    // The server therefore arrives by dynamic import, and that import must come after the guard.
    const dynamic = source.indexOf('await import(');
    assert.ok(dynamic > -1, `${where} reaches the rest of dpm by dynamic import`);
    assert.ok(guard < dynamic, `${where} checks the floor before importing anything that needs it`);

    // Only the two modules that reach nothing are imported statically. Asserting the list rather
    // than the absence of `node:sqlite` catches the case that actually happens: a new static import
    // of some module that innocently imports the database three levels down.
    const statics = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    assert.deepEqual(statics.sort(),
      ['../src/server/node-floor.ts', '../src/server/warnings.ts'],
      `${where} statically imports only the modules that reach no database`);

    // The cast is TypeScript's, not a change of behaviour: `catch` binds `unknown` under `strict`,
    // so the five files that used to write `${error.message}` now write `${(error as Error).message}`
    // and print exactly what they printed before.
    assert.match(source,
      /catch[\s\S]*?process\.stderr\.write\(`\$\{\(error as Error\)\.message\}\\n`\)/,
      `${where} puts the refusal on stderr, where it cannot be read as protocol`);

    const exit = source.match(/catch[\s\S]*?process\.exit\((\d+)\)/)?.[1];
    assert.ok(exit && Number(exit) !== 0, `${where} exits non-zero after refusing, not ${exit}`);
  }
});

// --- must NOT: a dependency on the repository this was forked from --------------------------------

test('nothing ties this repository back to the marketplace it was forked from [unit]', () => {
  const manifest = packageManifest();

  // A package dependency. Asserted as *empty* rather than as "does not name dpm", because the
  // fork's whole claim is that it installs nothing — a rule stated that way needs no list.
  // **Story 1 asserted both maps empty; story 2 narrowed it, and the narrowing is the honest
  // reading of this criterion rather than a concession.** What must NOT exist is a dependency on
  // the *marketplace repository* — a package, a git reference, or a copy script pointing at it.
  // Emptiness was the strongest available statement of that while dpm installed nothing at all;
  // once ENVR3 required a type checker, emptiness stopped being a claim about the marketplace and
  // started being a claim about TypeScript. `unsanctionedDependencies` is the surviving one.
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'no runtime package dependency');
  assert.deepEqual(unsanctionedDependencies(manifest), [],
    'and nothing for development but the type checker — certainly nothing named for the fork source');

  // A git or copy-script dependency, which would show up as a script reaching outside the tree.
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    assert.doesNotMatch(script, /ninthspace-marketplace|\.claude\/plugins|git clone|\.\.\/\.\./,
      `scripts.${name} reaches outside this repository`);
  }

  // And nothing in the sources reads from the marketplace checkout. Two exclusions, both on the
  // same principle — a sweep that cannot tell the statement of a rule from a breach of it reports
  // the rule. `tests/corpus-snapshot/` is a frozen copy of the source project's own planning
  // corpus, so its prose is data this repository stores rather than a path it follows; and this
  // file states the rule, so it necessarily contains the string. `withoutComments` cannot rescue
  // the second, because the string is in the pattern below rather than in a comment.
  const corpus = ['src', 'bin', 'skills', 'shared', 'hooks']
    .flatMap((directory) => filesUnder(join(ROOT, directory)))
    .concat(moduleFilesUnder(join(ROOT, 'tests'))
      .filter((path) => !path.includes('/corpus-snapshot/') && path !== import.meta.filename))
    .map((path) => ({ name: path.slice(ROOT.length + 1), text: readFileSync(path, 'utf8') }));

  const reaching = corpus
    .filter(({ text }) => /ninthspace-marketplace/.test(withoutComments(text)))
    .map(({ name }) => name);

  assert.deepEqual(reaching, [], 'no source names the marketplace checkout');

  // **The controls, because an empty finding is the cheapest thing a sweep can produce.** The first
  // says the sweep read a corpus at all; the second says it reads content and not just names, by
  // finding a string that is genuinely in there.
  assert.ok(corpus.length > 200, `the sweep read ${corpus.length} files`);
  assert.ok(corpus.some(({ text }) => text.includes('assertNodeFloor')),
    'and read their contents, since a string known to be present was found');
});
