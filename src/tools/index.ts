/**
 * The registry — create, read, update and list for every entity type in the schema.
 *
 * `acceptance_criterion` is here alongside `story_criterion` because they are the two halves of
 * one join: `coverage` binds a spec-side criterion to a story-side one, and tooling either alone
 * would have left it reachable from one end only. `document` carries thirteen of the types rather
 * than one, because the kinds are one table distinguished by `kind`. That is why the count of
 * tools is not the count of tables, and why anything asserting either derives it from this list
 * rather than restating a number.
 *
 * **What is not here is asserted rather than assumed.** `dpm/tests/parity.test.js` compares the
 * live table list against this registry in both directions, and every table it passes over carries
 * its reason beside it. Story 5's reachability assertion reads each tool's `reads` the same way —
 * what is covered is a property of this registry, never of a list kept next to it.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { Context, Row, Tool } from './convention.ts';

import { ulid } from '../id/ulid.ts';
// The neighbour check, threaded through `context` so the integrity tool can report it. `src/tools/`
// reaching into `src/server/` closes no cycle: that module imports the filesystem, the path
// helpers and the version parser, and nothing else.
import { currentSkew } from '../server/neighbour.ts';
import { stampSkew } from '../server/stamp.ts';
import { withAccountedFor } from '../coverage/warrant.ts';
import { ToolError } from './convention.ts';
import { hasColumn } from '../schema/columns.ts';
import { coverageCheckTools } from './cross/coverage-check.ts';
import { dependencyTools } from './cross/dependency.ts';
import { integrityTools } from './cross/integrity.ts';
import { numberingTools } from './cross/numbering.ts';
import { publishTools } from './cross/publish.ts';
import { templateTools } from './cross/template.ts';
import { artifactTools } from './entity/artifacts.ts';
import { milestoneTools } from './entity/milestones.ts';
import { reviewRetroTools } from './entity/review-retro.ts';
import { listTools } from './list.ts';
import { referenceTools } from './reference.ts';
import { searchTools } from './search.ts';
import { sessionTools } from './session.ts';
import { sharedDocumentTools } from './shared.ts';
import { coverageTools } from './spine/coverage.ts';
import { criterionTools } from './spine/criterion.ts';
import { deliveryTools } from './spine/delivery.ts';
import { DETAIL, detailChildTools } from './spine/detail.ts';
import { documentTools } from './spine/document.ts';
import { requirementTools } from './spine/requirement.ts';
import { sectionTools } from './spine/section.ts';
import { vocabularies, vocabularyJoins } from './vocabulary.ts';

/**
 * Build every spine tool against one database.
 *
 * `now` and `newId` are injected rather than reached for, so a test can pin a timestamp and read
 * back exactly what it wrote. The dump work in Epic 47-02 needed a normalisation rule for one
 * machine-local timestamp it could not pin; there is no reason to create more of them here.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [options]
 * @param {() => string} [options.now] ISO 8601.
 * @param {() => string} [options.newId]
 * @param {string} [options.root] The repository root `publish` writes into — the server's own
 *   working directory in life, and injected for the same reason `now` is: a test that cannot pin
 *   it publishes a corpus into whichever directory the test runner happened to start in.
 * @returns {object[]} Every tool, in a stable order.
 */
/**
 * Why a database this server is too old for is served read-only (NFR7).
 *
 * @param {{found: number, supported: number}} version
 * @returns {string}
 */
export const versionSkew = ({ found, supported }: { found: number; supported: number }) =>
  `this database is at schema version ${found} and this server understands up to ${supported}. `
  + 'Reads are answered; writes are refused until the plugin is updated, so an older release '
  + 'cannot write rows a newer schema constrains.';

/**
 * The same registry with every write refused, for whichever reason applies.
 *
 * **The write tools stay listed rather than being dropped.** Withholding them would answer a
 * create call with *Method not found*, which is what a caller sees when a server is broken or a
 * tool was renamed — and would tell them nothing about the reason that actually applies. Listed
 * and refusing, the refusal explains itself. NFR7's clause is that a user is not locked out of
 * their own planning history; a lockout with a misleading error is the worst of the available
 * outcomes, not a safe default.
 *
 * **The reason is a parameter because there are two of them and only one mechanism.** A database
 * from a newer plugin and a server launched to observe are different situations with the same
 * answer — every mutating tool refuses, every read still answers, and the wire form of the list is
 * untouched, which is what `listChanged: false` promises a client. Building the sentence at the
 * call site is what keeps that one implementation from acquiring a mode.
 *
 * @param {object[]} tools
 * @param {{reason: string}} why One of the two sentences above.
 * @returns {object[]}
 */
export function readOnlyTools(tools: Tool[], { reason }: { reason: string }): Tool[] {
  return tools.map((tool) => (tool.mutates
    ? Object.freeze({
      ...tool,
      handler: () => {
        throw new ToolError(`${tool.name}: ${reason}`);
      },
    })
    : tool));
}

