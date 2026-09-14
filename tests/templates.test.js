/**
 * Epic 47-04 Story 2 — a projection template for every document kind (FR10).
 *
 * Three criteria, and the first two pull in opposite directions on purpose. The enumeration is
 * *structural* — the registry's keys against `document_kind`'s rows, in both directions — and it
 * is what catches a fourteenth kind arriving by migration with nobody writing its template. The
 * appearance assertions are *behavioural* — a value written into each projectable type shows up in
 * some rendered file — and they are what catches a template that exists, is registered, and drops
 * the collection it was written for. Neither one substitutes for the other: a registry full of
 * functions returning `''` passes the first and fails the second, and a template set that renders
 * everything beautifully for twelve kinds passes the second and fails the first.
 *
 * **The type that reaches no template is named by the assertion, not left out of it.** `session`
 * has no `document_id`, so there is no parent whose template could hold it. Dropping it from the
 * fixture's list would shrink the input until the assertion passed, which proves nothing — the
 * count moves from ten to nine and nobody sees the tenth go. It is carried with its reason, and
 * the test asserts the reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPlanningDatabase } from './support/planning-database.js';
import { moduleFilesUnder } from './support/sources.js';
import { fullCorpus, PROJECTED_TYPES, UNPROJECTED_TYPES } from './support/corpus.js';
import { spineTools } from '../src/tools/index.ts';
import { project, renderDocument, TEMPLATES } from '../src/projection/index.ts';
import { identifiers, identifierOf, pathOf, ProjectionError } from '../src/projection/naming.ts';
import { MARKER } from '../src/projection/markers.ts';
import { table } from '../src/projection/text.ts';

const ROOT = join(import.meta.dirname, '..');

/** The tool surface, by name — the spine's fixtures go through it and never by `INSERT`. */
function surface(t) {
  const db = openPlanningDatabase(t);

  return { db, call: Object.fromEntries(spineTools(db).map((tool) => [tool.name, tool.handler])) };
}

/** The corpus, rendered without touching a disk. */
function rendered(t) {
  const { db, call } = surface(t);
  const documents = fullCorpus(db, call);
  const { written, inline } = project(db, { write: false });
  const names = identifiers(db);

  // The inline kinds' bytes are computed by `project` and discarded, so they are re-rendered here
  // rather than assumed empty. An ADR whose parent forgot to splice it in must still be visible to
  // an appearance assertion, or "renders inside a parent" is asserted only where it already works.
  const inlineTexts = inline.map((key) => {
    const id = key.slice(key.indexOf(':') + 1);

    return { path: null, text: renderDocument(db, id, names).text };
  });

  return { db, call, documents, written, inline, names, all: [...written, ...inlineTexts] };
}

/** Every rendered file's bytes, joined — for "does this value appear anywhere" questions. */
const corpusText = (files) => files.map((file) => file.text).join('\n');

// --- The enumeration (criterion 2) -----------------------------------------------------------

test('the template registry and the seeded document kinds name the same set', (t) => {
  const { db } = surface(t);

  const seeded = db.prepare('SELECT kind FROM document_kind ORDER BY kind').all()
    .map((row) => row.kind);
  const registered = Object.keys(TEMPLATES).sort();

  assert.equal(seeded.length, 14, 'the seed is the parity contract and it moved');

  // **Both directions, and the two failures are different.** A seeded kind with no entry ships an
  // artefact type that nothing renders; a registered kind with no seed is a template for something
  // that cannot exist, which is dead code wearing a passing coverage number.
  assert.deepEqual(registered, seeded);

  for (const [kind, template] of Object.entries(TEMPLATES)) {
    assert.equal(typeof template, 'function', `'${kind}' maps to something that is not a function`);
  }
});

