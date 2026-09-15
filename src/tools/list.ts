/**
 * A list tool per spine type — the subject FR13's bound was missing.
 *
 * **Why these exist in this story rather than a later one.** Story 2 and Story 3 built twenty-seven
 * tools and not one of them returns more than a single row: every read is by primary key, and
 * `check_integrity` is deliberately unbounded (a truncated integrity report is precisely the
 * false pass NFR6 forbids, and it is excluded here for that reason, not by oversight). FR13's
 * criterion — "every list-returning tool declares a `limit` with a default, and a caller that
 * raises it receives the larger result" — and its must-NOT would both have passed by having
 * nothing to check. A requirement that cannot fail is not covered.
 *
 * **The scope argument is optional on every one of them.** Listing an epic's stories is the common
 * call, but "every task in the project" is a legitimate one, and refusing it would make the bound
 * a substitute for a query rather than a default over one. Optional scope is also what gives the
 * must-NOT something to bite on: an unscoped list over a large table is exactly the unbounded row
 * set FR13 forbids, so the limit has to be doing real work rather than shadowing a `WHERE`.
 *
 * **`body` is copied off the matching read tool, never restated.** A list that withheld a
 * different set of columns from the read of the same type would be two answers to one question,
 * and the pair a caller compares most often is `list_x` then `read_x`.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Tool } from './convention.ts';

import { defineTool, ToolError } from './convention.ts';
import { selectPage, includeFlag } from './query.ts';

/** What a scope column must name: a row of `parent` whose `key` is the value given. */
type Reference = { parent: string; key: string };

/** A table's first primary key column, absent for a table keyed on its rowid. */
function primaryKey(db: DatabaseSync, table: string): string | undefined {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>)
    .find((column) => column.pk === 1)?.name;
}

/** The scope columns of `table` a caller supplies that are foreign keys, with what each names. */
function scopeReferences(db: DatabaseSync, table: string, columns: string[]): Map<string, Reference> {
  const keys = db.prepare(`PRAGMA foreign_key_list(${table})`)
    .all() as Array<{ from: string; table: string; to: string | null }>;

  return new Map(keys
    .filter((key) => columns.includes(key.from))
    .map((key) => [key.from, { parent: key.table, key: key.to ?? primaryKey(db, key.table) ?? 'rowid' }]));
}

/** Tables keyed on a column named `id`, which is where a stray id can be looked for. */
function idTables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((table) => primaryKey(db, table) === 'id')
    .sort();
}

/** One list tool's declaration, whether written out in `LISTS` or derived from the schema. */
type ListDescriptor = {
  type: string;
  table: string;
  fixed?: Record<string, unknown>;
  within?: string;
  scopes?: string[];
  gated?: string;
  live?: string;
  order: string[];
  documentRows?: boolean;
};

/**
 * One row per list tool, for the types that are not document kinds. The kinds are derived instead,
 * by `documentLists` below.
 *
 * `fixed` is scoping the tool applies whatever the caller says — `document` holds every kind in one
 * table, and `list_spec` returning epics would make the type in the name mean nothing, the same
 * rule the kind-scoped read tools already hold to.
 *
 * `order` ends in the table's own primary key everywhere — `id` on the spine types, the term itself
 * on a vocabulary: `position` and `number` are unique only within a parent, so on an unscoped list
 * they tie, and a tie in an ordered page is a row that can appear twice or not at all across two
 * calls. The key is what the table guarantees unique, which is not always the column named `id`.
 *
 * `live` marks the four vocabularies, whose lists are the roster a skill offers a choice from. It
 * is the difference between a term being retired and a term being gone: the row stays readable by
 * key and stops being offered.
 */
