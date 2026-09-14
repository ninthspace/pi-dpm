/**
 * `coverage` — one matrix row: a verbatim fragment of a requirement bound to one story criterion.
 *
 * **The natural key is `(requirement_id, spec_fragment, story_criterion_id)`, and `position` is no
 * part of it.** `004-delivery.sql` records what an earlier draft cost by keying on `position`
 * instead of `spec_fragment`: it accepted the same fragment bound to the same criterion twice at
 * two positions — two identical rows, each independently verifiable, each counting toward a
 * roll-up — while rejecting two genuinely different fragments that happened to share a position.
 * The tool inherits that. `position` is an argument because the column is `NOT NULL` with no
 * default, and it is display order; nothing here reads it to decide whether a binding exists.
 *
 * **`verified_at` and `binding_hash` are set together or not at all**, which the table's `CHECK`
 * enforces and this tool does not duplicate. What these tools do add is that the pair can only be
 * set *correctly*: `verified_at` is the caller's, `binding_hash` is computed from the row's own two
 * texts by `src/coverage/binding.js` and is not an argument at all. A hash chosen by the party
 * making the claim attests to nothing, and the `CHECK` would have accepted any string — so a
 * skill writing a ✓ says when, and the server says over what.
 *
 * **Retirement is its own verb, and `update_coverage` does not offer it.** `retire_coverage` takes
 * an id and a reason; the timestamp is the server's. The alternative — `retired_at` and
 * `retired_reason` as two more fields on the update tool, the way `artifact` carries them — would
 * make withdrawing a binding indistinguishable at the tool boundary from moving its display order,
 * and would let a mistyped update un-retire one. Withdrawing a binding is a decision with a reason;
 * `position` is a detail. `coverage` is not a vocabulary, so the tool is written here rather than
 * produced by `vocabulary.js`'s factory, but the shape is that factory's deliberately: same
 * server-supplied clock, same refusal to retire twice.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { Binding } from '../../coverage/binding.ts';
import type { Context, Tool } from '../convention.ts';

import { defineTool, SUPPLIED, ToolError } from '../convention.ts';
import { bindingHash } from '../../coverage/binding.ts';
import { insert, readById, update } from '../crud.ts';
import { entityTools } from '../entity.ts';

const BINDING = {
  requirement_id: { type: 'string', minLength: 1 },
  spec_fragment: {
    type: 'string',
    minLength: 1,
    description: 'A verbatim fragment of the requirement — part of identity, not a summary',
  },
  story_criterion_id: { type: 'string', minLength: 1 },
};

const OWN_TEXT = 'SELECT label, spec_id, instr(text, ?) > 0 AS quoted FROM requirement WHERE id = ?';

// Same `instr` as integrity register entry 9, so the write refuses exactly what the check reports.
const QUOTED_BY = `
  SELECT id, label FROM requirement
   WHERE spec_id = ? AND instr(text, ?) > 0
   ORDER BY position
`;

/**
 * Refuses a fragment its requirement's text does not contain, naming where the text actually is.
 *
 * **Refused at the write, where it was only reported afterwards.** A local model binding a spec
 * wrote five rows whose fragment was the neighbouring requirement's text under the wrong id, and a
 * gap check that counted rows per requirement then called both requirements covered. Register entry
 * 9 caught every one, but only for a run that called it; the write is the one place every run passes.
 * An unknown requirement id is left to the foreign key, which names it.
 */
function refuseStrayFragment(db: DatabaseSync, args: Record<string, unknown>): void {
  const own = db.prepare(OWN_TEXT).get(args.spec_fragment as string, args.requirement_id as string) as
    { label: string; spec_id: string; quoted: number } | undefined;
  if (!own || own.quoted) return;

  const elsewhere = db.prepare(QUOTED_BY).all(own.spec_id, args.spec_fragment as string) as
    { id: string; label: string }[];
  const hint = elsewhere.length > 0
    ? `it is ${elsewhere.map((r) => `${r.label}'s (${r.id})`).join(' and ')} — bind it there`
    : 'no requirement of this spec contains it — quote the requirement verbatim';
  throw new ToolError(`create_coverage: spec_fragment is not in ${own.label}'s text; ${hint}`);
}

const STATE = {
  position: { type: 'integer', minimum: 0, description: 'Display order only; not identity' },
  verified_at: {
    type: 'string',
    description: 'ISO 8601. Records the ✓; the server computes the binding hash that accompanies it',
  },
};

/**
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @param {() => string} context.now
 * @param {() => string} context.newId
 * @returns {object[]}
 */
