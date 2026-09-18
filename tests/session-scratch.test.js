/**
 * Epic 01-04 Story 3 — session scratch, and where it is not (FR9, ENVR11).
 *
 * FR9 asks that anything which was per-session scratch keyed by an environment variable move to
 * `ctx.storage`, unless a database `session` row already answers it, and that no transient file
 * land in the project tree.
 *
 * **The audit found nothing to move, and that answer is the reason this file is careful.** A
 * criterion whose antecedent is empty is satisfied by doing nothing, and "no per-session scratch
 * was keyed by an environment variable" is exactly the shape that passes without anyone checking:
 * a sweep that read no files, a regex that stopped matching, and a genuine absence are three
 * different facts wearing one empty array. So the reading below **enumerates** what the plugin
 * reads from the environment rather than asserting a negative — the set is named, each member is
 * classified, and a new variable arriving fails here until somebody says which kind it is.
 *
 * The classification, as of this story:
 *
 * - `DPM_READ_ONLY` (`src/server/read-only.ts`) — a launch mode, resolved once by `main` and passed
 *   down. Configuration supplied by whoever starts the server, not state dpm keeps between calls.
 * - `DPM_DATABASE` (`src/db/location.ts`) — a path override, read at module load because it is a
 *   process-level setting; re-reading per call would let one run open two databases.
 *
 * Neither is per-session and neither is scratch, and the per-session state dpm *does* keep is the
 * `session` table — rows written by `create_session` and `update_session`, which is the answer the
 * criterion explicitly exempts. So `ctx.storage` has no caller, and that is a finding rather than
 * an omission. `ctx.storage` itself exists — the SDK's `StorageDomain` carries `get`, `set`,
 * `remove` and `scan` — so the criterion names a mechanism that is there, which is worth having
 * checked before concluding anything about it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { initRepository } from './support/git.js';
import { ownedDirectory } from './support/scratch.js';
import { pluginSources, withoutComments } from './support/sources.js';
import { fullCorpus } from './support/corpus.js';
import { IGNORE_FILE, writeIgnore } from '../src/server/ignore.ts';
import { MARKER_PATH } from '../src/sync/marker.ts';
import { DUMP_PATH } from '../src/guard/index.ts';
import { start } from '../src/start.ts';
import { spineTools } from '../src/tools/index.ts';

const ROOT = join(import.meta.dirname, '..');
const PUBLISH = join(ROOT, 'bin', 'dpm-publish.ts');

/**
 * Every environment variable the plugin reads, by name.
 *
 * Both spellings, because a module that reached for `process.env['DPM_THING']` would be invisible
 * to the dotted form and is the same read. Comments are stripped first: `warnings.ts` names
 * `NODE_NO_WARNINGS` in prose explaining why it is *not* set, and a sweep that counted that would
 * report a variable nothing reads.
 */
