#!/usr/bin/env node
/**
 * No skill body reaches past the boundaries the port drew — Epic 01-03 Story 4 (FR3).
 *
 * **The suite already reads both of these, and that is not the same thing as enforcing them.**
 * `skill-port.test.js` sweeps for Claude Code's mechanisms and `skills-corpus.test.js` for SQL, so
 * a breach is caught today by `npm test`. What the specification asks for is a *check that fails
 * the build*, and the difference is not ceremony: a suite is one command among several, and the
 * rule it protects is the rule a contributor is most likely to break while doing something else
 * entirely — writing a skill body, where nothing about the file says it is under a prohibition.
 * A named step in CI puts the rule's name in the failure output.
 *
 * **Every pattern is shared with the suite rather than restated here.** A second copy of the SQL
 * patterns would be a second place for one to be quietly dropped, and the copy that CI ran would be
 * the one nobody read. `HOST_MECHANISM` is this file's, exported so `skill-port.test.js` reads the
 * same list — the sweep and the enforcement of a sweep should not be able to disagree.
 *
 * **The controls live in `ci-skill-body.test.js`**, which runs this script as a process against
 * planted breaches. A check for an absence proves nothing about the check, and a check whose
 * patterns had all stopped matching would report a clean corpus in exactly the voice of a real one.
 *
 * Run as `npm run skills`. Deliberately not part of `npm test`, for the reason above.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SQL, sweep } from '../tests/support/skills.js';

const ROOT = join(import.meta.dirname, '..');

/**
 * The host mechanisms a ported body may not name.
 *
 * The first four are the story's own criterion. `$ARGUMENTS` is the fifth and was not on that list:
 * it is the *argument half* of the same slash-command mechanism — Claude Code substituted the
 * user's typed text into the body before the model saw it, and v2 substitutes nothing — so a body
 * naming it carries a literal string in a sentence that still reads as an instruction. Epic 01-03's
 * section records the finding. Checking it is more than the criterion asks and never less.
 *
 * `.claude` is matched at a word boundary rather than followed by a slash, so
 * `.claude-plugin/plugin.json` cannot slip through as a different suffix on the same mechanism.
 */
export const HOST_MECHANISM = [
  { pattern: /mcp__plugin_/, why: "Claude Code's MCP tool-dispatch prefix" },
  { pattern: /\/dpm:/, why: 'a /dpm: slash-command invocation' },
  { pattern: /CLAUDE_PLUGIN_ROOT/, why: "Claude Code's plugin-root variable" },
  { pattern: /\.claude\b/, why: 'the .claude harness directory' },
  { pattern: /\$ARGUMENTS/, why: "Claude Code's slash-command argument substitution" },
];

/**
 * Model names a body may not carry, because guidance tied to one belongs in an advice overlay.
 *
 * **The rule this enforces is a boundary between two kinds of prose, not a ban on a word.** A rule
 * about what the record must hold — a story does not close over a pending task — is true whoever is
 * writing and lives in the body. Advice about how a model behaves — that its answers run long
 * unless brevity is asked for — is true until the model changes, and then it is wrong, and prose
 * edited into twenty-three bodies has no boundary anyone can find afterwards. `shared/advice/` is
 * where the second kind goes; this is what keeps it there.
 *
 * The cost of not having this is on the record next door: cpm's `skill-conventions.md` carries
 * *"Opus 5's default responses run longer than prior models'"* inline and unconditionally, and both
 * cpm and plain dpm have been swept by hand on every model change. A sweep across twenty-three
 * files with the two kinds interleaved is also where the rules that should not vary get edited by
 * mistake.
 *
 * **Product names only, and that is deliberate.** A body citing an `MTPLX … run` as the evidence for
 * an invariant is provenance and stays — three bodies do it today, and what each cites is a
 * record-level rule that holds for any model. What cannot stay is a body instructing *because of*
 * who is reading it, and a vendor's product name is the mechanical form of that. Phrases are matched
 * where they are unambiguous; the judgement cases are what the convention in the overlay's own
 * header is for, and no pattern will catch them.
 */
export const MODEL_SPECIFIC = [
  { pattern: /\bopus\b/i, why: 'the model name Opus' },
  { pattern: /\bsonnet\b/i, why: 'the model name Sonnet' },
  { pattern: /\bhaiku\b/i, why: 'the model name Haiku' },
  { pattern: /\bgpt-?\d/i, why: 'a GPT model name' },
  { pattern: /\bqwen/i, why: 'the model name Qwen' },
  { pattern: /\bllama\b/i, why: 'the model name Llama' },
  { pattern: /\bgemini\b/i, why: 'the model name Gemini' },
  { pattern: /\bmistral\b/i, why: 'the model name Mistral' },
  { pattern: /\bthe model (?:tends|will often|struggles)\b/i, why: "a claim about one model's habits" },
];