const LISTS: ListDescriptor[] = [
  { type: 'requirement', table: 'requirement', within: 'spec_id', order: ['position', 'id'] },
  {
    type: 'acceptance_criterion',
    table: 'acceptance_criterion',
    within: 'requirement_id',
    order: ['position', 'id'],
  },
  // Declared for `live` alone — the scope and the order are what derivation already produced.
  //
  // A criterion is superseded when an amendment overtakes it, and it stays readable because the
  // bindings hanging off it are the record of what was verified against the wording it had. The
  // word is `018-section-supersession.sql`'s rather than a retirement's, so a reader asking for the
  // story's history passes `include_superseded` — derived from the column name, not declared here.
  {
    type: 'story_criterion',
    table: 'story_criterion',
    within: 'story_id',
    live: 'superseded_at',
    order: ['position', 'id'],
  },
  { type: 'story', table: 'story', within: 'epic_id', gated: 'story', order: ['number', 'id'] },
  { type: 'task', table: 'task', within: 'story_id', order: ['number', 'id'] },
  // `story_criterion_id` alongside the owner because both directions of the binding are asked for:
  // `epics` walks a spec's requirements to find gaps, and `do` walks a story's criteria to record
  // verifications. Without it the second is a sweep of every requirement in the spec, filtered by
  // the caller — which is a join done in prose.
  //
  // **`live`.** A retired binding is one somebody withdrew — the fragment was wrong, or the
  // criterion it named was superseded — and it stays readable because the register's account of
  // what was once bound is the thing retirement exists to keep. What it must stop doing is counting:
  // a roll-up that offered it would report a requirement discharged by a binding nobody stands
  // behind. `include_retired` is for the reader auditing the withdrawal rather than adding up the
  // coverage, and it is derived from the column name.
  {
    type: 'coverage',
    table: 'coverage',
    within: 'requirement_id',
    scopes: ['story_criterion_id'],
    live: 'retired_at',
    order: ['position', 'id'],
  },

  // Declared rather than derived, for both of the reasons the derivation cannot reach.
  //
  // **The origin scopes.** Derivation takes the first foreign key in column order, which here is
  // `retro_id` — the grouping. `story_id` and `quick_id` are the two *origins*, and an observation
  // carries one from the moment `do` or `quick` writes it, which is before any retro exists to
  // group it under. Without the scopes, "the observations of this story" is an unscoped list
  // filtered by the caller, and the whole point of the inclusive parentage is that the origin stays
  // queryable. Two columns rather than one polymorphic pair, because they reference different
  // tables and the foreign keys are what make each origin checkable.
  //
  // **`library_doc_id` is the same argument run backwards, and it is why provenance is an edge
  // rather than a source line.** A promoted lesson points at the library entry it became; without
  // the scope, a reader holding the entry can only list every observation and filter — and every
  // one of them is retired, so the filter has to ask for the retired rows first, which is a caller
  // reconstructing the query the tool exists to answer. With it, "which observations became this
  // entry, and which stories did they come from" is one call, and the `→`-joined `**Source**` line
  // CPM parsed out of prose is replaced by something readable from both ends.
  //
  // **`live`.** Retirement on an observation means the lesson is spent or has graduated to the
  // library, and a retired one must never be offered as a candidate again — that is what stops a
  // promoted lesson being promoted twice. Left to the caller it is a convention a skill remembers;
  // here it is the same `WHERE` clause the four vocabularies already get, with `include_retired`
  // for the reader that wants the audit trail rather than the roster. Provenance is that reader:
  // a `library_doc_id` scope always wants `include_retired`, because promotion retires in the same
  // call that sets the link.
  {
    type: 'observation',
    table: 'observation',
    within: 'retro_id',
    scopes: ['story_id', 'quick_id', 'library_doc_id'],
    live: 'retired_at',
    order: ['position', 'id'],
  },

  // Declared for `live` alone — the scope and the order are what derivation already produced.
  //
  // A section is superseded when a consolidation folds it into one that says it better, and the
  // amendment stays readable rather than being deleted because it is the record of how the document
  // came to say what it says. Left to the caller that exclusion is a filter every reader has to
  // remember, and the readers here are every skill's Library Check — so the one that forgot would
  // render an amendment beside the body it was already folded into and report a document that
  // contradicts itself.
  {
    type: 'document_section',
    table: 'document_section',
    within: 'document_id',
    live: 'superseded_at',
    order: ['position', 'id'],
  },

  // The other direction of the artifact join. Derivation takes the first column of a composite key,
  // which here is `artifact_id` — "what was this artifact published from". The reverse question,
  // "what has already been published from this document", is the one a regeneration asks, and it is
  // asked before the artifact's id is known: a run holding its sources and no artifact has nothing
  // to scope by. Without it the check is a list of every artifact in the project compared in the
  // caller, so a project with more artifacts than one page silently mints a second row for a source
  // set that already has one — an unbounded scan producing a duplicate, which is both halves of what
  // FR13 and FR2 are for.
  //
  // Both ends optional and ANDed, as on `dependency`: the pair is the primary key, so supplying both
  // is an existence check on one edge, which is what an update-in-place offer needs to be certain of.
  {
    type: 'artifact_document',
    table: 'artifact_document',
    within: 'artifact_id',
    scopes: ['document_id'],
    order: ['artifact_id', 'document_id'],
  },

  // The edge table, whose scope is named rather than derived — see `UNOWNED` below. Every end is
  // optional and they AND, so "what blocks this story" is one call and so is "every edge of this
  // kind". `kind` earns its place here because the ends are present alongside it: on its own it
  // was the wrong question, which is what deferred this tool.
  {
    type: 'dependency',
    table: 'dependency',
    scopes: ['kind', 'source_document_id', 'source_story_id',
      'target_document_id', 'target_story_id'],
    order: ['id'],
  },

  // Declared for `live` alone; derivation already lists it unscoped, a table with no foreign key.
  //
  // A retired artifact is one this project no longer points anyone at — superseded, replaced, or
  // gone — and it must stay readable, because "what happened to that page?" is one of the questions
  // the register exists to answer. That is the vocabularies' rule exactly, and `include_retired` is
  // what the reader asking the historical question passes.
  { type: 'artifact', table: 'artifact', live: 'retired_at', order: ['id'] },

  // The kinds themselves, which is the roster `templates` offers a choice from. Every other list
  // here enumerates rows a project wrote; this one enumerates what a project *can* write, and
  // without it a skill asking "which kinds are there?" has to carry the thirteen in its own prose —
  // a list that goes stale the moment a project seeds a fourteenth, with no diagnostic. Ordered on
  // `kind`, which is the table's primary key, so there is nothing left to tiebreak; two kinds share
  // a directory (`epic` and `coverage_matrix`), so ordering by `dir` would not be total.
  { type: 'document_kind', table: 'document_kind', order: ['kind'] },

  // The vocabularies. A term is reachable by key without these, and a *roster* is not — FR24's
  // "extensible per project" is only observable if something can enumerate what the project now
  // has, and the party, review and consult rosters are that enumeration.
  {
    type: 'taxonomy',
    table: 'taxonomy',
    within: 'domain',
    live: 'retired_at',
    order: ['position', 'id'],
  },
  { type: 'agent', table: 'agent', live: 'retired_at', order: ['position', 'name'] },
  { type: 'test_approach', table: 'test_approach', live: 'retired_at', order: ['position', 'tag'] },
  {
    type: 'dependency_kind',
    table: 'dependency_kind',
    live: 'retired_at',
    order: ['position', 'kind'],
  },
];

