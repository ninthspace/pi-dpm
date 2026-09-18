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
epic and a run resumed mid-loop has to know where to look.

**So does anything settled for a later epic, as it is settled.** A binding a render leaves to another
epic — *FR3's exit-code half binds in the CLI epic* — goes into `state` naming the requirement, the
clause and the epic, and that epic's Step 3d binds it. Left in the conversation, it is gone at the
next handoff, and Step 4 does not find it: the requirement already has a binding, so it is not
reported uncovered.

**On a resume, the rows say what is written** — the Session Startup rule. The loop is where it
bites: a flag saying an epic's stories are not written may sit over stories that are. Before
proposing anything for an epic, read what it already has, in this order, and resume at the first
step whose rows are missing:

1. `dpm_list_story` with the epic's id — Step 3's stories;
2. `dpm_list_story_criterion` with `story_id` for **each** of those stories — Step 3's criteria;
3. `dpm_list_story_criterion_approach` with `story_criterion_id` for each criterion — Step 3's tags;
4. `dpm_list_task` with `story_id` for each story — Step 3b;
5. `dpm_list_coverage` with `story_criterion_id` for each criterion — Step 3d.

A step whose rows exist for some stories and not others resumes at the first story without them.
Never propose a row the list has just returned.

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

**Each epic ends with a handoff**, following the shared **Handoff** procedure. Once an epic's
bindings are read back, record it as done in `state` with the epic that comes next, and hand off.
Hand off once more after the last epic, so Step 4 starts in a fresh context as well. One context then
holds one epic, however many epics the spec needs.

**A continued run starts at the epic its `state` names.** It reads Step 1's source again, with the
same bound and the same bodies, because the fragments it binds are quoted from requirement text this
context has not seen, and it lists the spec's epics. It does not gate Steps 1 and 2 again, and it
does not present the library, the decisions or the retro lessons the earlier run already weighed.
**Nor does it move the phase back to `read`:** reading the source again is not Step 1 running again,
and the phase stays the one the handoff recorded. The resume order under **Session** then finds where
that epic's rows stop.

Gate each step with the `question` tool, converging in one or two rounds. Where the user cannot decide
after one clarification round, present a recommended structure and record the decision as
provisional in the session `state`; it can be revised before execution begins.

**Every one of those gates is two steps, and the first one is the one that gets dropped.** Render
what is being decided in the message body; *then* call `question` with the decision alone. A gate
arriving with nothing above it asks the user to approve something they have not been shown.
The loop makes that easy to drop: tags, then tasks, then coverage, each gate straight after the
last. Each one renders its own draft in its own message — a draft worked out in reasoning after the
previous answer has not been shown.

**Nothing a gate decides is written before it is answered** — a row found missing at the end as
much as one planned at the start. Writing first and gating after asks the user to approve what is
already recorded.

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
substring of its requirement is refused at the write, so a guess costs a refused call and a second
read.

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
An edge found the wrong way round is removed with `dpm_delete_dependency`, and the right one written
after it.

### Step 3: Break into stories

For each epic, break the work into **stories** — coherent units of value. A story answers "what are
we delivering?", not "what file are we editing?". Two to five tasks is typical; a title describing a
single function is a task, so push it down to Step 3b.

Agreeing them is two steps:

1. **Render the proposed stories in the message body**, each with its title and the value it
   delivers, so the breakdown is readable before any row exists. Write any order between them as
   *"X must finish before Y"* — never as an arrow or as "X blocks Y", which read either way round.
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
ends may be stories in different epics. For *"X must finish before Y"*, X is the source.

**Read the edges back before the criteria.** `dpm_list_dependency` with each waiting story's
`target_story_id`, and check every edge's `source_story_id` is a story approved to finish first. An
edge the wrong way round is removed with `dpm_delete_dependency`, then written the right way; it is
never accepted as recorded, since readiness would start the waiting story first.

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
`dpm_list_acceptance_criterion` with its `requirement_id` and `include_body` — it takes no `spec_id` —
and give every criterion whose `polarity` is
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
the `tag`. A criterion verified two ways carries two of them.

**Tag a criterion only once its create call has returned**, with the `id` that result carries. A
criterion and its tags sent in the same message name an id that does not exist yet, and every such
tag is refused. `dpm_list_test_approach` returns
the terms this project recognises, each with its meaning; use those and no invented ones.

**Propagate what the spec assigned.** For a criterion derived from a spec requirement, read that
requirement's criteria and their `dpm_list_criterion_approach` rows (with `criterion_id`), and apply
the same tags.

**Read the story's tags back with `dpm_list_story_criterion_approach` and `story_criterion_id`.**
`dpm_list_criterion_approach` holds the spec's tags and refuses a story criterion's id, so it cannot
show what this step wrote.
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

