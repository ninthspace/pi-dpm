/**
 * Walking dpm's own sources.
 *
 * Several checks read the tree rather than the code — which fixtures exist, which files
 * import a package, which test files one command reaches. They differ in what they conclude
 * and not in how they look, so the walk lives here once.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Directories that are not dpm's own source, and would make every check report on them. */
const SKIPPED = new Set(['node_modules']);

/** The extensions a dpm module is written in. */
const MODULE = ['.js', '.ts'];

/**
 * Every module file under a directory, recursively, as absolute paths in a stable order.
 * Dot-directories are skipped, so a check cannot be thrown by editor or VCS state.
 *
 * **This was named for JavaScript and matched `.js` alone, and the rename is not cosmetic.** The
 * port moves `src/` to TypeScript, and a walk that kept only `.js` would have returned an empty
 * list for `src/` the moment the rename landed. Seventeen suites sweep `src/` through this
 * function; every one of them would have gone on passing, having checked nothing — the precise
 * false pass the module's own header says these walks exist to prevent, arriving through the
 * helper rather than through a caller. Widening it without renaming would have left the same
 * trap set for the next reader, who would reasonably have believed the old name.
 *
 * The old name is not written out above, and that is deliberate: the scripted rename that carried
 * this change across the suite rewrote its own explanation the first time, leaving a paragraph
 * claiming the function used to be called what it is now called. A sweep that cannot tell the
 * statement of a rule from a use of it is the failure `withoutComments` exists for, met here in
 * the one file that had to describe the change it was subject to.
 *
 * Both extensions match rather than only `.ts`: during the port `src/` is TypeScript while
 * `tests/` and `bin/` are still JavaScript, and several callers sweep across the boundary.
 *
 * @param {string} directory
 * @returns {string[]}
 */
export function moduleFilesUnder(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...moduleFilesUnder(path));
    else if (MODULE.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }

  return found;
}

/**
 * The same walk as names rather than paths — what a check read, so one that found nothing can
 * prove it looked at something.
 *
 * A sweep reporting a clean pass it never computed is the false pass this project keeps
 * rediscovering, and the answer each time is the same pair: the finding, and the corpus the
 * finding was looked for in. Two sweeps had written this line for themselves before a third
 * wanted it.
 *
 * @param {string} directory
 * @returns {string[]}
 */
export const sourceNamesUnder = (directory) => moduleFilesUnder(directory).map(
  (path) => path.slice(path.lastIndexOf('/') + 1),
);

/**
 * The suite's test files, by bare name, in a stable order — **the flat read, not the walk above.**
 *
 * `suite-integrity.test.js` reconciles this against the 133 v0.7.0 shipped plus the list of what
 * the port added; `suite-skill-names.test.js` reads each one for the cases it declares. Both had
 * written the same line, and two copies of *what the suite is* would go on agreeing right up until
 * one of them learned about a subdirectory and the other did not.
 *
 * It is deliberately not `moduleFilesUnder`. That walk recurses, so it reaches `support/` and
 * `fixtures/`, and both callers are asking about the files `node --test` runs from the top of
 * `tests/` — a different question that happens to have overlapped while no test file sat deeper.
 *
 * @param {string} directory The suite root.
 * @returns {string[]}
 */
export const testFileNames = (directory) => readdirSync(directory)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

/**
 * The same walk in the shape the sweeps take: repo-relative name, and text.
 *
 * `auditImports`, `auditEnvironment`, `auditReach` and `auditWrites` all read `{name, text}`, and
 * every suite calling one had written this map for itself. The name is relative to `dpm/` because
 * that is what a complaint quotes back, and an absolute path in a failure message says where the
 * checkout is rather than which file is wrong.
 *
 * @param {string} directory
 * @returns {Array<{name: string, text: string}>}
 */
export const sweepSourcesUnder = (directory) => {
  const root = join(import.meta.dirname, '..', '..');

  return moduleFilesUnder(directory)
    .map((file) => ({ name: file.replace(`${root}/`, ''), text: readFileSync(file, 'utf8') }));
};