/**
 * The document kinds' lists, derived from `document_kind` rather than declared above.
 *
 * **A kind acquires its list tool by being seeded**, which is the same rule `spineTools` applies to
 * create, read and update — and it is here for a reason found rather than anticipated. Only `spec`
 * and `epic` were listed by hand, so eleven of the thirteen kinds could be read by key and not
 * enumerated at all. That is invisible to `dpm/tests/parity.test.js`, which compares tables against
 * the registry and sees a `document` table well covered; it surfaced on the first attempt to
 * convert a skill, because a skill that must find "the product briefs in this project" without
 * reading a directory has nothing to call. A hand-kept list here would have to be edited for every
 * kind seeded afterwards, and that is the drift this spec exists to remove.
 *
 * **Order follows `numbering`; the parent scope follows parentage, and they are not the same
 * question.** A root-numbered kind is unique on `number` across the project and a child-numbered
 * one only within its parent, so the two order differently. But a kind can be root-numbered and
 * still have a parent — `retro` hangs off an epic, `review` off a spec or an epic, `product_brief`
 * off a problem brief — and deriving the scope from `numbering` left all three listable only
 * unscoped. That is not a missing convenience: "the retros of this epic" is how a roll-up finds a
 * completed epic that has none, and answering it by listing every retro in the project and matching
 * parents in the run is the join-in-the-caller this file exists to remove. `document_kind_parent`
 * already says which kinds have parents, so the scope is read from there. Both orders end on `id`,
 * for the tiebreaker reason given above.
 *
 * `live: 'archived_at'` applies to every kind, because archival is on `document` rather than on any
 * one of them. It is the same clause the vocabularies get and a different word for it — see
 * `includeFlag`.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {object[]}
 */