function environmentReads() {
  const PATTERNS = [/process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[\s*['"`]([^'"`]+)/g];

  return [...new Set(pluginSources().flatMap(({ text }) => {
    const source = withoutComments(text);

    return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map(([, name]) => name));
  }))].sort();
}

/**
 * What each variable is, and why it is not per-session scratch.
 *
 * Written here rather than derived, because the judgement is the point — a variable's *name* says
 * nothing about whether it holds state between calls. What is checked mechanically is that the set
 * of names and the set of judgements are the same set.
 */
const CLASSIFIED = {
  DPM_READ_ONLY: 'a launch mode, resolved once at bring-up and passed down',
  DPM_DATABASE: 'a path override, read at module load as a process-level setting',
  // Read once where `read_shared_document` is built, checked against the overlays on disk, and
  // thereafter a constant for the life of the process. It carries no state between calls and
  // nothing writes it back — which is what makes it a launch-time choice like the other two rather
  // than scratch. A profile that varied per session would be a different mechanism entirely: the
  // advice would stop being a property of how the server was started and become something a run
  // could change about itself mid-flight, which is the thing an overlay must never be.
  DPM_PROFILE: 'a launch-time choice of advice overlay, resolved once when the tool is built',
};

// --- Criterion 1: nothing was per-session scratch keyed by an environment variable --------------

test('every environment variable the plugin reads is classified, and none is session scratch [unit]', () => {
  const read = environmentReads();

  // **The control comes first, and it is the whole defence against a vacuous pass.** An empty
  // reading would satisfy every assertion below; the sweep has to be shown to find something.
  assert.ok(read.length > 0, 'the sweep found no environment reads at all, so it read nothing');
  assert.ok(pluginSources().length > 50,
    `the sweep walked ${pluginSources().length} files, which is not this package`);

  assert.deepEqual(read, Object.keys(CLASSIFIED).sort(),
    'the plugin reads an environment variable this story never classified — decide whether it is '
    + 'per-session scratch, and if it is, ctx.storage is where it goes');

  // And the reading is a reading rather than a constant: the same patterns over a planted source
  // find a planted name, and over prose naming one find nothing.
  const planted = [
    { name: 'planted.ts', text: 'const x = process.env.DPM_PLANTED;' },
    { name: 'bracket.ts', text: "const y = process.env['DPM_BRACKETED'];" },
    { name: 'commented.ts', text: '// process.env.DPM_IN_A_COMMENT is not read\nexport const z = 1;' },
  ];
  const found = planted.flatMap(({ text }) => [
    ...withoutComments(text).matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g),
    ...withoutComments(text).matchAll(/process\.env\[\s*['"`]([^'"`]+)/g),
  ].map(([, name]) => name));

  assert.deepEqual(found.sort(), ['DPM_BRACKETED', 'DPM_PLANTED'],
    'the reading misses one of the two forms, or counts a name that only appears in a comment');
});

test('the per-session state dpm keeps is a database row, which is why storage has no caller [unit]', () => {
  // **The criterion's exemption, asserted rather than assumed.** "Where a database session row is
  // not already the answer" is only a defence if there *is* such a row, and if the tools that
  // write it are the ones a skill calls. Without this the conclusion "nothing to move" rests on
  // the environment sweep alone, which would be equally empty in a release that had lost sessions
  // altogether.
  const db = start(':memory:').db;

  try {
    const names = spineTools(db).map((tool) => tool.name);

    for (const tool of ['create_session', 'update_session', 'read_session', 'adopt_session']) {
      assert.ok(names.includes(tool), `${tool} is gone, so session state is no longer a row`);
    }

    const call = Object.fromEntries(spineTools(db).map((tool) => [tool.name, tool.handler]));
    const made = call.create_session({ id: 'a-harness-session', skill: 'dpm:do', phase: 'startup' });

    assert.equal(made.id, 'a-harness-session');

    // The part that makes it scratch's replacement rather than merely a row: it carries a blob the
    // skill defines, which is what a `ctx.storage` value would have held.
    call.update_session({ id: made.id, phase: 'story 2', state: '{"carried":true}' });
    assert.equal(JSON.parse(call.read_session({ id: made.id, include_body: true }).state).carried,
      true, 'a session row does not carry state, so it is not the answer the criterion exempts');
  } finally {
    db.close();
  }
});

// --- Criterion 2 and 3: a first run writes into .dpm/, and leaves nothing loose -----------------

/** A fresh git repository with dpm's first-run writes performed, as `open()` performs them. */
function freshProject(t) {
  const root = ownedDirectory(t, 'dpm-session-scratch-');
  const git = initRepository(root);
  const location = join(root, '.dpm', 'dpm.db');

  // Through the shipped writer rather than a transcribed pattern, so the fixture cannot drift from
  // what the server does on a first tool call: the directory, the ignore file, then the database.
  execFileSync('mkdir', ['-p', join(root, '.dpm')]);
  writeIgnore(join(root, '.dpm'));

  const { db } = start(location);

  t.after(() => db.close());

  return {
    root,
    git,
    db,
    location,
    call: Object.fromEntries(spineTools(db).map((tool) => [tool.name, tool.handler])),
  };
}

/** Every file under `root`, repo-relative, excluding `.git/` — which is git's and not dpm's. */
function filesIn(root) {
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.name === '.git') return [];

    return entry.isDirectory() ? walk(path) : [relative(root, path)];
  });

  return walk(root).sort();
}

test('a first run creates the database under .dpm/, and a publish writes the dump [integration]', async (t) => {
  const repo = freshProject(t);

  assert.equal(existsSync(repo.location), true, 'the first run created no database');
  assert.equal(existsSync(join(repo.root, DUMP_PATH)), false,
    'the dump exists before anything published, so the assertion below proves nothing');

  fullCorpus(repo.db, repo.call);

  execFileSync(process.execPath, [PUBLISH, repo.root], { encoding: 'utf8' });

  assert.equal(existsSync(join(repo.root, DUMP_PATH)), true, 'the publish wrote no dump');

  // **Rewritten, not merely written.** The criterion says a subsequent publish rewrites it, and a
  // publish that wrote once and no-oped afterwards would satisfy the line above forever.
  const first = readFileSync(join(repo.root, DUMP_PATH), 'utf8');

  repo.call.create_spec({ slug: 'later', title: 'A spec added after publishing' });
  execFileSync(process.execPath, [PUBLISH, repo.root], { encoding: 'utf8' });

  const second = readFileSync(join(repo.root, DUMP_PATH), 'utf8');

  assert.notEqual(second, first, 'a second publish left the dump exactly as it was');
  assert.match(second, /later/, 'the rewritten dump does not hold the row that caused the rewrite');
});

test('must NOT — a transient file lands in the project tree [integration]', async (t) => {
  const repo = freshProject(t);

  fullCorpus(repo.db, repo.call);
  execFileSync(process.execPath, [PUBLISH, repo.root], { encoding: 'utf8' });

  // Everything on disk after a full first run, split by what git would carry. A file is acceptable
  // when it is generated *and committed* — the projection and the dump, which are artefacts — or
  // when it is ignored, which is what "not in the project tree" means for something machine-local.
  const isIgnored = (path) => {
    try {
      execFileSync('git', ['check-ignore', '-q', path], { cwd: repo.root });

      return true;
    } catch {
      return false;
    }
  };

  const present = filesIn(repo.root);

  assert.ok(present.length > 10, `only ${present.length} files after a full run — nothing was read`);

  const loose = present.filter((path) => !isIgnored(path)
    && !path.startsWith('docs/')
    && path !== DUMP_PATH
    && path !== join('.dpm', IGNORE_FILE));

  assert.deepEqual(loose, [],
    'a file dpm wrote is neither a committed artefact nor ignored, so it would arrive in a commit');

  // **The controls, because an empty `loose` has two boring explanations.** The reading has to find
  // the ignored files it is excusing, and `check-ignore` has to be capable of answering false.
  assert.ok(present.includes(MARKER_PATH),
    `the sync marker is not on disk, so its exclusion above excused nothing: ${present.join(', ')}`);
  assert.equal(isIgnored(MARKER_PATH), true,
    'the sync marker is not ignored, and it is machine-local state that must never be committed');
  assert.equal(isIgnored(DUMP_PATH), false,
    'the dump is ignored, so the reading cannot tell a committed artefact from a hidden one');

  // **And the planted breach, which is what makes the empty array above an observation.** The
  // shape being ruled out is a per-session file written beside the work — the `.local.md` a stop
  // hook kept under Claude Code — so that is what is planted. Nothing under test wrote it; the
  // reading has to report it anyway, or it would have reported nothing about a tree that had one.
  writeFileSync(join(repo.root, 'dpm-loop.local.md'), 'iteration 3\n', 'utf8');

  const withPlanted = filesIn(repo.root).filter((path) => !isIgnored(path)
    && !path.startsWith('docs/')
    && path !== DUMP_PATH
    && path !== join('.dpm', IGNORE_FILE));

  assert.deepEqual(withPlanted, ['dpm-loop.local.md'],
    'a transient file was planted in the project tree and the reading did not report it');
});
