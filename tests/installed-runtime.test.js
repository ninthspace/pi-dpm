/**
 * The registered MCP command, and the two runtimes that decide it (FR1, FR2).
 *
 * **Written for epic 01-05 story 2, when the install was tried and the server did not start.
 * Rewritten in epic 02-01 story 5, when the fix it recorded turned out to be a fact about the host
 * that epic dropped.** Both halves are kept, because between them they are the whole reason dpm is
 * installed from a checkout rather than as a package, and a reader who finds only the conclusion
 * will re-derive the wrong one.
 *
 * **Half one — Node refuses a `.ts` file under `node_modules`.** `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`,
 * on 22 and on 24, with no flag that lifts it. Both OpenCode majors unpack a plugin under exactly
 * such a directory, so `node bin/dpm-mcp.ts` runs in the checkout and cannot run in an installed
 * package. 01-05 found this the expensive way: the host registered 23 skills from the installed
 * copy and zero tools, with nothing in the interface saying the skills were inert.
 *
 * **Half two — the host's bun has no `node:sqlite`, and this file used to say otherwise.** 01-05
 * answered half one by spawning the host binary in bun mode, and its own fixture preferred a
 * standalone `bun` and fell back to `opencode2` — bun 1.4.0, which does carry `node:sqlite`. The
 * bun compiled into OpenCode v1 1.18.25 is 1.3.14 and does not. So this file was green, on a
 * machine with no standalone bun, against the runtime of the host the project no longer targets;
 * under v1 the same command dies on a missing built-in module while the host blocks waiting for it.
 *
 * That is why test 2 below is a *pair* of controls rather than one. A single reading showing `node`
 * working from the checkout would be satisfied by the arrangement that shipped broken, and a single
 * reading showing bun working would be satisfied by whichever bun this machine happens to have.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { ownedDirectory } from './support/scratch.js';
import { HELLO, repliesFrom, wire } from './support/session.js';
import { runNode } from './support/run-node.js';
import { RUNTIME, localServer } from '../src/plugin/server.ts';
import { SERVER_EXECUTABLE } from '../src/plugin/root.ts';

const ROOT = join(import.meta.dirname, '..');

/** What OpenCode names the directory it installs a plugin package into. */
const INSTALLED = join('node_modules', 'pi-dpm');

/** Where a v1 install puts its CLI. Absent on most machines, which is why every use of it skips. */
const V1_CLI = join(process.env.HOME ?? '', '.opencode', 'bin', 'opencode');

/** What a bun-compiled standalone executable reads to behave as the bun CLI instead of as itself. */
const BE_BUN = 'BUN_BE_BUN';

/**
 * The package, copied to where the host would have put it: under a `node_modules` directory.
 *
 * Only `bin/` and `src/` are copied — 138 files and about 1MB — because they are the whole of what
 * the server executable reaches. `skills/` and `shared/` are the plugin entry's business and
 * `publish-package.test.js` already holds them against the tarball.
 *
 * **A symlink would not do.** Node resolves a module's real path before deciding whether it sits
 * under `node_modules`, so a link pointing back at the checkout would be judged by the checkout's
 * location and the restriction would never fire — the fixture would quietly test nothing.
 *
 * @param {import('node:test').TestContext} t Owns the directory's removal.
 * @returns {string} Absolute path to the planted package root.
 */
function installed(t) {
  const root = join(ownedDirectory(t, 'dpm-installed-'), INSTALLED);

  mkdirSync(root, { recursive: true });

  for (const directory of ['bin', 'src']) {
    cpSync(join(ROOT, directory), join(root, directory), { recursive: true });
  }

  return root;
}

