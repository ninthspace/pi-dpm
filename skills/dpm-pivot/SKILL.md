---
name: dpm-pivot
description: Course correction. Amend a planning artefact through its update tools, then walk the documents that hang off it and gate every downstream change on its own. Run with /dpm-pivot.
phases: select:off amend:high cascade:high tasks:medium retro:low
---

# Course Correction

Revisit a planning artefact — a problem brief, a product brief, a spec, an epic, an ADR, a
discussion or a quick record — amend it, and walk what hangs off it. Pivot is lighter than
re-running the skill that produced the artefact: it changes what is there rather than starting
over.

**The chain is stored, not rediscovered.** A document carries the id and the kind of the document
it hangs off, and that pair is pinned by a composite foreign key. So "what depends on this?" is a
traversal of edges the project already holds. Nothing here reads a reference out of a document's
prose, and nothing pairs one artefact with another by matching their names.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Session Startup**, **Library Check**, **Retro Awareness**, **Gate Presentation**,
**Conversational Output**, **Written Deliverable Length** and **Cross-References** from it.

## Input

What the request names is optional.

1. A **document id** names what to amend. It is resolved against Phase 1's lists rather than by
   guessing which read tool it belongs to — an id does not say what kind of thing it is.
2. A **description** ("the auth spec's scope was wrong") narrows the selection.
3. **Nothing** presents the selection in full.

## Startup

Follow the shared **Session Startup** procedure. `state` holds the artefact under amendment, each
amendment as it lands, and each downstream decision as the user makes it — so a cascade interrupted
halfway resumes at the change it was on instead of being facilitated again from the top. It holds
no status and no list of ids: those are columns, and a copy of a column goes stale.

Follow the shared **Library Check** procedure with scope keyword `pivot`. A project that has
recorded which artefacts are settled, or what an amendment is expected to carry, says so there.

Follow the shared **Retro Awareness** procedure. An incorporated lesson routes by category: one
about scope informs Phase 3, where the reach of a cascade is judged, and one about a criterion
having missed something informs Phase 2, where the amendment is drafted.

## Process

### Phase 1: Select

Call the lists for the kinds a person pivots, each with a `limit` above what the project plausibly
holds: `dpm_list_problem_brief`, `dpm_list_product_brief`, `dpm_list_spec`,
`dpm_list_epic`, `dpm_list_adr`, `dpm_list_discussion`, `dpm_list_quick`.
Then:

1. **Render them in the message body**, each with its kind, number and title.
2. **Then gate** the selection with the `question` tool.

The selected row carries its own `kind`, which is what Phase 3 traverses from and the one thing an
id on its own does not give.

**Nothing is grouped into a chain here.** A chain is what a run builds when it cannot ask; this one
can, so the relationships are read in Phase 3 from the document actually selected rather than
assembled in advance for every artefact in the project.

### Phase 2: Amend

1. **Read before proposing.** `dpm_list_document_section` on the artefact, then
   `dpm_read_document_section` with `include_body` for the sections in question — a section
   listed without its body is a `heading` and a position, and a run amending from headings is
   amending something it has not read. For a spec, `dpm_list_requirement` with `include_body`
   as well.
2. **Ask what to change**, in the user's own words.
3. **Apply each change through the update tool of the thing being changed.** Prose is
   `dpm_update_document_section`, which takes the new `body`. A document's own fields — its
   `title`, its `slug`, its status — are its kind's tool: `dpm_update_spec`,
   `dpm_update_epic`, `dpm_update_problem_brief`, `dpm_update_product_brief`,
   `dpm_update_adr`, `dpm_update_discussion`, `dpm_update_quick`. A requirement's
   `text` is `dpm_update_requirement` and its criteria `dpm_update_acceptance_criterion`;
   a story is `dpm_update_story`, its criteria `dpm_update_story_criterion`, and a task
   `dpm_update_task`.
4. **A status change carries `status` and nothing else.** The token and the human qualifier are two
   columns: `status` is the value every other skill reads, and `status_note` is the sentence whoever
   set it wrote. Passing `status` alone leaves that note exactly where its author put it. Amend
   `status_note` when the user's change is *about* the note — never as a side effect of moving the
   token, and never to restate what the token already says.

   **Name no status value in this file.** The set of them belongs to the database and is enforced
   there; a run offers what the tool accepts. A skill listing the values would be a second copy of
   a vocabulary — correct on the day it was written and silently short afterwards.
5. **Each call lands as it is made.** A run abandoned midway leaves everything already applied
   applied.

Close by saying what changed — section by section rather than line by line — and what it implies
for the documents below.

### Phase 3: Cascade

#### Where the cascade reaches

`dpm_read_document_kind` on the amended document's kind. Its `children` names the kinds that
may hang off this one; for each, call that kind's list scoped by `parent_id` to the amended
document — `dpm_list_epic`, `dpm_list_coverage_matrix`, `dpm_list_adr`,
`dpm_list_retro`, `dpm_list_review`, `dpm_list_product_brief`. Repeat on each
document found. It terminates on its own: a kind nothing hangs off comes back with `children`
empty.

**Scope every one of those calls by `parent_id`.** Unscoped, a list returns every document of that
kind in the project, and a cascade that then matches parents in the run is offering to amend
documents that have nothing to do with the change — and doing it quietly, because the offer looks
the same either way.

Two kinds reach further than their own row:

