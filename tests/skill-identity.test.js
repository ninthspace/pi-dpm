/**
 * Epic 02-02 Story 1 — a skill declares one identity, and declares it twice in agreement.
 *
 * Until this story the `dpm-` prefix was applied at *registration*: `ID_PREFIX` in
 * `src/plugin/skills.ts` composed `dpm-do` out of a directory called `do`, and the tree knew
 * nothing about it. Story 2 removes that composition, so the name has to be on disk first. This
 * file is what says it is.
 *
 * **The criterion used to say the host required the pair to match, and the host requires no such
 * thing.** dpm registers `{type: 'embedded', skill: {name, description, location, content}}` — v1
 * is handed a computed name and never opens the directory or parses front matter. Epic 02-01
 * demonstrated exactly the mismatch live: twenty-three skills registered as `dpm-<skill>` from
 * directories named without the prefix, and 1.18.25 accepted every one. So nothing here is a claim
 * about what OpenCode will tolerate. It is a claim about dpm being legible to the next reader, and
 * about story 2 having a single place to take the name from.
 *
 * **The corpus is read through `tests/support/skills.js` rather than walked here.** One reader of
 * the tree is the whole point of that module; a second one in this file would agree with it today
 * and diverge on the first skill added. What *is* walked here is the two scratch trees the controls
 * need — and they are fixture plumbing feeding the same predicate the real corpus is judged by,
 * which is the only way a must-NOT gets a control at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

import { PREFIX, frontMatter, skillNames, skillSource } from './support/skills.js';
import { packageTree, skillSource as plantedSkill } from './support/package-tree.js';
import { discoverSkills } from '../src/plugin/skills.ts';

const ROOT = join(import.meta.dirname, '..');
const CHECK = join(ROOT, 'scripts', 'skill-body-check.ts');

/** What dpm ships, so a reading that walked an empty tree is named rather than reported clean. */
const CORPUS = 23;

/**
 * The shape a v1 skill name may take — ADR 01-05's namespace, spelled as a pattern.
 *
 * Anchored at both ends deliberately. `dpm-do_thing` contains a matching run and would satisfy an
 * unanchored form, which is library lesson 04's whole subject: a check that can be satisfied by a
 * substring is satisfied by the thing it was written to reject.
 */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Every skill's directory name beside the name its front matter declares.
 *
 * @returns {{directory: string, declared: string | undefined}[]}
 */
const declared = () => skillNames().map((directory) => ({
  directory,
  declared: frontMatter(skillSource(directory)).name,
}));

/**
 * The names that more than one skill declares — **derived from the corpus, never enumerated.**
 *
 * Retro 03's lesson, applied to a must-NOT: a prohibition written as a list of strings catches only
 * the strings somebody thought of, and the collision that matters is the one nobody anticipated. So
 * nothing here names a skill. Every declared name is counted, and any name counted twice is
 * reported with the directories that claim it.
 *
 * @param {{directory: string, declared: string | undefined}[]} entries
 * @returns {{name: string, directories: string[]}[]}
 */
function shared(entries) {
  const claims = new Map();

  for (const { directory, declared: name } of entries) {
    claims.set(name, [...(claims.get(name) ?? []), directory]);
  }

  return [...claims]
    .filter(([, directories]) => directories.length > 1)
    .map(([name, directories]) => ({ name, directories }));
}

/**
 * The same pairs from a tree built on purpose, read **through the discoverer the host uses**.
 *
 * `discoverSkills` is what actually walks a package and decides what each skill is called, so a
 * control driven through it is a control over the thing that ships. A private walk here would agree
 * with it today and be the second reader of one format — the duplication `frontMatter` was pulled
 * out of `src/` to end.
 *
 * @param {string} root A package root, as `packageTree` returned it.
 * @returns {{directory: string, declared: string}[]}
 */
const plantedEntries = (root) => discoverSkills(root)
  .map((skill) => ({ directory: basename(skill.location), declared: skill.name }));

// --- Criterion 1: one identity, in both places a reader looks -------------------------------------

test('every skill directory is dpm-prefixed and declares that same name [unit]', () => {
  const entries = declared();

  // **Counted before anything is asserted about it.** A `for` over an empty list passes every
  // assertion below, and the reading above walks a directory this story moved.
  assert.equal(entries.length, CORPUS,
    `${entries.length} skills were read from the tree, and dpm ships ${CORPUS}`);

  const wrong = entries.filter(({ directory, declared: name }) => name !== directory);

  assert.deepEqual(wrong, [],
    'a skill declares a name other than the directory it sits in');

  const unprefixed = entries.filter(({ directory }) => !directory.startsWith(PREFIX));

  assert.deepEqual(unprefixed, [], `a skill directory does not carry the ${PREFIX} prefix`);

  // And the prefix is carried once. `dpm-dpm-do` satisfies both readings above and is what a second
  // pass over an already-renamed tree would produce.
  const twice = entries.filter(({ directory }) => directory.startsWith(`${PREFIX}${PREFIX}`));

  assert.deepEqual(twice, [], 'a skill directory carries the prefix twice');
});

// --- Criterion 2: the name is a name the flat keyspace can hold ------------------------------------

