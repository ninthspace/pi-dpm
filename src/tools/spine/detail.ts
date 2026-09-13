/**
 * AD7's four structured kinds — the detail their documents carry, and the rows beneath it.
 *
 * Four of the fourteen document kinds hold structure that `document_section` would flatten into
 * prose: an ADR's decision status and its options against shared axes, a review's scope, a quick
 * record's close, a library document's machine-read `doc_type`. Each detail table's primary key
 * **is** its document's, which is what makes the one-to-one structural rather than a rule someone
 * has to maintain.
 *
 * **The detail row is created by the document's own tool, not by a second call.** `adr.decision`
 * and `library_document.doc_type` are `NOT NULL`, so a document of one of these kinds without its
 * detail row is a half-made artefact — legal by every constraint in the schema, and unreadable by
 * anything that expects the pair. `documentTools` writes both in one transaction; what these
 * descriptors supply is the arguments and the mapping. The child tables below are ordinary rows
 * with their own tools, because there may be any number of them or none.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Args, Context, Row, Rule, Tool } from '../convention.ts';

import { ToolError } from '../convention.ts';
import { entityTools } from '../entity.ts';

/**
 * A detail table, as `documentTools` uses one: the columns a kind adds to `document`, how to build
 * its row from the arguments, and the rule no `CHECK` can hold.
 */
export type Detail = {
  table: string;
  fields: Record<string, Rule>;
  required: string[];
  row: (args: Args) => Record<string, unknown>;
  guard?: (db: DatabaseSync, row: Row, where: string) => void;
};

/** `adr.decision_status`'s `CHECK` set, copied by hand from `002-detail.sql`. */
const DECISION_STATUS = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'];

/** `review.scope`'s `CHECK` set, likewise. */
const REVIEW_SCOPE = ['whole', 'story'];

/**
 * The detail each of the four kinds carries, as `documentTools` takes it.
 *
 * `row` maps validated arguments to detail columns and is the only place the defaults are
 * applied: `defineTool` advertises a `default` rather than materialising it, for the reason
 * `convention.js` sets out, so the fallback has to be written where the row is built.
 */
export const DETAIL: Record<string, Detail> = {
  adr: {
    table: 'adr',
    fields: {
      decision_status: { type: 'string', enum: DECISION_STATUS, default: 'proposed' },
      decision: {
        type: 'string',
        minLength: 1,
        description: 'The decision itself, in one sentence — the ADR\'s reason for existing',
      },
    },
    required: ['decision'],
    row: (args) => ({
      decision_status: args.decision_status ?? 'proposed',
      decision: args.decision,
    }),

    // **An ADR becomes `accepted` only once exactly one of its options is chosen.** This is the
    // half of integrity register entry 8 that `adr_option`'s own guard cannot reach: zero chosen
    // options is not a fact about any option, so nothing on the option side is in a position to
    // refuse it. Here it is, because this is where the ADR takes the status the invariant is
    // conditioned on.
    //
    // It follows that a `create_adr` call cannot carry `accepted` — an ADR has no options at the
    // moment it is created. That is the intended shape rather than a side effect: a decision is
    // recorded as `proposed`, its options are explored, one is chosen, and the promotion is the
    // separate act. The register check stays either way, because a restore writes rows without
    // passing through any of this.
    guard: (db, row, where) => {
      if (row.decision_status !== 'accepted') return;

      const { chosen } = db
        .prepare('SELECT COUNT(*) AS chosen FROM adr_option WHERE adr_id = ? AND chosen = 1')
        .get(row.document_id) as { chosen: number };

      if (chosen === 1) return;

      throw new ToolError(
        `${where}: ADR '${row.document_id}' has ${chosen} chosen options — an accepted ADR has `
        + 'exactly one, so choose an option before accepting the decision (integrity register '
        + 'entry 8)',
      );
    },
  },

  review: {
    table: 'review',
    fields: {
      scope: { type: 'string', enum: REVIEW_SCOPE, default: 'whole' },
      scope_story_id: {
        type: 'string',
        minLength: 1,
        description: "Required when scope is 'story', and refused otherwise",
      },
    },
    required: [],
    // What was reviewed is `document.parent_id`; only the narrowing lives here. The paired `CHECK`
    // is left to the database rather than restated: a second copy of it here would be the AD10
    // hazard one layer up, and its refusal already names the column.
    row: (args) => ({
      scope: args.scope ?? 'whole',
      scope_story_id: args.scope_story_id ?? null,
    }),
  },

  quick: {
    table: 'quick',
    fields: {
      closed_at: { type: 'string', description: 'ISO 8601; NULL while the record is open' },
    },
    required: [],
    row: (args) => ({ closed_at: args.closed_at ?? null }),
  },

  library: {
    table: 'library_document',
    fields: {
      doc_type: {
        type: 'string',
        minLength: 1,
        description: "'architecture', 'coding-standards', 'domain' — what the Library Check reads",
      },
      // Nullable, and the NULL is the answer rather than the absence of one: a document written
      // in this project has no provenance, and one imported from elsewhere has one its readers
      // need. Held as a `**Source**:` line under a heading it is a field parsed back out of prose.
      source: {
        type: 'string',
        minLength: 1,
        description: 'Where an imported document came from; omit for one written in this project',
      },
    },
    required: ['doc_type'],
    row: (args) => ({ doc_type: args.doc_type, source: args.source ?? null }),
  },
};