**Read each story's tasks back before the next story.** After writing its approved tasks,
`dpm_list_task` with its `story_id`, and compare the titles with the ones approved. A title approved
and not listed was never written — write it before moving on. A run of writes can lose one without
an error, and nothing later counts tasks against what was approved.

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
refused by `dpm_create_coverage`.

**Read the refusal before retrying.** When another requirement's text holds the fragment, the
refusal names it, and that is a binding sent to the wrong requirement's id: bind it to the one named.
Never trim the fragment until the first requirement accepts it — that keeps the wrong id and quotes
a clause it does not own.

**A binding already written to the wrong criterion or requirement is withdrawn, not left beside its
correction.** `dpm_retire_coverage` with its id and a reason naming what was wrong, then the right
row. A wrong row left live goes on counting toward its requirement.

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

**Quote the clause the criterion tests, not the nearest verbatim one.** Decide which words of the
requirement the criterion checks before writing the binding; the fragment is those words. A
requirement's opening words are the wrong fragment whenever the criterion tests something said later
in it: a criterion rejecting zero-value lines bound to *"tally prints a per-month summary"* quotes
real text that says nothing the criterion checks, and a reader comparing the two sides cannot see
why they are paired.

**A `must_not` criterion's fragment is the clause whose outcome it rejects** — the words that would
be broken if the rejected outcome happened. A criterion rejecting a panic's exit code quotes the
exit codes the requirement contracts; one rejecting zero-value lines quotes what the summary prints
for each month. Where the criterion carries one of the spec's acceptance criteria whose words are
not in the requirement, quote the narrowest clause that spec criterion elaborates, and name the spec
criterion beside the binding in the render.

**Every criterion on the story is bound or warranted, rejections included.** A `must_not` criterion
is accounted for by a binding of its own. Its positive twin being bound does not account for it,
and neither does its having been transcribed from the spec.

Where one requirement is delivered by several criteria, write a row per criterion — each is
independently verifiable. Where a criterion is also delivered by another story **of the same epic**,
add `dpm_create_coverage_story` naming that story. A story in another epic is refused: work it
delivers is a criterion of that story, bound on its own. A row naming the wrong story is removed with
`dpm_delete_coverage_story`, which leaves the binding standing.

The bindings go to the user to judge, in two steps:

1. **Render them in the message body**: the requirement text and the criterion text side by side,
   both verbatim, with the tags, and the fragment shown as the part of the requirement it quotes. The judgement of fidelity is theirs; extraction and presentation
   are yours, and a binding summarised rather than quoted is one they cannot judge.
2. **Then gate**. Where they find a criterion weaker than the requirement, fix it with
   `dpm_update_story_criterion` before moving on.

**Once they approve, write the bindings, then read them back before the next epic or Step 4.** For
each criterion of this epic, `dpm_list_coverage` with `story_criterion_id` and `include_body` —
**every one of those calls in a single message**, not a message per criterion or two: each message
is another turn over the whole context, and the seventh MTPLX epics run spent over twenty minutes
reading one epic's sixteen bindings back that way. Then compare what they return with what was
approved: every approved binding present, to the requirement
and fragment approved, and nothing else live. Check each row's requirement by its
`requirement_label`, which every coverage row carries, rather than by ids remembered from earlier calls: a
row's fragment is already known to be in the requirement it names, so a label that matches the approval
is a binding to leave alone. A binding missing is written now; one wrong is withdrawn with
`dpm_retire_coverage` and written again. A step that moves on from the write alone is reporting
the calls it sent, and Step 4 then finds the gaps they left as though the breakdown had them.

**Nothing here writes a table, and nothing here records a verification.** The matrix is a projection
of these rows. Verification is `coverage.verified_at`, written during execution, and it is cleared
automatically whenever the fragment or the criterion it was bound to changes — so a row's mark
cannot outlive the text that earned it.

### Step 4: Confirm

**The gap check is `dpm_check_coverage` with the spec's id — one read over the spec, made in this
step, not a sum of what was just written.** What Step 3 read came before this run wrote anything, and
a check answered from memory of it has the shape of a check without being one. The report returns:

- `requirements` — every requirement of the spec with its live `coverage` count and its `standing`.
  `gap` is a requirement nothing live is bound to that is either **must have** — the system fails
  without it — or **environmental**, whatever its band: leaving one uncovered does not change the
  host it describes; it only stops anyone noticing until the work is built and will not run.
  `warning` is a should- or could-have with nothing bound, and `excluded` is deferred, out of scope
  or won't-have.
- `unaccounted_criteria` — every live story criterion whose `accounted_for` is false: neither a live
  binding nor a warrant (`warrant_adr_id`, the accepted decision that constrains the story where no
  requirement does). It is the same field `dpm_list_story_criterion` returns.
  **There is no third way to be accounted for.** An unbound `must_not` criterion is a gap like any
  other — not finished work because its positive twin is bound, and not because the spec stated it.