/**
 * Every module the plugin itself runs — `src/` and `bin/`, and deliberately not `scripts/`.
 *
 * **The exclusion is the reason this is worth sharing.** `scripts/` is real code a developer runs,
 * so a third-party runner or a socket appearing in it is a finding; it is not part of what installs
 * as a plugin, so claims about what *the plugin* reads from the environment are not made against
 * it. `suite-integrity.test.js` drew that line and had the only copy of it; the second suite to
 * need it — `session-scratch.test.js`, asking which environment variables the plugin reads — would
 * otherwise have drawn it again, and the two would agree until one directory moved.
 *
 * @returns {Array<{name: string, text: string}>}
 */
export const pluginSources = () => [
  ...sweepSourcesUnder(join(import.meta.dirname, '..', '..', 'src')),
  ...sweepSourcesUnder(join(import.meta.dirname, '..', '..', 'bin')),
];

/**
 * The five executables, named rather than discovered.
 *
 * **Named is the point.** `readdirSync(bin)` would return whatever is there, so a sixth executable
 * arriving — or one of these five being deleted — would change what every caller counts without
 * changing a line of any of them. The equality against this list is how that surfaces, and it has
 * already surfaced one: a rename by extension turned `filter((name) => name.endsWith('.js'))` into
 * an empty enumeration in two suites, and a `deepEqual` against a named set was the only thing that
 * caught it.
 *
 * The extension is carried because it is the subject of one of the callers — the port's claim is
 * that these run under plain `node` as TypeScript, with no loader and no build.
 *
 * `executables-typescript.test.js` and `vendoring.test.js` each had this list, with a paragraph
 * each making the same argument; `publish-package.test.js` was about to be the third. Collected
 * here when the third arrived rather than after there were five.
 */
export const EXECUTABLES = [
  'dpm-guard.ts', 'dpm-import.ts', 'dpm-mcp.ts', 'dpm-merge.ts', 'dpm-publish.ts',
];

/**
 * dpm's own `package.json`, parsed.
 *
 * Five suites assert over this file — that nothing is declared to install, that the engine floor
 * matches the one the code enforces, that no build script exists — and each had written its own
 * read of it. The reads were identical and the assertions are not, which is the shape this module
 * already exists to collect: the walk lives here once and the conclusions stay with their suites.
 *
 * @returns {object}
 */
export function packageManifest() {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));
}

/**
 * dpm's `package-lock.json`, parsed.
 *
 * Kept beside the manifest reader for the same reason that one exists, and added the moment there
 * was a second caller rather than after there were five. The lockfile answers a question the
 * manifest cannot: `dependencies` being empty says what is *declared*, and the lockfile says what
 * an install would actually fetch — every entry marked `dev`, which is what makes "a user installs
 * nothing" a fact about the tree rather than a reading of the intent.
 *
 * @returns {object}
 */
export function packageLock() {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package-lock.json'), 'utf8'));
}

/**
 * The host SDKs this plugin may be typed against — one package name per host, in host order.
 *
 * **Two lists were about to say this, which is the shape retro 02 recorded six times.**
 * `SANCTIONED_DEV_DEPENDENCIES` below answers "what may be installed" and the module sweep's
 * recognition rule answers "what may be imported for its types"; both are the same set of SDKs,
 * and two copies of it would agree until one host was added or dropped. Derived below rather than
 * repeated, so adding a third host is one edit and the two questions cannot disagree about what an
 * SDK is.
 *
 * **The type-only rule is what this exists for, and it closes a hole the second SDK opens.** A
 * type-only import is erased before evaluation, so every runtime check in this project is blind to
 * it by design — `staticImports` skips it, the bare-specifier rule never sees it, and
 * `dependencies` staying empty says nothing about it. With one SDK that was a hole nothing could
 * fall into. With two published under the same package name at different versions, a registrar
 * typed against the wrong host's SDK type-checks, sweeps clean, and is wrong — so the specifier a
 * module names is the only place that mistake is visible.
 */
export const SDK_PACKAGES = ['@opencode-ai/plugin', '@opencode-ai/plugin-v1'];

/**
 * The package a specifier belongs to — the whole of a scoped name, the first segment otherwise.
 *
 * A subpath is the same dependency arriving through a different door: `@opencode-ai/schema/skill`
 * and `jest/globals` name `@opencode-ai/schema` and `jest`, and a rule written over exact
 * specifiers would miss both. `suite-integrity.test.js` wrote this to catch a test runner smuggled
 * in through a subpath and had the only copy; the module sweep's type-only rule is the second
 * caller, so it moved here rather than being written a second time.
 *
 * @param {string} specifier
 * @returns {string}
 */
