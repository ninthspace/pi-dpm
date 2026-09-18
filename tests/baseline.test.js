/**
 * Epic 49-01 Story 6 — the baseline this spec's environment clauses assert (NFR2, ENV1–2,
 * ENVX1–3).
 *
 * **Six criteria, and none of them is about a feature.** They are the properties that make dpm
 * installable by copying a directory and runnable by a plugin host: no dependency to fetch, no
 * environment variable to set, nothing written outside `.dpm/` and what the publish owns, and no
 * `git` on the server's path. Each holds today, and each would be cheap to lose in a change aimed
 * at something else — which is the only reason to spend tests on them.
 *
 * **Every sweep here is checked twice: on the tree, and on a planted source it must complain
 * about.** A sweep that returns no complaints is indistinguishable from one whose pattern stopped
 * matching or whose file walk returned nothing, and the tree cannot tell the two apart because it
 * passes either way. The planted input is what makes the empty answer mean something, and the
 * `examined` floor beside it is what catches the walk that looked at nothing at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from './support/database.js';
import {
  lifecycleScripts, packageManifest, sweepSourcesUnder, unsanctionedDependencies,
} from './support/sources.js';
import {
  auditEnvironment, auditImports, auditReach, auditWrites, importGraph, withoutComments,
} from './support/sweeps.js';
import { FTS5, hasFts5 } from '../src/db/capability.ts';
import { assertNodeFloor, meetsFloor, REQUIRED_NODE } from '../src/server/node-floor.ts';

const ROOT = join(import.meta.dirname, '..');

/** Every source under a directory, as the sweeps take them: repo-relative name, and text. */
const sourcesUnder = (...parts) => sweepSourcesUnder(join(ROOT, ...parts));

// --- The comment stripper the other sweeps rest on ----------------------------------------------

test('the comment stripper removes prose and leaves regular expressions alone [unit]', () => {
  // **Asserted before anything that uses it, because every sweep below is only as sound as this.**
  // A stripper that ate a regex literal would delete code the sweeps then report clean; one that
  // missed a block comment would complain about prose. Both are silent in a green suite.
  const source = [
    '/** process.env.DOCUMENTED is named here in prose. */',
    '// process.env.ALSO_PROSE',
    "const pattern = /https:\\/\\/example.invalid/;",
    'const real = process.env.DPM_DATABASE;',
  ].join('\n');

  const code = withoutComments(source);

  assert.ok(!code.includes('DOCUMENTED'), 'a block comment survived');
  assert.ok(!code.includes('ALSO_PROSE'), 'a whole-line comment survived');
  assert.ok(code.includes("/https:\\/\\/example.invalid/"), 'a regular expression was damaged');
  assert.ok(code.includes('process.env.DPM_DATABASE'), 'the code was stripped along with the prose');
});

// --- NFR2: the environment is read for the names that are sanctioned, and no others ---------------

/**
 * Every environment variable dpm is allowed to read, with the requirement that sanctions it.
 *
 * `DPM_DATABASE` is AD4's override. `DPM_READ_ONLY` is spec 48's AD1: the board observes projects
 * it does not own, and the mode that makes observing inert has to reach the server somehow.
 * `DPM_PROFILE` names the advice overlay `read_shared_document` appends — the seam that keeps
 * model-specific guidance out of the skill bodies, and the server is a spawned process, so the
 * environment is the one channel a host-independent registration can reach it through. All three
 * are optional — NFR2's clause is that dpm needs *no* variable set, not that it reads none — and a
 * fourth name arriving without a requirement behind it is what this list exists to stop.
 */
const SANCTIONED = ['DPM_DATABASE', 'DPM_READ_ONLY', 'DPM_PROFILE'];

