/**
 * `acceptance_criterion` and `story_criterion` — the two criterion sets, one factory.
 *
 * They are separate tables for a reason `004-delivery.sql` sets out: a spec states its criteria
 * in `## Testing Strategy`, an epic states different ones per story, and `coverage` is the join
 * between them. Modelling only one side leaves that join with nothing on its right-hand side. But
 * their *shape* is identical — a parent, a text, a polarity, a position — so the tools are one
 * factory taking the parent column's name, and the two are told apart by the tool name.
 *
 * **`polarity` is the sleeper this pair exists to fix.** In the markdown corpus a negative
 * criterion is written `must NOT — …` and recognised by that prefix; a control case by the word
 * `control`. Both are types carried in prose, in the artefact whose entire purpose is deciding
 * whether the work is done. Here they are a column with a `CHECK`, and the create tool offers
 * exactly the three values that `CHECK` admits — which is FR4's "type is a column, not a
 * spelling" applied to the criterion tables rather than only to `requirement`.
 *
 * **`extra` and `endings` are two sets and the difference is which tool offers them.** `extra`
 * reaches create and update both, because a breakdown knows a criterion's warrant as it writes the
 * criterion. `endings` reaches update alone: a criterion created already superseded is not a state
 * anybody decided, and offering it at create would put a decision with consequences in the same
 * list as `position`. `entityTools` draws the same line as `mutable`; here the tables differ in
 * their *endings* rather than in which columns happen to be writable, since `acceptance_criterion`
 * has none.
 *
 * **`guard` is `entityTools`'s option under `entityTools`'s contract**, down to the argument order,
 * and it is deliberately not a second design: a rule the schema cannot express, run before the
 * write on create and on update, seeing the *resolved* row rather than the arguments. On update
 * that is the stored row with the changes over it, which is what lets a guard about
 * `warrant_adr_id` refuse a call that mentioned only `text` — and, just as much, lets it stay quiet
 * on the far more common call that mentions neither.
 */

import type { Context, Row, Rule, Tool } from '../convention.ts';

import { defineTool, SUPPLIED } from '../convention.ts';
import { insert, readById, update } from '../crud.ts';

/** Copied by hand from `004-delivery.sql`, where both tables declare the same set. */
const POLARITY = ['must', 'must_not', 'control'];

/**
 * Build create, read and update for one criterion table.
 *
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @param {() => string} context.newId
 * @param {object} options
 * @param {string} options.table `acceptance_criterion` or `story_criterion`.
 * @param {string} options.parent The column naming its owner — `requirement_id` or `story_id`.
 * @param {string} options.owner What that owner is, for the descriptions.
 * @param {object} [options.extra] Further fields, offered at create and update both.
 * @param {object} [options.endings] Further fields, offered at update only. See the module note.
 * @param {(row: object, where: string) => void} [options.guard] A rule no constraint can hold, run
 *   before the write on create and on update. It receives the resolved row and the tool name.
 * @param {(value: unknown) => unknown} [options.derived] A field the read computes rather than
 *   stores. The read alone: `list_story_criterion` declares the same one in `list.js`, and the
 *   write tools deliberately do not — a derived field on a write's return would be a second place
 *   for it to arrive from, which is the reason `document.reference` is a read-side field too.
 * @returns {object[]}
 */
export function criterionTools({ db, newId }: Context, {
  table,
  parent,
  owner,
  extra = {},
  endings = {},
  guard = null,
  derived = null,
}: {
  table: string;
  parent: string;
  owner: string;
  extra?: Record<string, Rule>;
  endings?: Record<string, Rule>;
  guard?: ((row: Row, where: string) => void) | null;
  derived?: ((value: unknown) => unknown) | null;
}): Tool[] {
  const fields: Record<string, Rule> = {
    text: { type: 'string', minLength: 1 },
    polarity: {
      type: 'string',
      enum: POLARITY,
      default: 'must',
      description: "'must_not' is a type here, and the document writes 'must NOT — ' before the text, so "
        + "the text names the rejected outcome as though it happened: 'a raw stack trace reaches the user', "
        + "not 'the tool does not print a stack trace' and not 'must NOT print a stack trace'",
    },
    position: { type: 'integer', minimum: 0 },
    ...extra,
  };

  return [
    defineTool({
      name: `create_${table}`,
      table,
      description: `Create a criterion under its ${owner}. Polarity is a value, not a prefix.`,
      reads: [table],
      mutates: true,
      serverSupplied: { id: SUPPLIED.ulid },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { [parent]: { type: 'string', minLength: 1 }, ...fields },
        required: [parent, 'text', 'position'],
      },
      handler: (args) => {
        const row = {
          id: newId(),
          [parent]: args[parent],
          text: args.text,
          polarity: args.polarity ?? 'must',
          position: args.position,
          // Only the fields the caller actually supplied, and the reason is a database older than
          // the column: `insert` writes the keys it is given, so passing `warrant_adr_id: null`
          // unconditionally names a column that a pre-025 schema does not have — and every corpus
          // fixture built against an earlier version writes criteria through this tool. Omitting an
          // unsupplied field leaves the column at its default, which for a nullable column is the
          // same value the explicit null would have written.
          ...Object.fromEntries(Object.keys(extra)
            .filter((field) => args[field] !== undefined)
            .map((field) => [field, args[field]])),
        };

        if (guard) guard(row, `create_${table}`);

        return insert(db, table, row, `create_${table}`);
      },
    }),

    defineTool({
      name: `read_${table}`,
      table,
      description: `Read one criterion by id, with its polarity as a column.`,
      reads: [table],
      mutates: false,
      body: ['text'],
      ...(derived ? { derived } : {}),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
      },
      handler: (args) => readById(db, table, args.id, `read_${table}`),
    }),

    defineTool({
      name: `update_${table}`,
      table,
      description: `Update a criterion's text, polarity or position.`,
      reads: [table],
      mutates: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 }, ...fields, ...endings },
        required: ['id'],
      },
      handler: ({ id, ...changes }) => {
        // The stored row with the changes over it, read before the `UPDATE` rather than after —
        // `entityTools` gives the reason at greater length. A guard consulted afterwards would be
        // describing a row it had already allowed, and a guard passed the arguments alone would be
        // blind to the columns this call did not mention.
        if (guard) {
          guard({ ...readById(db, table, id, `update_${table}`), ...changes }, `update_${table}`);
        }

        return update(db, table, id, changes, `update_${table}`);
      },
    }),
  ];
}
