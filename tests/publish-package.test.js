/**
 * Epic 01-05 Story 1 — the packed tarball carries what a registered skill needs (FR1).
 *
 * **This is not about npm the registry.** The epic defers publishing, on FR1's own wording — the
 * requirement names `opencode2 plugin add github:ninthspace/opencode-dpm` first and reserves the
 * npm form for *later*, and the reasoning is on the epic as *Why this epic no longer publishes to
 * npm*. What is checked here is the **tarball an installer builds from this repository**, which is
 * what a user receives by the documented command; `npm pack` is the way to obtain it locally, and
 * that is the whole of npm's part in this file.
 *
 * **The tarball is packed rather than predicted.** `files` is an allow-list supplemented by rules
 * of the packer's own — `package.json` and `README.md` go in whatever the field says, `.git` and
 * `node_modules` stay out however the field is written — so a check that read the manifest and
 * reasoned about what *would* be packed would be asserting a model of the packer. The pack is run
 * and the artefact it produces is opened, which is the discipline retro 02 recorded for the v0.7.0
 * parity work: when there is a real artefact, do not compare the code to itself.
 *
 * **The contents are held against named sets, not looped over.** A `files` field that stopped
 * matching would leave every `for` loop below iterating nothing and reporting clean — the false
 * pass this project keeps rediscovering, and the one a `deepEqual` against an expected set has twice
 * been the only defence against. So the skills are compared against `discoverSkills`, the
 * executables against `EXECUTABLES`, and the plugin entry against what `exports` names.
 *
 * **The must-NOT has a control, and the control is the shipped code.** The extracted package is
 * handed to the code that reads it at runtime, and then a `shared/` document is deleted from it and
 * the same call must refuse. An absence is only an observation when something was watching, and
 * here the thing watching ships to users.
 *
 * **Epic 02-03 changed which shipped code that is, and made the check matter more.** It used to be
 * `resolveSupportingPaths`, which threw at *registration* when a skill named a `shared/` document
 * the package did not hold — so a tarball missing those files failed loudly on load. That rewrite
 * is gone: the shared documents are served by `read_shared_document`, read out of the package when
 * a skill asks for them. A tarball missing `shared/` now loads perfectly and fails on the first
 * call of every session, which is later and quieter, so the check moves to the tool.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ownedDirectory } from './support/scratch.js';
import { EXECUTABLES, packageManifest } from './support/sources.js';
import { discoverSkills } from '../src/plugin/skills.ts';
import { sharedDocumentTools } from '../src/tools/shared.ts';

const ROOT = join(import.meta.dirname, '..');

/** What npm names the directory inside every tarball it makes. */
const PACKED = 'package';

/**
 * `npm pack` into a scratch directory, extracted, with its file list.
 *
 * The tarball is made for real rather than with `--dry-run`, because two of the checks below need
 * to *open* it: a listing answers what shipped, and only an extracted tree answers whether the
 * thing that shipped still works. `--pack-destination` keeps the artefact out of the checkout, so a
 * crashed run cannot leave a `.tgz` where the guard would see it.
 *
 * @param {import('node:test').TestContext} t Owns the directory's removal.
 * @returns {{root: string, files: string[]}} The extracted package root, and its paths relative to it.
 */
