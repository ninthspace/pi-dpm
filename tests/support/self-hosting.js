/**
 * A planning corpus dpm can hold — the build's standing acceptance fixture (Epic 47-09 Story 6).
 *
 * Epic 47-01's Notes state the check as "dpm must be able to represent a real planning corpus",
 * and asking that question is what produced all five self-hosting register entries. Every one of
 * them needed a *spec* change and none was found by reading the schema: inline ADs degrading to
 * prose, `retro→spec` parentage unseeded, prose references with nothing able to rewrite them
 * (which is where FR28 and the whole `{{ref:}}` mechanism came from), milestones with no table,
 * and partial coverage indistinguishable from full.
 *
 * **The corpus is handcrafted rather than transcribed, and that is a deliberate trade.** Real
 * planning documents were written to a different tool's conventions, so nothing guarantees they
 * comply with what dpm writes — and a failure to load one is then ambiguous, because a schema gap
 * and a non-compliant input look identical. An invented corpus complies by construction, which
 * makes every failure attributable. What it gives up is the ability to *surprise* the schema: it
 * exercises shapes already known to matter, so this fixture is a completeness-and-fidelity check
 * and not a discovery instrument.
 *
 * **Nothing here is enumerated in the assertions it supports.** The claims the corpus is written
 * to satisfy are three readings of the live schema — every table a create tool writes carries a
 * row, every seeded `document_kind` has a document, every `document_kind_parent` pair is
 * exercised. A hand-kept list of "what the corpus contains" would be the failure this spec removes
 * everywhere else, and it is the failure the register already recorded: an earlier enumeration
 * omitted the artifact, so `artifact` and `artifact_document` went unexercised by the check that
 * gates the whole build, and nothing reported it.
 *
 * **Create tools throughout.** `corpus.js`'s `fullCorpus` predates the non-spine tools and inserts
 * the rest by statement; it stays as it is, because Epic 47-04's tests are built on it. This one is
 * the tool-surface corpus Story 6's criterion asks for, so a shape the tools refuse cannot reach
 * the database by another door.
 */

const AT = '2026-03-01T00:00:00.000Z';

/**
 * Load the corpus.
 *
 * @param {Record<string, Function>} call Raw handlers, keyed by tool name.
 * @returns {object} What was written, keyed for a test to assert against without re-deriving it.
 *   `prose` is the record the fidelity comparison walks: every body the corpus handed a create
 *   tool, paired with the document it belongs to.
 */