test('a kind seeded without a template fails rather than rendering', (t) => {
  const { db, call } = surface(t);

  fullCorpus(db, call);

  db.prepare("INSERT INTO document_kind (kind, dir, numbering) VALUES ('ledger', 'ledgers', 'root')")
    .run();

  const seeded = db.prepare('SELECT kind FROM document_kind ORDER BY kind').all()
    .map((row) => row.kind);

  assert.notDeepEqual(Object.keys(TEMPLATES).sort(), seeded,
    'the enumeration above accepted a kind with no template');

  // And the failure is not confined to the enumeration: a document of that kind refuses the render
  // rather than reaching a default. The enumeration is the early warning; this is the behaviour.
  db.prepare(`INSERT INTO document
      (id, kind, numbering, number, slug, title, status, created_at, updated_at)
      VALUES ('led-1', 'ledger', 'root', 9, 'costs', 'Costs', 'pending',
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run();

  assert.throws(() => project(db, { write: false }), ProjectionError);
});

test('must NOT — a missing template falls back to a generic renderer', (t) => {
  const { db, call } = surface(t);

  fullCorpus(db, call);

  // The mutation this guards against is one line: `TEMPLATES[kind] ?? renderProse`. It would leave
  // every test above green — the enumeration compares keys, and a fallback adds none — so the
  // check has to be that an *unregistered* kind produces no bytes at all.
  db.prepare("INSERT INTO document_kind (kind, dir, numbering) VALUES ('ledger', 'ledgers', 'root')")
    .run();
  db.prepare(`INSERT INTO document
      (id, kind, numbering, number, slug, title, status, created_at, updated_at)
      VALUES ('led-1', 'ledger', 'root', 9, 'costs', 'Costs', 'pending',
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO document_section (id, document_id, heading, body, position)
              VALUES ('led-sec', 'led-1', 'Ledger', 'A generic renderer would print this.', 0)`)
    .run();

  let caught;

  try {
    renderDocument(db, 'led-1');
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ProjectionError, 'an untemplated kind was rendered');
  assert.match(caught.message, /no projection template for kind 'ledger'/);
  assert.doesNotMatch(caught.message, /A generic renderer would print this/,
    'the section body reached the output — something rendered it');
});

// --- Every kind renders, and the nine appear (criterion 1) -----------------------------------

test('one document of every kind renders, and only the ADR renders without a file', (t) => {
  const { db, written, inline } = rendered(t);

  const kinds = db.prepare('SELECT kind, dir FROM document_kind ORDER BY kind').all();
  const filed = kinds.filter((row) => row.dir !== null);

  // One file per kind with a `dir`, **plus the artifact register**, which is the only projected
  // file that is not a document — `artifact` is a standalone table with no kind, so it comes out of
  // `project()` directly rather than out of the per-document loop. Named in the assertion rather
  // than folded into the number, so a kind quietly losing its file cannot be absorbed by the extra.
  const register = written.filter((file) => file.path === 'docs/artifacts/index.md');

  assert.equal(register.length, 1, 'the register was not projected');
  assert.equal(written.length - register.length, filed.length,
    `${filed.length} kinds have a dir and ${written.length - register.length} files were written`);
  assert.deepEqual(inline.map((key) => key.slice(0, key.indexOf(':'))), ['adr'],
    'exactly one seeded kind renders inside its parent, and it is the ADR');

  // Each file lands where its kind's `dir` says, with the kind in the name — the two `epics` kinds
  // are the reason the kind is there at all, and they also share an identifier.
  const paths = written.map((file) => file.path).sort();

  assert.ok(paths.includes('docs/epics/01-01-epic-projection.md'));
  assert.ok(paths.includes('docs/epics/01-01-coverage_matrix-projection.md'),
    'the matrix shares its epic\'s number and is kept apart only by the kind in the filename');
  assert.equal(new Set(paths).size, paths.length, 'two documents rendered to one path');

  for (const file of written) assert.ok(file.text.startsWith('# '), `${file.path} has no title`);
});

test('every projectable non-document type appears in some rendered file', (t) => {
  const { db, all } = rendered(t);
  const text = corpusText(all);

  // Nine, and the tenth is named below rather than missing from here. Each is checked by a value
  // that only that table holds, so a template that rendered its parent and dropped the collection
  // fails — which an existence check over the tables would not.
  const evidence = {
    requirement: 'FR10',
    milestone: 'Substrate',
    story: 'Write a template for every kind',
    task: 'Write the templates',
    story_criterion: 'Each kind renders',
    coverage: 'Every kind has a template',
    finding: 'Hidden Complexity',
    observation: 'A structural check has nothing to be lucky about',
    artifact: 'The projection, illustrated',
  };

  assert.deepEqual(Object.keys(evidence).sort(), Object.keys(PROJECTED_TYPES).sort());
  assert.equal(Object.keys(evidence).length, 9);

  for (const [type, value] of Object.entries(evidence)) {
    const rows = db.prepare(`SELECT count(*) AS n FROM ${PROJECTED_TYPES[type].table}`).get().n;

    assert.ok(rows > 0, `the fixture wrote no ${type} rows, so its appearance proves nothing`);
    assert.ok(text.includes(value), `no ${type} reached the projection — looked for '${value}'`);
  }
});

test('the type that reaches no template is named, with the reason it cannot', (t) => {
  const { db, call } = surface(t);

  fullCorpus(db, call);

  // **This is the assertion that would have hidden the count.** The story renders nine of the
  // parity list's ten non-document types, and the honest way to say so is to carry the tenth and
  // state why — not to shorten the list until the sum works out.
  assert.deepEqual(Object.keys(UNPROJECTED_TYPES), ['session']);
  assert.equal(Object.keys(PROJECTED_TYPES).length + Object.keys(UNPROJECTED_TYPES).length, 10,
    'the parity list names ten non-document types; this set no longer accounts for all of them');

  // The reason is structural and checkable: `session` has no column joining it to a document, so
  // no parent's template could reach it even if one wanted to.
  const columns = db.prepare('PRAGMA table_info(session)').all().map((column) => column.name);

  assert.ok(!columns.includes('document_id'), UNPROJECTED_TYPES.session);

  for (const type of Object.keys(PROJECTED_TYPES)) {
    const table_ = PROJECTED_TYPES[type].table;
    const own = db.prepare(`PRAGMA table_info(${table_})`).all().map((column) => column.name);
    const links = db.prepare(`PRAGMA foreign_key_list(${table_})`).all().map((key) => key.table);

    assert.ok(own.length > 0, `${type}: '${table_}' is not a table`);
    assert.ok(links.length > 0 || type === 'artifact',
      `${type} claims a parent template but joins to nothing`);
  }
});

test('a kind whose template drops a collection fails the appearance check', (t) => {
  const { db, all } = rendered(t);

  // The control for the test above: the values it looks for are not in the corpus by accident —
  // remove the rows and they are gone from the render. Without this, an assertion that a string
  // appears somewhere in fourteen files is satisfied by any file that happens to contain it.
  assert.ok(corpusText(all).includes('Hidden Complexity'));

  db.prepare('DELETE FROM finding').run();

  const after = project(db, { write: false }).written.map((file) => file.text).join('\n');

  assert.ok(!after.includes('Hidden Complexity'), 'the finding survived its own deletion');
});

// --- The shapes each template is responsible for ---------------------------------------------

test('the ADR renders inside its parent and as its own bytes, from one set of blocks', (t) => {
  const { db, all, written } = rendered(t);
  const spec = written.find((file) => file.path.startsWith('docs/specifications/'));

  // Inside the spec — which is the criterion's clause, and the only place a reader meets it.
  assert.match(spec.text, /## Architecture Decisions/);
  assert.match(spec.text, /### 01-01 — The projection is one-way/);
  assert.match(spec.text, /\*\*Decision status\*\*: accepted/);
  assert.match(spec.text, /One-way projection — chosen/);
  assert.match(spec.text, /\| cost \| low \|/);

  // And standalone, at the top level, from the same blocks. `project` computes these bytes and
  // writes none of them — which is what render-checks an ADR whose parent's template forgot it.
  const standalone = all.find((file) => file.path === null);

  assert.match(standalone.text, /^# 01-01 — The projection is one-way/);
  assert.match(standalone.text, /## One-way projection — chosen/);

  assert.equal(db.prepare("SELECT dir FROM document_kind WHERE kind = 'adr'").get().dir, null,
    'the ADR gained a dir, and with it a file the criterion says it does not have');
});

test('a coverage matrix renders its epic\'s rows and no other epic\'s', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  // A second epic under the same spec, with its own story, criterion and coverage row. The matrix
  // reaches its rows through its epic, and the only thing stopping it reaching these is that
  // filter — which no fixture with one epic in it can exercise.
  const other = call.create_epic({
    parent_id: built.spec.id, slug: 'merge', title: 'Merge and renumber',
  });
  const otherStory = call.create_story({
    epic_id: other.id, number: 1, title: 'Renumber the loser', position: 0,
  });
  const otherCriterion = call.create_story_criterion({
    story_id: otherStory.id, text: 'A renumber renames the file', polarity: 'must', position: 0,
  });
  const requirement = call.create_requirement({
    spec_id: built.spec.id, label: 'FR11', class: 'functional',
    text: 'A renumber renames its projection file.', position: 1,
  });

  call.create_coverage({
    requirement_id: requirement.id, spec_fragment: 'renames its projection file',
    story_criterion_id: otherCriterion.id, position: 1,
  });

  const matrix = project(db, { write: false }).written
    .find((file) => file.path.includes('coverage_matrix'));

  assert.match(matrix.text, /Each kind renders/, 'its own epic\'s criterion');

  // **The witness is the coverage row's own `spec_fragment`, not the criterion's text.** A filter
  // replaced by a fallback — `criteria.get(id) ?? {criterion: {text: ''}}` — renders the foreign
  // row with an empty criterion cell, so a test watching the criterion text sees nothing and
  // passes. `spec_fragment` lives on the row being wrongly included and no fallback can blank it.
  assert.doesNotMatch(matrix.text, /renames its projection file/,
    'another epic\'s coverage row rendered into this matrix');

  // And the count, which is the assertion no substitution survives: one row in, one row out.
  const body = matrix.text.split('\n').filter((line) => line.startsWith('| 1 |'));

  assert.equal(body.length, 1, 'the matrix rendered a row it has no criterion for');

  // Two rows, both this epic's: the corpus binds the same criterion twice, once live and once
  // withdrawn. **A retired binding renders**, as a retired observation and a retired artifact do —
  // the matrix is the record of what was bound, and a row that vanished from it would take the
  // reason it was withdrawn with it. So the number to hold here is this epic's rows, not the live
  // ones; what the filter excludes is the foreign epic's row asserted above.
  assert.equal(matrix.text.split('\n').filter((line) => /^\| \d+ \|/.test(line)).length, 2);

  // The control: all three coverage rows exist, so the absence above is the filter working rather
  // than the foreign row never having been written.
  assert.equal(db.prepare('SELECT count(*) AS n FROM coverage').get().n, 3);

  const otherMatrix = project(db, { write: false }).written
    .filter((file) => file.path.includes('coverage_matrix'));

  assert.equal(otherMatrix.length, 1, 'the second epic has no matrix, so its row renders nowhere');
});

test('a table cell containing a pipe or a newline stays one cell', () => {
  // Asserted on `text.js` rather than through a template, because the rule is about bytes and every
  // template reaching it goes through this one function. The values most likely to carry a pipe are
  // a coverage matrix's, which are verbatim fragments of somebody else's markdown.
  const built = table(['A', 'B'], [['x | y', 'one\ntwo']]);
  const rows = built.split('\n');

  assert.equal(rows.length, 3, 'a newline in a cell became a row');
  assert.equal(rows[2], '| x \\| y | one two |');
});

test('a story-scoped observation renders on its epic as well as in the retro', (t) => {
  const { db, written } = rendered(t);

  // **Both, because the row belongs to both.** `observation.story_id` is the origin and survives
  // promotion into a retro; `retro_id` is the grouping. The DDL is explicit that an exclusive
  // constraint between them would make gathering an observation destroy where it came from, so a
  // template set that rendered it only under the retro would drop the story's `**Retro**:` half —
  // and the whole-corpus appearance check would not notice, because the retro still holds it.
  const epic = written.find((file) => file.path === 'docs/epics/01-01-epic-projection.md');
  const retro = written.find((file) => file.path.startsWith('docs/retros/'));

  assert.match(epic.text, /### Retro/);
  assert.match(epic.text, /A structural check has nothing to be lucky about/);
  assert.match(retro.text, /A structural check has nothing to be lucky about/);

  assert.equal(db.prepare('SELECT count(*) AS n FROM observation').get().n, 1,
    'one row reached two files, which is the point');
});

test('a parentage cycle fails the render rather than hanging it', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  // **Written with foreign keys off, which is not a shortcut — it is the only way in.** The
  // parentage allow-list has no `(X, X)` pair and no pair whose reverse it also holds, so a cycle
  // is unwritable through the constrained path. It arrives by restore, where foreign keys are off
  // by construction, and by a migration that seeds a pair somebody did not think through. Register
  // entry 1 *reports* cycles rather than the schema preventing them, so the renderer meets one
  // eventually — and without a guard the ancestry walk loops forever. A hung projection is worse
  // than a failed one: it produces no diagnostic at all, so there is nothing for a caller to
  // report or for Story 3's guard to fail on.
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('UPDATE document SET parent_id = id, parent_kind = kind WHERE id = ?')
    .run(built.epic.id);
  db.exec('PRAGMA foreign_keys = ON');

  assert.throws(() => renderDocument(db, built.epic.id), ProjectionError);

  // `identifiers` omits what it cannot name rather than raising — a `numbering = 'none'` document
  // is a legitimate row — so the cycle costs the epic its number and leaves the rest intact.
  const names = identifiers(db);

  assert.ok(!names.has(built.epic.id));
  assert.equal(names.get(built.spec.id), '01');
});

// --- The direction of a blocking edge (quick 01) ----------------------------------------------

/**
 * Every story's `**Blocked by**` line in a rendered epic, by story number.
 *
 * Read out of the bytes rather than off the tree, because the bytes are what was wrong: the tree
 * held the right rows throughout, and a check that asked the loader what it loaded would have
 * agreed with the loader about the end it was reading from.
 *
 * The lazy span stops at the first `**Blocked by**` after each heading, which is the story's own —
 * the field is emitted once per story, immediately under `**Status**`.
 */
function blockedByLines(text) {
  return new Map([...text.matchAll(/^## Story (\d+) —[\s\S]*?^\*\*Blocked by\*\*: (.*?) *$/gm)]
    .map(([, number, names]) => [Number(number), names]));
}

/** The rendered epic the corpus builds, by the path it publishes to. */
const projectedEpic = (db, path = 'docs/epics/01-01-epic-projection.md') => project(db, { write: false })
  .written.find((file) => file.path === path);

test('a story blocked by a story in another epic names that epic [unit]', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  const other = call.create_epic({
    parent_id: built.spec.id, slug: 'merge', title: 'Merge and renumber',
  });
  const otherStory = call.create_story({
    epic_id: other.id, number: 4, title: 'Renumber the loser', position: 0,
  });
  const mine = db.prepare('SELECT id FROM story WHERE number = 1 AND epic_id = ?').get(built.epic.id);

  // **Source blocks target**, so the story in the other epic is the source: it is the one holding
  // story 1 up, and story 1 is where its name has to appear. This edge ran the other way round
  // until quick 01, when the assertion below still passed — the template read the source end and
  // printed the target, so an inverted row and an inverted reading agreed on the answer.
  call.create_dependency({
    kind: 'blocks', source_story_id: otherStory.id, target_story_id: mine.id,
  });

  // `Story 4` alone would be ambiguous the moment the edge leaves the epic, and cross-epic story
  // blocking is one of the two directions `010-dependency.sql` says occurs in real epics.
  assert.equal(blockedByLines(projectedEpic(db).text).get(1), '01-02 Story 4');
});

test('must NOT — a story names what it blocks under `**Blocked by**` [integration]', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  const other = call.create_epic({
    parent_id: built.spec.id, slug: 'merge', title: 'Merge and renumber',
  });
  const otherStory = call.create_story({
    epic_id: other.id, number: 4, title: 'Renumber the loser', position: 0,
  });
  const mine = db.prepare('SELECT id FROM story WHERE number = 1 AND epic_id = ?').get(built.epic.id);

  call.create_dependency({
    kind: 'blocks', source_story_id: otherStory.id, target_story_id: mine.id,
  });

  // **Its own test rather than a second assertion on the one above**, because the two fail
  // together and the first one shadows this: a run that stopped at "story 1 says `Story 2`" never
  // reached the half asking what story 4 said, and a must-NOT nothing executed is not a control.
  // Against the pre-quick template this line held `01-01 Story 1` — the blocker's file naming the
  // work it releases under a heading that says the reverse.
  assert.equal(
    blockedByLines(projectedEpic(db, 'docs/epics/01-02-epic-merge.md').text).get(4),
    '—',
  );

  // The corpus's own sibling edge, over a story that blocks and is not blocked. The cross-epic
  // case above could pass on a template that simply failed to resolve a foreign epic.
  assert.equal(blockedByLines(projectedEpic(db).text).get(1), '01-02 Story 4');
  assert.equal(blockedByLines(projectedEpic(db).text).get(2), 'Story 1');
});

test("a story's Blocked by line agrees with the readiness query [integration]", (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  const lines = blockedByLines(projectedEpic(db).text);

  // **The oracle is the tool surface, not a second walk of the same table.** `ready` is
  // `readyClause`, which is where the direction is stated and believed; recomputing the edges here
  // would be the template's own reading written twice and agreeing with itself. Every story in the
  // corpus is pending and no blocker is complete, so ready is exactly "nothing holds it".
  const ready = new Set(call.list_story({ epic_id: built.epic.id, ready: true }).items
    .map((row) => row.number));

  assert.ok(ready.size > 0 && ready.size < lines.size,
    `the corpus must hold both a ready story and a held one for this to say anything; `
    + `${ready.size} of ${lines.size} are ready`);

  for (const [number, names] of lines) {
    assert.equal(names === '—', ready.has(number),
      `Story ${number} renders \`${names}\` and the readiness query `
      + `${ready.has(number) ? 'does not hold it' : 'holds it'}`);
  }
});

