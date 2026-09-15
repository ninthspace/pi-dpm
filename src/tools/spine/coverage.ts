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
import type { ViolationRow } from '../../integrity/register.ts';
import type { Context, Tool } from '../convention.ts';

import { defineTool, overRows, SUPPLIED, ToolError } from '../convention.ts';
import { bindingHash } from '../../coverage/binding.ts';
import { REGISTER } from '../../integrity/register.ts';
import { deleteByKey, insert, readById, update } from '../crud.ts';
import { entityTools } from '../entity.ts';

/**
 * Register entry 4, found by its number, so `create_coverage_story` refuses exactly what the
 * integrity check reports — `create_dependency`'s reason for reusing entries 1 and 6.
 */
const SAME_EPIC = REGISTER.find((entry) => entry.entry === 4);

if (!SAME_EPIC) {
  throw new Error("register entry 4 (a coverage_story row's story is in the coverage row's epic) is "
    + 'missing — create_coverage_story has no rule to enforce');
}

/**
 * `requirement_label` on a coverage row — `FR6` beside the id it names.
 *
 * **An MTPLX epics run retired two correct bindings as "sent to the wrong requirement".** It had
 * written them to the right ids and then, holding nothing but ULIDs, lost track of which was which:
 * the retirement reasons named the swap it believed had happened. A label is what the run meant when
 * it chose the requirement, so a row that says `FR6` can be checked against that intent without an
 * id being remembered across fifty calls. Derived rather than stored, as `accounted_for` is, and one
 * query for a page.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown} value One coverage row, or a page of them.
 * @returns {unknown}
 */
function withRequirementLabel(db: DatabaseSync, value: unknown) {
  if (value === null || typeof value !== 'object') return value;

  const shaped = value as { items?: unknown };
  const rows = (Array.isArray(shaped.items) ? shaped.items : [value]) as Array<{ requirement_id?: string }>;
  const ids = [...new Set(rows.map((row) => row.requirement_id).filter((id): id is string => !!id))];

  if (ids.length === 0) return value;

  const labels = new Map((db
    .prepare(`SELECT id, label FROM requirement WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids) as Array<{ id: string; label: string }>).map((row) => [row.id, row.label]));

  return overRows(value, (row: { requirement_id: string }) => ({
    ...row,
    requirement_label: labels.get(row.requirement_id) ?? null,
  }));
}

const COVERAGE_STORY = {
  coverage_id: { type: 'string', minLength: 1 },
  story_id: { type: 'string', minLength: 1 },
};

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
      derived: (value) => withRequirementLabel(db, value),
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
      // `list_coverage` takes this from here, as it takes `body`.
      derived: (value) => withRequirementLabel(db, value),
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
      derived: (value) => withRequirementLabel(db, value),
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
      derived: (value) => withRequirementLabel(db, value),
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
    // join rather than a second `story_id` column on `coverage`. The factory's read is kept; its
    // create is replaced below by one that refuses what register entry 4 reports.
    ...entityTools({ db, newId }, {
      table: 'coverage_story',
      noun: 'the record that a story also delivers a coverage row',
      key: ['coverage_id', 'story_id'],
      fields: COVERAGE_STORY,
    }).filter((tool) => tool.name !== 'create_coverage_story'),

    defineTool({
      name: 'create_coverage_story',
      table: 'coverage_story',
      description: 'Create the record that a story also delivers a coverage row. Refuses a story in '
        + 'another epic than the criterion the coverage row binds: work in another epic is a criterion '
        + 'of that story, bound on its own.',
      reads: ['coverage_story'],
      mutates: true,
      serverSupplied: {},
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: COVERAGE_STORY,
        required: ['coverage_id', 'story_id'],
      },
      handler: (args) => {
        const where = 'create_coverage_story';

        if (db.isTransaction) {
          throw new Error(`${where}: cannot run inside a caller's transaction — it needs its own, `
            + 'to roll back a row register entry 4 reports');
        }

        db.exec('BEGIN');

        let row;
        try {
          row = insert(db, 'coverage_story', { coverage_id: args.coverage_id, story_id: args.story_id },
            where, ['coverage_id', 'story_id']);
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }

        // Asked of the new row, as `create_dependency` asks entry 6: the entry reports offending
        // rows by their key, so a database restored with one already in it still accepts others.
        const crossed = SAME_EPIC!.check(db).find((violation: ViolationRow) => (
          violation.coverage_id === args.coverage_id && violation.story_id === args.story_id));

        if (crossed) {
          db.exec('ROLLBACK');
          throw new ToolError(
            `${where}: story ${args.story_id} is in epic ${crossed.story_epic}, and coverage `
            + `${args.coverage_id} binds a criterion of epic ${crossed.coverage_epic}; the story must `
            + 'be in the same epic. A story in another epic that delivers this needs a criterion of '
            + 'its own, bound with create_coverage',
          );
        }

        db.exec('COMMIT');

        return row;
      },
    }),

    // **Deleted, as an edge is.** The row records a relationship rather than anything verified, and
    // without this one written across epics could be reported by the integrity check and never
    // removed — an MTPLX epics run found exactly that, and reached for `delete_dependency`.
    defineTool({
      name: 'delete_coverage_story',
      table: 'coverage_story',
      description: 'Delete the record that a story also delivers a coverage row — one naming the '
        + 'wrong story, or one the integrity check reports. The coverage row itself is untouched. '
        + 'Returns the record as it was. Not reversible.',
      reads: ['coverage_story'],
      mutates: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: COVERAGE_STORY,
        required: ['coverage_id', 'story_id'],
      },
      handler: (args) => deleteByKey(db, 'coverage_story',
        { coverage_id: args.coverage_id, story_id: args.story_id }, 'delete_coverage_story'),
    }),
  ];
}
