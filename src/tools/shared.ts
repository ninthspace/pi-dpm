/**
 * `read_shared_document` — the two shared documents, served through the MCP boundary (FR4, ADR 02-01).
 *
 * Twenty-three skill bodies open by reading `dpm/shared/skill-conventions.md`, and `dpm-status`
 * reads `dpm/shared/status-model.md`. Until now that worked by a registration-time rewrite —
 * `resolveSupportingPaths` substituted an absolute path into the content before the host saw it —
 * and that mechanism has no hook to run in on v1, which reads `SKILL.md` verbatim off disk. It is
 * also already broken on v2, where the substituted path is auto-rejected as `external_directory`.
 *
 * **So the conventions are not reaching the model on either host today**, and the shape of that
 * failure is why this is a tool rather than a better path. A denied or absent file read returns
 * nothing, the skill proceeds without its conventions, and no error is raised anywhere: an
 * omission, which is the failure mode retro 04 recorded as the one that passes by doing nothing.
 * A tool call crosses the boundary ADR 01-02 already established as host-agnostic, and its failure
 * is loud — the session sees a refusal.
 *
 * ## Why an unknown name is refused rather than answered emptily
 *
 * This is criterion 1's whole point and it is easy to read as defensive tidiness. It is not. A
 * mechanism that answers an unknown name with empty content reproduces, *inside* the tool boundary,
 * exactly the silent omission the file read produced outside it — the skill would carry on without
 * its conventions and the loudness the tool was chosen for would have been given away at the last
 * step. So the refusal is the property FR4 turns on, and it names what is available, because a
 * caller told only *no* is left where a failed file read would have left them.
 *
 * ## `packageRoot`, not `Context.root`
 *
 * `Context.root` is the *project* root — the working directory `publish` renders a tree into. The
 * shared documents live in the installed dpm package, which is a different directory in every
 * install that is not this checkout. This is the first tool in `src/tools/` to need the package
 * root, and it takes it from `src/plugin/root.ts` rather than computing a second answer: that
 * module already resolves the root and *checks* it, refusing a root with no server executable
 * underneath, and its own doc comment records what a second, unchecked derivation cost last time.
 *
 * The module lives under `src/plugin/` for historical reasons rather than good ones — nothing in
 * it is host-specific, and both `packageRoot` and `withinPackage` are now read from both sides.
 *
 * ## The containment check
 *
 * `name` is a caller-supplied string that becomes part of a path, so `../../etc/passwd` has to go
 * somewhere. It goes to `withinPackage`, which asks whether the resolved path climbs out of
 * `shared/` — the `relative`-based reading library lesson 04 argues for, rather than a blacklist of
 * characters, which is the form of this check that is wrong in whichever direction nobody tested.
 *
 * ## The advice overlay
 *
 * **Guidance that is true *because of the model* gets appended here, and is never edited into a
 * skill body.** The distinction is the one the whole seam exists for: a rule about what the record
 * must hold — a story does not close over a pending task — is true whoever is writing, belongs in
 * the body or in the server, and does not vary. Advice about how a particular model behaves — that
 * its answers run long unless brevity is asked for, that a rule bears restating at a handoff — is
 * true until the model changes, and then it is wrong and nobody can find it.
 *
 * That is not hypothetical. cpm's own `skill-conventions.md` carries *"Opus 5's default responses
 * run longer than prior models'"* inline and unconditionally, and plain dpm has been swept by hand
 * on every model change. Twenty-three bodies with the two kinds of prose interleaved and nothing
 * marking which is which is a sweep every time, and a sweep is where the model-independent rules
 * get edited by mistake.
 *
 * So an overlay is **additive, separate, and named**: the base document is always served whole, the
 * profile's file is appended under its own heading, and `profile` comes back with the content so
 * the run records which advice it was given. Switching models is then one file, and deleting the
 * old advice is one directory.
 */

import type { Tool } from './convention.ts';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { SHARED_DIRECTORY, packageRoot, withinPackage } from '../plugin/root.ts';
import { defineTool, ToolError } from './convention.ts';