export const packageOf = (specifier) => (specifier.startsWith('@')
  ? specifier.split('/').slice(0, 2).join('/')
  : specifier.split('/')[0]);

/**
 * The packages `src/` may name for their types — a host's type surface, which is more than its SDK.
 *
 * **Separate from `SDK_PACKAGES` because the two answer different questions, and conflating them
 * was wrong in a way the sweep caught on its first run.** `SDK_PACKAGES` is what the manifest
 * declares: one entry per host, and what `SANCTIONED_DEV_DEPENDENCIES` is derived from. This is
 * what a module may be typed against, and it is larger — `src/plugin/index.ts` needs `Skill.Info`
 * to hand the v2 host a registrable skill, and that type lives in `@opencode-ai/schema` rather
 * than in the plugin package.
 *
 * **`@opencode-ai/schema` is not declared anywhere, and naming it here is a record of that rather
 * than an endorsement.** It resolves because the v2 SDK depends on it and npm hoists it, so the
 * type check passes today on an edge nothing in this repository asserts. A v2 release that dropped
 * the dependency, or an installer that stopped hoisting, breaks `tsc` on a file nobody touched and
 * with nothing naming the cause. That is a finding this rule surfaced and not one it fixes;
 * declaring the package is a manifest decision.
 */
export const SDK_TYPE_SURFACE = [...SDK_PACKAGES, '@opencode-ai/schema'];

/**
 * What may appear under `devDependencies`, and nothing else may.
 *
 * **The rule this replaces was "no dependencies at all", and it did not lapse — it was superseded.**
 * v0.7.0 genuinely declared none, so six suites could each assert emptiness and be right. ENVR3 of
 * the OpenCode port requires `tsc --noEmit` to run *from `devDependencies`*, which makes emptiness
 * false by design rather than by accident, and an assertion that stays as it was would fail for a
 * reason nobody could read as a decision.
 *
 * So the surviving claim is narrower and is written here once. Three things still hold, and they
 * are what the six suites are really about:
 *
 * - **Nothing at runtime.** `dependencies` stays empty. It stayed empty when the plugin SDK
 *   arrived, which is the paragraph below.
 * - **No test runner.** ENVR2 says `node --test` is the runner; a third-party one in
 *   `devDependencies` is the specific thing that would quietly displace it.
 * - **Nothing that compiles.** ENVX1 forbids native compilation, and nothing below compiles —
 *   see the qualification on the third entry.
 *
 * `node --test` itself still needs no install step, because the type check is a separate command.
 * That is why `npm test` on a fresh clone is unaffected by anything in this list.
 *
 * **`@opencode-ai/plugin` is here rather than under `dependencies`, and that is NFR1 met rather
 * than NFR1 bent.** The requirement used to name it as the one runtime entry; it was amended when
 * the package was read, because `Plugin.define` is `define(plugin) { return plugin }` — the
 * identity function. Importing it at runtime would pull `effect`, `zod` and six more packages into
 * every user's install in order to call a function that returns its argument. The entry takes it
 * as `import type` and writes `satisfies Plugin`, which `tsc` checks exactly as hard and which
 * both Node's type-stripper and `tsc` erase before anything is evaluated. So a user installing
 * this plugin installs nothing, and the nine assertions that `dependencies` deep-equals `{}` are
 * untouched by the SDK arriving.
 *
 * It is a large dev install — 99 packages — and one of them, `msgpackr-extract`, carries an
 * install script. It compiles nothing: the script is `node-gyp-build-optional-packages`, which
 * *selects* a prebuilt binary for the platform and only falls back to a compile when none matches,
 * and the lockfile carries the prebuilt for every platform this project runs on. `plugin.test.js`
 * checks that no compile happened rather than trusting the name, and CI checks it inside an
 * environment that has no compiler at all.
 *
 * **`@opencode-ai/plugin-v1` is the same package at a second version, under an npm alias** —
 * `npm:@opencode-ai/plugin@1.18.25`, which ADR 02-05 chose so that each registrar is type-checked
 * against the real published types of the host it targets. npm will not install one package name
 * twice, and the alias is how the two versions coexist; the lockfile records the entry under the
 * aliased path with `name` naming the package it actually is, which is the structural evidence
 * that the alias points where it claims to rather than a reading of the specifier string.
 *
 * **It changes nothing the three claims above rest on.** Both SDKs are `devDependencies`, both are
 * taken `import type`, and both are erased before anything is evaluated — so `dependencies` stays
 * empty and a user still installs nothing. The v1 package's own dependencies (`effect`, `zod`,
 * `@opencode-ai/sdk`, `@ai-sdk/provider`) arrive marked `dev` for the same reason the v2 SDK's do.
 *
 * **`@earendil-works/pi-coding-agent` is the pi host, and it is not in `SDK_PACKAGES`.** That list is
 * what `src/plugin/hosts.ts` names, and the pi extension lives outside `src/` in `extensions/dpm/`,
 * which pi loads itself. The extension takes the package `import type` only, so the three claims
 * hold for it too. Its tests spawn the installed pi CLI as a command, the way `tsc` is spawned, and
 * import nothing from it. Pinned to 0.85.1, the version the port specification was checked against.
 * It ships an `npm-shrinkwrap.json`, so its own dependencies land nested beneath it rather than
 * hoisted.
 */
