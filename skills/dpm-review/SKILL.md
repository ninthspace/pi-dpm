---
name: dpm-review
description: Adversarial review of an epic or one of its stories, using the agent roster. Each persona examines the work through their professional lens; findings carry a severity and a category as typed references, and remediation becomes tasks on the epic. Run with /dpm-review.
thinking: medium
phases: read panel find rank write remediation handoff
---

# Adversarial Review

Run a critical review of an epic or a single story. Each persona challenges assumptions, spots gaps
and flags risks, and every finding is recorded with what kind of problem it is and how badly it
matters.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length**,
**Cross-References** and **Artifact Publishing** from it.

## Input

Resolve what is being reviewed, in this order.

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   `dpm_read_epic` on it. A reference goes through
   `dpm_resolve_reference` first, which returns the row it names or refuses; a
   ULID is already the id and needs no resolving.
2. Otherwise `dpm_list_epic` and offer the results with the `question` tool, showing each title.
   **Ask which one; never take the most recent.**
3. If there are none, say so and stop — there is nothing to review.

Then the scope. `dpm_list_story` on the epic and ask: the whole epic, or one story. A story
named in the request skips the question.

**Scope is a column pair, not a name.** A story-scoped review is the same kind of document as a
whole-epic one, hung off the same epic, with `scope: 'story'` and `scope_story_id` naming the story.
Both are set together or neither is — the database refuses one without the other — so a review can
never claim a narrowing it does not carry.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:review'`.

**Every finding belongs in `state` as it is found**, because Step 2 is the expensive half and a run
resumed after it has no other way back to what the personas said.

### Roster

`dpm_list_agent` with `include_body` — this is the review panel, and it is the whole of it.
The personality and communication style are body columns, so without that argument each persona
arrives as a name and a role and every lens below is the same lens.

**The roster is rows, so a project can add to it.** A persona this plugin never shipped joins the
selection because it is in the table, with no plugin change and no file edit; a retired one is
skipped because the row says so. Use only what the row carries — name, display name, icon, role,
personality and communication style. Do not invent a trait to fill a persona out.

### Library

Follow the shared **Library Check** procedure with scope keyword `review`. A reviewer citing a
recorded standard is making a stronger finding than one citing taste.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated, they become **review prompts** rather than context: a retro that flagged criteria gaps in
one area is a reason to look for the same gap here. That is the whole of the incorporation — this
skill has no phase a category routes to, and a lesson that cannot be turned into a question to ask
of this artefact is one to leave.

## Process

### Step 1: Read what is under review

The epic through its own rows: `dpm_list_story`, then `dpm_list_task`,
`dpm_list_story_criterion` — both with `include_body`, a task being its `description` and a
criterion its `text` — and `dpm_list_story_criterion_approach` per story, and
`dpm_list_dependency` for what blocks what. On a story-scoped review, read every story anyway —
a story is reviewed in the epic it sits in, and its dependencies point at siblings.

Then its lineage. The epic's `parent_id` is the spec, so `dpm_read_spec`,
`dpm_list_requirement` and `dpm_list_acceptance_criterion`, both with `include_body`,
give what the epic is supposed to satisfy — which is their text and not their count — and
`dpm_list_coverage` gives what it claims to. `dpm_list_adr` and
`dpm_read_adr` on the spec give the decisions the stories have to respect.

**Nothing here is discovered.** The spec is the epic's parent, the coverage rows name their own
requirement, the ADRs hang off the spec — there is no field to read out of prose and no file to
match by name. A coverage row whose requirement has no story criterion is a gap the rows state
outright.

Summarise what is being reviewed and how much of it, then proceed.

### Step 2: Select the panel

Two or three agents for a story, three or four for an epic, chosen for what the work actually
touches — infrastructure to the DevOps engineer, user flows to the UX designer, terminology to the
technical writer.

**Two are not optional.** One agent must challenge the *business value* and one the *technical
approach*, so every review carries both a "should we?" and a "can we?". A panel of four technical
reviewers is a panel with one question.

Record each as `dpm_create_document_agent` once the review row exists in Step 4 — the row
references the `agent` by name rather than copying the persona into the finding, which is what lets
a project rename a persona without orphaning its past reviews.

### Step 3: Find, then rank

Two stages, and keeping them apart is the point of the step.

**Find.** Each agent examines the artefact through their own lens and reports **everything** it
surfaces. Not curated, not pre-ranked, not trimmed for seeming minor. Give each finding a category
from `dpm_list_taxonomy` in the `finding` domain and a severity from the `severity` domain,
and a summary that names the story, task or criterion it is about — a reviewer who cannot point at
what they are criticising is not being helpful.