export function spineTools(
  db: DatabaseSync,
  {
    now = () => new Date().toISOString(), newId = ulid, root = '.',
    skew = currentSkew, stamp = stampSkew,
  }: Partial<Omit<Context, 'db'>> = {},
): Tool[] {
  const context: Context = { db, now, newId, root, skew, stamp };

  // **The kinds come from `document_kind`, not from a list here.** A hand-kept enumeration in this
  // file is what left eleven kinds without tools through Epic 47-03 and had the breakdown that
  // found it name ten of them — and the same list would have to be edited again for every kind
  // seeded afterwards. Read from the table, a kind acquires its three tools by being seeded, which
  // is FR10's "from the outset" holding by construction rather than by anyone remembering.
  const kinds = (db.prepare('SELECT kind FROM document_kind ORDER BY kind')
    .all() as Array<{ kind: string }>).map((row) => row.kind);

  const spine = [
    ...kinds.flatMap((kind) => documentTools(context, { kind, detail: DETAIL[kind] ?? null })),
    ...sectionTools(context),
    ...detailChildTools(context),
    ...requirementTools(context),
    ...criterionTools(context, {
      table: 'acceptance_criterion', parent: 'requirement_id', owner: 'requirement',
    }),
    // `warrant_adr_id` is the story side's alone, and it is the one asymmetry between the two
    // criterion tables. A spec-side criterion belongs to a requirement, so what warrants it is the
    // requirement; a story-side one may instead be warranted by an accepted decision, and until
    // this column existed such a criterion was indistinguishable in the roll-up from one nobody
    // got round to binding. Offered at create because a breakdown knows the warrant as it writes
    // the criterion, and there is nothing to bind it to afterwards.
    ...criterionTools(context, {
      table: 'story_criterion',
      parent: 'story_id',
      owner: 'story',
      extra: {
        warrant_adr_id: {
          type: 'string',
          minLength: 1,
          description: 'The accepted decision that warrants this criterion, where no requirement does',
        },
      },
      // FR6 — a criterion an amendment overtook is marked rather than rewritten, so the epic goes
      // on recording what it actually delivered. Update-only, for the reason `criterion.js` gives.
      //
      // **`superseded_at` is the caller's, where `retire_coverage` takes the clock's.** The fact
      // recorded here is when the amendment overtook the criterion, which is the pivot's knowledge
      // and not the write's — the same distinction `artifact.retired_at` draws, and the choice
      // `018-section-supersession.sql` already made for the same situation one table over.
      //
      // Both descriptions say the two go together because JSON Schema's `required` cannot: "both or
      // neither" lives in a column `CHECK`, so the description is the only place a caller deciding
      // whether to omit one will read the rule.
      endings: {
        superseded_at: {
          type: 'string',
          description: 'ISO 8601; overtaken by an amendment. Set with superseded_reason or not at all',
        },
        superseded_reason: {
          type: 'string',
          minLength: 1,
          description: 'Which amendment overtook it. Set with superseded_at or not at all',
        },
      },
      // FR7 — a warrant names an **accepted** decision, and the foreign key alone cannot say so.
      // `warrant_adr_id REFERENCES adr(document_id)` is satisfied by a proposal nobody agreed to
      // and by a decision the project has since rejected, either of which would let a criterion
      // read as accounted for on the strength of a decision that was never taken.
      //
      // **A guard here rather than a trigger in the schema, and that is not the usual answer.** A
      // rule a direct write can route around normally belongs in the database; this one must not,
      // because `src/restore/index.js` replays a dump as raw SQL and `PRAGMA foreign_keys = OFF`
      // does not disable triggers. A trigger would fire mid-restore and refuse rows for reasons
      // that have nothing to do with any caller: a criterion replayed before its ADR sees no ADR
      // at all, and a criterion warranted by a decision the project later superseded is a true
      // record that would become un-restorable. `DETAIL.adr`'s guard in `spine/detail.js` takes
      // the same position in the same words — the invariant belongs to the integrity register,
      // because a restore writes rows without passing through any of this.
      // FR7's other half. `warrant_adr_id` says what warrants the criterion; `accounted_for` is the
      // judgement a roll-up acts on, and it lives in `src/coverage/warrant.js` because two skills
      // ask the same question and prose is the one place two copies of a rule cannot be compared.
      derived: (value) => withAccountedFor(db, value),
      guard: (row, where) => {
        // One live criterion per text on a story. An MTPLX epics run lost track of which criteria
        // it had written and sent one again, and only `UNIQUE (story_id, position)` stopped it —
        // by accident, because it reused the position. At the next position it would have landed,
        // and the story would carry the same check twice under two coverage-bindable ids.
        // A database older than supersession is filled through these tools by migration tests.
        const superseding = hasColumn(db, 'story_criterion', 'superseded_at');
        const twin = row.superseded_at ? undefined : db.prepare(`
          SELECT id, position FROM story_criterion
           WHERE story_id = ? AND text = ? AND id <> ?
           ${superseding ? 'AND superseded_at IS NULL' : ''}
        `).get(row.story_id, row.text, row.id) as { id: string; position: number } | undefined;

        if (twin) {
          throw new ToolError(`${where}: this story already has that criterion at position `
            + `${twin.position} (${twin.id}) — read the story's criteria back rather than writing it again`);
        }

        // Most criteria carry no warrant. Checked first so an update that mentions only `text` is
        // not refused for a column it never named.
        if (!row.warrant_adr_id) return;

        const adr = db
          .prepare('SELECT decision_status FROM adr WHERE document_id = ?')
          .get(row.warrant_adr_id);

        if (adr?.decision_status === 'accepted') return;

        // The two cases are told apart because the remedies are different — find the right id, or
        // accept the decision — and a refusal that names a remedy the caller cannot act on from
        // where they are standing is the failure mode `adr_option`'s guard sets out at length.
        throw new ToolError(
          `${where}: '${row.warrant_adr_id}' `
          + (adr ? `names a ${adr.decision_status} decision` : 'names no ADR')
          + ' — a warrant names an accepted one, so accept the decision or name the one that was',
        );
      },
    }),
    ...deliveryTools(context, {
      table: 'story',
      parent: 'epic_id',
      // FR4. CPM appends `[plan]` to the story's `##` heading and reads it back off there; here
      // `epics` sets a column and `do` asks the story. Declared 0/1 rather than a boolean so the
      // argument and `CHECK (plan IN (0, 1))` are the same set, which is what AD10's conformance
      // seam compares — a boolean at the tool boundary would have nothing to check against.
      extra: {
        plan: {
          type: 'integer',
          enum: [0, 1],
          default: 0,
          description: 'whether this story is planned in full before any of its tasks are executed',
        },
      },
    }),
    ...deliveryTools(context, {
      table: 'task',
      parent: 'story_id',
      extra: { description: { type: 'string' } },
    }),
    ...coverageTools(context),
    // In the spine rather than below with the other cross-entity tools, because `list_dependency`
    // takes its body columns from `read_dependency` and `listTools` is handed the spine to find
    // them in. An edge is a create/read pair like any other; what makes it cross-entity is which
    // tables it points at, not how it is built.
    ...dependencyTools(context),
    ...reviewRetroTools(context),
    ...artifactTools(context),
    ...milestoneTools(context),
    ...vocabularies(context),
    ...vocabularyJoins(context),

    // FR6's discoverability pair, in the spine rather than below because `list_document_kind` is
    // derived from `LISTS` and takes its body columns from `read_document_kind` — which has to
    // exist by the time `listTools` runs. `spineTools` is handed down rather than imported over
    // there, because the preview seeds its example through the ordinary create tools and an import
    // would close a cycle back through this module while it is still being built.
    ...templateTools(context, (scratch) => spineTools(scratch)),
  ];

  return [
    ...spine,

    // Built from the spine rather than beside it: each list tool takes its body columns from the
    // read tool of the same type, so the two cannot answer the same question differently.
    ...listTools(context, spine),

    // FR9's tool, over both indexes. It sits beside the list tools rather than in `spine` because
    // it belongs to no entity type: what it returns is a hit naming one, and the entity vocabulary
    // it accepts is read out of the schema at build time.
    ...searchTools(context),

    // FR7's other direction, beside `search` for the same reason: it belongs to no entity type.
    // What separates the two is what comes back — a hit naming a row, against the row itself —
    // which is why this one declares `document` as its table and `search` declares an index.
    ...referenceTools(context),

    // FR11's table. It sits here rather than in Epic 47-05 — where the parity enumeration counts
    // it — because session lifecycle is a server concern every skill needs from the first
    // conversion. The epic's Notes carry the reasoning.
    ...sessionTools(context),

    // FR4's tool, and the first in this registry whose subject is a file rather than a row. It
    // sits here rather than in `spine` for `search` and `resolve_reference`'s reason — it belongs
    // to no entity type — and takes no `context`: what it reads is the installed package, not the
    // project this server was started in, so `Context.root` is the wrong root and it resolves its
    // own. Story 2 of epic 02-03 points all twenty-four skill-body references at it.
    ...sharedDocumentTools(),

    // The three that belong to no single entity: a number, the sweep over everything, and the one
    // that writes the tree rather than a row (AD11).
    ...numberingTools(context),
    ...integrityTools(context),
    // A spec's gap check, beside the sweep it complements: that one asks whether the rows hold,
    // this one what they add up to against the requirements.
    ...coverageCheckTools(context),
    ...publishTools(context),
  ];
}
