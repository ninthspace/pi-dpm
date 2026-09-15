/**
 * Which reads in the corpus ask for the body they render, and which have no body to ask for.
 *
 * FR13 bounds a read by default: a tool declaring `body: ['text']` returns every other column and
 * withholds that one unless `include_body` is passed. All three of FR13's original criteria are
 * about the tool. This file is about the twenty-three consumers, because the tool being correct is
 * not what makes the corpus correct.
 *
 * **The failure has no error in it, which is why the corpus needs a check of its own.** A withheld
 * column arrives as an *absent field*, so a step that renders stored text from a read that never
 * asked for it produces output that is well-formed, structurally complete, and simply says less.
 * Nothing is empty and nothing throws; the missing text reads as a field nobody filled in.
 *
 * Three things here, in the order they have to happen:
 *
 * 1. **`withheld`** — which tools withhold, taken off the live registry. Never a written list: half
 *    of them are generated, `list.js` copying each list tool's `body` from its matching read tool,
 *    so a transcription would carry the sixteen read tools and miss the twenty list tools beside
 *    them and report a corpus in which two thirds of the sites do not exist.
 * 2. **`sites`** — every mention of one of those in a skill file, with the step it sits under and
 *    the block it sits in. Derived the same way and for the same reason.
 * 3. **`CLASSIFICATION`** — what each site's step *does with the rows*, which is a judgement and is
 *    the one part of this that cannot be derived. It is checked against (2) in both directions, so
 *    a new site with no entry fails and an entry for a site that no longer exists fails.
 */

import { PREFIX, conventions, prose, skillNames, skillSource, toolMentions } from './skills.js';

/** The shared conventions, under a name no skill directory can take. */
export const SHARED = 'shared/skill-conventions.md';

/**
 * The tools that withhold a column, as a set of names.
 *
 * `body: []` — which `document.js` declares — is not withholding, and reads as one under a truthy
 * check. Every document kind would then be a site with nothing to ask for, and the corpus would
 * carry sixty entries whose reason is "there is no body", which is a list of noise an entry can
 * hide in.
 *
 * @param {object[]} tools The live registry.
 * @returns {Set<string>}
 */
export function withheld(tools) {
  return new Set(tools.filter((tool) => tool.body?.length > 0).map((tool) => tool.name));
}

/**
 * A markdown source split into the units that bind a read to its step.
 *
 * **This is the construction, and picking it is the whole design.** These files write a call as a
 * numbered instruction item — ``1. `dpm_list_agent`, passing `include_body`.`` —
 * or, where a step is prose, as a paragraph. Either way the tool and the arguments it carries sit
 * in one block, so the block is what a check should read.
 *
 * The alternatives were tried and both are weaker in the same direction. A **character window**
 * around the tool name reaches across item boundaries, so item 2's `include_body` covers item 1's
 * unbodied read; retro 38 recorded exactly that false pass — *"a step's `include_body` was covered
 * by a shared section that names it for different reads"*. The **whole file** is that failure
 * without the boundary: a file could name `include_body` once, for a read that has nothing to do
 * with the twelve others in it, and satisfy any check written over the source. A **section** sits
 * between the two and still lets a step with two reads satisfy the check for both by asking on
 * behalf of one.
 *
 * A block ends at a blank line, at a heading, or at the next list marker. Continuation lines — the
 * indented remainder of an item, or the rest of a hard-wrapped paragraph — belong to the block they
 * continue, because a hard wrap is a fact about the line width and not about the instruction.
 *
 * @param {string} source
 * @returns {{start: number, text: string}[]}
 */
export function blocks(source) {
  const found = [];
  let current = null;
  let offset = 0;

  for (const line of source.split('\n')) {
    const start = offset;
    offset += line.length + 1;

    // A heading names the step; it is not part of any instruction under it. A blank line ends
    // whatever was open. Both leave the next line to start a block of its own.
    if (/^#{1,6} /.test(line) || line.trim() === '') {
      current = null;
      continue;
    }

    if (current === null || /^\s*(?:\d+\.|[-*+])\s/.test(line)) {
      current = { start, text: line };
      found.push(current);
    } else {
      current.text += `\n${line}`;
    }
  }

  return found;
}

/**
 * The heading a position sits under, as its text — the *step*, in the epic's terms.
 *
 * @param {string} source
 * @param {number} index
 * @returns {string}
 */