export const SANCTIONED_DEV_DEPENDENCIES = [
  ...SDK_PACKAGES, '@earendil-works/pi-coding-agent', '@types/node', 'typescript',
];

/**
 * Every argument a package script hands `node` before the file it runs, as `"script: argument"`.
 *
 * **The rule ADR 01-03 actually states, read over every script rather than over the test one.**
 * dpm runs TypeScript natively under plain `node`: no loader, no transpiler, no build. A flag
 * between `node` and its entry path is how each of those would arrive, and it would arrive in
 * whichever script needed it rather than in the one a check happened to read — `suite-integrity`
 * held this over `scripts.test` alone, which is the command least likely to be the one that grew a
 * flag.
 *
 * **`--test` is excluded by name, and the exclusion is narrow on purpose.** It is the runner ENVR2
 * names, it takes no entry path, and it neither loads nor compiles anything — so the honest rule is
 * not "no flags" but "nothing that changes how a module is loaded". Excluding it by name rather
 * than by shape means `--test-reporter` or `--experimental-strip-types` arriving beside it is still
 * reported, which a rule shaped like "flags are fine on the runner" would have let through.
 *
 * A script that does not invoke `node` is not this rule's business: `typecheck` runs `tsc`, whose
 * arguments say nothing about how the plugin executes.
 *
 * @param {object} [manifest]
 * @returns {string[]}
 */
export function nodeRuntimeArguments(manifest = packageManifest()) {
  const found = [];

  for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
    const [runner, ...tokens] = command.trim().split(/\s+/);

    if (runner !== 'node') continue;

    // Stop at the entry path: everything after it is the script's own argv and not Node's.
    for (const token of tokens) {
      if (!token.startsWith('-')) break;
      if (token !== '--test') found.push(`${script}: ${token}`);
    }
  }

  return found.sort();
}

/**
 * The lifecycle and build scripts a manifest declares — the ones that make installing dpm *run*
 * something, or that turn `tsc` from a check into a step producing output.
 *
 * Named rather than counted, so a failure says which arrived. Four suites asked this question with
 * a loop each, and **the four lists disagreed** — `plugin.test.js` guarded `prepublish` and not
 * `prepack`, while `baseline`, `dependency-isolation` and `plugin-entry` guarded `prepack` and not
 * `prepublish`, two of them omitting `build` as well. So each was a genuine hole somewhere else was
 * covering, and nothing said so: every one of them passed, and a `prepack` script would have been
 * caught by three of the four while a `prepublish` would have been caught by one. The list here is
 * their union, which is the only reading that makes all four claims true at once.
 *
 * The story that added the second SDK drives this against a manifest carrying each name in turn,
 * because a check over a manifest that has never had one of these is a check whose failure has
 * never been seen.
 *
 * @param {object} [manifest]
 * @returns {string[]}
 */
export const LIFECYCLE_SCRIPTS = [
  'preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'prepublish', 'build',
];

export function lifecycleScripts(manifest = packageManifest()) {
  return LIFECYCLE_SCRIPTS.filter((name) => manifest.scripts?.[name] !== undefined);
}

