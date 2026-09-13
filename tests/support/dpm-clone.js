/**
 * A DPM clone on disk, and a way to run a README command against one.
 *
 * **Replaces the package-cache fixture this file grew out of.** DPM used to be installed with
 * `opencode plugin add`, and the README's link instructions globbed
 * `$XDG_CACHE_HOME/opencode/packages/*​/node_modules/opencode-dpm/`. Epic 02-01 story 5 established
 * that no runtime can start the server from there — Node will not strip types under `node_modules`
 * and the host's own bun has no `node:sqlite` — so the documented install is a clone, and the
 * instructions name a path rather than resolving one. The fixture follows the instructions.
 *
 * The substitution below is what makes that testable. The README addresses a reader who has cloned
 * to `~/src/pi-dpm`; a test that ran the line unchanged would either link into the author's
 * home directory or fail on a machine that has no such path, and neither reads the instruction.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { ownedDirectory } from './scratch.js';

const ROOT = join(import.meta.dirname, '..', '..');

/** The clone path the README's instructions name, and what `follow` rewrites it to. */
export const DOCUMENTED_CLONE = '~/src/pi-dpm';

/**
 * The token the README's command blocks put where that path goes, for a reader who chose another.
 *
 * Beside `DOCUMENTED_CLONE` because the two are the same fact in the two forms the README needs —
 * a path for the line you copy, a placeholder for the lines you edit first — and because they go
 * stale together. It was `<package path>` until epic 02-04: correct while there was a package to
 * point at, and left reading as though there still were once epic 02-01 replaced the packaged
 * install with a clone.
 *
 * **Here rather than in either test that reads it**, which is the whole of the reason: two files
 * now check the README against this string, and a rename that reached one of them would leave the
 * other looking for a token no longer in the document — a check that has stopped constraining
 * anything while still passing, if its assertion is ever loosened to tolerate an absence.
 */
export const CLONE_PLACEHOLDER = '<dpm clone>';

/**
 * `count` clones of this checkout's hook, oldest first.
 *
 * More than one is not hypothetical: the README's *When the guard is out of date* is about a link
 * into a clone you did not pull, so the second one exists to be linked against deliberately. The
 * mtimes are set explicitly rather than left to creation order, since two directories made in the
 * same second are a coin toss.
 *
 * @param {import('node:test').TestContext} t Owns the directory's removal.
 * @param {number} [count]
 * @returns {{roots: string[], hooks: string[]}}
 */
export function clone(t, count = 1) {
  const parent = ownedDirectory(t, 'dpm-clone-');
  const roots = [];
  const hooks = [];

  for (let index = 0; index < count; index += 1) {
    const root = join(parent, `checkout-${index}`);

    mkdirSync(join(root, 'hooks'), { recursive: true });

    // The hook is copied from this checkout rather than invented, so the file the instruction finds
    // is the one this repository ships and a rename of it fails at the caller.
    const hook = join(root, 'hooks', 'pre-commit');

    execFileSync('cp', ['-p', join(ROOT, 'hooks', 'pre-commit'), hook]);

    const when = new Date(Date.now() - (count - index) * 60_000);

    utimesSync(hook, when, when);
    utimesSync(root, when, when);
    roots.push(root);
    hooks.push(hook);
  }

  return { roots, hooks };
}

/**
 * Run one README command in `cwd`, with the documented clone path pointed at `into`.
 *
 * `-c` rather than a parsed argument list, because the instructions carry variables and `~`
 * expansion — running them any other way would be running something else.
 *
 * **The shell is a parameter because one documented block is not POSIX.** `sh` is the default and
 * the strictest thing a reader is likely to have; a caller passes `bash` for a block the README
 * addresses to an interactive shell, and says why at the call site rather than here.
 *
 * @param {string} command
 * @param {{cwd: string, into: string, shell?: string}} where
 * @returns {string}
 */
export const follow = (command, { cwd, into, shell = 'sh' }) => execFileSync(
  shell,
  ['-c', command.split(DOCUMENTED_CLONE).join(into)],
  { cwd, encoding: 'utf8', env: { ...process.env } },
);