export function stepAt(source, index) {
  const before = source.slice(0, index).split('\n');

  for (let line = before.length - 1; line >= 0; line -= 1) {
    if (/^#{2,6} /.test(before[line])) return before[line].replace(/^#+\s*/, '').trim();
  }

  return '(preamble)';
}

/**
 * Every mention of a withholding tool in one source, with the step it sits under and the block it
 * sits in.
 *
 * **Matched on the callable form**, for `toolNames`' reason: a bare `list_requirement` is not
 * something an agent can call, and treating it as a site would launder a name no run can reach into
 * a site that classifies clean.
 *
 * Repeated mentions of one tool under one step collapse to a single site *per block*, so a step
 * that names a tool twice in the same sentence is one site and a step that names it in two separate
 * instructions is two — which is right, because the two instructions can differ in what they do
 * with the rows.
 *
 * @param {string} source
 * @param {Set<string>} names From `withheld`.
 * @returns {{tool: string, step: string, index: number, block: string}[]}
 */
export function sites(source, names) {
  const units = blocks(source);
  const found = new Map();

  for (const hit of toolMentions(source)) {
    if (!names.has(hit[1])) continue;

    const unit = units.findLast((block) => block.start <= hit.index);
    const inside = unit && hit.index < unit.start + unit.text.length;

    const site = {
      tool: hit[1],
      step: stepAt(source, hit.index),
      index: hit.index,
      block: inside ? unit.text : '',
    };

    // Keyed on the block rather than on the step, so the collapse above is the one described.
    found.set(`${site.tool} ${unit?.start ?? site.index}`, site);
  }

  // **An ordinal, because one tool can appear under one heading in two instructions that want
  // different answers.** `shared`'s `Perspectives` is the clearest: step 1 loads the roster and has
  // to carry the body, and the closing sentence names the same tool again only to say what an empty
  // result means. Keyed on the step alone the two would collide, and whichever entry was written
  // second would silently classify both.
  const seen = new Map();

  return [...found.values()]
    .sort((one, other) => one.index - other.index)
    .map((site) => {
      const at = `${site.tool} ${site.step}`;
      const ordinal = (seen.get(at) ?? 0) + 1;

      seen.set(at, ordinal);

      return { ...site, ordinal };
    });
}

/**
 * The corpus: every skill, plus the shared conventions.
 *
 * **The shared file is in it, and that is deliberate rather than incidental.** It is where the
 * lesson was first learnt — `Perspectives` loaded a roster without `include_body` and wove voices
 * off nothing — and it is now the model, passing the argument at every one of its four reads. A
 * corpus check that skipped it would leave its hole exactly where the last one was found, and would
 * do so while reporting the property holding everywhere.
 *
 * @param {Set<string>} names From `withheld`.
 * @returns {Map<string, {source: string, sites: object[]}>}
 */
export function corpus(names) {
  const found = new Map(skillNames()
    .map((name) => [name, skillSource(name)])
    .map(([name, source]) => [name, { source, sites: sites(source, names) }]));

  const shared = conventions();
  found.set(SHARED, { source: shared, sites: sites(shared, names) });

  return found;
}

/**
 * What each site's step does with the rows — `true` where it renders or quotes stored text, `false`
 * where it needs only identity or a typed column, with the reason in both directions.
 *
 * **Judged from the step, never from what is written near the tool name.** The proximity sweep that
 * opened this epic reported six skills clean; two of them are not, and both misses are the same
 * shape — `artifact`'s Input matches a search term against `description`, and `consult`'s Invite
 * reads an agent "for their traits", each a body column named in words the sweep had no way to see.
 * It also flagged sites that are correct: `inspect` joins and counts, `epics` Step 4's coverage read
 * follows a foreign key, `status` Phase 3b's takes three states off `verified_at`. Reading each step
 * moved sites in both directions, which is what a proxy cannot do.
 *
 * **The `false` entries carry the more load-bearing reasons.** A `true` that is wrong shows up as an
 * argument passed where it was not needed; a `false` that is wrong is a render that quietly says
 * less, which is the failure the whole epic is about. So each one names the column it does *not*
 * need and what it uses instead, and a reader disagreeing with it has something specific to
 * disagree with.
 */
export const CLASSIFICATION = new Map(Object.entries({
  // **The skill segment is written bare and prefixed on the way in — see `prefixed` below.** The
  // hundred entries here are a transcription a reader scans by skill, and `dpm-` on every one of
  // them is a hundred repetitions of the one thing every entry has in common.
  // --- architect --------------------------------------------------------------------------------
  'architect · list_document_section · Input':
    [false, 'enumerates the sections; the `read_document_section` beside it is what opens the prose'],
  'architect · read_document_section · Input':
    [true, 'the constraints and success criteria it records are what the decision is judged against'],
  'architect · list_agent · Roster':
    [true, '**Perspectives** weaves voices from `personality` and `communication_style`'],

  // --- artifact ---------------------------------------------------------------------------------
  'artifact · list_artifact · Input':
    [true, 'the step matches the search term against title **and `description`**, which is the withheld column'],
  'artifact · list_artifact · 1. Resolve before creating':
    [false, 'matches on `url`, which is unique and is not withheld'],
  'artifact · read_artifact · 1. Resolve before creating':
    [true, 'shows the candidate entry so the user can tell one artifact from another'],

  // --- brief ------------------------------------------------------------------------------------
  'brief · list_agent · Roster':
    [true, '**Perspectives** weaves voices from `personality` and `communication_style`'],
  'brief · list_document_section · Phase 1: Problem recap':
    [false, 'enumerates the sections; the read beside it opens them'],
  'brief · read_document_section · Phase 1: Problem recap':
    [true, 'the constraints are restated to the user for confirmation, which is a quotation'],

  // --- clean ------------------------------------------------------------------------------------
  // The model entry: this step says so itself, in as many words.
  'clean · list_session · Step 1: The inventory':
    [false, 'the file states it outright — *"Leave `include_body` alone"*, because *"the inventory needs the id, the skill, the phase and the age, and each of those is a column"*'],
  'clean · list_session · Step 2: Which of them are stale':
    [false, 'the stale set is a `WHERE` clause on `updated_at`; nothing reads `state`'],
  'clean · read_session · Step 3: Ask, then confirm':
    [true, 'shows what a row was carrying before it goes — the blob has no other home'],
  'clean · delete_session · Step 4: Delete what was confirmed':
    [false, 'the row comes back to report the deletion by id, skill and phase; Step 3 is where `state` was offered'],

  // --- consult ----------------------------------------------------------------------------------
  // The other must-NOT case: `include_body` is in this block, and it belongs to the read.
  'consult · list_agent · Startup':
    [false, 'the file divides the labour — *"the list gives you names and roles and the read gives you the voice"*'],
  'consult · read_agent · Startup':
    [true, 'the voice each agent speaks in is the two body columns'],
  'consult · list_agent · Input':
    [false, 'matches the argument against `display_name` and `role`, both typed columns'],
  'consult · read_document_section · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_requirement · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_acceptance_criterion · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_story_criterion · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_finding · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_observation · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_task · Input': [true, 'a search hit is opened and used as context'],
  'consult · read_agent · Commands':
    [true, 'reads an invited agent *"for their traits"*, and the traits are exactly the body columns'],

  // --- discover ---------------------------------------------------------------------------------
  'discover · list_agent · Roster':
    [true, '**Perspectives** weaves voices from `personality` and `communication_style`'],

  // --- do ---------------------------------------------------------------------------------------
  'do · list_task · Story selection':
    [false, 'takes the lowest `number` whose `status` is pending; both are typed columns'],
  'do · list_story_criterion · Story selection':
    [true, 'what the story is measured against, and a criterion has no title — its `text` is its name'],
  'do · list_task · Story selection #2':
    [false, 'rebuilds the harness mirror, which shows the run\'s shape; the description is read per task at Step 1'],
  'do · read_task · 1. Load context':
    [true, 'the file says it — *"A task\'s `description` says what it contributes"*'],
  'do · list_coverage · 5. Verify':
    [false, 'takes each row\'s id and writes `verified_at` back; the fragment is not read'],
  'do · list_requirement · 8. Epic summary':
    [true, 'the run judges whether the bound fragments account for the requirement **whole**, which is a reading of its text'],
  'do · list_coverage · 8. Epic summary':
    [true, 'the same judgement is made against `spec_fragment`, which is the withheld column'],
  'do · list_coverage · 8. Epic summary #2':
    [false, 'the denominator is *"the bindings still standing"* — a count of the rows the call returns, and the fragment is judged by the read above it'],
  'do · list_observation · 8. Epic summary':
    [true, 'the observations are synthesised, and a synthesis of withheld text is a synthesis of nothing'],
  'do · list_story_criterion · 8. Epic summary':
    [true, 'the roll-up reports the criteria whose `accounted_for` is false, and a criterion has no title — its `text` is how the report names it'],

  // --- epics ------------------------------------------------------------------------------------
  'epics · list_requirement · Step 1: Read the source':
    [true, 'Step 3d binds each coverage row with a **verbatim fragment of that requirement\'s own text**, and `create_coverage` refuses a fragment that is not a substring'],
  'epics · list_document_section · Step 1: Read the source':
    [true, 'the scope boundary and the integration boundaries are what those sections say, not that they exist'],
  'epics · list_acceptance_criterion · Acceptance criteria':
    [true, 'every `must_not` criterion is given a story criterion with the same text — the file calls it transcription'],
  'epics · list_task · Step 3b: Tasks within stories':
    [false, 'the read-back compares titles with the ones approved, and a title is not withheld'],
  'epics · list_coverage · Step 3d: Requirement coverage':
    [true, 'the read-back compares each binding with the one approved, fragment included, and `spec_fragment` is withheld'],
  'epics · list_task · Step 4: Confirm':
    [true, 'reads the tree back to catch *"A value that never reached a row is absent from the rows"*, and `description` is one of those values'],
  'epics · list_story_criterion · Step 4: Confirm':
    [false, 'names the field `check_coverage` shares with this list; the gap check reads the report, not the list'],
  'epics · list_story_criterion · Step 4: Confirm #2':
    [true, 'reads the tree back, and a criterion\'s `text` is a value a read that did not ask for it returns as absent'],
  'epics · list_story_criterion · Session':
    [false, 'a resume asks only whether a story already has criteria, which is whether the list is empty'],
  'epics · list_task · Session':
    [false, 'a resume asks only whether a story already has tasks, which is whether the list is empty'],
  'epics · list_coverage · Session':
    [false, 'a resume asks only whether a criterion is already bound, and follows `story_criterion_id`'],

  // --- inspect ----------------------------------------------------------------------------------
  // Eight sites, none of which needs a body — and the sweep flagged every one.
  'inspect · list_requirement · 3. Join the change set to what records intent':
    [false, 'traces a change set to the row that records its intent; a requirement is named by `label`'],
  'inspect · list_task · 3. Join the change set to what records intent':
    [false, 'the join is to the row; a task is named by its `title`'],
  'inspect · list_story_criterion · 3. Join the change set to what records intent':
    [false, 'reached as part of the chain, and the report is the mapping rather than the criteria'],
  'inspect · list_coverage · 3. Join the change set to what records intent':
    [false, 'coverage is the join, read in both directions by id'],
  'inspect · list_observation · 3. Join the change set to what records intent':
    [false, 'enumerates what the pipeline holds; the gap query is *a completed epic with no retro*'],
  'inspect · list_artifact · 3. Join the change set to what records intent':
    [false, 'reports what has been published, by `title` and `url`'],
  'inspect · list_coverage · 3. Join the change set to what records intent #2':
    [false, 'the gap query is whether the list comes back empty'],
  'inspect · list_acceptance_criterion · 3. Join the change set to what records intent':
    [false, 'read only for the ids `dpm_list_criterion_approach` takes; the tags are compared, not the text'],

  // --- library ----------------------------------------------------------------------------------
  'library · list_document_section · 1. Read what is there':
    [false, 'enumerates the sections; the file attaches the argument to the read beside it — *"each read with"* it *"and `include_body`"*'],
  'library · read_document_section · 1. Read what is there':
    [true, 'the reconciliation folds the amendments into the body, which it has to have'],
  'library · list_document_section · 3. Write it back':
    [false, 'names `include_superseded`, not the body: the point is that a folded amendment stays reachable'],

  // --- party ------------------------------------------------------------------------------------
  'party · list_agent · Startup':
    [true, 'the file says it — *"One call, and it must carry the body"*'],
  'party · read_document_section · Input': [true, 'a search hit is put in front of the room'],
  'party · read_requirement · Input': [true, 'a search hit is put in front of the room'],
  'party · read_acceptance_criterion · Input': [true, 'a search hit is put in front of the room'],
  'party · read_story_criterion · Input': [true, 'a search hit is put in front of the room'],
  'party · read_finding · Input': [true, 'a search hit is put in front of the room'],
  'party · read_observation · Input': [true, 'a search hit is put in front of the room'],
  'party · read_task · Input': [true, 'a search hit is put in front of the room'],
  'party · list_document_section · Input':
    [true, 'puts a whole document in front of the room rather than one hit'],

  // --- pivot ------------------------------------------------------------------------------------
  'pivot · list_document_section · Phase 2: Amend':
    [false, 'enumerates the sections; the read beside it carries the body and says why'],
  'pivot · read_document_section · Phase 2: Amend':
    [true, 'the file says it — *"a run amending from headings is amending something it has not read"*'],
  'pivot · list_requirement · Phase 2: Amend':
    [true, 'a requirement is amended by rewriting its `text`, which has to be read first'],
  'pivot · list_requirement · Where the cascade reaches':
    [true, 'the cascade is specific about what an amendment breaks, which is a comparison of text'],
  'pivot · list_coverage · Where the cascade reaches':
    [false, 'the file says what it takes — *"Every coverage row names a `story_criterion_id`"*'],
  'pivot · read_story_criterion · Where the cascade reaches':
    [true, 'opens the criterion written against the amended requirement, to say what it breaks'],
  'pivot · list_story_criterion · Where the cascade reaches':
    [true, 'the epic branch of the same walk — the criteria are compared against what Phase 2 changed'],
  'pivot · list_coverage · Bindings the amendment broke':
    [true, 'the step asks whether each row\'s `spec_fragment` is *"still a verbatim substring of the text Phase 2 wrote"*, and the fragment is the withheld column'],
  'pivot · list_task · Phase 4: Tasks affected':
    [false, 'reports **which** tasks are in doubt; the *why* is the criterion change already in hand'],

  // --- present ----------------------------------------------------------------------------------
  'present · list_document_section · 1. Select the sources':
    [true, 'the file attaches the argument to both — *"passing `include_body`"* — and says a draft from headings alone is a table of contents'],
  'present · read_document_section · 1. Select the sources':
    [true, 'the draft is written from the sections\' prose'],
  'present · read_artifact · 5. Record it':
    [false, 'the file says what it takes — *"gives each one its `title` and `url`"*'],

  // --- quick ------------------------------------------------------------------------------------
  'quick · list_quick_criterion · Step 2: Propose, confirm, and write the record':
    [true, 'the file says it — *"Those criteria are what Step 4 decides against — read them back rather than working from the conversation"*'],

  // --- ralph ------------------------------------------------------------------------------------
  'ralph · list_requirement · 1d. Test runner discovery':
    [true, 'takes the test tooling from the environmental requirements that name it, which is in their text'],
  'ralph · list_session · 1e. Resume detection':
    [false, 'finds the most recent row for the skill; the state is read by the `read_session` below'],
  'ralph · read_session · 1e. Resume detection':
    [true, 'reads how many iterations ran and what they measured, all of which is `state`'],
  'ralph · adopt_session · 1e. Resume detection':
    [true, 'the file says it — *"It hands back the state"* — and `state` is the withheld column'],
  'ralph · list_story_criterion · The completion check is a traversal, and the loop relays it':
    [true, 'unverified rows are **named** to the user, and a criterion has no title to name it by'],
  'ralph · list_coverage · The completion check is a traversal, and the loop relays it':
    [false, 'a row whose `verified_at` is set is verified; that is the whole reading'],
  'ralph · list_requirement · The completion check is a traversal, and the loop relays it':
    [false, 'a requirement no coverage row claims is untraced, and it is named by `label`'],
  'ralph · list_coverage · The completion check is a traversal, and the loop relays it #2':
    [false, 'the spec-mode half of the same traversal, read the same way'],

  // --- retro ------------------------------------------------------------------------------------
  'retro · list_observation · Step 1: Gather the observations':
    [true, 'Step 2 writes, per category, what the group says that no single observation says — off this read'],
  'retro · list_observation · Step L1: Select':
    [true, 'the candidates are presented for the user to choose a lesson from'],
  'retro · list_observation · Step T1: Classify':
    [true, 'the waivable outcome is *no observations worth synthesising*, which is a judgement about their text'],

  // --- review -----------------------------------------------------------------------------------
  'review · list_agent · Roster':
    [true, 'the panel is the roster, and each lens is `personality` and `communication_style`'],
  'review · list_task · Step 1: Read what is under review':
    [true, 'the panel reviews the work, and what a task does is its `description`'],
  'review · list_story_criterion · Step 1: Read what is under review':
    [true, 'the criteria are what the epic is measured against and what the findings speak to'],
  'review · list_requirement · Step 1: Read what is under review':
    [true, 'gives what the epic is *supposed to satisfy*, which is the requirement\'s text'],
  'review · list_acceptance_criterion · Step 1: Read what is under review':
    [true, 'the other half of the same lineage read'],
  'review · list_coverage · Step 1: Read what is under review':
    [false, 'gives what the epic *claims to* satisfy — the join, stated by the rows themselves'],

  // --- spec -------------------------------------------------------------------------------------
  'spec · list_agent · Roster':
    [true, '**Perspectives** weaves voices from `personality` and `communication_style`'],
  'spec · list_document_section · Constraint inheritance':
    [true, 'reads the section headed *Constraints* and carries its entries forward; no read tool sits beside it'],
  'spec · list_requirement · Section 7: Review':
    [true, 'renders the complete spec in the message body, and a requirement is its text'],
  'spec · list_acceptance_criterion · Section 7: Review':
    [true, 'the same render, and a criterion is its text'],
  'spec · list_document_section · Section 7: Review':
    [true, 'the same render, and a section is its body'],
  'spec · list_document_section · Session':
    [false, 'a resume asks whether the recap\'s sections are written, which their headings answer'],
  'spec · list_requirement · Session':
    [true, 'a resume tells a written requirement from a proposed one by its text'],
  'spec · list_adr_option · Session':
    [false, 'a resume asks whether an ADR already has options, which is whether the list is empty'],
  'spec · list_document_section · Session #2':
    [false, 'a resume asks whether the scope and integration sections are written, which their headings answer'],
  'spec · list_acceptance_criterion · Session':
    [true, 'a resume tells a written criterion from a proposed one by its text'],

  // --- status -----------------------------------------------------------------------------------
  'status · list_task · Phase 1: The planning rows':
    [false, 'the roll-up counts `status`; task-level detail is the count, not the description'],
  'status · list_session · Phase 1: The planning rows':
    [false, 'reports which skills have runs in flight, with `phase` saying where each reached'],
  'status · list_requirement · Phase 3b: Spec coverage roll-up (only for a spec)':
    [true, 'the file says it — *"quoting each requirement\'s `text` **verbatim**"*'],
  'status · list_coverage · Phase 3b: Spec coverage roll-up (only for a spec)':
    [false, 'the three states are read off `verified_at` and the row count'],

  // --- the shared conventions -------------------------------------------------------------------
  [`${SHARED} · list_session · Session Startup`]:
    [false, 'finds what is open and how old it is; the adopt below is what carries the state'],
  [`${SHARED} · adopt_session · Session Startup`]:
    [true, 'the resumed run inherits what the last one held, which is `state`'],
  [`${SHARED} · list_document_section · Library Check`]:
    [true, 'the procedure attaches the argument to both, and says a section without it is a heading with no text'],
  [`${SHARED} · read_document_section · Library Check`]:
    [true, 'the section bodies are what a library document is consulted for'],
  [`${SHARED} · list_observation · Retro Awareness`]:
    [true, 'the selection judges subject overlap, which is a reading of each observation'],
  [`${SHARED} · list_agent · Perspectives`]:
    [true, 'the roster is loaded for the voices, and the two traits are body columns'],
  [`${SHARED} · list_agent · Perspectives #2`]:
    [false, 'names the same call again only to say what an empty result means'],
}).map(([name, judgement]) => [prefixed(name), judgement]));

/**
 * One classification key with its skill segment brought into line with the tree — epic 02-02.
 *
 * The keys are `<file> · <tool> · <step>`, and `<file>` is whatever `corpus()` keyed the body under:
 * a skill's directory name, or `shared/skill-conventions.md` for the file every body reads. Story 1
 * renamed the directories to `dpm-<skill>`, so every skill key needed the prefix and the shared one
 * needed to be left alone.
 *
 * **The shared entry is told apart by the slash in its own name, not by comparing it to `SHARED`.**
 * A key that already carries the prefix is also left as it is, so the function is safe to apply
 * twice — which matters, because the thing that would otherwise happen here is `dpm-dpm-do`.
 *
 * @param {string} name
 * @returns {string}
 */
function prefixed(name) {
  const [file, ...rest] = name.split(' · ');

  return file.includes('/') || file.startsWith(PREFIX)
    ? name
    : [`${PREFIX}${file}`, ...rest].join(' · ');
}

/** How a site is named in the classification, and in a failure. */
export function key(file, site) {
  return `${file} · ${site.tool} · ${site.step}${site.ordinal > 1 ? ` #${site.ordinal}` : ''}`;
}

/**
 * The corpus and the classification, reconciled — what every check over this reads.
 *
 * **Both directions, because each catches a different kind of rot.** A site with no entry is a read
 * nobody has judged, arriving with a new skill or a reworded step; an entry with no site is a
 * judgement about something that has moved or gone, still sitting there looking like coverage. The
 * asymmetry matters: the first fails open unless it is checked, and the second is how a
 * classification quietly becomes a list of assertions about a file that no longer says any of it.
 *
 * @param {Set<string>} names From `withheld`.
 * @returns {{entries: object[], unclassified: string[], stale: string[]}}
 */
export function resolve(names) {
  const entries = [];
  const unclassified = [];
  const seen = new Set();

  for (const [file, { source, sites: found }] of corpus(names)) {
    for (const site of found) {
      const name = key(file, site);
      const judgement = CLASSIFICATION.get(name);

      seen.add(name);

      if (!judgement) {
        unclassified.push(name);
        continue;
      }

      entries.push({
        ...site,
        file,
        source,
        key: name,
        needs: judgement[0],
        why: judgement[1],
        // **The whole step, for the reason — where the block is for the instruction.** Retro 37's
        // split, and it cuts the same way here: the numbered line is the call, and the paragraph
        // under it is why the call is made that way. `clean`'s inventory names the tool in one
        // paragraph and says *"Leave `include_body` alone"* in the next, so a reason checked against
        // the block alone would fail on the clearest-stated judgement in the corpus.
        //
        // `prose` rather than `section`, because a quote is a phrase and these files are hard
        // wrapped — the reasoning that helper already carries, reused rather than restated.
        stepText: prose(source, site.step),
      });
    }
  }

  return {
    entries,
    unclassified,
    stale: [...CLASSIFICATION.keys()].filter((name) => !seen.has(name)),
  };
}

/**
 * The phrases a reason quotes from the file it is about, as the **control on the reason itself**.
 *
 * Retro 38's disposition, applied here: an exemption carries its reason, its scope, and a test that
 * fails when the reason stops being true. A reason is prose and most of it cannot be checked — but
 * the strongest reasons in this file are the ones that quote the step, because the step said the
 * thing outright. `clean`'s inventory is the model: *"Leave `include_body` alone… the inventory
 * needs the id, the skill, the phase and the age, and each of those is a column."*
 *
 * Where a reason quotes, the quote is checked against the **step** — not the block, because a
 * justification belongs in the paragraph beneath the instruction as often as in it. Reword the step
 * and the entry fails with the sentence it was resting on, rather than outliving it, which is
 * exactly what a classification recorded once and never revisited would otherwise do.
 *
 * Quotes are written as `*"…"*` and matched with whitespace collapsed, because these files are hard
 * wrapped and a phrase sits on one line today and across two after an edit above it.
 *
 * @param {string} why
 * @returns {string[]}
 */
export function quoted(why) {
  return [...why.matchAll(/\*"([^"]+)"\*/g)].map((hit) => flat(hit[1]));
}

/** Whitespace collapsed, so a hard wrap is not a difference. */
export function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Whether a site's step asks for the body — the construction Story 3's assertion runs on.
 *
 * Scoped to the **block**, per `blocks` above: not the file, not a character window, and not the
 * section. Its one residual gap is stated where the check is, because a check whose limits are
 * only in the author's head is a check that will be read as total.
 *
 * @param {{block: string}} site
 * @returns {boolean}
 */
export function asks(site) {
  return /\binclude_body\b/.test(site.block);
}
