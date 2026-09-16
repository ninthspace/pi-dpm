/**
 * One example document per kind, built so a template can be rendered without a project (FR6).
 *
 * **What this is for.** `dpm-templates`, asked to preview a kind, answers "what will this look
 * like?", and the
 * only honest answer is the bytes the real template produces. So the preview does not describe a
 * format — it renders one, through `TEMPLATES[kind]`, from rows built here. A skeleton stored
 * anywhere as *text* would be a second copy of the format, free to drift from the renderer the
 * moment either changed, which is the same defect the artifact register was built to remove one
 * directory over.
 *
 * **The rows are built through the ordinary create tools, not by INSERT.** Numbering, ULIDs,
 * timestamps, detail-table pairing and every CHECK are then the same ones a real project goes
 * through, so an example that would not be a legal document fails here rather than rendering
 * something no project could hold. It also means this file stays a list of what each kind *has*
 * rather than a second description of how a document is stored.
 *
 * **A recipe covers the collections its template reads and stops there.** The point is to show the
 * shape, so each kind gets at least two of anything that renders as a list — one row cannot show a
 * reader whether the template produces a table, a heading per item, or a sentence. Where a template
 * renders a distinction (a `must_not` criterion, a chosen ADR option, a met and an unmet check), the
 * example carries both sides of it, because a preview showing only the common case is a preview of
 * half the format.
 *
 * The vocabulary references are seeded ids named in full rather than "whichever term comes first".
 * A preview should show a representative term, and a seed that stopped shipping one should fail
 * loudly here instead of quietly previewing a corpus with a dangling reference in it.
 */

/**
 * The tool handlers, by name — what `preview_document_kind` assembles from `build(scratch)` and
 * hands in. The return is `any` rather than a shape, because the table is heterogeneous by
 * construction: `create_spec` returns a document row and `list_requirement` returns a page, and
 * every recipe below reads whichever of the two its own call produces. Naming a union here would
 * be a shape nothing enforces, invented to satisfy the annotation.
 */
type Call = Record<string, (args: object) => any>;

/** Prose that reads as an example rather than as lorem — a reader is meant to recognise the slot. */
const BODY = 'One paragraph of body text, so the heading above it has something to sit over and the '
  + 'spacing between sections is visible.';

/**
 * Two sections, which is the minimum that shows a reader how sections are separated.
 *
 * @param {Record<string, Function>} call
 * @param {string} id
 * @param {[string, string][]} headings
 */
function sections(call: Call, id: string, headings: Array<[string, string]>) {
  headings.forEach(([heading, body], position) => {
    call.create_document_section({ document_id: id, heading, body, position });
  });
}

/**
 * Build an example of `kind` and return its document id.
 *
 * Recipes rather than one corpus with every kind hanging off it: a preview of an epic should show
 * an epic, and a shared corpus would put whatever the other twelve recipes happened to add into it.
 * The cost is that a kind with a parent builds its own — three lines, and they are the three lines
 * that make the identifier in the rendered heading correct.
 *
 * @param {Record<string, Function>} call Tool handlers by name, built against a scratch database.
 * @param {string} kind A seeded `document_kind.kind`.
 * @returns {string} The document id to render.
 */
export function exampleDocument(call: Call, kind: string) {
  const recipe = RECIPES[kind];

  if (!recipe) {
    // Named the same way `renderDocument` names a missing template, and for the same reason: a
    // kind seeded without an example is a kind whose preview would otherwise be an empty document,
    // which reads as "this template renders nothing" rather than as "nobody wrote the example".
    throw new Error(`no preview example for kind '${kind}' — a kind with no example cannot be `
      + 'previewed, because an empty document reads as a template that renders nothing');
  }

  return recipe(call);
}

/** A spec with the requirement structure its template renders. Reused as a parent by three kinds. */
function exampleSpec(call: Call) {
  const spec = call.create_spec({ slug: 'example', title: 'Example Specification' });

  sections(call, spec.id, [
    ['Problem Summary', BODY],
    ['Solution Overview', BODY],
  ]);

  call.create_milestone({
    spec_id: spec.id, label: 'M1', title: 'First milestone', position: 1,
    summary: 'What this milestone delivers.',
  });

  const requirement = call.create_requirement({
    spec_id: spec.id, label: 'FR1', class: 'functional', moscow: 'must', position: 1,
    text: 'The system shall do the thing this requirement is about.',
  });

  // Both polarities, because the template renders them differently and a preview showing only the
  // positive one would not tell a reader that a must-NOT has a home.
  const criterion = call.create_acceptance_criterion({
    requirement_id: requirement.id, position: 1, polarity: 'must',
    text: 'The observable outcome that shows the requirement is met.',
  });
  const excluded = call.create_acceptance_criterion({
    requirement_id: requirement.id, position: 2, polarity: 'must_not',
    // No "must NOT" in the text: `polarity` is the column and the template writes the prefix, so
    // an example carrying it too would preview the format saying it twice.
    text: 'the failure this requirement exists to prevent.',
  });

  // The tag is what a coverage matrix's Test Approach column renders, and an untagged example
  // would show that column empty — which reads as "this template has a column nothing fills".
  call.create_criterion_approach({ criterion_id: criterion.id, tag: 'integration' });
  call.create_criterion_approach({ criterion_id: excluded.id, tag: 'unit' });

  return spec;
}