function packed(t) {
  const scratch = ownedDirectory(t, 'dpm-pack-');

  // `stderr` is ignored rather than inherited: npm writes a `notice` line per packed file, and 166
  // of them in the middle of a test run bury every other result.
  const [tarball] = execFileSync('npm', ['pack', '--pack-destination', scratch], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().split('\n').slice(-1);

  execFileSync('tar', ['-xzf', join(scratch, tarball)], { cwd: scratch });

  const root = join(scratch, PACKED);
  const files = execFileSync('tar', ['-tzf', join(scratch, tarball)], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.startsWith(`${PACKED}/`) && !line.endsWith('/'))
    .map((line) => line.slice(PACKED.length + 1))
    .sort();

  return { root, files };
}

/** The top-level entry each packed path sits under — the shape `files` actually controls. */
const topLevel = (files) => [...new Set(files.map((path) => path.split('/')[0]))].sort();

// --- The manifest can publish at all ----------------------------------------------------------

test('the manifest declares pi-dpm at 0.1.0 and nothing marks it private [unit]', () => {
  const manifest = packageManifest();

  assert.equal(manifest.name, 'pi-dpm');
  assert.equal(manifest.version, '0.1.0', 'the story ships 0.1.0');

  // **`private` is not a field to get right — it is a field that must not be there.** It arrived
  // with the vendoring commit as scaffolding rather than as a decision, and it is the difference
  // between a package that can be distributed and one that cannot, whatever the route.
  assert.equal(Object.hasOwn(manifest, 'private'), false,
    'package.json is marked private, which blocks distribution');

  // The install the README documents is a GitHub specifier, so the manifest naming that repository
  // is the one place the package itself says where it came from.
  assert.match(manifest.repository?.url ?? '', /github\.com\/[\w.-]+\/pi-dpm/,
    'the manifest names no repository, so the package does not say where it came from');
});

test('neither files nor exports names a build output [unit]', () => {
  const manifest = packageManifest();
  const named = [...manifest.files, ...Object.values(manifest.exports)];

  assert.ok(named.length >= 6, `the reading found ${named.length} named paths, which is not this manifest`);

  // **The property, and why it is the right one.** NFR2 says there is no build step, so nothing
  // either field names may be generated — and the strongest available evidence that a path is not
  // generated is that git tracks it. A `dist/` would be ignored and absent from this list however
  // plausible the name looked.
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean));
  const untracked = named.filter((path) => {
    const clean = path.replace(/^\.\//, '').replace(/\/$/, '');

    return !tracked.has(clean) && ![...tracked].some((file) => file.startsWith(`${clean}/`));
  });

  assert.deepEqual(untracked, [],
    'files or exports names a path git does not track, which is what a build output looks like');

  // **The control on that reading**, since an empty result is also what a reading that resolved
  // nothing returns. A planted build directory has to be caught.
  const planted = ['dist/', 'build/lib.js'].filter((path) => {
    const clean = path.replace(/\/$/, '');

    return !tracked.has(clean) && ![...tracked].some((file) => file.startsWith(`${clean}/`));
  });

  assert.deepEqual(planted, ['dist/', 'build/lib.js'], 'the reading cannot tell an untracked path from a tracked one');
});

// --- Criterion 2: what the tarball contains ---------------------------------------------------