export function selfHostingCorpus(call) {
  const prose = [];
  const record = (documentId, text) => { prose.push({ documentId, text }); return text; };

  const taxonomy = new Map(call.list_taxonomy({ limit: 200 }).items.map((term) => [
    `${term.domain}/${term.name}`, term.id,
  ]));

  // --- Upstream: the brief a spec came from -------------------------------------------------

  const problem = call.create_problem_brief({
    slug: 'release-visibility', title: 'Nobody can say what shipped', status: 'complete',
  });

  call.create_document_section({
    document_id: problem.id,
    heading: 'Why',
    body: record(problem.id, 'Three teams ship from one repository and the only record of what '
      + 'went out is the changelog somebody remembered to edit.'),
    position: 0,
  });

  const product = call.create_product_brief({
    parent_id: problem.id, slug: 'release-visibility', title: 'A release record that is queried',
    status: 'complete',
  });

  call.create_document_section({
    document_id: product.id,
    heading: 'Vision',
    body: record(product.id, 'A release is a row, and every question about one is a query.'),
    position: 0,
  });

  // --- The spec, its milestones, its requirements and its inline ADs -------------------------

  const spec = call.create_spec({ slug: 'release-record', title: 'The release record' });

  call.create_document_section({
    document_id: spec.id,
    heading: 'Problem Summary',
    body: record(spec.id, 'The changelog is prose, and prose cannot be asked a question.'),
    position: 0,
  });

  // **A marker in a section body — half of the case FR28 exists for.** The other half is the
  // observation below, and the two together are why `document_reference` was rejected: a
  // section-scoped table reaches this one and cannot reach that one.
  call.create_document_section({
    document_id: spec.id,
    heading: 'Scope Boundary',
    body: record(spec.id, `In scope: the record. Out of scope: everything brief `
      + `{{ref:${product.id}}} left for later.`),
    position: 1,
  });

  const milestones = [
    { label: 'M1', title: 'Substrate', summary: 'Tables and constraints.' },
    { label: 'M2', title: 'Surface', summary: 'The tools that write them.' },
  ].map((fields, position) => call.create_milestone({ spec_id: spec.id, position, ...fields }));

  const requirements = [
    {
      label: 'FR1',
      class: 'functional',
      moscow: 'must',
      text: 'A release is recorded as a row carrying its version, its date and its contents.',
    },
    {
      label: 'FR2',
      class: 'functional',
      moscow: 'should',
      text: 'A release names the artefacts it delivered, and the naming is a foreign key.',
    },
    {
      label: 'NFR1',
      class: 'non_functional',
      moscow: 'must',
      text: 'A query over a year of releases returns inside a second.',
    },
    {
      label: 'ENV1',
      class: 'environmental_requirement',
      text: 'The database ships with the repository and needs no server.',
    },
    {
      label: 'FR9',
      class: 'functional',
      moscow: 'wont',
      exclusion: 'out_of_scope',
      text: 'A release is announced to a mailing list.',
    },
  ].map((fields, position) => call.create_requirement({ spec_id: spec.id, position, ...fields }));

  for (const [position, fields] of [
    { requirement: requirements[0], text: 'A recorded release returns its version and date', tag: 'integration' },
    { requirement: requirements[0], text: 'a release is recorded with no contents', polarity: 'must_not', tag: 'unit' },
    { requirement: requirements[1], text: 'A release names its artefacts through the join', tag: 'feature' },
    { requirement: requirements[2], text: 'A year of releases returns inside a second', tag: 'manual' },
    { requirement: requirements[3], text: 'The suite runs from one command', tag: 'feature' },
  ].entries()) {
    const { requirement, tag, ...rest } = fields;
    const criterion = call.create_acceptance_criterion({
      requirement_id: requirement.id, position, ...rest,
    });
    call.create_criterion_approach({ criterion_id: criterion.id, tag });
  }

  // **The inline ADs — register entry 3.** `adr` seeds with `dir IS NULL`, so this renders inside
  // the spec and writes no file of its own. What the entry was about is everything below the
  // heading: a decision status, two options, one of them `chosen`, and tradeoff assessments on
  // shared axes. An AD that degraded to prose would keep the words and lose all four.
  // **It is created `proposed` and accepted afterwards, and the order is not incidental.** The
  // write-time guard refuses an accepted ADR carrying zero chosen options — register entry 8,
  // enforced at the boundary rather than found later — so accepting one before its options exist
  // is impossible by construction. That is the sequence a skill has to follow too.
  const adr = call.create_adr({
    parent_id: spec.id,
    slug: 'one-table-or-two',
    title: 'AD1: A release is one row, not a row and a manifest',
    decision_status: 'proposed',
    decision: 'One `release` row carrying its contents through a join, rather than a release row '
      + 'and a separate manifest document.',
  });

  const options = [
    { name: 'One row with a join', chosen: true, rationale: 'The contents are rows, so they are queryable.' },
    { name: 'A row and a manifest file', chosen: false, rationale: 'The manifest is prose again, one layer down.' },
  ].map((fields, position) => call.create_adr_option({ adr_id: adr.id, position, ...fields }));

  for (const option of options) {
    for (const axis of ['queryability', 'write cost']) {
      call.create_adr_option_tradeoff({
        option_id: option.id,
        axis,
        assessment: option.chosen ? 'A column answers it' : 'A reader has to open the file',
      });
    }
  }

  call.update_adr({ id: adr.id, decision_status: 'accepted' });

  // --- Two epics, one of which spans both milestones ------------------------------------------

  const epics = [
    { slug: 'substrate', title: 'The release tables' },
    { slug: 'surface', title: 'The tools and the projection' },
  ].map((fields) => call.create_epic({ parent_id: spec.id, ...fields, status: 'complete' }));

  call.create_document_section({
    document_id: epics[0].id,
    heading: 'Notes',
    // The second marker column shape: an epic's notes naming another epic, which is the sentence
    // register entry 5 quoted when it was opened.
    body: record(epics[0].id, `The tool half is epic {{ref:${epics[1].id}}}.`),
    position: 0,
  });

  call.create_document_milestone({ document_id: epics[0].id, milestone_id: milestones[0].id });

  // **The spanning epic — register entry 2.** `document_milestone` is many-to-many precisely so
  // one epic can sit in two milestones; an epic in exactly one exercises the table and not the
  // reason it is a join rather than a column.
  for (const milestone of milestones) {
    call.create_document_milestone({ document_id: epics[1].id, milestone_id: milestone.id });
  }

  const matrices = epics.map((epic, index) => call.create_coverage_matrix({
    parent_id: epic.id,
    slug: `${['substrate', 'surface'][index]}-coverage`,
    title: `Coverage Matrix: ${epic.title}`,
  }));

  const stories = [
    { epic: epics[0], number: 1, title: 'Create the release tables', status: 'complete', plan: 1 },
    { epic: epics[0], number: 2, title: 'Add the contents join', status: 'complete' },
    { epic: epics[1], number: 1, title: 'Write the create tools', status: 'complete' },
    { epic: epics[1], number: 2, title: 'Announce releases by email', status: 'withdrawn' },
  ].map((fields, position) => {
    const { epic, ...rest } = fields;
    return call.create_story({ epic_id: epic.id, position, ...rest });
  });

  // The description is recorded against the **epic**, not the story: a task has no file of its
  // own, so the document whose projection has to carry its prose is the epic above it.
  for (const [position, story] of stories.entries()) {
    call.create_task({
      story_id: story.id,
      number: 1,
      title: `Do the work of story ${story.number}`,
      description: record(epics[position < 2 ? 0 : 1].id,
        `Task prose for story ${story.number} of ${position < 2 ? 'substrate' : 'surface'}.`),
      position,
      status: story.status === 'withdrawn' ? 'withdrawn' : 'complete',
    });
  }

  // `blocks` gates work, so it is the edge FR22's readiness reads, at both the ends it admits;
  // `constrains` does not, and having both means the readiness query is answering rather than
  // defaulting. **The ends are not interchangeable** — `dependency_kind_endpoint` says which kinds
  // each edge kind joins, so an edge kind chosen for its `gates_work` flag alone is refused at the
  // write. `blocks` is the one kind with no rows there, because these two edges are exactly why:
  // its ends may be stories, which no document-kind pair can express.
  call.create_dependency({
    kind: 'blocks', source_story_id: stories[0].id, target_story_id: stories[1].id,
  });
  call.create_dependency({
    kind: 'blocks', source_document_id: epics[1].id, target_document_id: epics[0].id,
  });
  // The non-gating edge is `constrains`, and it is written once its two ADRs exist, below.

  // --- Coverage: fragments that are verbatim slices, and one claim beside one absence ----------

  const criteria = [];
  let coveragePosition = 0;

  for (const [index, requirement] of requirements.entries()) {
    const accepted = call.list_acceptance_criterion({
      requirement_id: requirement.id, include_body: true,
    }).items;

    for (const source of accepted) {
      const story = stories[index % 2];

      const criterion = call.create_story_criterion({
        story_id: story.id, text: source.text, polarity: source.polarity, position: criteria.length,
      });

      for (const { tag } of call.list_criterion_approach({ criterion_id: source.id }).items) {
        call.create_story_criterion_approach({ story_criterion_id: criterion.id, tag });
      }

      // A genuine verbatim slice: register entry 9 refuses a fragment its requirement's text does
      // not contain, so a fabricated one would be caught by the integrity sweep rather than here.
      const coverage = call.create_coverage({
        requirement_id: requirement.id,
        spec_fragment: requirement.text.split(' ').slice(1, 6).join(' '),
        story_criterion_id: criterion.id,
        position: coveragePosition,
        verified: true,
      });

      call.create_coverage_story({ coverage_id: coverage.id, story_id: story.id });

      criteria.push(criterion);
      coveragePosition += 1;
    }
  }

  // **Register entry 1 — partial coverage next to full.** Both requirements carry bound fragments;
  // only one carries the claim. Without the pair, "covered" and "claimed complete" are the same
  // observation and FR26 has nothing to distinguish.
  call.update_requirement({ id: requirements[0].id, coverage_claimed: true });

  // --- A review with findings and participants, an audit, a quick, a retro ---------------------

  const review = call.create_review({
    parent_id: spec.id, slug: 'release-record', title: 'Review: the release record',
    scope: 'story', scope_story_id: stories[0].id, status: 'complete',
  });

  for (const agent of ['architect', 'qa']) {
    call.create_document_agent({ document_id: review.id, document_kind: 'review', agent });
  }

  const findings = [
    { severity: 'Warning', category: 'Missing Acceptance Criteria', summary: 'FR2 has one criterion and two obligations.' },
    { severity: 'Suggestion', category: 'Testability Concerns', summary: 'NFR1 is tagged manual and could be timed.' },
  ].map((fields, position) => call.create_finding({
    review_id: review.id,
    position,
    agent: 'architect',
    category_id: taxonomy.get(`finding/${fields.category}`),
    severity_id: taxonomy.get(`severity/${fields.severity}`),
    summary: record(review.id, fields.summary),
    status: position === 0 ? 'accepted' : 'open',
  }));

  const audit = call.create_audit({ slug: 'release-debt', title: 'Audit: release debt', status: 'complete' });

  call.create_audit_finding({
    audit_id: audit.id,
    position: 0,
    dimension_id: taxonomy.get('audit_dimension/Test debt'),
    file: 'src/release/record.js',
    line: 42,
    symbol: 'recordRelease',
    severity_id: taxonomy.get('severity/Warning'),
    summary: record(audit.id, 'The contents join has no test at all.'),
    recommendation: record(audit.id, 'Add one integration test over a release with two artefacts.'),
  });

  const quick = call.create_quick({
    slug: 'version-sort', title: 'Sort versions numerically', status: 'complete', closed_at: AT,
  });

  call.create_quick_criterion({
    quick_id: quick.id, text: 'Versions sort 9 before 10', met: true, position: 0,
    note: record(quick.id, 'Was lexicographic.'),
  });

  // **Register entry 4 — a retro whose parent is the spec.** The seeded parentage allows
  // `retro→epic`, `retro→spec` and `retro→quick`; a corpus with only the first would leave the
  // pair the entry was opened for unexercised.
  const retro = call.create_retro({
    parent_id: spec.id, slug: 'release-record', title: 'Retro: the release record',
    status: 'complete',
  });

  const observations = [
    {
      category: 'Codebase Discoveries',
      // The child-row marker. `observation.text` is not a section, so this is the reference a
      // section-scoped table could never have reached — the reason entry 5 became a marker.
      text: `The version column had to be widened, which spec {{ref:${spec.id}}} did not foresee.`,
      synthesis: 'Widening was cheap because nothing read the column by offset.',
    },
    {
      category: 'Testing Gaps',
      text: 'The contents join shipped with no test.',
      note: 'Caught by the audit rather than by the story.',
    },
    {
      category: 'Smooth Deliveries',
      text: 'A lesson that has since been spent.',
    },
  ].map((fields, position) => {
    const { category, ...rest } = fields;
    const observation = call.create_observation({ retro_id: retro.id, position, ...rest });
    call.create_observation_category({
      observation_id: observation.id, taxonomy_id: taxonomy.get(`observation/${category}`),
    });
    record(retro.id, fields.text);
    return observation;
  });

  // **Retired after it was categorised, because it cannot be categorised after it is retired.** A
  // guard refuses a new row referencing a retired one — register entry 10, closed at the tool
  // boundary — so a corpus that seeded the retirement first would be describing an observation
  // that never had a category, which is not the shape a spent lesson has.
  call.update_observation({
    id: observations[2].id, retired_at: AT, retired_reason: 'the module it warned about is gone',
  });

  call.create_retro_application({
    retro_id: retro.id,
    applied_to_id: epics[1].id,
    theme: 'Testing Gaps',
    disposition: 'applied',
    // Recorded against the **epic**, because that is where the breadcrumb renders. The retro keeps
    // the row and the document it was applied to is what a reader meets it on, which is why
    // `load.js` reads `retro_application` by `applied_to_id` and not by `retro_id`.
    note: record(epics[1].id, 'The join test is Story 1 of the surface epic.'),
  });

  // --- The remaining kinds, so every seeded one has a document ---------------------------------

  const discussion = call.create_discussion({
    slug: 'versioning', title: 'Discussion: how versions are ordered', status: 'complete',
  });

  call.create_document_agent({ document_id: discussion.id, document_kind: 'discussion', agent: 'dev' });

  call.create_document_section({
    document_id: discussion.id,
    heading: 'Key points',
    body: record(discussion.id, 'Semantic versions sort by component, never as strings.'),
    position: 0,
  });

  const communication = call.create_communication({
    slug: 'release-note-draft', title: 'Draft release note', status: 'pending',
  });

  call.create_document_section({
    document_id: communication.id,
    heading: 'Draft',
    // Kept local and never published, which is why no `artifact` row names it — the absence is how
    // the corpus says this went nowhere.
    body: record(communication.id, 'Not issued. Held here until somebody decides it should be.'),
    position: 0,
  });

  const runbook = call.create_runbook({ slug: 'cut-a-release', title: 'Runbook: cut a release' });

  call.create_document_section({
    document_id: runbook.id,
    heading: 'Steps',
    body: record(runbook.id, 'Tag, build, record the row, then publish.'),
    position: 0,
  });

  const library = call.create_library({
    slug: 'versioning-standard',
    title: 'Versioning standard',
    doc_type: 'reference',
    source: 'https://semver.org/',
    status: 'complete',
  });

  for (const scope of ['spec', 'do']) call.create_library_scope({ document_id: library.id, scope });

  call.create_document_section({
    document_id: library.id,
    heading: 'Rule',
    body: record(library.id, 'A breaking change bumps the major, always.'),
    position: 0,
  });

  // --- Every remaining parentage pair -----------------------------------------------------------

  // **`document_kind_parent` is twelve pairs and a corpus reaching six of them proves half a
  // vocabulary.** Each pair below is a different parent for a kind already present, and each one
  // is a real shape: an AD reached during discovery, one reached in a discussion, a retro on an
  // epic rather than on the spec, a retro on a quick, a review of one epic. They are cheap and the
  // absence of any of them is invisible without the derived check that counts them.
  const parentage = [
    { kind: 'adr', parent: problem, slug: 'store-or-derive', title: 'AD2: The date is stored' },
    { kind: 'adr', parent: product, slug: 'one-feed', title: 'AD3: One feed, not one per team' },
    { kind: 'adr', parent: discussion, slug: 'sort-order', title: 'AD4: Versions sort by component' },
  ].map(({ kind, parent, slug, title }) => call.create_adr({
    parent_id: parent.id,
    slug,
    title,
    // Left `proposed`, which is also the case an accepted-only corpus never reaches: the guard on
    // `chosen` fires on acceptance, so a proposed ADR legitimately carries no options at all.
    decision_status: 'proposed',
    decision: `${title.split(': ')[1]}, pending review.`,
  }));

  // The non-gating edge promised above. `constrains` is ADR-to-ADR and nothing else, so it waits
  // here rather than standing next to the `blocks` edges it is the counterpart to.
  call.create_dependency({
    kind: 'constrains', source_document_id: parentage[0].id, target_document_id: parentage[1].id,
  });

  const epicRetro = call.create_retro({
    parent_id: epics[0].id, slug: 'substrate', title: 'Retro: the substrate epic', status: 'complete',
  });

  call.create_observation({
    retro_id: epicRetro.id, position: 0,
    text: record(epicRetro.id, 'The tables landed in one pass because the ADs were settled first.'),
  });

  const quickRetro = call.create_retro({
    parent_id: quick.id, slug: 'version-sort', title: 'Retro: the version sort', status: 'complete',
  });

  call.create_observation({
    retro_id: quickRetro.id, position: 0,
    text: record(quickRetro.id, 'A one-line fix, and the test for it took longer than the fix.'),
  });

  const epicReview = call.create_review({
    parent_id: epics[1].id, slug: 'surface', title: 'Review: the surface epic',
    scope: 'whole', status: 'complete',
  });

  call.create_finding({
    review_id: epicReview.id,
    position: 0,
    category_id: taxonomy.get('finding/Spec Compliance'),
    severity_id: taxonomy.get('severity/Suggestion'),
    summary: record(epicReview.id, 'Story 2 is withdrawn and the epic still counts it as work.'),
  });

  // A completed epic that will never carry a retro, said in a column rather than left to a reader
  // to infer from the absence of one.
  call.update_epic({
    id: epics[1].id, retro_waived_at: AT, retro_waived_reason: 'folded into the substrate retro',
  });

  // --- The artifact, its join, and a session ----------------------------------------------------

  // The two tables an earlier enumeration omitted. The register renders from them, so an artifact
  // with no join would produce a register naming a document nothing points at.
  const artifact = call.create_artifact({
    url: 'https://artifacts.example.test/release-record-map',
    title: 'The release record, illustrated',
    description: 'Which table answers which question, arranged as one page.',
    published_at: AT,
  });

  call.create_artifact_document({ artifact_id: artifact.id, document_id: spec.id });

  call.create_session({
    id: 'session-corpus', skill: 'dpm:do', phase: 'Story 2', state: '{"epic":"surface"}',
  });

  return {
    problem,
    product,
    spec,
    adr,
    options,
    milestones,
    requirements,
    epics,
    matrices,
    stories,
    criteria,
    review,
    findings,
    audit,
    quick,
    retro,
    observations,
    parentage,
    epicRetro,
    quickRetro,
    epicReview,
    discussion,
    communication,
    runbook,
    library,
    artifact,
    prose,
  };
}