/**
 * Anything declared to install that the rule above does not sanction, as `"name@spec"` strings.
 *
 * Returns a list rather than a boolean so a failure names the package. A suite asserting this is
 * empty is making the narrowed claim; one that also wants to say *which* packages are allowed
 * asserts over `SANCTIONED_DEV_DEPENDENCIES` directly.
 *
 * @param {object} [manifest]
 * @returns {string[]}
 */
export function unsanctionedDependencies(manifest = packageManifest()) {
  const runtime = Object.entries(manifest.dependencies ?? {});
  const development = Object.entries(manifest.devDependencies ?? {})
    .filter(([name]) => !SANCTIONED_DEV_DEPENDENCIES.includes(name));

  return [...runtime, ...development].map(([name, spec]) => `${name}@${spec}`).sort();
}

/**
 * A module's text with its comments removed, for the sweeps that read code and not prose.
 *
 * **Written because a sweep that cannot tell the two apart reports the presence of a rule as a
 * breach of it.** `neighbour.js` and `plugin-version.js` each carry a doc comment saying they read
 * nothing from `process.env`, and the first run of the first of those sweeps found the explanation
 * and failed. Every caller wants the same stripping, and every caller also needs the *unstripped*
 * text to hand — the control on this function is that the string really is in the file, in the
 * comment that says why it is not in the code.
 *
 * A regex rather than a parser, and that is a limit worth stating: a comment opener written inside
 * a string literal would be stripped as though it opened a comment. Nothing in this project writes
 * one, and a sweep is a check on prose rather than a semantic analysis — if that changes, this
 * needs a parser and not a longer regex.
 *
 * @param {string} source
 * @returns {string}
 */
export function withoutComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
}

/**
 * The same, for a file whose comments open with `#` — YAML and shell.
 *
 * **Written here because two suites now strip the CI workflow and must not disagree about what a
 * comment is.** `executables-typescript.test.js` sweeps it for transpiler flags and `ci.test.js`
 * reads what its jobs run; both have to skip the prose, because the workflow's own comments explain
 * that no loader is passed and say the word while doing it. Two copies of this regex would drift,
 * and the direction they drift in is silent: the one that stopped matching indented comments would
 * start reporting an explanation as a use.
 *
 * Leading whitespace is part of the match — a YAML comment is almost never at column 0 — and a `#`
 * inside a quoted string is not distinguished, which is the same stated limit `withoutComments`
 * carries. Nothing this is used on has one.
 *
 * @param {string} source
 * @returns {string}
 */