/** Speak the handshake to a command and return what came back. */
const handshake = (command, environment) => {
  const [executable, ...args] = command;

  return execFileSync(executable, args, {
    input: wire([HELLO]),
    encoding: 'utf8',
    env: { ...process.env, ...environment, DPM_DATABASE: undefined },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

// --- What the registration is, and that it starts ------------------------------------------------

test('the registered command is a runtime and a source, and it starts the server [integration]', () => {
  const entry = localServer(ROOT);
  const executable = join(ROOT, SERVER_EXECUTABLE);

  assert.deepEqual(entry.command, [RUNTIME, executable]);

  // **NFR2, asserted as a length.** The defect 01-05 found was fixed by changing which runtime is
  // named; a fix reaching for `--loader` or a compiled `dist/` would have been a build step, and the
  // only argument this command may ever carry is the executable itself.
  assert.equal(entry.command.length, 2, `the command carries an extra argument: ${entry.command.join(' ')}`);
  assert.match(entry.command[1], /\.ts$/, 'the source is spawned directly, with nothing generated from it');

  // And it answers — taken from `localServer` rather than written out, because what is being
  // verified is the registration the host receives. A test composing its own command would confirm
  // that Node works and leave the registration unexamined, which is the gap that let 01-05 ship.
  const [reply] = repliesFrom(handshake(entry.command, {}));

  assert.equal(reply.id, 1, 'the server did not answer the handshake');
  assert.equal(reply.result?.serverInfo?.name, 'dpm', 'something answered, but not dpm');
});

// --- The two closures, each with the reading that would have caught it ----------------------------

test('node refuses the same source once it sits under node_modules [integration]', async (t) => {
  const root = installed(t);

  const refused = await runNode([join(root, SERVER_EXECUTABLE)], wire([HELLO]));

  assert.notEqual(refused.code, 0, 'node ran a .ts file under node_modules, which it does not do');
  assert.match(refused.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/,
    `node failed for some other reason, so this file is guarding the wrong thing:\n${refused.stderr}`);

  // **The control that pins the cause to the path.** The same source in the checkout runs
  // perfectly, so the failure above is not the file being broken, a dependency being absent, or the
  // handshake being malformed. Location is the only variable that moved — and it is why the install
  // dpm documents is a checkout, where this restriction does not apply.
  const accepted = await runNode([join(ROOT, SERVER_EXECUTABLE)], wire([HELLO]));

  assert.equal(accepted.code, 0, `the checkout copy failed too, so location is not the variable:\n${accepted.stderr}`);
  assert.ok(repliesFrom(accepted.stdout)[0]?.result?.serverInfo, 'and it answered the handshake');
});

test('the v1 host runtime cannot run the server, which is why it is not registered [integration]', (t) => {
  // ENVX1: the suite must run without either host CLI, so its absence skips with a reason rather
  // than passing. What the skip costs is stated — the *reason* the bun branch was removed goes
  // unverified here, not the behaviour, which test 1 pins whatever this machine has.
  if (!existsSync(V1_CLI)) {
    t.skip('no OpenCode v1 on this machine, so the runtime that closed the bun route cannot be read here');

    return;
  }

  /** Run one expression in the host's own bun, without throwing on a non-zero exit. */
  const inHostBun = (source) => spawnSync(V1_CLI, ['-e', source], {
    encoding: 'utf8',
    env: { ...process.env, [BE_BUN]: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const missing = inHostBun('await import("node:sqlite")');

  assert.notEqual(missing.status, 0, 'the v1 host runtime imported node:sqlite, so the bun branch could have stayed');
  assert.match(`${missing.stderr}`, /No such built-in module: node:sqlite/,
    `it failed for some other reason, so this is not the closure it claims:\n${missing.stderr}`);

  // **The control, and it is what makes the failure specific.** The same runtime imports
  // `bun:sqlite` and runs the statement, so the refusal above is one missing module rather than a
  // runtime that cannot be driven at all — which is also why reopening the packaged install is a
  // change to `src/db/connection.ts` and not to anything here.
  const present = inHostBun(
    'const {Database} = await import("bun:sqlite");'
    + 'const d = new Database(":memory:"); d.run("create table t(a)"); console.log("ok");',
  );

  assert.equal(present.status, 0, `the host runtime could not run bun:sqlite either:\n${present.stderr}`);
  assert.match(`${present.stdout}`, /ok/, 'bun:sqlite loaded but could not execute a statement');
});