test('a story blocked by a whole epic names that epic [unit]', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  const other = call.create_epic({
    parent_id: built.spec.id, slug: 'merge', title: 'Merge and renumber',
  });
  const mine = db.prepare('SELECT id FROM story WHERE number = 1 AND epic_id = ?').get(built.epic.id);

  // `source_document_id` with `target_story_id` — a story waiting on a whole epic, which
  // `readiness.ts` names as one of the two ways a story is held and which the source-keyed read
  // could not reach at all: the row has no `source_story_id` to be found by.
  call.create_dependency({
    kind: 'blocks', source_document_id: other.id, target_story_id: mine.id,
  });

  assert.equal(blockedByLines(projectedEpic(db).text).get(1), '01-02');
});

// --- Determinism and fidelity, over the whole set --------------------------------------------

test('every stored section reaches the file its document renders to', (t) => {
  const { db, written, names } = rendered(t);
  const byPath = new Map(written.map((file) => [file.path, file.text]));

  // **Driven from the table, not from a list written beside it.** Four kinds share `renderProse`,
  // and a `renderProse` that emitted only its header would leave every other test here green: the
  // enumeration counts keys, the appearance checks name values that live on other kinds, and a
  // header-only file still starts with `# `. This is the fidelity criterion applied per kind —
  // whatever sections a document holds must be in the bytes that document produced.
  const sections = db.prepare(`
    SELECT s.document_id, s.heading, s.body, d.kind
      FROM document_section AS s JOIN document AS d ON d.id = s.document_id
     ORDER BY s.document_id, s.position
  `).all();

  assert.ok(sections.length >= 7, `${sections.length} sections is too few to cover the kinds`);

  const covered = new Set();

  for (const section of sections) {
    const path = written.find((file) =>
      file.path.includes(`/${names.get(section.document_id)}-${section.kind}-`))?.path;

    assert.ok(path, `${section.kind} '${section.document_id}' rendered to no file`);
    assert.ok(byPath.get(path).includes(section.heading),
      `${path} dropped the heading '${section.heading}'`);
    assert.ok(byPath.get(path).includes(section.body),
      `${path} dropped the body of '${section.heading}'`);

    covered.add(section.kind);
  }

  // The four kinds that share a template are all in the fixture, so the check above is over the
  // shared path and not only over the kinds that happen to have one of their own.
  for (const kind of ['problem_brief', 'product_brief', 'discussion', 'runbook']) {
    assert.ok(covered.has(kind), `no ${kind} section in the fixture, so nothing was checked`);
  }
});

