/**
 * Epic 01-01 Story 2 — `src/` as erasable-syntax TypeScript, run rather than built.
 *
 * ADR 01-03 decided the port is authored in TypeScript restricted to **erasable syntax** and ships
 * sources rather than artefacts: OpenCode loads the plugin's `.ts` entry directly and Node 24
 * type-strips it, with no build step, no loader and no compiled output. That decision has an
 * unusually sharp failure mode — a single `enum` anywhere under `src/` stops the whole codebase
 * running, and it stops it at *load*, in whatever the host was doing at the time. So the checks
 * here are structural on purpose: they are what stands between a syntax the type checker is
 * perfectly happy with and a plugin that cannot be imported.
 *
 * **Two of the seven criteria are checked by spawning a real interpreter rather than by reading
 * text**, and the reason differs each time:
 *
 * - "the tree runs under plain `node` with no loader" cannot be read off the source at all. The
 *   argument list this file passes is the assertion — `[path]` and nothing else — and a flag
 *   creeping in would be visible in the diff rather than hidden behind a helper.
 * - the must-NOT on non-erasable syntax is swept over `src/` by regex, and **a regex sweep for an
 *   absence is worth nothing without a control**. Four fixtures, one per construct the criterion
 *   names, are written to a scratch directory and spawned: each proves Node genuinely rejects the
 *   construct, and each is then fed to the same patterns the sweep uses, proving those patterns
 *   find it. Without that pair the sweep would report `src/` clean on a corpus of zero files, or
 *   with a regex that matches nothing anywhere — the false pass this suite keeps rediscovering.
 *
 * **The decorator fixture is deliberately asserted more weakly than the other three**, and the
 * difference is a fact about Node rather than a gap here. `enum`, `namespace` and a parameter
 * property each reach the type-stripper and come back as
 * `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]`, which is a code a test can name. A legacy
 * decorator never reaches it: `@` is not valid JavaScript, so V8's parser refuses the file first
 * with a plain `SyntaxError: Invalid or unexpected token`. Both are refusals and the criterion is
 * met either way; asserting the code on all four would be asserting something untrue.
 *
 * Two things this file does not import. `tests/support/skills.js` builds its exports at load time
 * from `.claude-plugin/plugin.json`, which the fork does not vendor, so every suite importing it
 * dies before its first assertion — Story 4's coupling to cut. And nothing here restates the
 * hundred-module count that `vendoring.test.js` pins; this file asserts what those modules *are*.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runNode } from './support/run-node.js';
import {
  moduleFilesUnder, packageManifest, sweepSourcesUnder, unsanctionedDependencies, withoutComments,
} from './support/sources.js';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** `tsconfig.json`, parsed. Read here rather than in `sources.js` — one suite asserts over it. */
const tsconfig = () => JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));

/**
 * Every relative import specifier under `src/`, as `{file, specifier}`.
 *
 * Static `from '…'`, bare `import '…'` and dynamic `import('…')` in one pattern, because the
 * criterion is about the specifier and not about which of the three forms carries it. JSDoc
 * `{import('./x.ts')}` type annotations are matched too, and deliberately: a stale one there
 * breaks type resolution silently, which is worse than breaking the runtime loudly.
 *
 * Bare and `node:` specifiers are dropped rather than asserted over — `.ts` on those would be
 * wrong, and the criterion says *internal*.
 */
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*'([^']+)'/g;

const relativeSpecifiers = (directory) => sweepSourcesUnder(directory)
  .flatMap(({ name, text }) => [...text.matchAll(SPECIFIER)]
    .map(([, specifier]) => ({ file: name, specifier }))
    .filter(({ specifier }) => specifier.startsWith('.')));

/**
 * The four constructs the must-NOT names, as patterns over comment-stripped source.
 *
 * `enum` needs the identifier after it to be part of the match: `enum` is also a JSON Schema
 * keyword, and `convention.ts` declares `enum?: unknown[]` on its `Rule` type with dozens of
 * `enum: [...]` fields under it. A bare `\benum\b` would report the tool surface as a breach.
 */