/** The extension every shared document carries, and the part a caller does not type. */
const SUFFIX = '.md';

/** Where the per-profile overlays live, one directory per profile, under `shared/`. */
export const ADVICE = 'advice';

/** The variable naming the active profile. Unset is the whole of the default. */
export const PROFILE_VARIABLE = 'DPM_PROFILE';

/** The heading an overlay is appended under, so a reader can see where the base stopped. */
const ADVICE_HEADING = '## Model-specific guidance';

/**
 * The profiles `shared/advice/` holds, read from the directory for `stems`' reason.
 *
 * @param directory The package's `shared/`.
 * @returns {string[]} Sorted, so a refusal reads the same way twice.
 */
const profiles = (directory: string): string[] => {
  const advice = join(directory, ADVICE);

  if (!existsSync(advice)) return [];

  return readdirSync(advice, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

/**
 * The overlay for one document under the active profile, or `''` where there is none.
 *
 * **Appended to the base rather than replacing it, and that is the decision this file turns on.**
 * A profile that served its *own* copy of `skill-conventions.md` would be a second statement of
 * every convention in it, and the two would agree until the first edit — the failure `stems` above
 * refuses for the document list, one level up. Composing leaves one canonical body and makes the
 * model-specific part a thing you can read on its own, which is what makes it a thing you can
 * delete when the model changes. That deletion is the whole point: the guidance a model needs is
 * the guidance that goes stale, and prose edited *into* twenty-three bodies has no boundary anyone
 * can find a year later.
 *
 * **A profile with no overlay for a document is not an error.** Advice is cross-cutting by nature —
 * tone, length, how often a rule bears restating — so a profile will usually carry an overlay for
 * `skill-conventions`, which every skill body opens by reading, and nothing for `status-model`.
 *
 * @param directory The package's `shared/`.
 * @param profile The active profile, or null.
 * @param stem The document being read.
 * @returns {string}
 */
function overlay(directory: string, profile: string | null, stem: string): string {
  if (profile === null) return '';

  const file = join(directory, ADVICE, profile, `${stem}${SUFFIX}`);

  // Containment for the handler's reason: `stem` reached the path from a caller. The profile came
  // from the environment and was checked against the directory when the tool was built.
  if (!withinPackage(directory, file) || !existsSync(file)) return '';

  return `\n\n${ADVICE_HEADING}\n\n`
    + `The guidance below applies to the \`${profile}\` profile and to no other. It is advice about `
    + 'how this model works, never a rule about what the record must hold — those are in the body '
    + 'above and in the server, and they do not vary.\n\n'
    + readFileSync(file, 'utf8').trim();
}

/**
 * The profile named by the environment, checked against the overlays that exist.
 *
 * Unknown names are refused rather than ignored, for `profileFrom`'s reason and this tool's own: a
 * user who writes `DPM_PROFILE=opsu` and silently gets the base conventions has been told nothing,
 * and the omission is invisible in exactly the way ADR 02-01 chose a tool over a file read to
 * avoid. It is raised where the tool is built, so it fails at startup rather than on the first
 * skill's first call.
 *
 * **The name is taken rather than the environment**, and `baseline.test.js` is why. A function
 * given the whole environment and indexing it by a constant reads the environment in a way no sweep
 * can attribute to a variable — the test names that hole in its own comment and counts attributable
 * reads to close it. Defaulting the *value* keeps `DPM_PROFILE` greppable in `src/`, which is the
 * property NFR2's sanctioned list is asserted over.
 *
 * @param directory The package's `shared/`.
 * @param requested The profile name, defaulting to `DPM_PROFILE`.
 * @returns {string|null}
 */
export function activeProfile(
  directory: string,
  requested: string | undefined = process.env.DPM_PROFILE,
): string | null {
  if (requested === undefined || requested === '') return null;

  const available = profiles(directory);

  if (!available.includes(requested)) {
    throw new Error(
      `dpm: no advice profile named '${requested}'. `
      + (available.length > 0
        ? `The profiles are: ${available.join(', ')}.`
        : `No profile exists — ${join(ADVICE, '<name>')} under the package's shared/ is where one goes.`),
    );
  }

  return requested;
}

/**
 * The stems `shared/` actually holds, read from the directory rather than listed here.
 *
 * **A hand-kept pair would be a second statement of what the package contains**, and the two would
 * agree right up until a third document was added — at which point the tool would refuse a file
 * sitting in front of it, with a message naming the two it still knew about. Criterion 2 asks that
 * the second document not be a special case; a literal list is how the third one becomes one.
 *
 * @param directory The package's `shared/`.
 * @returns {string[]} Sorted, so a refusal reads the same way twice.
 */
const stems = (directory: string): string[] => readdirSync(directory)
  .filter((file) => extname(file) === SUFFIX)
  .map((file) => file.slice(0, -SUFFIX.length))
  .sort();

/**
 * @param {object} [context]
 * @param {string} [context.root] The installed package root. A parameter for the reason `now` and
 *   `newId` are elsewhere: a test that cannot pin it can only assert this checkout against itself,
 *   and the refusal in particular has no other way to be driven against a directory whose contents
 *   the test chose.
 * @returns {object[]}
 */
export function sharedDocumentTools(
  { root, profile: requested }: { root?: string; profile?: string } = {},
): Tool[] {
  const name = 'read_shared_document';
  // Resolved once, at build time, for ADR 01-07's reason: a root computed inside the handler is a
  // root recomputed on every call, and the check that makes it safe would run on every call too.
  const directory = join(root ?? packageRoot(import.meta.dirname), SHARED_DIRECTORY);
  // Read once for the same reason, and raising here so an unknown profile stops the server rather
  // than being discovered by a run that has already planned half an epic without its conventions.
  const profile = activeProfile(directory, requested);

  return [
    defineTool({
      name,
      // The exemption `check_integrity`, `publish` and `search` take. NFR5's rule is that every
      // part after the verb is schema vocabulary, and there is no schema word for a tool whose
      // subject is a file in the package — this one touches no table at all, where `publish`
      // declares the same marker while writing a working tree. `naming.test.js` names the tools
      // taking it, one line each, and says why each qualifies.
      table: 'sqlite_schema',
      reads: ['sqlite_schema'],
      description:
        'Return the content of one of dpm\'s shared documents by name — `skill-conventions` for '
        + 'the conventions every skill opens by reading, `status-model` for the status vocabulary. '
        + 'Every dpm skill body begins with this call. An unknown name is refused, naming the '
        + 'documents that exist. Where a model profile is active, its guidance is appended to the '
        + 'document under a heading of its own and `profile` names it.',
      mutates: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: 'The document\'s name without its extension: `skill-conventions`',
          },
        },
        required: ['name'],
      },
      handler: (args) => {
        const file = join(directory, `${args.name}${SUFFIX}`);

        // Containment first, so a name that climbs out is refused as an unknown name rather than
        // reported with the path it reached — a refusal that echoed `/etc/passwd` back would be
        // answering the question the caller was not entitled to ask.
        if (!withinPackage(directory, file) || !existsSync(file)) {
          throw new ToolError(
            `${name}: no shared document is called '${args.name}'. `
            + `Available: ${stems(directory).join(', ')}.`,
          );
        }

        // **The path is not returned, and its absence is the point.** A caller handed the file's
        // location can read the file instead of calling this again, which is the mechanism this
        // tool exists to replace — and that read is the one v1 has no hook for and v2 rejects.
        //
        // `profile` is returned beside the content so a run can say which advice it was given, and
        // so a transcript records it. Advice that shaped a run and left no trace in it is advice
        // nobody can hold to account afterwards.
        return {
          name: args.name,
          profile,
          content: readFileSync(file, 'utf8') + overlay(directory, profile, args.name),
        };
      },
    }),
  ];
}