test('the whole corpus regenerates byte-identically', (t) => {
  const { db, written } = rendered(t);

  const again = project(db, { write: false }).written;

  assert.equal(again.length, written.length);

  for (const [index, file] of again.entries()) {
    assert.equal(file.path, written[index].path);
    assert.equal(file.text, written[index].text, `${file.path} is not stable`);
  }
});

test('no marker survives into any file, in any template', (t) => {
  const { all } = rendered(t);

  // The corpus plants a marker in a section body, a requirement text, an `adr.decision` and a
  // `finding.summary` — four columns in four different templates, because the reference model the
  // spec rejected reached section bodies only.
  for (const file of all) {
    assert.doesNotMatch(file.text, MARKER, `${file.path ?? 'inline'} shipped a marker verbatim`);
  }

  assert.match(corpusText(all), /Superseded by spec 01\./, 'requirement.text');
  assert.match(corpusText(all), /The matrix reaches its rows through spec 01\./, 'finding.summary');
});

test('every file ends in exactly one newline and holds no CRLF', (t) => {
  const { written } = rendered(t);

  for (const { path, text } of written) {
    assert.ok(text.endsWith('\n'), `${path} does not end in a newline`);
    assert.ok(!text.endsWith('\n\n'), `${path} ends in a blank line`);
    assert.ok(!text.includes('\r'), `${path} carries a CR`);
  }
});

