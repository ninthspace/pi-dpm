/**
 * A runtime that reports no FTS5, for driving the refusal through a spawned binary.
 *
 * Passed as `--import` so it runs before the entry point's own imports resolve. It rewrites
 * `hasFts5` at load time to return false, which is the one thing a test on this machine cannot
 * otherwise arrange: the criterion asks for the refusal to be exercised on a runtime that *does*
 * have the capability, so that the assertion distinguishes the probe from the machine it happens
 * to run on.
 *
 * **A module hook rather than an environment variable the probe reads.** An env override would be
 * a production surface — a way to talk a real server out of its own safety check — added for the
 * convenience of a test. This reaches the same place and ships nothing.
 */

import { registerHooks } from 'node:module';

/**
 * The module to patch, and the signature to patch inside it.
 *
 * **Both moved in the port, and the pair is why this is written out rather than inlined.** The file
 * became `capability.ts`, and the path it used to be matched by — `/dpm/src/db/capability.js` —
 * assumed the plugin sat in a directory called `dpm` inside the marketplace repository. The
 * standalone fork's root is `pi-dpm`, so `/dpm/…` no longer matches it and never would again.
 *
 * **The failure that combination produced is the one worth naming.** The guard below catches a
 * signature that moved, but it sits *downstream of the filter*: when the filter stopped matching,
 * the hook returned the module untouched and said nothing, every binary ran with FTS5 present, and
 * the suite reported "exited 0 on a runtime that cannot maintain the schema". The filter is now
 * anchored on the part that is a fact about this repository's layout — the module's path from
 * `src/` down — and `MATCHED` below turns a filter that stops matching into a failure rather than
 * a silence.
 */
const MODULE = '/src/db/capability.ts';
const SIGNATURE = 'export function hasFts5(db: DatabaseSync): boolean {';

/** Set when the module was seen at all, so a filter that matches nothing is not a quiet pass. */
let matched = false;

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);

    if (!url.endsWith(MODULE)) return loaded;

    matched = true;

    const source = loaded.source.toString();
    const patched = source.replace(SIGNATURE, `${SIGNATURE} return false;`);

    if (patched === source) {
      throw new Error('no-fts5.mjs could not patch hasFts5 — its signature moved and this shim '
        + 'would otherwise leave the capability true and report the run as a pass');
    }

    return { ...loaded, source: patched };
  },
});

// **The control on the filter, which is what was missing.** Every binary this shim is used with
// opens a database, so every one of them loads `capability.ts`; a process that exits without
// having done so was not shimmed at all, and its refusal — or its absence — says nothing about
// FTS5. Reported on exit rather than thrown, because throwing here would race the process's own
// work and replace the diagnostic the test is reading.
process.on('exit', (code) => {
  if (matched) return;

  process.stderr.write(`no-fts5.mjs never saw ${MODULE} — the capability was left true and this `
    + 'run proves nothing about a runtime without FTS5\n');

  if (code === 0) process.exitCode = 70;
});
