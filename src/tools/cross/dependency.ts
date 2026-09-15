/**
 * `create_dependency` — the edge, and the one rule the schema cannot express.
 *
 * `010-dependency.sql` says plainly what it leaves open: the self-edge `CHECK`s rule out
 * `A depends on A` and nothing more, because `A blocks B` together with `B blocks A` is two
 * perfectly legal rows and reachability is not a row-level constraint. It also says why that gap
 * is the worst shape available — a readiness query over a cycle returns nothing ready, which
 * reads exactly like everything being done and raises no error at all. This tool is one of the
 * two places that gap is closed; FR14's integrity check is the other, for the cycles that predate
 * the rule or arrive by restore.
 *
 * **The refusal is defined as "the edge that makes register entry 1 fail", and reuses that
 * entry's own check.** Writing a second reachability query here would be the obvious thing and
 * would be wrong: two implementations can disagree about what a cycle is, and the single place
 * that must never happen is between the rule that prevents them and the check that reports them.
 * A disagreement in that direction produces a database the integrity tool calls broken and the
 * link tool will not let anyone repair.
 *
 * **The comparison is before-and-after, not empty-or-not.** A database restored with a cycle
 * already in it must still accept unrelated edges. Refusing every write while any cycle exists
 * would make the integrity tool's report actionable only by hand-written SQL, which is the whole
 * of what FR14's "without SQL" clause forbids.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { ViolationRow } from '../../integrity/register.ts';
import type { Args, Row, Tool } from '../convention.ts';

import { REGISTER } from '../../integrity/register.ts';
import { ulid } from '../../id/ulid.ts';
import { defineTool, SUPPLIED, ToolError } from '../convention.ts';
import { deleteById, insert, readById } from '../crud.ts';

/**
 * Register entry 1, found by its number.
 *
 * **Not `REGISTER[0]`.** The register is ordered by the Data Model's own numbering, and an entry
 * inserted above this one would silently repoint the link tool's cycle check at a different
 * invariant — a change that breaks nothing visibly and makes this tool enforce the wrong rule.
 * `entry` is the join key between a table in a document and a function in that file; it is what
 * this should be looking things up by.
 */
const CYCLE_CHECK = REGISTER.find((entry) => entry.entry === 1);

if (!CYCLE_CHECK) {
  throw new Error('register entry 1 (no cycle among gates_work edges) is missing — the link '
    + 'tool has no rule to enforce and would accept every edge');
}

/**
 * Register entry 6, found the same way and reused for the same reason.
 *
 * The pairs each edge kind admits are rows in `dependency_kind_endpoint`, and this tool refusing
 * one pair while the check reports another is the disagreement neither could survive: an edge the
 * register calls a violation and this tool will not let anyone replace. So the refusal below is
 * defined as "the edge that makes entry 6 fail", exactly as the cycle refusal is defined as the
 * edge that makes entry 1 fail.
 */
const ENDPOINT_CHECK = REGISTER.find((entry) => entry.entry === 6);

if (!ENDPOINT_CHECK) {
  throw new Error("register entry 6 (a dependency's ends are kinds that edge admits) is missing — "
    + 'the link tool has no endpoint rule to enforce and would accept every pair');
}

/** Node ids currently reachable from themselves over gating edges. */
const cycleNodes = (db: DatabaseSync) => new Set(
  CYCLE_CHECK.check(db).map((row: ViolationRow) => row.id),
);

/** Edge ids whose ends are kinds their edge kind does not admit. */
const misEnded = (db: DatabaseSync) => new Set(
  ENDPOINT_CHECK.check(db).map((row: ViolationRow) => row.edge_id),
);

/** Whichever end was given, as one id — an end is a document or a story, never both. */
const endOf = (args: Args, side: string) => (
  args[`${side}_document_id`] ?? args[`${side}_story_id`]
);

/**
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @param {() => string} [context.newId]
 * @returns {object[]}
 */