/** An epic under a spec, with the story structure its template renders. */
function exampleEpic(call: Call, spec: { id: string }) {
  const epic = call.create_epic({ parent_id: spec.id, slug: 'example', title: 'Example Epic' });

  sections(call, epic.id, [['Overview', BODY]]);

  const story = call.create_story({
    epic_id: epic.id, number: 1, title: 'The first story', position: 1, plan: 1,
  });

  call.create_task({
    story_id: story.id, number: 1, title: 'The first task', position: 1,
    description: 'What this task covers within its story.',
  });
  call.create_task({
    story_id: story.id, number: 2, title: 'Write tests for the first story', position: 2,
    description: 'Automated tests for the criteria carrying a test-approach tag.',
  });

  const criterion = call.create_story_criterion({
    story_id: story.id, position: 1, polarity: 'must',
    text: 'What has to be observably true for this story to be done.',
  });

  const excluded = call.create_story_criterion({
    story_id: story.id, position: 2, polarity: 'must_not',
    text: 'the outcome this story must avoid producing.',
  });

  call.create_story_criterion_approach({ story_criterion_id: criterion.id, tag: 'integration' });
  call.create_story_criterion_approach({ story_criterion_id: excluded.id, tag: 'unit' });

  return { epic, story, criterion };
}

/**
 * A builder per kind. The four prose kinds share `renderProse` and share a recipe for the same
 * reason: what distinguishes them is where the file lands, not what the template does with it.
 *
 * @type {Record<string, (call: Record<string, Function>) => string>}
 */