function documentLists(db: DatabaseSync): ListDescriptor[] {
  const parented = new Set(
    (db.prepare('SELECT DISTINCT kind FROM document_kind_parent').all() as Array<{ kind: string }>)
      .map((row) => row.kind),
  );

  return (db.prepare('SELECT kind, numbering FROM document_kind ORDER BY kind')
    .all() as Array<{ kind: string; numbering: string }>)
    .map(({ kind, numbering }) => ({
      type: kind,
      table: 'document',
      fixed: { kind },
      gated: 'document',
      live: 'archived_at',
      // FR1, and set here rather than on every entry in `LISTS`: this is the one builder whose
      // rows are documents, and it is derived per seeded kind — so a kind seeded later carries
      // the reference by being seeded, with nothing to add to a list of tool names.
      documentRows: true,
      ...(parented.has(kind) ? { within: 'parent_id' } : {}),
      order: numbering === 'child' ? ['sequence', 'id'] : ['number', 'id'],
    }));
}

/**
 * A composite-key pin rather than a scope. `milestone.spec_kind` accompanies `spec_id` to hold the
 * foreign key to one kind; it narrows nothing on its own, and a list scoped by it would offer a
 * caller an argument with one legal value.
 */
const PIN = /_(kind|domain)$/;

/**
 * Child tables whose owner cannot be derived, named here with the reason rather than guessed at.
 *
 * `dependency` is an edge with two ends and four candidate columns, and the rule below would scope
 * it on `kind` — answering "every edge that blocks" where a caller asking for a list of an entity's
 * dependencies means "the edges into this story". A tool that answers a different question from the
 * one its name asks is worse than a missing tool, because the caller has no reason to check.
 *
 * **It stays exempt from derivation and is declared in `LISTS` instead**, with all four ends
 * offered separately, so the caller says which question it is asking rather than the schema
 * guessing. The direction the deferral was waiting on came out the other way from expected:
 * readiness is not a scoping of this tool at all but a clause on the blocked table's own list —
 * `ready` on `list_story` and `list_epic`, from `readyClause`. This tool answers the second half,
 * *why* not, which a boolean cannot.
 */
const UNOWNED = new Set(['dependency']);