export function coverageTools({ db, now, newId }: Context): Tool[] {
  return [
    defineTool({
      name: 'create_coverage',
      table: 'coverage',
      description: 'Bind a requirement fragment to a story criterion. One matrix row.',
      reads: ['coverage'],
      mutates: true,
      serverSupplied: { id: SUPPLIED.ulid, binding_hash: SUPPLIED.derived('the bound texts') },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...BINDING, ...STATE },
        required: ['requirement_id', 'spec_fragment', 'story_criterion_id', 'position'],
      },
      handler: (args) => {
        refuseStrayFragment(db, args);
        return insert(db, 'coverage', {
          id: newId(),
          requirement_id: args.requirement_id,
          spec_fragment: args.spec_fragment,
          story_criterion_id: args.story_criterion_id,
          position: args.position,
          verified_at: args.verified_at ?? null,
          // Computed from the arguments rather than read back, because the row is not there yet —
          // and the criterion is, which is the half that has to be looked up either way. Nullish,
          // so a row created explicitly unverified gets no hash: a `binding_hash` beside a NULL
          // `verified_at` is a binding recorded for a verification that was never made, which is
          // the state FR21's decay triggers exist to prevent arising the other way round.
          binding_hash: args.verified_at == null ? null : bindingHash(db, args as Binding),
        }, 'create_coverage');
      },
    }),

    defineTool({
      name: 'read_coverage',
      table: 'coverage',
      description: 'Read one coverage row by id, with its verification state as columns.',
      reads: ['coverage'],
      mutates: false,
      body: ['spec_fragment'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
      },
      handler: (args) => readById(db, 'coverage', args.id, 'read_coverage'),
    }),

    defineTool({
      name: 'update_coverage',
      table: 'coverage',
      description: "Update a coverage row's position, or record its verification.",
      reads: ['coverage'],
      mutates: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 }, ...STATE },
        required: ['id'],
      },
      // The mark and its binding move together, in all three of the states a caller can now
      // express. Omitting `verified_at` leaves both alone. Supplying one hashes off the **stored**
      // row rather than off anything the caller holds: a verification is a statement about the
      // texts as they are now, and a caller working from a copy read earlier would otherwise stamp
      // a hash over text that has since moved. Clearing it clears the hash with it — a binding
      // left behind by an unverification is the stale mark of a verification nobody made.
      handler: ({ id, ...changes }) => {
        if (changes.verified_at === undefined) {
          return update(db, 'coverage', id, changes, 'update_coverage');
        }

        const binding = changes.verified_at === null
          ? null
          : bindingHash(db, readById(db, 'coverage', id, 'update_coverage') as Binding);

        return update(db, 'coverage', id, { ...changes, binding_hash: binding }, 'update_coverage');
      },
    }),

    defineTool({
      name: 'retire_coverage',
      table: 'coverage',
      description: 'Withdraw a binding, with the reason it was withdrawn. The row stays readable '
        + 'and stops counting toward the requirement. Not reversible through the tools.',
      reads: ['coverage'],
      mutates: true,
      serverSupplied: { retired_at: SUPPLIED.clock },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          reason: {
            type: 'string',
            minLength: 1,
            description: 'Why the binding was withdrawn — the fragment was wrong, or the criterion '
              + 'it named was superseded. Required, and the only prose a coverage row carries',
          },
        },
        required: ['id', 'reason'],
      },
      // `additionalProperties: false` over two named arguments is where criterion 3's refusal
      // actually lives: `retired_at` is not reachable from a caller at all, here or through
      // `update_coverage`, so the pair cannot be set half-way or un-set by a mistyped update. The
      // `CHECK` on the table forbids the half state too; this forbids expressing it.
      handler: (args) => {
        const where = 'retire_coverage';
        const row = readById(db, 'coverage', args.id, where);

        // Reported rather than silently restamped, as `retire_taxonomy` does it. Retiring twice is
        // a caller that has lost track, and moving the date would erase when the decision was made.
        if (row.retired_at !== null) {
          throw new ToolError(`${where}: already retired at ${row.retired_at}`);
        }

        // **`verified_at` is left exactly as it stands, and that is the decision rather than an
        // omission.** A ✓ was true of the two texts it was made about, and retiring the binding
        // does not make it untrue — what changes is that the row is no longer offered as live, which
        // `list_coverage`'s derived clause already handles. A retirement that cleared the mark would
        // destroy the record retirement exists to keep, and would do it in the one column a later
        // reader trusts without asking around it.
        return update(db, 'coverage', args.id, {
          retired_at: now(),
          retired_reason: args.reason,
        }, where);
      },
    }),

    // "Covered by: Story 2, Story 4" — a criterion may be delivered by more than the story that
    // declares it. Rare (three rows in a 393-artefact corpus) and real, and the reason it is a
    // join rather than a second `story_id` column on `coverage`.
    ...entityTools({ db, newId }, {
      table: 'coverage_story',
      noun: 'the record that a story also delivers a coverage row',
      key: ['coverage_id', 'story_id'],
      fields: {
        coverage_id: { type: 'string', minLength: 1 },
        story_id: { type: 'string', minLength: 1 },
      },
    }),
  ];
}