Present each as:

```
{icon} **{displayName}** [{severity}]: {finding}
→ {story or criterion}: {what is wrong and why it matters}
```

**Rank.** Consolidate every agent's findings, weigh severity against how well each is evidenced,
and select down to the review's depth: three to eight for a story, five to fifteen for an epic.

**The cap belongs here and not in the finding stage.** A cap the finders can see is a cap they stop
short of, and what goes unfound cannot be curated back. Findings that do not make the cut stay in
the conversation and are not written.

Present the survivors grouped by category, severity-first within each.

### Step 4: Write the review

Two steps before any row exists:

1. **Render the review in the message body** — the surviving findings grouped by category,
   severity-first within each, and the panel that produced them.
2. **Then gate**, with the `question` tool: "Record this review?" with `Approve` /
   `Request changes` / `Stop`.

On approval:

1. `dpm_create_review` with the epic as `parent_id`, a short kebab-case `slug`, a `title`, and
   — for a story-scoped review — `scope: 'story'` with `scope_story_id`. That call assigns the
   number, which nothing here works out.
2. `dpm_create_document_agent` per panel member, with `document_kind: 'review'` and the
   `agent`.
3. `dpm_create_finding` per surviving finding, with the review, its `position`, its `summary`,
   the `agent` who raised it, and `category_id` and `severity_id`.

**The category and the severity come from different vocabularies and the tool knows which.** Each is
a domain-scoped reference, so a severity handed to `category_id` is refused rather than stored — the
mistake that makes a table of findings unsortable, caught at the point it is made. Read the terms
rather than remembering them: a project may have added or retired one.

`status` starts `open`. Leave it alone here; Step 5 moves it.

### Step 5: Remediation

Findings at the top severities are work, and work belongs on the epic.

Ask whether to raise them. On yes, `dpm_create_story` on the epic for the remediation, then
`dpm_create_task` per finding — the finding's own words as its `description`, so the task
carries what it is answering — then `dpm_update_finding` setting `remediation_task_id` to the
task that will address it.

**That link is the whole of the record, and it replaces both halves of what a file needed.** There
is no story number to work out from the highest one already there, and no table pairing findings to
tasks — the finding points at its task, so "what is being done about this?" and "why does this task
exist?" are the same edge read from either end. A finding nobody will act on keeps `status: 'open'`
and no task, which is a different state from one nobody looked at.

Where the user declines, or a finding is judged not worth acting on, `dpm_update_finding` moves
`status` to `rejected` with the reason said aloud. Lowest-severity findings are informational and
stay `open` unless the user says otherwise.

**Report each finding under the disposition those two columns already give it.** Read the terms from
`dpm_list_taxonomy` in the `disposition` domain and render them in `position` order.
A finding carrying a `remediation_task_id` has a task answering it, so the plan is different now and
the reader has only to read it; a `rejected` finding was seen and deliberately not acted on, and
carries the reason; and a finding left `open` with no task is waiting on the reader to decide, so it
names the decision. Derived from the rows rather than said alongside them — a review whose findings
are summarised in prose puts the one still needing a decision beside the eleven that do not.

### Step 6: Handoff

- `dpm-pivot` to amend the epic or its spec from what the review found
- `dpm-do` to carry on, with the findings as background
- `dpm-retro` where the epic is finished and the findings are lessons

## Output

There is no file to save. The review is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without — and a story-scoped review has no suffix to add, because its narrowing is a
column.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

For `review` the artifact is a findings explorer: worst-first and filterable across the categories,
so a long review is triaged in one pass. The rows have to pick one ordering; the explorer lets the
reader pick the other. If you cannot write the one-line justification for what the visual carries
that the prose cannot, it has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this review.

## Guidelines

- **Adversarial, not hostile.** Challenge assumptions and find real issues; do not manufacture
  criticism. Where something is well made, say so.
- **Specific over vague.** "The criteria are unclear" is useless. Name the criterion and say what
  two implementers would do differently.
- **Severity is a judgement, not a flourish.** A genuinely blocking finding is rare, and a review
  where everything is critical has ranked nothing.
- **Find comprehensively, then curate.** Step 3's two stages are not a formality.
- **Match depth to scope**, and treat the counts in Step 3 as what the ranking aims at rather than
  what the finding stage stops at.
- **Correct yourself sparingly**, per the shared convention.