test('process.env is read in src/ only for the sanctioned names [unit]', () => {
  const sources = sourcesUnder('src');
  const { complaints, examined } = auditEnvironment(sources, { allowed: SANCTIONED });

  assert.deepEqual(complaints, []);

  // **A floor became an exact count, and the change is a strengthening rather than a relaxation.**
  // This used to require four or more reads, because the server, the merge, the publish and the
  // guard entry points each defaulted `DPM_DATABASE` themselves — the floor's job being to catch a
  // sweep that had stopped seeing them. Epic 49-04 collected the four into `src/db/location.js`,
  // which makes the honest number one per name, and that is a claim worth asserting directly:
  // *each sanctioned variable is read in exactly one place, and here they are*. An entry point
  // that spelled either default by hand now fails here, which is precisely what the old floor
  // could not do.
  //
  // What proves the sweep is looking is no longer the count but the three planted controls below,
  // run through the real implementation.
  const readers = sources
    .filter(({ text }) => /process\.env/.test(withoutComments(text)))
    .map(({ name }) => name);

  // **The file list and the count are asserted together, and neither alone would do.** A module
  // that took `env = process.env` as a parameter and indexed it by an exported constant would
  // appear in this list and contribute nothing to the count, which is a read of the environment
  // that the sweep cannot attribute to any name — the computed-key hole one step removed. Equal
  // numbers is what says every reader here is a reader the sweep could actually read.
  assert.deepEqual(readers, ['src/db/location.ts', 'src/server/read-only.ts', 'src/tools/shared.ts'],
    'the environment is read somewhere other than the modules that exist to read it');
  assert.equal(examined, SANCTIONED.length,
    `the sweep counted ${examined} reads across ${readers.length} files`);
  assert.equal(readers.length, SANCTIONED.length,
    'a module reads the environment in a form the sweep cannot attribute to a name');
  assert.ok(sources.length > 50, `only ${sources.length} sources were walked`);

  // **The planted controls, run through the real sweep.** Two shapes, because they fail
  // differently: a named variable this requirement did not sanction, and a computed key no static
  // check can follow. The second is the one a reader would not think to plant.
  const named = auditEnvironment([{ name: 'planted.js', text: 'const t = process.env.CI;' }],
    { allowed: SANCTIONED });

  assert.deepEqual(named.complaints, ['planted.js reads process.env.CI']);

  const computed = auditEnvironment([{ name: 'planted.js', text: 'const t = process.env[name];' }],
    { allowed: SANCTIONED });

  assert.equal(computed.complaints.length, 1, 'a computed environment read was not complained about');

  // And the sweep does not complain about the names it exists to permit, which is the half a check
  // that complained about everything would also satisfy.
  assert.deepEqual(
    auditEnvironment(
      SANCTIONED.map((name) => ({ name: 'planted.js', text: `const t = process.env.${name};` })),
      { allowed: SANCTIONED },
    ).complaints,
    [],
  );
});

// --- ENVX1: nothing to install --------------------------------------------------------------------

test('no import in src/ or bin/ resolves outside node: builtins and this tree [unit]', () => {
  const sources = [...sourcesUnder('src'), ...sourcesUnder('bin')];
  const { complaints, examined } = auditImports(sources);

  assert.deepEqual(complaints, []);

  // The floor, and it is a large number on purpose: this tree is import-heavy, and a sweep finding
  // a handful has matched the first file and stopped.
  assert.ok(examined >= 200, `only ${examined} imports were examined, so the sweep is not looking`);

  // Planted: a bare specifier is the thing a marketplace install would have to fetch.
  assert.deepEqual(
    auditImports([{ name: 'planted.js', text: "import { z } from 'zod';" }]).complaints,
    ['planted.js imports zod, which is neither a node: builtin nor relative'],
  );

  // And both permitted shapes pass, so the rule is not "complain about every import".
  assert.deepEqual(
    auditImports([{ name: 'planted.js', text: "import a from 'node:fs';\nimport b from './b.js';" }]),
    { complaints: [], examined: 2 },
  );
});

// --- ENV1: no install step ------------------------------------------------------------------------

