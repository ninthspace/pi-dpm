---
name: dpm-epics
description: Break a specification into epics, stories and tasks through facilitated conversation. Reads a spec's requirements and tagged criteria and records the breakdown — epics, their stories, each story's tasks and acceptance criteria, and the coverage rows binding each criterion to the requirement text it delivers — as typed rows. Run with /dpm-epics.
thinking: medium
phases: read epics stories tasks integration coverage confirm
---

# Work Breakdown into Epics

Turn a specification into **epics** — work areas holding **stories** (deliverables with acceptance
criteria) and **tasks** (the implementation steps under them).

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length** and
**Cross-References** from it.

## Input

Resolve the source in this order.

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   read that document. A reference goes through `dpm_resolve_reference` first,
   which returns the row it names or refuses; a ULID is already the id and needs no resolving.
2. If the request is a description, use it as the source.
3. Otherwise `dpm_list_spec` — offer the results with the `question` tool, showing each title.
4. If there are none, ask the user what work they want broken down.

**A spec is the expected source**, and the only one that makes Steps 3d and 4 possible: a
description has no requirements to bind criteria to, so the run produces stories and no coverage
graph. Say so when that is what happened, rather than presenting a thinner result as a complete one.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:epics'`.

**Which epic the production loop reached belongs in `state`**, because Steps 3 to 3d run once per
epic and a run resumed mid-loop has to know which ones are already written.

### Library

Follow the shared **Library Check** procedure with scope keyword `epics`. Carry what it returns into
Step 2, where coding standards and architecture affect where the boundaries between epics fall.

### Prior decisions

`dpm_list_adr` with the source spec as `parent_id`. Where decisions exist, summarise them and
use them in Step 2 — a decision that separates two concerns often separates two epics — and cite
the relevant one in a story's description where it constrains the approach.

### Retro awareness

Follow the shared **Retro Awareness** procedure. Where a lesson is incorporated, it routes by
category:

- **Scope surprises** inform Step 3 — a story that ran larger than expected suggests a sizing rule.
- **Patterns worth reusing** inform Step 3b — a surfaced abstraction becomes a candidate task.
- **Testing gaps** inform Step 3's tagging — a criterion that proved untestable is tagged as such
  this time, or rewritten until it is not.
- **Codebase discoveries** inform Step 3c — a surfaced integration point may need cross-story cover.

## Process

Steps 1 and 2 run once. Steps 3, 3b, 3c and 3d then run **per epic**, and each epic's rows are
complete before the next one starts. Step 4 closes the run across all of them.

Gate each step with the `question` tool, converging in one or two rounds. Where the user cannot decide
after one clarification round, present a recommended structure and record the decision as
provisional in the session `state`; it can be revised before execution begins.

**Every one of those gates is two steps, and the first one is the one that gets dropped.** Render
what is being decided in the message body; *then* call `question` with the decision alone. A gate
arriving with nothing above it asks the user to approve something they have not been shown.

### Step 1: Read the source

Read the spec and its parts: `dpm_read_spec`, `dpm_list_requirement` with `include_body`
and a `limit` above the spec's requirement count, and `dpm_list_document_section` with `include_body`
for the scope boundary and the integration boundaries. Summarise the work areas back to the user.

**The `limit` is the difference between a breakdown and a partial one.** Requirements left on a
second page are not visible as missing here — they are visible three steps later as coverage rows
that were never written, against requirements this run never saw.

**`include_body` is the difference between a breakdown and a guess**, and it fails one step further
on than the bound does. `text` on a requirement and `body` on a section are withheld unless asked
for, so without it every requirement arrives as a label with a class and a band and no statement of
what it requires. Step 3d then has to bind each coverage row to a **verbatim fragment of that
requirement's own text**, which there is no way to produce from a label. A fragment that is not a
substring of its requirement is not refused at the write — it is stored, and the integrity register
reports it afterwards as a broken invariant, at a distance from the step that caused it.

### Step 2: Identify epics

Analyse the source for major work areas. For each, agree a name, a one-sentence summary, and a
short kebab-case slug.

**Gate the grouping before any story is written**, in two steps:

1. **Render the proposed epics in the message body** — names, summaries, slugs.
2. **Then ask** with the `question` tool: `Approve` / `Request changes` / `Stop`.