/**
 * The child and link tables' lists, derived from the schema.
 *
 * **Every read tool is by primary key, so before this existed a child row could be created and
 * never found again.** `read_observation` needs an id, and nothing answered "the observations
 * of this retro" — so a skill's only route back to a child row was the rendered markdown, which is
 * the one thing FR25 forbids. Nineteen tables were in that state. It is invisible to
 * `dpm/tests/parity.test.js`, which asks whether a table has *a* tool rather than whether its rows
 * are reachable by someone who does not already hold their ids.
 *
 * Two shapes, both read off the table rather than declared:
 *
 * - **A composite key is its own scope.** `library_scope` is keyed `(document_id, scope)`, so the
 *   first key column is the owner and the whole key is the order — already unique, no tiebreak to
 *   add.
 * - **A single `id` takes the first foreign key in column order**, skipping the pins above. That
 *   is the parent in every case here: `observation.retro_id` precedes `story_id`, and
 *   `finding.review_id` precedes the taxonomy references. A table with no foreign key at all —
 *   `artifact` — lists unscoped, which is the same shape `list_agent` already has.
 *
 * `position` leads the order where the table has one and the key follows it, for the tiebreak
 * reason `LISTS` gives: `position` is unique within a parent and ties across the table.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object[]} spine
 * @returns {object[]}
 */
function childLists(db: DatabaseSync, spine: Tool[]): ListDescriptor[] {
  const covered = new Set(['document', ...LISTS.map((entry) => entry.table)]);

  const tables = [...new Set(spine
    .filter((tool) => tool.name.startsWith('create_'))
    .map((tool) => tool.table))]
    .filter((table) => !covered.has(table) && !UNOWNED.has(table))
    .sort();

  return tables.map((table) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ pk: number; name: string }>;
    const key = columns.filter((column) => column.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    const foreign = new Set(
      (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string }>)
        .map((entry) => entry.from),
    );

    const within = key.length > 1
      ? key[0]
      : columns.map((column) => column.name)
        .find((name) => foreign.has(name) && !PIN.test(name));

    return {
      type: table,
      table,
      within,
      order: [...(columns.some((column) => column.name === 'position') ? ['position'] : []), ...key],
    };
  });
}

/**
 * Build the list tools, taking each one's body columns from its own read tool.
 *
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @param {object[]} spine The already-built spine tools, which is where `body` comes from.
 * @returns {object[]}
 */