test('the suite runs from a clean checkout with no install step [integration]', () => {
  const manifest = packageManifest();

  // **The claim narrowed when TypeScript arrived, and `SANCTIONED_DEV_DEPENDENCIES` is where the
  // narrowing is argued.** This used to assert both maps empty. ENVR3 requires `tsc --noEmit` to
  // run from `devDependencies`, so emptiness is now false on purpose; what survives is that
  // nothing installs at runtime and nothing unsanctioned installs at all.
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(unsanctionedDependencies(manifest), []);

  // **The maps being empty is not the whole claim.** A `prepare`, `preinstall` or `build` script
  // is an install step that no dependency map records, and it would run on every clone. Read
  // through `lifecycleScripts` since four suites asked this with a loop each and the four lists
  // disagreed — this one missed `prepublish`.
  assert.deepEqual(lifecycleScripts(manifest), [],
    'package.json declares a script that runs at install or pack time');

  // **What replaced the `node_modules` check, and why it is a better claim rather than a weaker
  // one.** This used to assert the directory was absent, reading its own run as the clean checkout.
  // A repository whose type check installs a compiler has one, so that reading is gone — but the
  // criterion was never about the directory. It is about `npm test` needing no install, and the
  // way to say so is that the runner is Node's own and no source reaches anything installed. The
  // second half is asserted over `src/` in `server.test.js`; the first is here.
  assert.equal(manifest.scripts?.test, 'node --test',
    'the runner is the one built into Node, so a clean clone can run the suite as it stands');
  assert.equal(manifest.scripts?.typecheck, 'tsc --noEmit',
    'and the type check is a separate command, which is what keeps the install off the test path');
});

// --- ENV2: the runtime dpm is standing on ---------------------------------------------------------

test('the Node floor check and the FTS5 probe both pass in development [unit]', (t) => {
  // The floor, against the interpreter actually running this. `assertNodeFloor` throws below the
  // floor, so calling it is the assertion.
  assert.doesNotThrow(() => assertNodeFloor());
  assert.equal(meetsFloor(process.versions.node), true,
    `this runtime is ${process.versions.node}, below dpm's floor of ${REQUIRED_NODE}`);

  // The control: the check can say no. A floor that accepted everything would pass the line above
  // on any interpreter, including the ones AD5 chose `node:sqlite` in spite of.
  assert.equal(meetsFloor('22.4.0'), false, 'the floor accepts a version below it');
  assert.throws(() => assertNodeFloor('20.0.0'), new RegExp(REQUIRED_NODE));

  // FTS5, probed behaviourally on a real connection — the probe creates the virtual table rather
  // than reading a compile option, because a flag set is not a module registered.
  assert.equal(hasFts5(openDatabase(t)), true,
    `the SQLite behind ${process.execPath} has no ${FTS5}, so every prose table's triggers would fail`);
});

// --- ENVX2: nothing written outside .dpm/ and what the publish owns --------------------------------

test('every writer in src/ is declared, with the root it may write under [unit]', () => {
  // **The roots are documentation; the membership is what is checked here.** Each of these is held
  // to its root by its own suite — `publish.test.js` compares every byte it wrote against what
  // `project()` returned, `projection.test.js` runs the ignore writer against a directory it owns,
  // `merge.test.js` drives the staging rename, `restore-on-create.test.js` drives the restore and
  // its undo, `marker.test.js` writes the marker and reads it back through git, `guard-fix.test.js`
  // drives the one verdict on which the guard writes at all. What no other test asks is whether the
  // list is still the whole list, and that is this one's question.
  const DECLARED = {
    'src/projection/index.ts': 'the root it is handed — `docs/` in every real call',
    'src/publish/index.ts': '`docs/` and `.dpm/dpm.sql` (AD11)',
    'src/rebuild/index.ts': '`.dpm/`, for the staging database and the rename into place (AD16)',
    'src/server/index.ts': '`.dpm/`, which it creates on the first tool call',
    'src/server/from-dump.ts': 'the database path it is handed, and only to undo a failed restore',
    'src/server/ignore.ts': '`.dpm/`, for the ignore file (AD15)',
    'src/sync/marker.ts': '`.dpm/`, for the sync marker (AD13)',
    'src/guard/index.ts': '`.dpm/`, for the sync marker on adoption only (AD13)',
  };

  const sources = sourcesUnder('src');
  const { complaints, examined } = auditWrites(sources, DECLARED);

  assert.deepEqual(complaints, []);
  assert.equal(examined, sources.length);
  assert.ok(examined > 50, `only ${examined} sources were walked`);

  // Planted, in both directions — an undeclared writer, and a declaration nothing backs. The second
  // is how an allow-list outlives the module it was written for and quietly becomes a blank cheque.
  assert.deepEqual(
    auditWrites([{ name: 'planted.js', text: 'writeFileSync(target, text);' }], {}).complaints,
    ['planted.js writes to the filesystem and declares no root'],
  );
  assert.deepEqual(
    auditWrites([{ name: 'quiet.js', text: 'const x = 1;' }], { 'quiet.js': 'nowhere' }).complaints,
    ['quiet.js is declared as a writer and writes nothing'],
  );
});