This is the step where the shape of the whole breakdown is decided, and it is far cheaper to
reshape here than after three epics have their stories. Nothing below this gate runs until it is
approved.

On approval, each agreed epic is one `dpm_create_epic` call, with the spec as `parent_id`.
**That call assigns the epic's number, which nothing here works out.** Two or five epics for a small
feature, five to ten for a larger one; create one only where the work genuinely warrants it.

Then, for each epic, `dpm_create_coverage_matrix` with that epic as `parent_id`. It carries no
rows of its own — Step 3d writes those — and it exists so the matrix has somewhere to render.

Where one epic cannot start until another finishes, record it with `dpm_create_dependency`:
`kind: 'blocks'`, the epic that must finish first as `source_document_id`, the one that waits as
`target_document_id`. An edge that would close a cycle is refused when it is written, not later.

### Step 3: Break into stories

For each epic, break the work into **stories** — coherent units of value. A story answers "what are
we delivering?", not "what file are we editing?". Two to five tasks is typical; a title describing a
single function is a task, so push it down to Step 3b.

Agreeing them is two steps:

1. **Render the proposed stories in the message body**, each with its title and the value it
   delivers, so the breakdown is readable before any row exists.
2. **Then gate** with the `question` tool.

Each agreed story is then one `dpm_create_story` call under its epic, taking `number` (ordinal
within the epic, from 1), `title`, and `position`.

**A story that needs designing in full before any of it is built takes `plan: 1`.** It is a workflow
lock rather than a difficulty signal, and it is a value on the row — **the title says nothing about
it**, so nothing downstream has to read a title to find out. Set it for data-model changes, public
contract changes, and coordination across systems where the interaction design needs agreement
up front. Stories that follow an existing pattern do not take it. The user may ask for it on any
story; these are defaults, not restrictions.

Where a story cannot start until another finishes, record it with `dpm_create_dependency`:
`kind: 'blocks'`, the blocker as `source_story_id`, the waiting story as `target_story_id`. Both
ends may be stories in different epics.

#### Acceptance criteria

Each criterion is `dpm_create_story_criterion` under its story, with `text` and `position`.

**Use the spec's language verbatim where it states a threshold, a value or a behaviour.** "Concurrent
session limit of 3 per user" stays exactly that. The spec's specificity has to survive into the
story, because the story is what the work is measured against.

**Testable as written.** A criterion describes a specific, observable, verifiable outcome. "Users
can log in" names none; "a user with valid credentials receives a session token and reaches the
dashboard" does. A criterion resting on subjective judgement is rewritten before the story is
recorded — **refuse it and say which one**, naming what about it cannot be checked and offering the
checkable form.

**Reachable, not merely correct.** A criterion about what the system *returns* is a different claim
from one about what a person can *do*, and a requirement covered only by the first is satisfied by
an endpoint nothing is wired to. Where a requirement names an action a user takes — create, edit,
delete, share, export, revoke — at least one criterion names the affordance that reaches it,
alongside any criterion about the response. Both halves are needed and neither substitutes for the
other.

**A rejected behaviour is a criterion with `polarity: 'must_not'`** — a value on the row, not the
words "must NOT" at the front of the text. The document writes "must NOT — " in front of it, so the
text names the rejected outcome as though it happened: *a credential reaches a log line*, not *no
credential is logged*, which would read as a double negative.

**Carry every rejection the spec already states.** For each requirement this story delivers, read
`dpm_list_acceptance_criterion` with `include_body` and give every criterion whose `polarity` is
`must_not` a story criterion of its own with the same polarity and the same boundary — which is the
argument for `include_body`, there being nothing to transcribe from a row whose `text` was withheld.
These are boundaries someone already argued for;
propagating one is transcription, and dropping one is a decision nobody made.

**Copy the spec's text unchanged when it already names the rejected outcome.** An older spec may
state it as a denial instead — *tally does not print a stack trace* — and that text under the
"must NOT — " prefix reads as a double negative. Rewrite it as the outcome, keeping every detail
the spec gave:

- *tally does not print a stack trace* becomes *tally prints a stack trace*;
- a clause that only restates the denial is dropped rather than turned around with it. *An input
  error does not give exit code 2, and a usage error does not give exit code 1 — the two error
  classes are exclusive* becomes *an input error gives exit code 2, or a usage error gives exit
  code 1*. Turned around, the last clause would say the classes are not exclusive, which is the
  opposite of the spec.

Where the story goes beyond what the spec rejects and touches authentication, session or credential
handling, data mutation, or an external system, **propose** one or two further rejections for the
user to accept, modify or refuse. Proposed, never assumed.

**Gate the story's criteria before writing any of them**, in two steps:

1. **Render that story's criteria in the message body**, each with its polarity, and the proposed
   rejections alongside them.
2. **Then gate** with the `question` tool, carrying the proposed rejections into that same gate —
   accept, modify and refuse are the dispositions it offers, and a proposal with nowhere to be
   answered is one the run records on the user's behalf.

Step 3's own gate closes the step; this one is per story, because that is the unit the criteria
belong to and the unit whose rows exist once it passes.

#### Approach tags

Each criterion's approach is `dpm_create_story_criterion_approach`, naming the criterion and
the `tag`. A criterion verified two ways carries two of them. `dpm_list_test_approach` returns
the terms this project recognises, each with its meaning; use those and no invented ones.

**Propagate what the spec assigned.** For a criterion derived from a spec requirement, read that
requirement's criteria and their `dpm_list_criterion_approach` rows, and apply the same tags.
`tdd` is a workflow mode rather than a level, so it accompanies a level tag rather than replacing
one.

**Default to automation** for anything the spec did not tag: boundary-crossing is `integration`,
isolated logic is `unit`, a user-visible workflow is `feature`. Reach for `manual` only for visual
or editorial judgement, third-party interfaces you do not control, or behaviour genuinely infeasible
to exercise from code — and say in one line what blocks automation. If that line cannot be written,
the criterion belongs in an automated tag.

**`target` is not a weaker `manual`.** It is for a check that is mechanical and cannot run here
because the *environment* is missing — a production requirement, a host's language version, a
service the work must not depend on. A development entry is not one, however environmental it reads:
a runner, a driver, a test database and a CI job are claims about the machine this run is on, so
they are checkable here. `target` withholds a criterion from verification permanently, so applying
it to something this run can check leaves a story no amount of work completes.

1. **Render the stories and their tagged criteria in the message body**, then a per-story count of
   automated against manual tags so any drift toward manual is visible at a glance. Flag a story
   with no automated tag at all — that flag is a record, not a question.
2. **Then gate** with the `question` tool: `Approve` / `Request changes` / `Stop`.

### Step 3b: Tasks within stories

For each story, identify the **tasks** — the concrete steps that deliver it. Each is one
`dpm_create_task` call under its story, taking `number` (ordinal within the story), `title` in
imperative form, `position`, and a `description`.

**A description states scope, not method.** It anchors the task to the criteria it addresses or the
boundary it respects — "addresses the error path, not the happy path" — rather than prescribing how
to build it. Write one for every task in a story that has more than one; omit it only where a
single task's title is self-evident.

A single task is fine where the work is straightforward. Decomposition earns its place by making a
complex story manageable, not by adding ceremony to a simple one.

**Where any of the story's criteria carry an automated tag, add a testing task**: "Write tests for
{story title}", described as covering the criteria tagged `unit`, `integration` or `feature`. It is
the **last** task of the story — unless a criterion carries `tdd`, in which case it is the **first**,
which is what makes the red-green loop possible. Where every criterion is `manual`, there is nothing
to automate and no testing task.

1. **Render the tasks per story in the message body**, in the order they will be done.
2. **Then gate** with the `question` tool: `Approve` / `Request changes` / `Stop`.

### Step 3c: Integration testing story (when warranted)

After the epic's implementation stories exist, assess whether it warrants a story that verifies
**cross-story** behaviour — distinct from the per-story testing tasks, which verify one story's
criteria.

Warranted when the epic has several stories with `integration`-tagged criteria that meet, cross-story
data flows or contracts, or components that must work together as a system. Skipped when the epic
has one or two stories, no `integration` tags, or stories independent of each other.