test('the packed tarball carries the plugin entry, the skills, shared and the executables [integration]', (t) => {
  const { files } = packed(t);
  const manifest = packageManifest();

  // The plugin entry, taken from `exports` rather than written here — a rename of the entry that
  // updated the manifest and not the package would otherwise pass.
  const entry = manifest.exports['.'].replace(/^\.\//, '');

  assert.ok(files.includes(entry), `the tarball omits the plugin entry ${entry}`);

  // **The skills, against `discoverSkills` rather than against a count.** The registrar is what
  // decides which directories are skills, so comparing the tarball to its answer means a skill
  // added to the tree is either shipped or reported, and never silently one of the two.
  const shipped = files.filter((path) => path.startsWith('skills/') && path.endsWith('/SKILL.md'))
    .map((path) => path.split('/')[1]).sort();

  assert.deepEqual(shipped, discoverSkills(ROOT).map(({ name }) => name).sort(),
    'the skill directories in the tarball are not the ones the plugin registers');
  assert.equal(shipped.length, 23, `${shipped.length} skill directories shipped, and the port has 23`);

  // The five executables, and `shared/`, which is the directory the skills read at startup.
  assert.deepEqual(files.filter((path) => path.startsWith('bin/')).map((path) => path.slice(4)).sort(),
    EXECUTABLES, 'the executables in the tarball are not the five');
  // **Read recursively, because `shared/` stopped being flat.** The advice overlays sit under
  // `shared/advice/<profile>/`, and a non-recursive listing compares `advice` the directory against
  // `advice/opus/skill-conventions.md` the file — two spellings of different things, which is a
  // failure that says nothing. Recursing also makes the claim the stronger one: every overlay ships
  // too, and a profile that reached the tree without reaching the tarball would be a run configured
  // for advice it silently never receives.
  assert.deepEqual(files.filter((path) => path.startsWith('shared/')).map((path) => path.slice(7)).sort(),
    readdirSync(join(ROOT, 'shared'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(join(ROOT, 'shared').length + 1))
      .map((path) => path.replaceAll('\\', '/'))
      .sort(),
    'shared/ did not ship whole');

  // And the hook, which the README's pre-commit-framework entry names by path inside the package.
  assert.ok(files.includes('hooks/pre-commit'), 'the tarball omits the hook the README tells readers to point at');
});

test('the tarball leaves out the corpus, the suite and the Claude Code manifest [integration]', (t) => {
  const { files } = packed(t);

  // **Named, not counted.** The four excluded trees are each excluded for their own reason —
  // `docs/` and `.dpm/` are this repository's planning corpus and say nothing to a user;
  // `tests/` is 230 files and 4MB; `.claude-plugin/plugin.json` is a manifest for a different host,
  // which FR14 puts out of scope for this repository, and shipping it would advertise DPM to
  // Claude Code from inside an OpenCode package.
  assert.deepEqual(topLevel(files), ['README.md', 'bin', 'hooks', 'package.json', 'shared', 'skills', 'src'],
    'the tarball ships something the allow-list was written to keep out');

  // **The control on the reading**, since an absence found by a listing that read nothing looks
  // identical. These four are in the working tree and are what the assertion above is about.
  for (const path of ['docs', 'tests', '.dpm', '.claude-plugin']) {
    assert.ok(readdirSync(join(ROOT, path)).length > 0, `${path}/ is empty, so its exclusion proves nothing`);
  }
});

// --- Criterion 3, must NOT: the tarball omits a file a registered skill needs at runtime -------

test('must NOT — the tarball omits a file a registered skill needs at runtime [integration]', (t) => {
  const { root } = packed(t);

  // **Both halves of the runtime are run against the extracted package**, which is the only reading
  // that answers the criterion. The skills register from it, and the tool every one of their bodies
  // opens by calling serves the shared documents out of it. A tarball that shipped the skills and
  // not their supporting files passes every listing and fails here.
  const registered = discoverSkills(root);

  assert.equal(registered.length, 23, `${registered.length} skills registered from the tarball, and there are 23`);

  const [shared] = sharedDocumentTools({ root });

  for (const name of ['skill-conventions', 'status-model']) {
    assert.ok(shared.handler({ name }).content.length > 1000,
      `the tarball's ${name} came back too short to be the document`);
  }

  // Every registered body asks for the conventions, which is what makes the two halves one check
  // rather than two facts that happen to be true of the same directory.
  assert.deepEqual(
    registered.filter(({ content }) => !content.includes('read_shared_document')).map(({ name }) => name),
    [], 'a skill in the tarball does not call for its conventions, so the tool above serves nobody');

  // **The control, and it is the shipped code rather than a second reading.** Take the supporting
  // document away and the call must refuse — otherwise the pass above says only that nothing was
  // checked. The refusal names what is left, which is how a user with a broken install finds out
  // what their package is missing.
  rmSync(join(root, 'shared', 'skill-conventions.md'));

  assert.throws(() => sharedDocumentTools({ root })[0].handler({ name: 'skill-conventions' }),
    /no shared document is called 'skill-conventions'[\s\S]*status-model/,
    'a package missing a document its skills call for served it anyway, so this check cannot fail');
});