// --- The rules no fixture can fail (carried forward from Story 1) ----------------------------

test('nothing in the render path sorts by locale, or reads a clock', () => {
  const files = moduleFilesUnder(join(ROOT, 'src/projection'));

  assert.ok(files.length >= 12, `only ${files.length} render modules were swept`);

  const code = (file) => readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  const forbidden = /localeCompare|\bIntl\b|toLocale[A-Z]|Date\.now|new Date/;

  for (const file of files) {
    assert.doesNotMatch(code(file), forbidden, `${file} reaches for a locale or a clock`);
  }

  // The positive control. Without it an empty result is indistinguishable from a regex that
  // matches nothing, which is how this rule escaped Story 1's nineteen tests.
  assert.match('rows.sort((a, b) => a.localeCompare(b))', forbidden);
});

test('every identifier a template prints comes from identifierOf', (t) => {
  const { db, documents, names } = rendered(t);

  // Story 1's one idea, held across twelve more templates: the filename and the marker resolution
  // are one derivation. A template that built `${number}-${sequence}` itself would survive every
  // other test here and produce, at Story 4's renumber, a file whose name and inbound references
  // disagreed.
  for (const document of Object.values(documents)) {
    const row = db.prepare('SELECT * FROM document WHERE id = ?').get(document.id);
    const ancestry = [];

    for (let at = row; at.parent_id !== null;) {
      at = db.prepare('SELECT * FROM document WHERE id = ?').get(at.parent_id);
      ancestry.push(at);
    }

    const identifier = identifierOf(row, ...ancestry);

    assert.equal(names.get(row.id), identifier, `${row.kind}: the map and the function disagree`);

    const path = pathOf(db, row, ...ancestry);

    if (path !== null) assert.ok(path.includes(`/${identifier}-${row.kind}-`), path);
  }
});

test('a coverage matrix is numbered through its epic to the spec above it', (t) => {
  const { db, call } = surface(t);
  const built = fullCorpus(db, call);

  // The two-deep chain, which is the only one the seeded parentage allows and the one that had no
  // identifier at all before this story: `identifierOf` required the *parent* to be root-numbered,
  // and a matrix's parent is an epic.
  const names = identifiers(db);

  assert.equal(names.get(built.epic.id), '01-01');
  assert.equal(names.get(built.coverage_matrix.id), '01-01');

  const matrix = db.prepare('SELECT * FROM document WHERE id = ?').get(built.coverage_matrix.id);
  const epic = db.prepare('SELECT * FROM document WHERE id = ?').get(built.epic.id);
  const spec = db.prepare('SELECT * FROM document WHERE id = ?').get(built.spec.id);

  // With only the epic in hand there is no number to build from — the failure the old rule
  // reported as a schema gap, which it was not.
  assert.throws(() => identifierOf(matrix, epic), ProjectionError);
  assert.equal(identifierOf(matrix, epic, spec), '01-01');
});