When warranted: title it "Verify cross-story integration for {epic name}", number it after the last
implementation story, and record a `blocks` edge from **every** implementation story to it. Its
criteria name specific cross-story integration points — observable behaviour spanning more than one
story, never "everything works together". Confirm them with the user. Usually one task.

### Step 3d: Requirement coverage

Bind this epic's story criteria back to the requirements they deliver. **This is the traceability**;
there is no field on a story restating which requirements it satisfies, because a restatement is a
second, weaker copy of these rows.

For each requirement this epic delivers, and each story criterion delivering part of it, one
`dpm_create_coverage` call taking:

- `requirement_id` — one requirement, never a range and never a list. The binding is to a row.
- `spec_fragment` — **a verbatim fragment of that requirement's own text**, quoted from the
  requirement rather than paraphrased. It is part of the row's identity and half of what
  verification is later bound to.
- `story_criterion_id` — one criterion.
- `position` — display order, and no part of identity.

**Refuse to attach a criterion you cannot trace to spec text.** If no verbatim fragment of the
requirement supports the criterion, the binding is a guess: say which criterion and which requirement,
and either find the text or change the criterion. A fragment appearing nowhere in its requirement is
also refused by the integrity check, so a guess made here surfaces later as a broken database rather
than as a decision.

**Quote the clause that carries the obligation.** A requirement often opens with wording that
positions it — *"Building on the work above,"*, *"As with the other stores,"* — and states what it
actually requires somewhere after that. Both halves are verbatim text and both satisfy the rule
above, so *"a verbatim fragment"* does not choose between them and the choice is yours to make.

Make it the obligation, because the two halves do not survive an amendment equally. Connective
phrasing is scaffolding around the requirement rather than the requirement, and it is the first
thing a later pivot rewrites — so a fragment quoting it is a binding that goes stale on an
amendment that changed nothing the story delivers, and somebody then has to decide about a
withdrawal that the work never earned. The obligation is also the half the criterion is measured
against, which is what a reader comparing the two texts side by side is trying to see.

**This is a steer between traceable fragments and not a loosening of the refusal above.** A
fragment that appears nowhere in the requirement is refused exactly as before; connective wording
is worse than the obligation and is still better than a paraphrase, which is not a fragment at all.

Where one requirement is delivered by several criteria, write a row per criterion — each is
independently verifiable. Where a criterion is also delivered by a story other than the one that
declares it, add `dpm_create_coverage_story` naming that story.

The bindings go to the user to judge, in two steps:

1. **Render them in the message body**: the requirement text and the criterion text side by side,
   both verbatim, with the tags. The judgement of fidelity is theirs; extraction and presentation
   are yours, and a binding summarised rather than quoted is one they cannot judge.
2. **Then gate**. Where they find a criterion weaker than the requirement, fix it with
   `dpm_update_story_criterion` before moving on.

**Nothing here writes a table, and nothing here records a verification.** The matrix is a projection
of these rows. Verification is `coverage.verified_at`, written during execution, and it is cleared
automatically whenever the fragment or the criterion it was bound to changes — so a row's mark
cannot outlive the text that earned it.

### Step 4: Confirm

**The gap check is a query over the spec, not a sum of what was just written.** For each requirement
from `dpm_list_requirement` with `include_body`, call `dpm_list_coverage` on it. A
requirement with no coverage row is a gap when it is either:

- **must have** — the system fails without it; or
- **environmental** — its `class` is `environmental_requirement` or `environmental_restriction`,
  whatever its band. Leaving one uncovered does not change the host it describes; it only stops
  anyone noticing until the work is built and will not run.

A third class is a gap *despite* being covered, so finding it means reading the criteria rather than
counting rows: a **must have** naming an action a user takes whose every covering criterion
describes a system response, with none naming the affordance that reaches it. The requirement is
bound, the stories are honest, and nobody owns the way in. It blocks on the same terms as an
uncovered one — this is the only gate that asks whether the delivered system can be used, because
everything downstream verifies criteria as written.

**Both texts have to be in hand for that, and both are withheld by default.** Whether a requirement
names an action a user takes is in its `text`, not in its `class` or its band; whether a criterion
names the affordance or only the response is in the criterion's. So the requirement read above
carries `include_body`, and each covering criterion is reached with
`dpm_read_story_criterion` and `include_body` through the `story_criterion_id` its coverage row
names. Run over labels and counts, the gate returns a verdict computed against text it never saw —
and it returns it in the same shape as a real one.