// **`this model` was a pattern here and came straight back out.** `shared/status-model.md` is about
// the *status* model and says "`dpm-status` references this model in prose" — a true sentence about
// a data model, flagged as advice about an LLM. In a project whose domain vocabulary includes the
// word, the phrase cannot carry the rule, and a check that has to be argued with on every run is one
// that gets switched off. The product names above are unambiguous; the rest is the overlay's own
// convention to hold, and no pattern will hold it.

/**
 * The one breach on the record, and the whole of it.
 *
 * `ralph` drives its loop by writing a file a Claude Code stop hook reads. That hook was never
 * shipped — released v0.7.0's `hooks/` holds a `pre-commit` and nothing else — and v2 has no
 * equivalent, so this is a missing capability rather than a path that needs rewriting. Rewriting it
 * would satisfy the check by hiding what the check exists to catch. The decision was taken
 * deliberately: `ralph` stays registered and the gap stays visible, printed on every run.
 *
 * **Exactly one string in exactly one file.** `dpm-ralph` naming any other mechanism fails with the
 * rest, and a second body claiming an exemption has to claim it here, in the open.
 *
 * **`skill` is the directory name, which epic 02-02 story 1 prefixed.** It is compared against what
 * `bodies` reads off the tree, so the two have to be spelled the same way. This one was `'ralph'`
 * and would have gone on being a valid string that matched nothing: the exemption would simply stop
 * being applied, `dpm-ralph`'s five stop-hook references would surface as five breaches, and the
 * check would refuse a corpus that had not changed. Library lesson 04's rule about renames — grep
 * for the predicates that filter on the old form, separately from the literal name.
 */
export const RECORDED_GAP = { skill: 'dpm-ralph', pattern: /`?\.claude\/ralph-loop\.local\.md`?/g };

/** Every skill directory holding a body, read from the tree so a new one is covered on arrival. */
function bodies(root: string): { name: string, path: string, source: string }[] {
  const SKILLS = join(root, 'skills');

  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      const path = join(SKILLS, name, 'SKILL.md');

      try {
        return [{ name, path, source: readFileSync(path, 'utf8') }];
      } catch {
        return [];
      }
    });
}

/** The files every body reads at startup. A mechanism moved into one reaches all of them. */
function sharedFiles(root: string): { name: string, path: string, source: string }[] {
  const SHARED = join(root, 'shared');

  return readdirSync(SHARED, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(SHARED, name);

      return { name: `shared/${name}`, path, source: readFileSync(path, 'utf8') };
    });
}

/**
 * Check one tree.
 *
 * **The root is an argument so the check can be driven against a tree that is wrong on purpose.**
 * `ci-skill-body.test.js` builds a corpus with a planted breach in it and runs this file as a
 * process against it — which is the only way to show the check fails when it should, short of
 * breaking the real corpus and hoping to put it back.
 *
 * @param root A package root holding `skills/` and `shared/`.
 * @returns {number} The process exit code: 0 clean, 1 with problems reported on stderr.
 */
export function run(root: string): number {
  const checked = [...bodies(root), ...sharedFiles(root)];
  const problems: string[] = [];

  // **The floor, before any sweep.** An empty corpus trips no pattern, so a `skills/` that failed
  // to be read would otherwise report a clean project in the same voice as a clean one.
  if (checked.length < 20) {
    console.error(`dpm: only ${checked.length} files were read, so almost nothing was checked`);
    return 1;
  }

  for (const { name, path, source } of checked) {
    const text = name === RECORDED_GAP.skill
      ? source.replaceAll(RECORDED_GAP.pattern, '')
      : source;

    for (const found of sweep(text, HOST_MECHANISM)) {
      problems.push(`${path}: names ${found}`);
    }

    for (const found of sweep(text, SQL)) {
      problems.push(`${path}: reaches past the tool boundary — ${found}`);
    }

    // `sharedFiles` reads `shared/*.md` and not the directories under it, so `shared/advice/` is
    // outside this sweep by construction rather than by exemption — which is the point of it.
    for (const found of sweep(text, MODEL_SPECIFIC)) {
      problems.push(`${path}: names ${found} — model guidance belongs in shared/advice/<profile>/`);
    }
  }

  if (problems.length > 0) {
    console.error('dpm: a skill body reaches past a boundary the port drew\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}. `
      + 'A skill calls tools and names no host mechanism; see epic 01-03.');
    return 1;
  }

  console.log(`dpm: ${checked.length} files — every skill body and every file they read at startup `
    + '— name no host mechanism, no SQL and no model');
  console.log(`     one recorded gap, printed rather than hidden: ${RECORDED_GAP.skill} names the `
    + 'Claude Code stop-hook file, which OpenCode has no equivalent for');

  return 0;
}

// **Run only when run, because the patterns above are imported.** `skill-port.test.js` reads
// `HOST_MECHANISM` from here so the suite and the build check cannot disagree about the list, and a
// module that exited on import would take the suite down with it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(run(process.argv[2] ?? ROOT));
}