export function listTools({ db }: { db: DatabaseSync }, spine: Tool[]): Tool[] {
  const all = [...documentLists(db), ...LISTS, ...childLists(db, spine)];

  // **A scope naming no row of the table it references is refused, where it used to list nothing.**
  // An MTPLX epics run read its story tags back through `list_criterion_approach` with story
  // criterion ids — the spec side's tool — got ten empty pages, took them for writes that never
  // happened, and wrote the tags a second time. An empty page is the correct answer to a scope that
  // names a real row with no children, and the wrong answer to one that names a row of another
  // table, and the two looked identical. Naming the table the id does belong to, and the list that
  // takes it, is what turns the mistake into a second call instead of a second write.
  const references = new Map(all.map((entry) => [`list_${entry.type}`,
    scopeReferences(db, entry.table, [...(entry.within ? [entry.within] : []), ...(entry.scopes ?? [])])]));
  const keyed = idTables(db);

  /** Each parent table, and the lists that take one of its ids as a scope. */
  const takers = new Map<string, Array<{ name: string; table: string; column: string }>>();
  for (const entry of all) {
    for (const [column, { parent }] of references.get(`list_${entry.type}`)!) {
      takers.set(parent, [...(takers.get(parent) ?? []), { name: `list_${entry.type}`, table: entry.table, column }]);
    }
  }

  /** The list worth suggesting for an id of `owner`: the sibling of `table` if there is one. */
  const suggestion = (owner: string, table: string) => {
    const candidates = takers.get(owner) ?? [];
    const siblings = candidates.filter((taker) => taker.table.endsWith(table) || table.endsWith(taker.table));
    const offered = siblings.length > 0 ? siblings : candidates.length <= 3 ? candidates : [];

    return offered.map((taker) => `${taker.name} takes it as ${taker.column}`).join(', or ');
  };

  const refuseStrayScope = (name: string, table: string, args: Record<string, unknown>) => {
    for (const [column, { parent, key }] of references.get(name)!) {
      const value = args[column];
      if (value === undefined || value === null) continue;
      if (db.prepare(`SELECT 1 FROM ${parent} WHERE ${key} = ?`).get(value as string)) continue;

      const owner = key === 'id'
        ? keyed.find((candidate) => db.prepare(`SELECT 1 FROM ${candidate} WHERE id = ?`).get(value as string))
        : undefined;
      const offer = owner ? suggestion(owner, table) : '';

      throw new ToolError(`${name}: ${column} '${value}' names no ${parent} row`
        + (owner ? `; it is a ${owner} id${offer ? ` — ${offer}` : ''}` : ''));
    }
  };

  return all.map(({
    type, table, fixed = {}, within, scopes = [], gated, live, order, documentRows = false,
  }) => {
    const name = `list_${type}`;
    const read = spine.find((tool) => tool.name === `read_${type}`);

    if (!read) {
      throw new Error(`${name}: there is no read_${type} to take its body columns from`);
    }

    const owner = within?.replace(/_id$/, '');

    return defineTool({
      name,
      table,
      description: `List ${type} rows${owner ? `, optionally within one ${owner}` : ''}. `
        + 'Bounded by `limit`, which has a default and no ceiling.'
        + (gated ? ' `ready` narrows to what can be worked on now.' : '')
        + (live ? ` Rows with \`${live}\` set are left out unless \`${includeFlag(live)}\` asks `
          + 'for them.' : ''),
      reads: [table],
      mutates: false,
      body: read.body,
      // **Taken from the read tool rather than declared here, exactly as `body` is.** A derived
      // field is a claim about what a caller receives, and a list that computed its own would be a
      // second implementation of the same rule — the failure being silent, since both answers look
      // like answers. Declared once on the read, the two cannot disagree.
      ...(read.derived ? { derived: read.derived } : {}),
      paged: true,
      // Carried from the descriptor rather than tested for here — `table === 'document'` would be
      // this file deciding what a builder already knows, and the two would disagree the first time
      // a tool read `document` and returned something that was not a document row.
      ...(documentRows ? { db, documentRows: true } : {}),
      // Declared on the tool as well as used by it, so a test can hold the tiebreaker to being a
      // key the table actually guarantees unique rather than to a column that looks like one, and
      // can count what a list should reach without restating which tools hide retired rows.
      order,
      live,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...(within
            ? { [within]: { type: 'string', minLength: 1, description: `Only rows under this ${owner}` } }
            : {}),
          // Named scopes AND with each other and with `within`. Absent means unscoped on that
          // column, the same rule `selectPage` applies to every filter.
          ...Object.fromEntries(scopes.map((column) => [column, {
            type: 'string',
            minLength: 1,
            description: `Only rows whose ${column} is this`,
          }])),
          ...(gated
            ? {
              ready: {
                type: 'boolean',
                default: false,
                description: 'Only rows that can be worked on now: not complete, and with no '
                  + 'incomplete blocker over an edge kind whose `gates_work` is set. FR22 — the '
                  + 'answer comes from the edges, so a blocker completing releases its work '
                  + 'without anything being restated.',
              },
            }
            : {}),
          ...(live
            ? {
              [includeFlag(live)]: {
                type: 'boolean',
                default: false,
                description: live === 'archived_at'
                  ? 'Include documents that have been archived. Archival is orthogonal to status — '
                    + 'an archived document is complete and true, just out of the working set — so '
                    + 'this is what to pass when the question is the record rather than the work.'
                  : 'Include terms that have been retired. They stay readable and stay referenced '
                    + 'by existing rows; what retirement stops is new rows arriving.',
              },
            }
            : {}),
        },
        // Nothing is required. An unscoped call is a legitimate one, and the bound is what makes
        // it safe rather than the scope being compulsory.
        required: [],
      },
      handler: (args) => {
        refuseStrayScope(name, table, args);

        return selectPage(db, {
          table,
          order,
          gated,
          live,
          where: name,
          filters: {
            ...fixed,
            ...(within ? { [within]: args[within] } : {}),
            ...Object.fromEntries(scopes.map((column) => [column, args[column]])),
          },
        }, args);
      },
    });
  });
}