- **A spec.** `dpm_list_requirement` on it with `include_body`, then `dpm_list_coverage`
  scoped by `requirement_id` for each requirement that changed. Every coverage row names a
  `story_criterion_id`, and `dpm_read_story_criterion` opens it. That is the join from an
  amended requirement to the criteria written against it — the reach a cascade comparing prose
  never had, and the reason an amendment here can be specific about what it breaks.
- **An epic.** `dpm_list_story` on it, then `dpm_list_story_criterion` with
  `include_body` per story — each criterion is compared against what Phase 2 changed, which is a
  comparison of texts.

#### Before the walk

When every epic below is complete — counted from `dpm_list_story`'s `status`, not from
anything written in a document — the work has already been delivered, so ask what the amendment is
for before touching it:

- **Amend the record** — walk the cascade as below.
- **Pivot forward** — leave the completed epics standing as the record of what shipped, and hand
  off to `dpm-epics` with the amended spec.
- **Raise a new spec** — hand off to `dpm-spec`. Offered only when the amended artefact is a spec.

The second and third skip the walk entirely.

#### The walk

Closest dependency first. For each document reached:

1. Compare it against what Phase 2 changed, and identify the parts affected.
2. **Warn before proposing a change to work that is complete**: ⚠️ editing it changes the record of
   what was delivered. This is a flag on the decision, not a refusal — the user may well want it.
3. **Render each proposed change in the message body**, with the reason it follows from the
   amendment.
4. **Then gate each change on its own** with the `question` tool — apply, modify, or skip, one
   decision per change. Never present several for a single approval, and never carry an approval
   forward: a user who accepted three amendments has not accepted a fourth.
5. Apply what was approved through the same update tools Phase 2 used.

#### Bindings the amendment broke

A coverage row quotes a **verbatim fragment** of the requirement it binds. Amending that
requirement's text is what turns the quotation into a clause the requirement no longer contains, so
the bindings a pivot breaks are the pivot's to name.

1. `dpm_list_coverage` scoped by `requirement_id` for each requirement Phase 2
   amended, **with `include_body`** — `spec_fragment` is the withheld column and the comparison is
   over nothing else. Without it every row arrives with the fragment absent, and a comparison against
   an absent value finds every binding broken.
2. **The comparison is this skill's, and it is a substring test**: is the row's stored
   `spec_fragment` still a verbatim substring of the text Phase 2 wrote? That text is the one just
   written rather than one read back. The server does not make this judgement and does not offer it —
   `dpm_check_integrity` reports a broken binding afterwards, which is a fault
   found rather than a decision made.
3. **A binding already withdrawn is out of the answer**, because a list omits retired rows unless
   `include_retired` is passed and this step never passes it. So a run repeated after a retirement
   names what is left, and asks nobody to decide the same row twice.

Then offer each named binding **on its own approval** — apply, modify or skip, per *The walk* above,
one decision per binding and no approval carried forward. Show the fragment beside the clause that
replaced it, so what is being judged is a text rather than an id. On approval,
`dpm_retire_coverage` with the reason the withdrawal was made for. A binding
nobody approved is left exactly as it stands.

**Naming nothing is an answer.** An amendment every bound fragment survives has broken no binding —
say so and move on. Silence there is indistinguishable from a step that never ran.

#### Verification looks after itself

**Never write `verified_at`, and never clear one.** When an amendment changes a `story_criterion`'s
or a `requirement`'s `text`, the coverage row bound to it loses its verification and its binding
hash as a consequence of that write, and an edit that changes no bytes leaves the mark standing.
There is nothing to derive, nothing to locate, and no cell to edit.

Worth stating because the wrong instinct is available and looks conscientious. A run that tidies up
by clearing a mark itself is writing its own answer over the database's; a run that re-sets one is
asserting a verification nobody performed. Both are the false pass this decay exists to remove.

### Phase 4: Tasks affected

For each story whose criteria changed, `dpm_list_task` on it, and report which tasks are now
in doubt and why. **Change nothing.** What an amendment means for work already under way is the
user's call; this skill's job is to make sure they are looking at it.

**Report each task under the disposition the amendment gives it**, derived from which criteria moved
rather than judged task by task. Read the terms from `dpm_list_taxonomy` in the
`disposition` domain and render them in `position` order. A task under a criterion this pivot changed
is waiting on the reader, and says which criterion moved and what it now asks; a task under an
amended story whose own criteria did not move was looked at and is untouched; and the amendments
themselves are in the rows already. Because this phase changes nothing, everything it reports is
either a record or a decision — which is exactly why the two must not arrive in one paragraph.

### Phase 5: Retro

A pivot usually reflects a lesson. Offer `dpm-retro` on the amended artefact, and take no for an
answer — the offer is what stops the loop closing early, not a step to be completed.

## Output

The rows are the output. The projection regenerates every affected document from them, so nothing
here writes a rendered file and nothing reads one back.

## Guidelines

- **Amend, do not re-author.** A pivot changes the parts named. Rewriting a section that nobody
  asked about is a new draft wearing a correction's clothes.
- **Every downstream change belongs to the user.** Propose, explain, and wait. The cascade's value
  is that someone sees each consequence, not that the consequences get applied.
- **Scope every traversal.** A list without its `parent_id` is a different question with a
  plausible-looking answer.
- **Degrade by saying so.** A kind with empty `children` has no cascade — say that and finish. A
  document with no sections has nothing to amend but its own fields, which is a short run rather
  than a failed one.