const RECIPES: Record<string, (call: Call) => string> = {
  spec: (call) => exampleSpec(call).id,

  epic: (call) => exampleEpic(call, exampleSpec(call)).epic.id,

  // The matrix reaches its rows the long way round — through its epic's spec — so the example has
  // to carry the whole chain or it renders a heading and an empty table.
  coverage_matrix: (call) => {
    const spec = exampleSpec(call);
    const { epic, criterion } = exampleEpic(call, spec);
    const requirement = call.list_requirement({ spec_id: spec.id, limit: 10 }).items[0];

    call.create_coverage({
      requirement_id: requirement.id, story_criterion_id: criterion.id, position: 1,
      spec_fragment: 'shall do the thing',
      verified: true,
    });

    return call.create_coverage_matrix({
      parent_id: epic.id, slug: 'example', title: 'Example Epic',
    }).id;
  },

  // `document_kind.dir IS NULL` for an ADR, so this renders and is never written to a file of its
  // own. The preview shows the block a parent splices in, which is the thing a reader is asking
  // about — there is no other way to see it.
  adr: (call) => {
    // Created `proposed` and accepted at the end, because an accepted ADR must already have its
    // chosen option — the integrity guard refuses one without, and the example goes through the
    // same order a real decision does rather than around it.
    const adr = call.create_adr({
      parent_id: exampleSpec(call).id, slug: 'example', title: 'Example Decision',
      decision: 'The option chosen, stated in one sentence.',
    });

    sections(call, adr.id, [['Context', BODY], ['Consequence', BODY]]);

    // Chosen and rejected, because the template marks the difference and a single option would
    // show a reader a list rather than a decision.
    const chosen = call.create_adr_option({
      adr_id: adr.id, name: 'The option taken', position: 1, chosen: true,
      rationale: 'Why this one won.',
    });
    const rejected = call.create_adr_option({
      adr_id: adr.id, name: 'The option rejected', position: 2,
      rationale: 'Why this one did not.',
    });

    for (const option of [chosen, rejected]) {
      call.create_adr_option_tradeoff({
        option_id: option.id, axis: 'cost', assessment: 'How this option scores on cost.',
      });
      call.create_adr_option_tradeoff({
        option_id: option.id, axis: 'risk', assessment: 'How this option scores on risk.',
      });
    }

    call.update_adr({ id: adr.id, decision_status: 'accepted' });

    return adr.id;
  },

  review: (call) => {
    const review = call.create_review({
      slug: 'example', title: 'Example Review', scope: 'whole',
    });

    sections(call, review.id, [['Summary', BODY]]);
    const panel = { document_id: review.id, document_kind: 'review' };

    call.create_document_agent({ ...panel, agent: 'architect' });
    call.create_document_agent({ ...panel, agent: 'dev' });

    // Two severities, because they are what a reader scans the table by.
    call.create_finding({
      review_id: review.id, position: 1, agent: 'architect',
      category_id: 'finding:architectural-risks', severity_id: 'severity:critical',
      summary: 'The finding, in one sentence, with the story or task it is against.',
    });
    call.create_finding({
      review_id: review.id, position: 2, agent: 'dev',
      category_id: 'finding:testability-concerns', severity_id: 'severity:suggestion',
      summary: 'A second finding, at a lower severity.',
    });

    return review.id;
  },

  retro: (call) => {
    const retro = call.create_retro({ slug: 'example', title: 'Example Retro' });

    sections(call, retro.id, [['Summary', BODY]]);

    for (const [position, [text, category]] of [
      ['What the run discovered about the codebase.', 'observation:codebase-discoveries'],
      ['A pattern worth applying again.', 'observation:patterns-worth-reusing'],
    ].entries()) {
      const observation = call.create_observation({ retro_id: retro.id, position, text });

      call.create_observation_category({
        observation_id: observation.id, taxonomy_id: category,
      });
    }

    return retro.id;
  },

  quick: (call) => {
    const quick = call.create_quick({ slug: 'example', title: 'Example Quick Change' });

    sections(call, quick.id, [['What and why', BODY]]);

    // Met and unmet, because the template renders a ✓ table and one row of it shows only one state.
    call.create_quick_criterion({
      quick_id: quick.id, position: 1, met: true,
      text: 'A check that passed, with its note.',
      note: 'How it was verified.',
    });
    call.create_quick_criterion({
      quick_id: quick.id, position: 2,
      text: 'A check not yet made.',
    });

    return quick.id;
  },

  audit: (call) => {
    const audit = call.create_audit({ slug: 'example', title: 'Example Audit' });

    sections(call, audit.id, [
      ['Executive Summary', BODY],
      ['Counter-evidence', BODY],
    ]);

    call.create_audit_finding({
      audit_id: audit.id, position: 1, dimension_id: 'audit_dimension:consistency-rot',
      file: 'src/example.js', line: 42, symbol: 'exampleFunction',
      severity_id: 'severity:warning',
      summary: 'What the sweep found, where, and why it matters.',
      recommendation: 'What to do about it.',
    });
    call.create_audit_finding({
      audit_id: audit.id, position: 2, dimension_id: 'audit_dimension:dependency-debt',
      file: 'package.json', severity_id: 'severity:suggestion',
      summary: 'A finding with no line or symbol, which is the common shape for this dimension.',
    });

    return audit.id;
  },

  library: (call) => {
    const library = call.create_library({
      slug: 'example', title: 'Example Library Document', doc_type: 'reference',
    });

    sections(call, library.id, [
      ['Summary', 'One or two sentences on what this document is for.'],
      ['The standard itself', BODY],
    ]);

    // Two scopes, because the set is what a reader has to understand and one row reads as a field.
    call.create_library_scope({ document_id: library.id, scope: 'spec' });
    call.create_library_scope({ document_id: library.id, scope: 'do' });

    return library.id;
  },

  problem_brief: (call) => prose(call, 'create_problem_brief', 'Example Problem Brief'),
  product_brief: (call) => prose(call, 'create_product_brief', 'Example Product Brief'),
  discussion: (call) => prose(call, 'create_discussion', 'Example Discussion'),
  communication: (call) => prose(call, 'create_communication', 'Example Communication'),
  runbook: (call) => prose(call, 'create_runbook', 'Example Runbook'),
};

/** The five kinds whose whole structure is their sections. */
function prose(call: Call, tool: string, title: string) {
  const document = call[tool]({ slug: 'example', title });

  sections(call, document.id, [
    ['The first heading', BODY],
    ['The second heading', BODY],
  ]);

  return document.id;
}

/** Which kinds `exampleDocument` can build, for the enumeration that checks it against the seed. */
export const EXAMPLE_KINDS = Object.keys(RECIPES).sort();