- `untagged_criteria` — every live story criterion with no approach tag. Step 3 tags every
  criterion, so one without a tag is a tags gate approved and never written.
- `uncriteriated` — every in-scope requirement with no acceptance criterion at all. Not this
  skill's to fix — a criterion is the spec's — but this is where it is seen: a spec run wrote
  criteria for its first three requirements, moved to the next section, and left eleven of
  twenty-two with none, four of them live should-haves that were then built and claimed. Report
  them so the spec can be amended before a breakdown is built on requirements nothing tests.
- `duplicated_criteria` — one criterion's text declared by two stories. Within a story the server
  refuses the second copy; across stories it may be right, because two stories can genuinely share
  one criterion — but each gets its own bindable id, so a roll-up counts one obligation twice.
  Where it is a copy, drop one and bind the survivor; where both stories really deliver it, one
  criterion with a `coverage_story` row is the shape that says so.
- `claimable` — every requirement whose live bindings are all verified and which carries no
  completeness claim. Ordinary mid-run and not a gap; it is `dpm-do` that claims, at the end of the
  epic that finished the work.
- `gaps` and `warnings` — all of the above as sentences, and `ok`, true only when `gaps` is empty.
  **The three lists above reach `warnings` and never `gaps`**: each names work that is owed rather
  than a breakdown that is wrong, and a run passes through `claimable` every time it verifies a
  binding before claiming it.
- `must_have_criteria` — for each must-have in scope, its text, its spec criteria, and the story
  criteria covering it with the fragment each binding quotes.
- `counts` — epics, stories, live story criteria, `must_not` criteria, warrants, tags, untagged criteria, tasks, live
  coverage rows, coverage_story rows and dependency edges.

**Report every entry of `gaps` and `warnings`.** None is dropped because an earlier step believed the
requirement covered; the report is the later reading.

**Two gaps are judgements the report cannot make, and both are made from `must_have_criteria`.**

- **A requirement is covered only as far as its spec criteria are.** A row says one clause of it is
  delivered, not every clause: a requirement asking for a single pass *and* a time limit is bound by
  a row on the single pass while the time limit reaches no story. Find each spec criterion's
  counterpart among `covering_criteria`; a spec criterion none of them carries is a gap on the same
  terms as an uncovered requirement.
- **A must-have naming an action a user takes is a gap despite being covered** when every covering
  criterion describes a system response and none names the affordance that reaches it. The
  requirement is bound, the stories are honest, and nobody owns the way in. It blocks on the same
  terms — this is the only gate that asks whether the delivered system can be used, because
  everything downstream verifies criteria as written.

So the gap-check result lists, for each must-have, each of its spec criteria beside the covering
criterion found for it or marked as a gap, in the texts the report returned.

**Then `dpm_check_integrity`.** The gap check reads what the rows say; this reads whether they hold.
Report each violation not marked `advisory` with the rows it names, and treat it as a gap.

Resolve each gap before finishing: add it to an existing epic, raise a story for it, or defer it
with a stated reason. Should-have requirements with no cover are warnings rather than blockers. A
gap closed with new criteria or coverage rows goes through the step it belongs to — render, gate,
then write — before the final tree is gated. A coverage_story row the integrity check reports across
epics is removed with `dpm_delete_coverage_story`.

**The final tree is rendered from a read made after the last write.** Once every gap is closed and
its rows are written, call `dpm_check_coverage` again and read the tree back with the calls below,
and only then render it. A tree
rendered before its gaps are written, or from what earlier messages said, shows a breakdown that is
not the one recorded.

Then, in two steps:

1. **Render the whole tree in the message body** from those reads — epics, their stories, their
   tasks, the dependencies between them, a suggested order, the gap-check result, and the counts.
2. **Then gate** it with the `question` tool, **as the only question in that call**. A final-tree
   question asked beside another decision is approved before that decision's rows exist. Approval
   ends the run.

**Read the tree back rather than repeating what was sent.** `dpm_list_epic` with the spec as
`parent_id`, then `dpm_list_story` per epic — neither withholds a column, so neither takes
`include_body` — then `dpm_list_task` and `dpm_list_story_criterion` per story, both with
`include_body`. A
value that never reached a row is absent from the rows and present in the summary, and an absence
read from a summary reads as something that was not needed — and a task's `description` and a
criterion's `text` are the values most worth reading back, being the ones a read that did not ask
for them returns as absent whether they were written or not.

**Every count in the tree and the closing summary is the last `dpm_check_coverage` report's
`counts`**, and requirements are the ones its `requirements` lists, with each `excluded` one named as
outside scope. A number carried from a draft, an earlier message or a tally of the calls sent is the
one that has drifted.

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