const NON_ERASABLE = {
  enum: /\benum\s+[A-Za-z_$]/,
  namespace: /\bnamespace\s+[A-Za-z_$]/,
  'parameter property': /constructor\s*\([^)]*\b(?:public|private|protected|readonly)\b/,
  decorator: /^\s*@[A-Za-z_$][\w$]*\s*[(\n]/m,
};

/** One fixture per construct — the control for both the spawn and the sweep. */
const FIXTURES = {
  enum: 'enum Colour { Red, Green }\nexport const first = Colour.Red;\n',
  namespace: 'namespace Shapes { export const sides = 3; }\nexport const sides = Shapes.sides;\n',
  'parameter property': 'export class Held {\n  constructor(public readonly value: string) {}\n}\n',
  decorator: 'const seal = (target: unknown) => target;\n@seal\nexport class Boxed {}\n',
};

// --- Every module is TypeScript, and the tree runs as one ----------------------------------------

test('every module under src/ is a .ts file and none is left as .js [unit]', () => {
  const modules = moduleFilesUnder(SRC);

  // The corpus, before anything is concluded from it. `moduleFilesUnder` matches both extensions
  // during the port, so an empty walk here would satisfy "none is .js" while checking nothing.
  assert.ok(modules.length > 0, 'src/ holds modules to check');

  const javascript = modules.filter((path) => path.endsWith('.js'));

  assert.deepEqual(javascript, [], 'no module under src/ is still JavaScript');
  assert.equal(modules.filter((path) => path.endsWith('.ts')).length, modules.length,
    'every module under src/ is TypeScript');
});

test('a src/ module loads under plain node with no loader and no flags [feature]', async () => {
  // **The argument list is the assertion.** No `--loader`, no `--import`, no
  // `--experimental-strip-types` — Node 24 strips types unprompted, and a flag added here to make
  // a red test green would be the one thing this criterion exists to catch.
  // `process.stdout.write` of a string rather than `console.log` of a number: `console.log`
  // inspects its argument, and an inherited `FORCE_COLOR` wraps the value in escape codes that
  // the assertion below then compares against — a harness fault that reads as a failed criterion.
  const { code, stdout, stderr } = await runNode(['-e', [
    "const { start } = await import('./src/start.ts');",
    "const { db } = start(':memory:');",
    "const { kinds } = db.prepare('SELECT count(*) AS kinds FROM document_kind').get();",
    'process.stdout.write(String(kinds));',
  ].join('\n')], '', {}, { cwd: ROOT });

  assert.equal(code, 0, `plain node ran a .ts module: ${stderr}`);

  // Not merely "it parsed". `start` opens a database, applies the migrations and seeds the
  // vocabularies, so a count here is the type-stripped tree doing real work through `node:sqlite`.
  assert.ok(Number(stdout.trim()) > 0,
    `the type-stripped module opened and seeded a database, and got ${stdout.trim()} kinds`);
});

// --- Extension discipline ------------------------------------------------------------------------

test('every internal import specifier under src/ carries an explicit .ts extension [unit]', () => {
  const specifiers = relativeSpecifiers(SRC);

  // Two controls, because the sweep can go quiet in two directions. A corpus that walked nothing
  // and a regex that matched nothing both produce an empty `without`, and both read as a pass.
  assert.ok(sweepSourcesUnder(SRC).length > 0, 'the sweep read files');
  assert.ok(specifiers.length > 200,
    `the pattern found relative specifiers to check, not ${specifiers.length}`);
  assert.ok(specifiers.some(({ specifier }) => specifier === './convention.ts'),
    "the pattern finds a specifier known to be there — the tools layer's './convention.ts'");

  const without = specifiers.filter(({ specifier }) => !specifier.endsWith('.ts'));

  assert.deepEqual(without, [],
    'Node does not map a .js specifier onto a .ts file; every relative one names its extension');
});

test('tsconfig.json permits the extensioned specifiers it is asked to check [unit]', () => {
  const { compilerOptions } = tsconfig();

  assert.equal(compilerOptions.allowImportingTsExtensions, true,
    'tsc reads the .ts specifiers the runtime requires rather than rejecting them');

  // The other half of the same setting: `allowImportingTsExtensions` is only accepted alongside a
  // non-emitting configuration, and emitting is what ADR 01-03 rules out anyway.
  assert.equal(compilerOptions.noEmit, true, 'the type check is a check and not a compile');
});

// --- The type check, and where it comes from -----------------------------------------------------

test('tsc runs from devDependencies over the whole codebase and exits zero [integration]', async () => {
  const compiler = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

  assert.ok(existsSync(compiler), 'tsc is installed from devDependencies rather than fetched');

  const { include } = tsconfig();

  // `extensions` joined with the pi port: the extension is TypeScript pi loads directly, and the
  // one place its cast onto pi's `ToolDefinition` can be checked.
  assert.deepEqual([...include].sort(), ['bin', 'extensions', 'src', 'tests'],
    'the check covers the whole codebase, not src/ alone');

  const { code, stdout } = await runNode([compiler, '--noEmit'], '', {}, { cwd: ROOT });

  assert.equal(code, 0, `tsc --noEmit reported no errors:\n${stdout}`);
});

test('typescript is a devDependency, and nothing else is declared to install [unit]', () => {
  const manifest = packageManifest();

  assert.ok(manifest.devDependencies?.typescript, 'the type checker is declared, not assumed');
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'nothing is required at runtime');

  // ENVR2: `node --test` stays the runner. `unsanctionedDependencies` holds the narrowed rule —
  // the blanket "no dependencies at all" it replaced was superseded by ENVR3, not dropped.
  assert.deepEqual(unsanctionedDependencies(manifest), [],
    'no test runner and nothing that compiles has arrived alongside the type checker');
});

