/**
 * `requirement` — the table where FR4 stops being a spelling convention.
 *
 * **`class` is a required argument and `label` is never read to determine one.** That is this
 * story's must-NOT, and it is worth being precise about what it forbids, because the tempting
 * version looks helpful: a create tool that saw `NFR3` and filled in `non_functional`, or saw
 * `ENVX2` and chose `environmental_restriction`, would spare every caller an argument and would
 * be right almost always. It is the "almost" that the schema exists to remove — four shell
 * parsers in the corpus this replaces derived class, band and exclusion from label text, and the
 * whole of `003-requirements.sql` is the answer to what that cost. A tool that inferred here
 * would reintroduce the parser one layer up, where no `CHECK` can see it.
 *
 * So `label` is written verbatim, read back verbatim, and consulted for nothing. Nothing in this
 * file branches on its contents, and the test for that is not "the code has no regex" but that a
 * requirement labelled `NFR3` and classed `functional` stores and returns `functional`.
 */

import type { Context, Tool } from '../convention.ts';

import { ToolError, defineTool, SUPPLIED } from '../convention.ts';
import { claimComplete } from '../../coverage/claim.ts';
import { insert, readById, update } from '../crud.ts';

/** Copied by hand from `003-requirements.sql`. Story 7 asserts each against `PRAGMA`. */
const CLASS = ['functional', 'non_functional',
  'environmental_requirement', 'environmental_restriction'];
const MOSCOW = ['must', 'should', 'could', 'wont'];
const EXCLUSION = ['deferred', 'out_of_scope'];

/** Everything a caller may set or change. `spec_id` is identity and is not among them. */
const FIELDS = {
  label: { type: 'string', minLength: 1, description: 'Display only: FR1, NFR3, ENVX2' },
  class: { type: 'string', enum: CLASS, description: 'Never inferred from label' },
  moscow: { type: 'string', enum: MOSCOW },
  exclusion: { type: 'string', enum: EXCLUSION },
  parent_id: { type: 'string', minLength: 1, description: "FR1a's parent is FR1" },
  text: { type: 'string', minLength: 1 },
  position: { type: 'integer', minimum: 0 },
};

/**
 * FR26's completeness claim, offered on update and not on create.
 *
 * A requirement is never born claimed — there is nothing bound to it yet — so putting this in
 * `FIELDS` would give `create_requirement` an argument whose only honest value is absent.
 *
 * **Neither half of the claim is the caller's.** `coverage_claim_hash` is not here for the reason
 * `binding_hash` is not on the coverage tools: it is computed by `claimHash` over the bound
 * fragment set, and a digest supplied by the party making the claim records nothing. The date is
 * gone for the same reason — a claimant who also types the time of its claim can date it to before
 * the set it says it read, and the pair is then two assertions by one party rather than one
 * assertion witnessed. The caller says only *that* it claims.
 */
const CLAIM = {
  coverage_claimed: {
    type: 'boolean',
    description: 'Claim that the bound coverage rows account for this requirement whole, or '
      + 'withdraw the claim with false. The server stamps the time from its own clock and '
      + 'computes the hash over the bound set that accompanies it',
  },
};

/**
 * @param {object} context
 * @param {import('node:sqlite').DatabaseSync} context.db
 * @param {() => string} context.newId
 * @param {() => string} context.now
 * @returns {object[]}
 */
export function requirementTools({ db, newId, now }: Context): Tool[] {
  return [
    defineTool({
      name: 'create_requirement',
      table: 'requirement',
      description: 'Create a requirement. `class` is required and is never inferred from `label`.',
      reads: ['requirement'],
      mutates: true,
      serverSupplied: { id: SUPPLIED.ulid },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { spec_id: { type: 'string', minLength: 1 }, ...FIELDS },
        // `class` sits here, beside `label`, and that adjacency is the whole point: a caller
        // supplying one without the other is refused rather than helped.
        required: ['spec_id', 'label', 'class', 'text', 'position'],
      },
      handler: (args) => insert(db, 'requirement', {
        id: newId(),
        spec_id: args.spec_id,
        label: args.label,
        class: args.class,
        moscow: args.moscow ?? null,
        exclusion: args.exclusion ?? null,
        parent_id: args.parent_id ?? null,
        text: args.text,
        position: args.position,
      }, 'create_requirement'),
    }),

    defineTool({
      name: 'read_requirement',
      table: 'requirement',
      description: 'Read one requirement by id, with its class, band and exclusion as columns.',
      reads: ['requirement'],
      mutates: false,
      // What Story 4's bound withholds unless asked. Declared here so that story is a filter
      // over this shape rather than a change to it.
      body: ['text'],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
      },
      handler: (args) => readById(db, 'requirement', args.id, 'read_requirement'),
    }),

    defineTool({
      name: 'update_requirement',
      table: 'requirement',
      description: "Update a requirement's label, class, band, exclusion, text or position, "
        + 'or claim that the coverage rows bound to it account for it whole.',
      reads: ['requirement'],
      mutates: true,
      serverSupplied: {
        coverage_claimed_at: SUPPLIED.clock,
        coverage_claim_hash: SUPPLIED.derived('the bound fragment set'),
      },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 1 }, ...FIELDS, ...CLAIM },
        required: ['id'],
      },
      handler: ({ id, coverage_claimed: claimed, ...changes }) => {
        if (Object.keys(changes).length > 0) update(db, 'requirement', id, changes, 'update_requirement');
        else if (claimed === undefined) throw new ToolError('update_requirement: nothing to update');
        // A claim against a requirement that is not there is a boundary rejection like any other,
        // and `claimComplete` raises an internal error rather than one — so the row is reached
        // for here, where the failure has the shape FR3 asks for.
        else readById(db, 'requirement', id, 'update_requirement');

        // After the edits and never before: `requirement_unclaim_on_text_edit` would clear a claim
        // written first, and the claim is about the set as it stands when this call is finished.
        // `claimComplete` still takes the instant, because a withdrawal is a null date there and
        // the `CHECK` is written against the pair. The flag is what the caller decides; the clock
        // is read here, on the server, at the moment the claim is recorded.
        if (claimed !== undefined) claimComplete(db, id, claimed ? now() : null);

        return readById(db, 'requirement', id, 'update_requirement');
      },
    }),
  ];
}