/**
 * The rows beneath the detail: an ADR's options and their tradeoffs, the participants in a review
 * or a discussion, a quick record's criteria, a library document's scopes.
 *
 * @param {object} context
 * @returns {object[]}
 */
export function detailChildTools(context: Context): Tool[] {
  const { db } = context;

  return [
    ...entityTools(context, {
      table: 'adr_option',
      noun: 'one option an ADR considered',
      fields: {
        adr_id: { type: 'string', minLength: 1, description: 'the ADR this option belongs to' },
        name: { type: 'string', minLength: 1 },
        chosen: { type: 'boolean', default: false, description: 'exactly one option may be' },
        rationale: { type: 'string' },
        position: { type: 'integer', minimum: 0 },
      },
      required: ['adr_id', 'name', 'position'],
      mutable: ['name', 'chosen', 'rationale', 'position'],
      body: ['rationale'],

      // **The option side of integrity register entry 8.** `chosen` is a column on the option and
      // the rule is about the set, so no `CHECK` can hold it. Refusing it here means a run cannot
      // create the state; the register keeps its own copy of the rule for what a restore brings in.
      //
      // Two refusals, and the second is the one that is easy to miss. Choosing a second option is
      // the obvious violation. *Un*choosing the only one is the same violation arrived at from the
      // other side, and an ADR that has already been accepted is left with none — so the count is
      // taken over the set this write would leave behind rather than over the row in hand.
      //
      // A `proposed` ADR may have no chosen option, which is what being proposed means. The
      // symmetric refusal for promoting such an ADR to `accepted` lives on `DETAIL.adr` above,
      // because zero chosen options is not a fact about any option and no guard here could see it.
      // **Each refusal names a remedy that works from where the caller is standing.** On an
      // accepted ADR every single-step fix is itself refused — unsetting the choice leaves none,
      // setting another leaves two — so the only route through is to move the decision back to
      // `proposed`. The accepted case is therefore tested first, or the caller is handed advice
      // that fails on the next call.
      guard: (row, where) => {
        const chosen = Number(row.chosen) === 1;
        const others = db
          .prepare('SELECT * FROM adr_option WHERE adr_id = ? AND chosen = 1 AND id <> ?')
          .all(row.adr_id, row.id) as Row[];
        const adr = db
          .prepare('SELECT decision_status FROM adr WHERE document_id = ?')
          .get(row.adr_id) as { decision_status: string } | undefined;
        const total = others.length + (chosen ? 1 : 0);

        if (adr?.decision_status === 'accepted' && total !== 1) {
          throw new ToolError(
            `${where}: ADR '${row.adr_id}' is accepted and this would leave it with ${total} `
            + 'chosen options — an accepted ADR has exactly one. Move the decision back to '
            + 'proposed, change the choice there, and accept it again (integrity register entry 8)',
          );
        }

        if (chosen && others.length > 0) {
          throw new ToolError(
            `${where}: '${others[0].name}' is already the chosen option of ADR '${row.adr_id}' — `
            + 'an ADR has one chosen option, so unset that one before choosing another (integrity '
            + 'register entry 8)',
          );
        }
      },
    }),

    ...entityTools(context, {
      table: 'adr_option_tradeoff',
      noun: "one option's assessment against one axis",
      // The axis is half the identity: Options Considered repeats per option against the *same*
      // axes each time, and that repetition is what makes it a table rather than a paragraph.
      key: ['option_id', 'axis'],
      fields: {
        option_id: { type: 'string', minLength: 1 },
        axis: { type: 'string', minLength: 1, description: "'cost', 'complexity', 'reversibility'" },
        assessment: { type: 'string', minLength: 1 },
      },
      required: ['assessment'],
      body: ['assessment'],

      // **An option id that names nothing is refused with the ids that do.** The foreign key would
      // refuse it anyway, as `FOREIGN KEY constraint failed`, which says neither which column nor
      // what would have worked. A local model recording trade-offs made up ids close to the real
      // ones — a suffix added, a character changed — fifteen times in one run, and each retry was
      // another guess. The options of the ADR written last are the ones a run recording trade-offs
      // is almost always working on, and naming them turns the retry into a copy.
      guard: (row, where) => {
        if (db.prepare('SELECT 1 FROM adr_option WHERE id = ?').get(row.option_id) !== undefined) return;

        const latest = db.prepare('SELECT adr_id FROM adr_option ORDER BY id DESC LIMIT 1').get() as
          { adr_id: string } | undefined;

        if (latest === undefined) {
          throw new ToolError(`${where}: no ADR option has id '${row.option_id}', and none are recorded `
            + 'yet — create_adr_option returns the id a trade-off takes');
        }

        const offered = db
          .prepare('SELECT id, name FROM adr_option WHERE adr_id = ? ORDER BY position, id')
          .all(latest.adr_id) as Row[];

        throw new ToolError(`${where}: no ADR option has id '${row.option_id}', so nothing was recorded. `
          + `The options of ADR '${latest.adr_id}', the one written last, are `
          + `${offered.map((option) => `'${option.id}' (${option.name})`).join(', ')}. `
          + 'Pass the id exactly as create_adr_option returned it');
      },
    }),

    // Not a detail table of `review`, because a discussion records the same fact: `party` and
    // `consult` both convene personas and both write a `discussion`. `document_kind` is required
    // and is not mutable — it is half of what the row *is*, and changing it is deleting one row
    // and writing another, which `create_document_agent` already does.
    ...entityTools(context, {
      table: 'document_agent',
      noun: 'the record that one agent took part in a review or a discussion',
      key: ['document_id', 'agent'],
      fields: {
        document_id: { type: 'string', minLength: 1, description: 'the review or discussion' },
        document_kind: {
          type: 'string',
          enum: ['review', 'discussion'],
          description: 'the kind of the document above — a participant attaches to no other',
        },
        agent: { type: 'string', minLength: 1, description: 'a seeded agent.name' },
      },
      required: ['document_kind'],
      mutable: [],
    }),

    ...entityTools(context, {
      table: 'quick_criterion',
      noun: "one of a quick record's criteria",
      fields: {
        quick_id: { type: 'string', minLength: 1 },
        text: { type: 'string', minLength: 1 },
        // Tri-state on purpose: NULL while the record is open, and a decision at close. A status
        // word would have to invent a third value for "not decided yet".
        met: { type: 'boolean', description: 'left unset while the record is open' },
        note: { type: 'string' },
        position: { type: 'integer', minimum: 0 },
      },
      required: ['quick_id', 'text', 'position'],
      mutable: ['text', 'met', 'note', 'position'],
      body: ['text'],
    }),

    ...entityTools(context, {
      table: 'library_scope',
      noun: 'the record that a library document applies to one skill',
      key: ['document_id', 'scope'],
      fields: {
        document_id: { type: 'string', minLength: 1 },
        scope: { type: 'string', minLength: 1, description: "a skill name, or 'all'" },
      },
    }),
  ];
}