**The criterion side of the same check is `accounted_for`, returned by
`dpm_list_story_criterion` with `include_body` and not worked out here.** A criterion is
accounted for when it has a live binding **or** a warrant — `warrant_adr_id`, the accepted decision
that constrains the story where no requirement does. A criterion with neither is unbound and belongs
in the report, named by its `text` since it has no title; one with a warrant is finished work and
does not, and a run that counted coverage rows instead would call it a gap on every breakdown that
recorded one.

Resolve each gap before finishing: add it to an existing epic, raise a story for it, or defer it
with a stated reason. Should-have requirements with no cover are warnings rather than blockers.

Then, in two steps:

1. **Render the whole tree in the message body** — epics, their stories, their tasks, the
   dependencies between them, a suggested order, and the gap-check result.
2. **Then gate** it with the `question` tool. Approval ends the run.

**Read the tree back rather than repeating what was sent.** `dpm_list_story` per epic,
`dpm_list_task` and `dpm_list_story_criterion` per story, both with `include_body`. A
value that never reached a row is absent from the rows and present in the summary, and an absence
read from a summary reads as something that was not needed — and a task's `description` and a
criterion's `text` are the values most worth reading back, being the ones a read that did not ask
for them returns as absent whether they were written or not.

## Autonomous mode

When no human is present — the run was invoked by a wrapper — the gates do not block. **Rendering
stays mandatory**: each proposal is still written into the message body, and the fact that nobody
reads it as it is produced is exactly why it has to be there to read afterwards.

Five gates present a proposal this skill has just made, and their disposition is **approve it and
proceed**: the epic grouping, the stories, the tasks, the integration story's criteria, and the
final tree. A second pass over a proposal in the same run adds no information the first pass did not
have.

**The sixth takes the opposite disposition.** Proposing a rejection the spec does not state, and
then accepting it, marks its own work — and a rejection invented in the moment can be unsatisfiable
as written, leaving a story nobody can close. So: **propagate, never invent**. Every `must_not`
criterion the spec carries still propagates, because that is transcription. A rejection whose
subject the spec never raises is not attached, however reasonable it looks; record it instead as a
`dpm_create_document_section` on the epic, naming the clause and the story it would have gone
on. Recorded is not attached — it constrains nothing until someone accepts it.

Record each disposition the same way: one section on the epic naming the gate and what was chosen,
so a run nobody watched is reviewable from what it wrote down.

**The source spec is read and never written.** It is the only artefact a human authored and the only
fixed point the run is measured against, so a run able to edit it can move its own goalposts. A gap
or contradiction found in it mid-run is recorded on the epic and left for a human.

## Output

There is no file to save. The breakdown is the rows; the epic and its coverage matrix are
projections of them, and a pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without, and it is wrong the moment the projection moves where a kind renders.

Write the prose an epic carries — its context, the reasoning behind the grouping, anything the run
recorded rather than attached — with `dpm_create_document_section`, each with its heading and
position. Everything else is already a row.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

### After the breakdown

- `dpm-do` to execute the epics (recommended)
- `dpm-review` where an epic is large enough to warrant an adversarial read before work starts

## Guidelines

- **Epics are work areas, stories are deliverables, tasks are steps.** An epic with one story is
  probably not an epic.
- **Acceptance criteria live on stories.** A task inherits its meaning from the story above it. The
  story is done when its criteria pass, not when every task is ticked.
- **Dependencies are between stories or epics, never between tasks.** Where tasks in two stories are
  interdependent, the stories carry the edge.
- **Facilitate the grouping.** The user knows the domain. Propose a structure and let them reshape it.
- **Every value is an argument, never a formatted string.** A polarity, an approach tag, a planning
  mark and a status are each a column. The moment one becomes a marker inside some text, whatever
  reads it next has to parse it back out — and a parse that can misread is a parse that will.
- **Refuse rather than record something nobody can check**, and refuse rather than bind a criterion
  to a requirement whose text does not support it.
- **Correct yourself sparingly**, per the shared convention.
