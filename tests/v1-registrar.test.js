/**
 * Epic 02-01 Story 3 — the MCP server, registered through v1's `config` hook. FR2.
 *
 * **The story this file tests was re-scoped twice, and the second time restored the first.** It was
 * planned against FR2's `config` hook; a probe then found that the hook is reachable only from a
 * module with no default export, which the v2 object route requires, and the story was re-scoped to
 * skills-without-tools on the reading that one entry cannot be both. Chris's decision to target v1
 * alone removed the constraint that made that a dilemma: with no v2 to serve, dpm ships **two**
 * modules, one per v1 route, and FR2 is discharged as written.
 *
 * What the probes established, and what the assertions below are anchored to:
 *
 * - v1 calls the named `server` export with its `PluginInput` and awaits the `Hooks` it returns.
 *   `Hooks.config` is handed the resolved configuration, and `config.mcp` is the only handle v1's
 *   plugin API offers on the MCP registry.
 * - A default export diverts the loader to the object route, which refuses the module unless the
 *   default carries a `server()` of its own. So the absence of a default export here is
 *   load-bearing, and the last test in this file is what holds it.
 * - The `config` hook cannot bootstrap a second module: `config.plugin` is writable, the hook was
 *   observed writing to it, and the appended module never evaluated. The plugin list is resolved
 *   first.
 *
 * **The third re-scope is epic 02-05 story 2, and it removed the dilemma rather than resolving it.**
 * The skills entry this file used to check alongside the registrar had no loader under 1.18.25 at
 * all — its route is fed by a `plugins` config key the host strips — so it was deleted, and the
 * skills are registered by pointing the host's own `skills` key at `skills/`. FR2 is still
 * discharged exactly as written, by the one entry that remains.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as tools from '../src/plugin/index.ts';
import { SERVER_NAME } from '../src/plugin/registration.ts';
import { serverEntry } from '../src/plugin/registration.ts';
import { localServer } from '../src/plugin/server.ts';
import { packageRoot } from '../src/plugin/root.ts';
import { registerServer } from './support/host-contexts.js';
import { pluginSources, withoutComments } from './support/sources.js';

// --- Criterion 1: the config hook registers the packaged server -----------------------------------

test('the config hook sets an mcp entry whose command runs the packaged executable [integration]', async () => {
  const config = await registerServer(tools);

  assert.deepEqual(Object.keys(config.mcp), [SERVER_NAME],
    'exactly one server is registered, under the name the tool prefix is built from');

  const registered = config.mcp[SERVER_NAME];

  assert.equal(registered.type, 'local', 'a local server, so the host spawns it rather than dialling out');

  // **A runtime and the path, with nothing between them.** ADR 01-03: the sources run on what the
  // runtime does by default, and a `--loader` arriving here would be the one invocation surface a
  // contributor never types. Asserted as the whole array rather than as a `startsWith`, because a
  // flag inserted at index 1 would pass the looser check.
  assert.equal(registered.command.length, 2,
    `the command carries an extra argument: ${registered.command.join(' ')}`);
  assert.match(registered.command[1], /\/bin\/dpm-mcp\.ts$/);

  // The other half, and the reason it is checked rather than read off the source: a registered
  // server whose command names a file that is not there installs fine and fails at the first tool
  // call, which is the furthest possible point from the mistake.
  assert.ok(existsSync(registered.command[1]),
    `the registered command names ${registered.command[1]}, which is not in this tree`);
});

test('the registered entry is the one localServer builds, not a second spelling of it [unit]', async () => {
  // **The claim story 2 protected, kept after story 2's mechanism went.** There is no second
  // registrar to disagree with any more, so what is left to guarantee is that the hook registers
  // what `server.ts` computed rather than assembling a path of its own that agrees today.
  const config = await registerServer(tools);
  const built = localServer(packageRoot());

  assert.deepEqual(config.mcp[SERVER_NAME].command, [...built.command]);
  assert.equal(config.mcp[SERVER_NAME].type, built.type);
  assert.deepEqual(serverEntry(), built, 'registration.ts computes something other than localServer');
});

test('the user\'s own mcp entries survive the registration [unit]', async () => {
  // The block is the user's and dpm is adding one key to it. A hook that assigned rather than
  // spread would pass every assertion above and silently delete every other server they run.
  const theirs = { type: 'local', command: ['their-server'] };
  const config = await registerServer(tools, { mcp: { theirs } });

  assert.deepEqual(Object.keys(config.mcp).sort(), [SERVER_NAME, 'theirs'].sort());
  assert.deepEqual(config.mcp.theirs, theirs, 'the user\'s entry was replaced rather than kept');

  // The control: the reading would notice the loss, so the equality above is a finding.
  const replaced = await registerServer(tools, { mcp: {} });

  assert.equal(replaced.mcp.theirs, undefined);
});

test('the entry hands out copies, so a host editing one cannot edit the next [unit]', async () => {
  const first = await registerServer(tools);
  const second = await registerServer(tools);

  assert.deepEqual(first.mcp[SERVER_NAME], second.mcp[SERVER_NAME], 'two loads registered different servers');
  assert.notEqual(first.mcp[SERVER_NAME].command, second.mcp[SERVER_NAME].command,
    'both loads were handed the same array, so a host mutating it would change what the next load sees');

  first.mcp[SERVER_NAME].command.push('--planted');

  const third = await registerServer(tools);

  assert.equal(third.mcp[SERVER_NAME].command.length, 2,
    'a mutation of one registration reached the next, so the copy is not a copy');
});

// --- Criterion 3 (must NOT): no tool exists under one host and not the other ----------------------

/** Which plugin modules name a host at all, read from source with comments stripped. */
const namesAHost = (sources) => sources
  .filter(({ text }) => /\bhostOf\b|\bHost\b|['"]v1['"]/.test(withoutComments(text)))
  .map(({ name }) => name)
  .sort();

test('must NOT — a tool is advertised under one host and not the other [unit]', async () => {
  // **The tools are the MCP server's, and the server is one program.** Nothing under `src/tools/`
  // or `src/server/` may consult the host, because a tool surface that varied by host could only
  // do so by asking — so the check is that the question is never asked outside the registration
  // layer, and the registration layer registers a surface rather than individual tools. NFR1 is the
  // same rule stated over the whole tree.
  const outsideRegistration = namesAHost(pluginSources())
    .filter((name) => !name.startsWith('src/plugin/'));

  assert.deepEqual(outsideRegistration, [],
    'a module outside the registration layer consults the host — a tool surface that differs by '
    + 'host would have to be built exactly there');

  // **The control.** Without it this passes against a reading that matches nothing at all.
  assert.deepEqual(
    namesAHost([{ name: 'src/tools/planted.ts', text: "if (hostOf(ctx) === 'v1') register(tool);" }]),
    ['src/tools/planted.ts'],
    'a planted host-conditional tool registration is not reported, so the rule guards nothing');

  // And the corpus really was swept, so the emptiness above is a finding rather than a silence.
  assert.ok(pluginSources().length > 20,
    `the sweep read ${pluginSources().length} modules, which is too few to be the plugin tree`);
});

// --- Criterion 4 (must NOT): the plugin writes to the user's configuration -----------------------

/** Every file in a directory, by name, with its sha256 — the reading a write has to disturb. */
const fingerprint = (directory) => Object.fromEntries(readdirSync(directory).sort().map((name) => [
  name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex'),
]));

test('must NOT — the plugin writes to the user\'s OpenCode configuration [integration]', async () => {
  const configured = mkdtempSync(join(tmpdir(), 'dpm-v1-config-'));

  writeFileSync(join(configured, 'opencode.json'), JSON.stringify({ plugin: ['pi-dpm'] }));
  writeFileSync(join(configured, 'opencode.jsonc'), '{ "mcp": {} }');

  const before = fingerprint(configured);

  // Setting `config.mcp` mutates the object v1 passed in for exactly that purpose; ENVX4's claim is
  // about the file, and the file is what is hashed. There used to be a second load here, for the
  // skills entry epic 02-05 story 2 deleted — and the claim got easier to hold rather than harder,
  // because the half that is left is a directory the host reads and dpm never opens.
  await registerServer(tools);

  assert.deepEqual(fingerprint(configured), before,
    'a plugin load changed a configuration file — registration is a description handed to the '
    + 'host, and the user\'s config is the user\'s');

  // **The control the criterion names.** A comparison that could not notice a write would pass the
  // assertion above unchanged, so the planted write is what proves it fires.
  writeFileSync(join(configured, 'opencode.json'), JSON.stringify({ mcp: { dpm: 'planted' } }));

  assert.notDeepEqual(fingerprint(configured), before,
    'a planted write to the configuration is not noticed, so the comparison proves nothing');
});

// --- The shape v1 needs, which is the constraint that put the routes in two files -----------------

test('the tools module exports a callable server and no default [unit]', () => {
  // **A default export here diverts v1's loader to the object route**, which then refuses the module
  // outright unless the default carries a `server()` of its own — so this is the assertion that
  // keeps dpm on the route it wants. Read off the module namespace rather than through
  // `import entry from …`, which is a *static* error when there is no default: the file would fail
  // to parse instead of failing this assertion, and a suite cannot report on a module it could not
  // load.
  assert.equal(tools.default, undefined, 'the tools module has a default export, which changes its route');
  assert.equal(typeof tools.server, 'function', 'v1 calls the named `server` export, and there is none');

  // The control on that reading, since `undefined` is also what a namespace with nothing in it
  // returns: this module does export something, and it is not `default`.
  //
  // **It used to require two, and epic 02-05 story 2 made that false.** `SERVER_NAME` was the
  // second export, and it was the reason the module did not load under a real 1.18.25 host — which
  // walks every export and refuses the module on the first that is not a plugin. So the floor is
  // one, and the *ceiling* is one too; `plugin-entry.test.js` asserts the exact set, and this stays
  // a control on the `default` reading rather than becoming a second copy of that rule.
  assert.deepEqual(Object.keys(tools), ['server'],
    'the namespace is empty or holds something besides the route, either of which breaks the reading above');

  // And the name the server is registered under is not the plugin's own — one module now, but the
  // two namespaces are still two, and a rename that collapsed them would rename every tool.
  assert.equal(SERVER_NAME, 'dpm');
});