test('the README documents no step that writes a file the user owns [unit]', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const steps = [...readme.matchAll(/^\*\*(\d+)\. /gm)].map((match) => Number(match[1]));

  // Two, and the count is the assertion: ENVX2's clause is that dpm does not make the user edit a
  // file they own, and the way that clause fails is a *third* step appearing that asks them to.
  // Story 4 removed the one there was — the ignore line — by having the server write it instead.
  assert.deepEqual(steps, [1, 2], `the README's first run has ${steps.length} steps`);

  // And neither of them appends to anything. The symlink step creates a file inside `.git/hooks/`,
  // which is not a file the user authored; an `>>` is an edit to one that is.
  assert.doesNotMatch(readme, />>\s*\S*\.gitignore/, 'the README appends to a .gitignore');
});

// --- ENVX3: git is not a runtime dependency of the server -----------------------------------------

test('the static import graph from bin/dpm-mcp.ts reaches no node:child_process [unit]', () => {
  const entry = join(ROOT, 'bin', 'dpm-mcp.ts');
  const { complaints, examined } = auditReach(entry, 'node:child_process');

  assert.deepEqual(complaints, []);

  // **The floor, and it is the assertion that matters most here.** `bin/dpm-mcp.ts` reaches the
  // server through `await import()` — deliberately, so the Node floor check runs first — so its
  // *static* graph is small, and a walker that stopped at the entry point would report a clean
  // graph over one file. This is the number that says the walk went somewhere.
  assert.ok(examined >= 3, `the walk covered ${examined} files, which is not a graph`);

  // **The control, taken from `src/merge/main.js` rather than from `bin/dpm-merge.ts`.** Every
  // entry point under `bin/` reaches its logic through `await import()`, so every one of their
  // static graphs is the same three files and none of them reaches git — including the merge tool,
  // which runs `git` on every invocation. That is the shape this walker is blind to by design, and
  // naming it here is what stops the clean answer above from being read as more than it is: the
  // check defends the *hoisting* order the Node floor depends on, and the module that genuinely
  // imports git is the one that proves the walker can see it.
  const merge = auditReach(join(ROOT, 'src', 'merge', 'main.ts'), 'node:child_process');

  assert.deepEqual(merge.complaints, [
    `${join(ROOT, 'src', 'merge', 'main.ts')} imports node:child_process, reachable statically `
    + `from ${join(ROOT, 'src', 'merge', 'main.ts')}`,
  ]);

  // And the server's own graph — the one that fills in as `src/server/` grows — is clean too. This
  // is the assertion with teeth once `bin/dpm-mcp.ts`'s dynamic import is followed by a reader
  // rather than by this walker.
  assert.deepEqual(auditReach(join(ROOT, 'src', 'server', 'index.ts'), 'node:child_process').complaints, []);
});

test('the import graph walk follows relative edges rather than stopping at the entry [unit]', () => {
  // The graph walk underneath every reach check, asserted directly and on a graph deep enough to
  // have somewhere to go: `src/server/index.js` reaches the whole tool layer and the database
  // connection, none of it named in the file itself.
  const { files, edges } = importGraph(join(ROOT, 'src', 'server', 'index.ts'));

  assert.ok(files.length > 10, `the walk covered ${files.length} files, which is not this graph`);
  assert.ok(files.some((file) => file.endsWith(join('src', 'db', 'connection.ts'))),
    'the walk never reached the connection module, which is three edges away');

  // Every file is walked once however many modules import it — a diamond in the graph would
  // otherwise be walked twice and inflate every floor asserted on `examined`.
  assert.equal(new Set(files).size, files.length, 'a file was walked twice');
  assert.ok(edges.length >= files.length, 'fewer edges than files, so the walk recorded nothing');
});
