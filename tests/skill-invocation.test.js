/**
 * Epic 01-03 Story 3 — how a skill is started, said in every body the same way.
 *
 * - "Every skill body's invocation prose names the v2 skill-first mechanism rather than a
 *   slash-command trigger" [unit]
 * - "In a scratch project, a user can start each of the twenty-three skills by the documented v2
 *   invocation" [manual] — the walk is its evidence, and is not doubled here.
 *
 * **The half of the criterion with teeth is the one nobody would have written down.** That no body
 * says `/dpm:spec` any more is `skill-port.test.js`'s sweep and is not repeated. What this file adds
 * is the other end of the same mechanism: `$ARGUMENTS`, which Claude Code substituted into a body
 * before the model saw it and which v2 fills with nothing. Story 2's must-NOT named the four host
 * mechanisms anyone thinks of and this was not among them, so it survived a pass that was looking
 * for exactly this kind of thing — which is why the reading is here rather than folded in as a fifth
 * pattern nobody would notice was doing any work.
 *
 * The corpus is walked rather than listed, so a skill added tomorrow is held to both readings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conventions, frontMatter, skillNames, skillSource } from './support/skills.js';

/**
 * The sentence every description ends with, built from the id the extension actually registers.
 *
 * **pi has no skill tool, so the sentence names the command.** This was `Invoke with the skill tool,
 * name "…"`, which was right for OpenCode, whose skill tool takes `name`. pi lists each skill's
 * description and file in the system prompt and starts a skill from `/skill:<name>`, or from the
 * `/dpm-*` command `commands.ts` registers for it. A model reading the old sentence under pi is
 * pointed at a tool that is not in its request.
 */
const invocation = (name) => `Run with /${name}.`;

/**
 * What the sentence must not say: the skill tool, in any form.
 *
 * **The old sentence was wrong twice, and this catches both.** Before pi, every description told the
 * model to pass `id` to OpenCode's skill tool, which takes `name`, and a model following it got
 * `SchemaError(Missing key at ["name"])`. Under pi there is no skill tool to pass anything to.
 *
 * Checked as a must-NOT beside the positive reading, because the positive one is satisfied by a
 * description that says the right thing *and* the wrong thing in the same sentence.
 */
const REFUSED = /skill tool/;

test('every description says how the skill is invoked, with its own registered id [unit]', () => {
  const names = skillNames();

  assert.equal(names.length, 23, `${names.length} skills were enumerated from the tree`);

  for (const name of names) {
    const { description } = frontMatter(skillSource(name));

    assert.ok(description, `${name} has no description, so the host can advertise nothing`);

    // **Its own id, not merely some id.** A rewrite that pasted the same sentence into all
    // twenty-three would satisfy a check for the phrase and send every reader to one skill.
    assert.ok(description.endsWith(invocation(name)),
      `${name}'s description does not end with: ${invocation(name)}`);
  }

  // The control on the reading above: it can tell a wrong id from a right one, and a missing
  // sentence from a present one. Without this, a helper returning the empty string would pass.
  assert.equal(invocation('spec').endsWith(invocation('epics')), false);
  assert.equal(`A skill. ${invocation('do')}`.endsWith(invocation('do')), true);
  assert.equal('A skill that does things.'.endsWith(invocation('do')), false);
});

test('must NOT — no description sends the model to a skill tool [unit]', () => {
  // **pi has none.** See `REFUSED` above. The sweep is over the corpus rather than a list, so a skill
  // added by copying an old description fails here rather than in someone's session.
  for (const name of skillNames()) {
    const { description } = frontMatter(skillSource(name));

    assert.doesNotMatch(description, REFUSED,
      `${name}'s description names the skill tool, which pi does not have`);
  }

  // Driven both ways, because a regex that matches nothing passes the loop above over any corpus.
  assert.match('A skill. Invoke with the skill tool, id "dpm-spec".', REFUSED);
  assert.match('A skill. Invoke with the skill tool, name "dpm-spec".', REFUSED);
  assert.doesNotMatch('A skill. Run with /dpm-spec.', REFUSED);

  // And the two readings agree: the sentence the corpus is held to is not one this refuses.
  assert.doesNotMatch(invocation('dpm-spec'), REFUSED);
});

test('no body names $ARGUMENTS, the substitution v2 does not perform [unit]', () => {
  // **The failure this catches is the quiet one.** `$ARGUMENTS` under v2 is a literal string in a
  // sentence that still reads as an instruction, so a model does not error on it — it invents a
  // value. That is worse than a broken tool name, which fails loudly at the first call.
  const offenders = skillNames()
    .filter((name) => /\$ARGUMENTS/.test(skillSource(name)));

  assert.deepEqual(offenders, [], 'a body still names Claude Code\'s argument substitution');
  assert.doesNotMatch(conventions(), /\$ARGUMENTS/,
    'the file every skill reads at startup names it, so all twenty-three inherit it');

  // Driven against the sentences the port actually removed, one per shape, because a sweep over a
  // corpus that no longer contains the thing proves nothing about the sweep.
  for (const breach of [
    '`$ARGUMENTS` is optional.',
    'If `$ARGUMENTS` names a document — a ULID, or a human reference — read it.',
    '`$ARGUMENTS` selects the action:',
  ]) {
    assert.match(breach, /\$ARGUMENTS/, `the reading passes a body containing ${breach}`);
  }

  // And the replacement is not caught, which is what makes this a reading rather than a ban on the
  // word. Every body carries the new form, so a pattern that fired on it would empty the corpus.
  assert.doesNotMatch('The request selects the action:', /\$ARGUMENTS/);
});

test('the replacement actually landed in every body, not merely the old form removed [unit]', () => {
  // **Deleting the sentence would pass the test above.** A body whose Input section lost its
  // argument contract entirely names no `$ARGUMENTS` and tells a run nothing about what it was
  // started with, so the absence has to be paired with the presence.
  const silent = skillNames()
    .filter((name) => !/\brequest\b/i.test(skillSource(name)));

  assert.deepEqual(silent, [],
    'a body names neither $ARGUMENTS nor the request, so its argument contract went missing');
});