// --- must-NOT: build output ----------------------------------------------------------------------

test('no build output is produced, declared, or pointed at [unit]', () => {
  const manifest = packageManifest();
  const scripts = manifest.scripts ?? {};

  for (const name of ['build', 'prepare', 'prepack', 'prepublishOnly']) {
    assert.equal(scripts[name], undefined, `no ${name} script — the package ships sources`);
  }

  // The control on the loop above: the object it reads is populated, so an absent `scripts` key
  // cannot pass this by having nothing in it.
  assert.ok(Object.keys(scripts).length > 0, 'there are scripts, and none of them builds');

  const pointing = JSON.stringify({ files: manifest.files, exports: manifest.exports });

  for (const directory of ['dist', 'build', 'out', 'lib']) {
    assert.ok(!pointing.includes(directory),
      `neither files nor exports points at ${directory}/`);
    assert.ok(!existsSync(join(ROOT, directory)),
      `no ${directory}/ on disk — nothing emitted where a build step would have put it`);
  }
});

// --- must-NOT: non-erasable syntax ---------------------------------------------------------------

test('node rejects each non-erasable construct, and the sweep finds each one [integration]', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'dpm-erasable-'));

  // `type: module` so the fixtures load the way `src/` does. Under CommonJS the same files are
  // refused too, but by a different loader, and a control should exercise the real path.
  writeFileSync(join(scratch, 'package.json'), '{"type":"module"}\n');

  try {
    for (const [construct, source] of Object.entries(FIXTURES)) {
      const file = join(scratch, `${construct.replaceAll(' ', '-')}.ts`);

      writeFileSync(file, source);

      const { code, stderr } = await runNode([file]);

      assert.notEqual(code, 0, `node refuses a ${construct}`);

      // Three of the four carry the type-stripper's own code. A decorator is refused earlier, by
      // the JavaScript parser, so the assertion for it is the refusal and not the code — see the
      // header. Naming that difference here is what stops a later reader "fixing" it.
      assert.match(stderr, construct === 'decorator'
        ? /SyntaxError: Invalid or unexpected token/
        : /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/, `node's refusal of a ${construct} is legible`);

      assert.match(source, NON_ERASABLE[construct],
        `the pattern for a ${construct} matches one when it is there`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('no module under src/ uses a construct native type-stripping cannot erase [unit]', () => {
  const sources = sweepSourcesUnder(SRC);

  assert.ok(sources.length > 0, 'the sweep read files');

  for (const [construct, pattern] of Object.entries(NON_ERASABLE)) {
    // Comments stripped, because a module explaining why it avoids parameter properties would
    // otherwise be reported as using one — `convention.ts` says exactly that above `ToolError`.
    const found = sources
      .filter(({ text }) => pattern.test(withoutComments(text)))
      .map(({ name }) => name);

    assert.deepEqual(found, [], `no ${construct} under src/`);
  }

  // The control the loop cannot supply for itself: the patterns are the same objects the spawn
  // test proved match real fixtures, and this asserts they are still capable of matching here,
  // against text this file holds, rather than having been quietly narrowed to nothing.
  for (const [construct, pattern] of Object.entries(NON_ERASABLE)) {
    assert.match(FIXTURES[construct], pattern,
      `the ${construct} pattern is live in this run, not merely absent from src/`);
  }
});