export function dependencyTools(
  { db, newId = ulid }: { db: DatabaseSync; newId?: () => string },
): Tool[] {
  // **The "exactly one of" rule is in the description because `required` cannot hold it.** All four
  // of these are optional in JSON Schema terms and none of them is optional in practice: an edge
  // needs one end on each side. A caller reading the schema alone sees four fields it may leave out
  // and no hint that leaving out a whole side is refused.
  const end = (side: string) => ({
    [`${side}_document_id`]: {
      type: 'string',
      minLength: 1,
      description: `the ${side} when it is a document; give exactly one of ${side}_document_id or ${side}_story_id`,
    },
    [`${side}_story_id`]: {
      type: 'string',
      minLength: 1,
      description: `the ${side} when it is a story; give exactly one of ${side}_document_id or ${side}_story_id`,
    },
  });

  return [
    defineTool({
      name: 'read_dependency',
      table: 'dependency',
      description: 'Read one edge by id, with both its ends and its kind as columns.',
      reads: ['dependency'],
      mutates: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
      },
      // Added by Story 5's reachability assertion, which found this table written by the tool
      // below and readable by nothing. An edge a caller can create and cannot inspect is the
      // NFR7 gap in its plainest form — and the one thing FR22's readiness queries have to build
      // on, since a caller that cannot see the edge cannot tell a refusal from a missing write.
      handler: (args) => readById(db, 'dependency', args.id, 'read_dependency'),
    }),

    defineTool({
      name: 'create_dependency',
      table: 'dependency',
      // "Source-blocks-target" alone was read backwards by a local model: it wrote the waiting story
      // as the source on every edge of an epic. The sentence naming which end finishes first is
      // the one a caller choosing between two ids can check its call against.
      description:
        'Link two documents or stories with a typed edge, reading source-blocks-target: on a '
        + 'blocks edge the source must finish before the target can start, so the waiting end is '
        + 'the target. On a supersedes edge the source is the superseded end and the target replaces it. '
        + 'Refuses an edge that would close a cycle over a kind that gates work, and one whose '
        + 'ends are document kinds its own kind does not admit.',
      // `dependency` alone, and the endpoint table deliberately not beside it: `reads` on a
      // mutating tool is what NFR7's closure treats as *written*, and this tool consults that
      // table rather than writing it. Naming it here would demand a read tool for a vocabulary no
      // caller may add to — and the refusal above already tells the caller what the kind admits,
      // which is the discoverability a list tool would have bought.
      reads: ['dependency'],
      mutates: true,
      serverSupplied: { id: SUPPLIED.ulid },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', minLength: 1, description: 'A seeded dependency_kind.kind' },
          ...end('source'),
          ...end('target'),
        },
        // Only `kind` is required here. Which of the four id columns must be present is the pair
        // of exclusive `CHECK`s in `010-dependency.sql`, and restating them in the schema would
        // be a second copy of a rule the database already holds — the AD10 hazard one layer up.
        required: ['kind'],
      },
      handler: (args) => {
        const source = endOf(args, 'source');
        const target = endOf(args, 'target');

        // The one thing worth catching before the transaction: without both ends the insert
        // fails on a `CHECK` whose message names neither the tool nor which end was missing.
        if (!source || !target) {
          throw new ToolError(
            'create_dependency: an edge needs one source and one target — give exactly one '
            + 'of source_document_id/source_story_id and one of target_document_id/target_story_id',
          );
        }

        // `restore/index.js` found that `PRAGMA foreign_keys` is silently ignored inside a
        // transaction. The failure here is louder but no more welcome: SQLite refuses a nested
        // `BEGIN` with a message about transactions that says nothing about dependencies.
        if (db.isTransaction) {
          throw new Error('create_dependency: cannot run inside a caller\'s transaction — it '
            + 'needs its own, to roll back an edge that turns out to close a cycle');
        }

        const before = cycleNodes(db);

        db.exec('BEGIN');

        let row;
        try {
          row = insert(db, 'dependency', {
            id: newId(),
            kind: args.kind,
            source_document_id: args.source_document_id ?? null,
            source_story_id: args.source_story_id ?? null,
            target_document_id: args.target_document_id ?? null,
            target_story_id: args.target_story_id ?? null,
          }, 'create_dependency');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }

        // **This one is asked about the row rather than by before-and-after, and the difference is
        // in what the two entries report.** Entry 1 reports the *nodes* a cycle reaches, so the
        // only way to know whether this edge caused one is to compare the sets. Entry 6 reports the
        // offending *edge*, so the new row's own id answers the question exactly — and a database
        // restored with violations already in it goes on accepting unrelated edges without a
        // snapshot being needed to say so.
        // `!` because the module-level guard above threw if it was absent. The narrowing does not
        // reach in here the way it reaches `misEnded`: this is a hoisted function declaration, so
        // the checker cannot know its body runs after the guard, while an arrow assigned to a
        // `const` below the guard demonstrably does.
        const rejected = ENDPOINT_CHECK!.check(db)
          .find((edge: ViolationRow) => edge.edge_id === row.id);

        if (rejected) {
          db.exec('ROLLBACK');

          const admits = db
            .prepare('SELECT source_kind, target_kind FROM dependency_kind_endpoint WHERE kind = ?')
            .all(args.kind)
            .map((pair: Row) => `${pair.source_kind} → ${pair.target_kind}`);

          // What was given and what is allowed, because the caller cannot see the table and the
          // pair that was refused is rarely a typo — it is usually a kind chosen for what it means
          // rather than for what it joins.
          throw new ToolError(
            `create_dependency: '${args.kind}' does not admit `
            + `${rejected.source_kind} → ${rejected.target_kind}; it admits ${admits.join(', ')}`,
          );
        }

        const introduced = [...cycleNodes(db)].filter((id) => !before.has(id));

        if (introduced.length > 0) {
          db.exec('ROLLBACK');

          // Both ends named, which the criterion asks for, and the kind that gated it — because
          // the same pair of documents linked by `builds_on` would have been accepted, and a
          // message that omitted the kind would leave the caller unable to tell why.
          throw new ToolError(
            `create_dependency: '${args.kind}' gates work, and ${source} → ${target} would `
            + `close a cycle reaching ${introduced.join(', ')}`,
          );
        }

        db.exec('COMMIT');

        return row;
      },
    }),

    // **Deleted rather than retired, and that is a choice about this table rather than a lapse.**
    // Without a way to remove one, an edge written the wrong way round could be noticed and never
    // corrected: the right edge beside it closes a cycle over the wrong one and is refused. An MTPLX
    // epics run hit exactly that and could only recommend accepting the backwards edge. Retirement
    // would need columns, and `tests/parity-v070.test.js` holds this schema byte-identical to
    // v0.7.0's; an edge is a relationship rather than a record anything was verified against, so
    // nothing downstream loses a history it relied on.
    defineTool({
      name: 'delete_dependency',
      table: 'dependency',
      description: 'Delete an edge — one recorded the wrong way round, or no longer true — so the '
        + 'corrected edge can be written after it. Returns the edge as it was. Not reversible.',
      reads: ['dependency'],
      mutates: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
      },
      handler: (args) => deleteById(db, 'dependency', args.id, 'delete_dependency'),
    }),
  ];
}