test('every declared name matches the registered-name shape [unit]', () => {
  const entries = declared();

  assert.equal(entries.length, CORPUS, 'the corpus was not read');

  const malformed = entries.filter(({ declared: name }) => !NAME.test(name));

  assert.deepEqual(malformed, [], 'a declared name is not a lowercase hyphenated identifier');
});

test('the shape check rejects the forms a rename produces by accident [unit, control]', () => {
  // **The control, and it is the same predicate rather than a restatement of it.** A regex that
  // stopped matching anything would pass the test above over twenty-three names exactly as loudly
  // as one that works, so it is shown refusing what it exists to refuse.
  for (const rejected of ['dpm_do', 'dpm-Do', 'DPM-do', 'dpm-do-', '-dpm-do', 'dpm--do', 'dpm do']) {
    assert.equal(NAME.test(rejected), false, `${rejected} was accepted as a skill name`);
  }

  // The other half: it accepts the forms the corpus actually holds, including a single word and a
  // hyphenated one, so it has not been narrowed into a check that matches nothing.
  for (const accepted of ['dpm-do', 'dpm-architect', 'do', 'a1', 'dpm-two-words']) {
    assert.equal(NAME.test(accepted), true, `${accepted} was refused as a skill name`);
  }
});

// --- Criterion 3: the rename's surface, and the check that indexes by directory name --------------

test('the skill-body check passes over the renamed corpus [integration]', () => {
  // **Run as a process against the real root, which is how CI runs it.** The check reads the tree
  // by directory name and holds one exemption keyed on it — `RECORDED_GAP.skill`, which this story
  // had to rename with the directory. A stale key there is a valid string that matches nothing: the
  // exemption would stop being applied and `dpm-ralph`'s five stop-hook references would surface as
  // five breaches of a corpus nobody had touched.
  const result = spawnSync(process.execPath, [CHECK, ROOT], { encoding: 'utf8' });

  assert.equal(result.status, 0, `the body check refused the renamed corpus:\n${result.stderr}`);
  assert.match(result.stdout, /name no host mechanism, no SQL and no model/);

  // And the exemption is still being applied to the body that holds it, rather than the check
  // having gone quiet on the whole corpus.
  assert.match(result.stdout, new RegExp(`one recorded gap[^\\n]*${PREFIX}ralph`),
    'the recorded gap is no longer reported against the skill that carries it');
});

test('every skill id a body names resolves to a skill on disk [unit]', () => {
  // The cross-reference half of the criterion. The bodies name skills as the command that runs them,
  // `/dpm-<skill>`, so what this reads is whether the tree still answers to what they say.
  //
  // **The form is the command because pi has no skill tool.** This read `name "..."`, and before
  // that `id "..."`, following whatever the descriptions told a skill tool to take. The lookbehind
  // keeps a path such as `skills/dpm-spec` from counting as a command. The `cited.size` assertion
  // below is what makes the pattern honest: a regex that stopped matching the sentence would find
  // nothing, and a check over an empty set reports no dangling references with complete confidence.
  const live = new Set(skillNames());
  const cited = new Map();

  for (const directory of skillNames()) {
    for (const [, id] of skillSource(directory).matchAll(/(?<![\w./-])\/(dpm-[a-z]+)\b/g)) {
      cited.set(id, [...(cited.get(id) ?? []), directory]);
    }
  }

  assert.equal(cited.size, CORPUS,
    `${cited.size} distinct skill ids are named across the bodies, and dpm ships ${CORPUS}`);

  const dangling = [...cited].filter(([id]) => !live.has(id));

  assert.deepEqual(dangling, [], 'a body names a skill id that is not a directory in the tree');
});

// --- Criterion 4 (must NOT): two skills share a front-matter name ---------------------------------

test('no two skills declare the same front-matter name [unit]', () => {
  const entries = declared();

  assert.equal(entries.length, CORPUS, 'the corpus was not read');
  assert.deepEqual(shared(entries), [],
    'two skills claim one name, and v1 keys the registry on it — the later one wins in silence');
});

test('the duplicate reading finds a planted collision [unit, control]', (t) => {
  // **The control the must-NOT is worthless without.** Absence is what the test above asserts, and
  // a reading that could never report a duplicate asserts absence just as confidently as one that
  // works. So two directories claim one name and the same `shared` is asked about them.
  const root = packageTree(t, {
    [`${PREFIX}do`]: plantedSkill(`${PREFIX}do`, 'The real one.'),
    [`${PREFIX}also-do`]: plantedSkill(`${PREFIX}do`, 'An impostor declaring the same name.'),
    [`${PREFIX}spec`]: plantedSkill(`${PREFIX}spec`, 'A skill with a name of its own.'),
  });

  assert.deepEqual(shared(plantedEntries(root)), [
    { name: `${PREFIX}do`, directories: [`${PREFIX}also-do`, `${PREFIX}do`] },
  ], 'the reading did not report two directories claiming one name');

  // And it does not report the skill that is fine, which is what stops the check being silenced by
  // an allow-list the first time it fires on the whole corpus.
  assert.equal(shared(plantedEntries(root)).some(({ name }) => name === `${PREFIX}spec`), false);
});