export const withoutHashComments = (source) => source.replaceAll(/^\s*#.*$/gm, '');

/**
 * The specifiers a module loads when it is evaluated — its static imports, type-only ones excluded.
 *
 * **Written here because two suites walk the import graph for the same reason and must not
 * disagree about what an edge is.** `server.test.js` and `publish-cli.test.js` each assert that no
 * executable reaches `node:sqlite` through a static import, because ES imports are evaluated before
 * any statement in the file that wrote them — so one static import moves the crash *before* the
 * Node-floor check and silently un-implements NFR2, in a file where nothing looks wrong. The two
 * suites had a copy each; the copies were identical, and the TypeScript port had to correct both.
 *
 * **`import type` is skipped, and skipping it is what makes the claim true after the port.** A
 * type-only import is erased before the file is evaluated — by Node's type-stripper and by `tsc`
 * under `verbatimModuleSyntax` — so it reaches nothing at runtime and hoists nothing.
 * `src/db/capability.ts` names `DatabaseSync` that way, and counting it would report a crash that
 * cannot happen.
 *
 * The classification is narrow on purpose, in both directions:
 *
 * - `import { type Row, insert } from './crud.ts'` still loads the module for `insert`, and is
 *   **not** skipped.
 * - `import type from './x'` is a value default import bound to the name `type` rather than a
 *   type-only import at all, and is **not** skipped either.
 *
 * A regex rather than a parser, with `withoutComments`'s limit and for its reason. One further
 * limit, unchanged from the pattern this replaced: `from` must be followed by whitespace, so
 * `import type{X}from'x'` is read as nothing at all. Nothing in this tree writes one.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function staticImports(source) {
  return importStatements(source).filter(({ typeOnly }) => !typeOnly).map(({ specifier }) => specifier);
}

/**
 * Every static import statement, as its clause and its specifier, classified.
 *
 * **One reading split by one predicate, rather than two patterns that have to agree.** The two
 * exported halves — `staticImports` and `typeOnlyImports` — must partition the static imports
 * between them: every one is either evaluated at runtime or erased before it, and a specifier that
 * fell into both would be judged twice by rules that disagree, while one that fell into neither
 * would be judged by nothing at all. Written as two independent regexes they cannot be held to
 * that; derived from one match and one boolean, the partition is a property of the shape rather
 * than a coincidence anyone has to maintain.
 *
 * **The pattern this replaced got the second bullet above wrong, and said so in its own comment.**
 * It excluded type-only imports with a lookahead containing `type\b\s*(?!from\b)`, and `\s*`
 * backtracks to empty — so on `import type from './x.ts'` the inner test succeeded against a
 * *space*, the exclusion fired, and a value default import bound to the name `type` was read as
 * type-only by the one reading whose job is to see runtime edges. Nothing in this tree writes that
 * form, so the defect cost nothing; what found it was the module sweep's partition control, which
 * is the argument for having written the control rather than the comment.
 *
 * @param {string} source
 * @returns {Array<{clause: string, specifier: string, typeOnly: boolean}>}
 */
function importStatements(source) {
  return [...source.matchAll(/^\s*import\s+([^;]*?)from\s+['"]([^'"]+)['"]/gm)].map((match) => {
    const clause = match[1].trim();

    // `type` alone is the whole clause of a default import named `type`; `type` followed by
    // anything — a binding, a brace, a star — is the type-only modifier.
    return { clause, specifier: match[2], typeOnly: /^type\b/.test(clause) && clause !== 'type' };
  });
}

/**
 * The specifiers a module names for its types alone — the half `staticImports` skips.
 *
 * **The complement of the function above by construction, since both read one match and one
 * predicate.** That partition is the property to hold them to rather than either pattern:
 * `module-sweep.test.js` drives it against the narrow cases below, and it is what found the
 * backtracking defect `importStatements` describes.
 *
 * The same two narrow cases, from the other side:
 *
 * - `import { type Row, insert } from './crud.ts'` loads the module for `insert`, so it belongs to
 *   `staticImports` and is **not** returned here.
 * - `import type from './x'` is a value default import bound to the name `type`, so it is **not**
 *   returned here either.
 *
 * **What this is for.** Erasure makes a type-only import invisible to every runtime check, which is
 * correct for the properties those checks defend and leaves nobody reading the specifier. Once two
 * SDKs publish under the same package name at different versions, the specifier is the only thing
 * distinguishing the host a module is typed against — see `SDK_PACKAGES`.
 *
 * A regex rather than a parser, with `withoutComments`'s limit and for its reason.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function typeOnlyImports(source) {
  return importStatements(source).filter(({ typeOnly }) => typeOnly).map(({ specifier }) => specifier);
}

/**
 * Every module the given file reaches by static import, transitively, that imports `specifier`.
 *
 * Returns a list of sentences rather than a boolean, because a failure has to name the file: "some
 * binary reaches node:sqlite" is a report nobody can act on. Empty is the passing answer, which is
 * exactly why every caller pairs it with a control — a walk that reached nothing and a walk that
 * found nothing produce the same empty array.
 *
 * @param {string} file Absolute path to the entry module.
 * @param {string} specifier The import being hunted, e.g. `node:sqlite`.
 * @returns {string[]}
 */
export function reachesBySpecifier(file, specifier, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);

  const found = [];

  for (const imported of staticImports(readFileSync(file, 'utf8'))) {
    if (imported === specifier) found.push(`${file} imports ${specifier}`);
    if (!imported.startsWith('.')) continue;

    found.push(...reachesBySpecifier(join(file, '..', imported), specifier, seen));
  }

  return found;
}

/**
 * Every file under a directory, recursively, as absolute paths in a stable order.
 *
 * The `.js` walk above answers "which of dpm's modules"; this one answers "which of these files",
 * whatever they are. A sweep over the skills tree wants the second: a reference smuggled into a
 * reference file beside a `SKILL.md` costs a reader exactly what one in the skill would, and a walk
 * filtered by extension is a walk that would not have found it.
 *
 * @param {string} directory
 * @returns {string[]}
 */
export function filesUnder(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }

  return found;
}
