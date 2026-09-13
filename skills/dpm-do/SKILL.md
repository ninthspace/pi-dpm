---
name: dpm-do
description: Execute the stories and tasks of an epic, one at a time — load context, do the work, verify each acceptance criterion, record the verification, and move on. Reads readiness from the dependency graph and writes status, observations and verification as typed rows. Run with /dpm-do.
phases: select:low load:off start:off plan:high work:medium verify:medium refactor:medium done:off next:off summary:off
---

# Task Execution

Work an epic's stories to completion, one task at a time.

Everything this skill records is a typed tool call. It composes no markdown, names no files, and
never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Cross-References** and
**Implementation Guidelines** from it.

## Input

1. If the request names an epic — a ULID, or a human reference as another skill printed it — work
   that epic. A reference goes through `dpm_resolve_reference` first, which returns
   the row it names or refuses; a ULID is already the id and needs no resolving.
2. Otherwise `dpm_list_epic` with `ready: true`. That is the epics still `pending` with no
   blocker short of `complete` — a query over the edges, not a status anyone maintains. One result
   is auto-selected; several go to the `question` tool showing each title.
3. An empty result means every epic is complete, retired, or waiting on something — **three
   answers, and saying the wrong one is how a project loses track of what it decided to stop**. Say
   which, from `dpm_list_epic` unfiltered and `dpm_list_dependency` on the ones still
   `pending`, and stop. Report a `superseded` or `withdrawn` epic as retired, with its
   `status_note` where it carries one: it is neither work outstanding nor work delivered.

The epic, once resolved, holds for the whole loop.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:do'`, putting the task about to
start in `phase` and moving it on after every completed task.

`state` holds the test command, the framework, and the per-story record of what the refactoring pass
did. **It does not hold task or story status**, which are columns, or which stories are planned,
which is a column.

### Retro consumption gate

Select as the shared **Retro Awareness** procedure says, across all retros rather than the newest —
then replace its step 4 with the gate below, which is this skill's own and is stronger.

**Gate on disposition, not acknowledgement.** Render each selected observation verbatim with its
category and its source retro, then require a disposition for **each one** — `Applied` (say how it
changes this run), `Deferred` (say why not now), `Not relevant here` (say why it does not bear on
this work). One blanket acknowledgement does not satisfy this gate, and that is the whole of its
value: a lesson nobody had to place is a lesson nobody read.

Record each disposition as `dpm_create_retro_application` — `retro_id`, this epic as
`applied_to_id`, the observation's `theme`, and `disposition` as one of `applied`, `deferred` or
`not_applicable`, with the reason as `note`. The row is per-run and changes nothing at the source,
so a lesson set aside here is re-judged next time.

Carry every `applied` disposition into the loop as a lens on each task, not a one-off:

- **Complexity underestimates** and **codebase discoveries** inform Step 1's exploration.
- **Testing gaps** inform Step 5, early enough that a criterion can be raised before it is built
  against rather than after.
- **Patterns worth reusing** inform Step 4.

If there are no retros, skip the gate silently.

### Library

Follow the shared **Library Check** procedure with scope keyword `do`. Deep-read selectively during
the loop — coding standards before writing code, architecture before a structural decision.

### Test runner

Discover how this project runs its tests, in this order: a library document scoped to `do` that says
so; then `composer.json`, `package.json`, a `Makefile` target, `pyproject.toml`, `Cargo.toml`; then
ask. Put the answer in the session `state`, or `none` if the user declines.

Skip this entirely when no criterion in the epic carries a `level` approach that a machine can run —
which is a read of `dpm_list_test_approach` and the criteria's own tags, not a guess.

### Framework

Laravel when there is an `artisan` file and `composer.json` requires `laravel/framework`. Record it
in the session `state`. Nothing else is detected here yet.

## Story selection

`dpm_list_story` with this `epic_id` and `ready: true`. That is the stories still `pending`
with no blocker short of `complete` over an edge whose kind gates work — **the same query that
answers the same question for epics**, and the reason blocking is an edge rather than a status.
Take the lowest `number`.

**The two halves read `status` differently, and both lean the safe way.** A story is workable only
while `pending`, so a `superseded` or `withdrawn` one is never offered — it is not work this run
left undone. A *blocker* clears only on `complete`, so a story retired halfway goes on gating what
was waiting on it exactly as a pending one does: being stopped is not having delivered. Neither is
applied here — both are in the query — but a run that reports the absence has to say which.

When a story you expected is missing from that list, `dpm_list_dependency` with it as
`target_story_id` names the edges into it; each blocker's own row says whether it is done. That is
the answer to *why not*, which a boolean cannot give.

**Which of those edges actually hold work up is `dpm_list_dependency_kind`'s `gates_work`,
never a kind name written here.** A project can add an edge kind and decide for itself whether it
gates; a rule naming `blocks` would be that decision taken away, one indirection down, and it would
disagree with the readiness answer above without either side noticing.

Then, for the selected story:

- `dpm_read_story` — its `plan` column decides whether Step 3 opens formal plan mode.
- `dpm_list_task` with this `story_id` — the work, in `number` order. The next one to do is
  the lowest-numbered whose `status` is still pending; tasks carry no edges of their own, so order
  is the whole of their sequencing.
- `dpm_list_story_criterion` with `include_body: true`, and
  `dpm_list_story_criterion_approach` per criterion — what the story is measured against.

**Nothing here derives the story's shape from its title.** Whether it is planned in full is a
column; whether it is blocked is an edge; whether it is done is a column. A marker inside a title
would have to be parsed back out, and a parse that can misread will.

Mirror the tasks into the harness task list so the user can see the run's shape, plus one
verification task blocked by them. That list is a view of the rows and never the record: task status
is `task.status`, and the mirror is rebuilt from `dpm_list_task` rather than reconciled
against itself.

When no ready story remains, go to Step 8 — **and no ready story is not the same as a finished
epic**. Read the epic's stories unfiltered: complete throughout is done, and anything `superseded`
or `withdrawn` is reported as retired beside the rest rather than counted into either column. A
story still `pending` and held by a blocker is neither, and `dpm_list_dependency` on it says
by what.

## Per-task workflow

For each task, in order. **Termination**: an unresolvable external blocker or a criterion that
cannot be evaluated goes to the `question` tool, then the task is skipped and the loop continues.

### 1. Load context

`dpm_read_task` with `include_body` for the task, and the story's criteria already read above. A
task's `description` says what it contributes and is withheld unless asked for; the criteria it
serves belong to the story, not to it.

Explore the code the task touches before planning it, carrying the applied retro lessons as the lens.

### 2. Start

**Being in flight is the session's `phase`, not a status.** `dpm_update_session` names the
task about to start; the row itself moves from pending to complete in one step at Step 6, because
there is no value between them. One place says what is happening now, and it is the place a resumed
run reads.

**The other two values this run does not set.** `superseded` says the work was replaced and
`withdrawn` says it was dropped — both terminal, and both a decision rather than an outcome of
doing the work. Set either only where the user asks for it. A task that could not be finished stays
short of complete with an observation saying why; closing it as retired would report a judgement
nobody made, in the one column a later run trusts without reading around it.

Where a status needs qualifying — folded into another story, partly superseded — that is
`status_note` on the same call that sets the status. **There is no token to parse and no tail to
preserve**: the status is the status and the note is the note, and they are two columns.

### 3. Plan

If the story's `plan` is `1`, enter formal plan mode, present the plan, and get approval before any
implementation. That approval covers the story's remaining tasks — record it in the session `state`
so plan mode does not re-fire per task.

If `plan` is `0`, plan inline: a short text plan, then straight on.

### 4. Do the work

Implement what the task and the story's criteria call for. Minimal change, scoped to the task; solve
the requirement generally rather than special-casing what a test happens to check.

**When a criterion carries the `tdd` approach**, run red-green-refactor: write a failing test and
confirm it fails against a targeted run of that file alone; write the minimum that passes it; clean
up within the task's scope. A test that passes before the implementation exists is a stop — say so
and ask, because either the test is not testing what it claims or the behaviour is already there.

`tdd` is a `mode` and the levels are a separate axis — read that from
`dpm_list_test_approach`'s `kind` column rather than from a list of tag names here. A project
that adds an approach decides for itself which axis it is on.

### 5. Verify

For each of the story's criteria, assess it by the approach its tags name:

- **A `level` a machine can run** — run the cached test command. Passing is the evidence; failing
  means the criterion is not met, and the specific failures are what gets reported.
- **`manual`** — self-assess against the code, the files, the output.
- **`target`** — do not self-assess and do not count it met. The check is mechanical but only means
  anything against the real deployment target, so a verdict from this machine is worth nothing.
  Record it as unverified in this environment, name it, and let the other criteria decide. It does
  not block completion.
- **A tag with no routing here** — name it and assess nothing. Falling back to self-assessment would
  read afterwards as a deliberate verification choice while being the opposite of one.

A criterion whose `polarity` is `must_not` is met when the rejected thing is **absent**, and absence
needs a control: something that would have caught it had it been present. A must-NOT with no control
has not been verified, it has been asserted.

Unmet criteria go to the `question` tool — keep working, or complete anyway. **Render them in the
message body first**: each unmet criterion in full, with what the assessment actually found. A
choice between carrying on and accepting a shortfall is one nobody can make from a count.

**Recording the verification.** When a story's criteria are met, for each criterion call
`dpm_list_coverage` with its `story_criterion_id` and, for each row, `dpm_update_coverage`
with `verified_at`.

That call is the whole of it. **Nothing here writes a table, clears a mark, or computes a hash**:
the matrix is a projection of these rows, the hash that records *what* was verified is the server's,
and editing either bound text clears the mark by trigger. A skill re-implementing any of the three
would be a second answer to a question the database already answers.

### 5b. Story refactoring pass

Once per completed story, at its verification gate, and not gated on the verification result — a
story whose criteria were unmet-but-continued still earns its pass.

Skip it, recording the reason in the session `state`, when the story did not complete, when no
implementation task touched code, or when there is no test command — the retest is the only thing
that catches a refactor that changed behaviour, and refactoring untested code blind is worse than
not refactoring.

Scope starts at the files this story's tasks touched and looks outward for consolidation: duplication
to merge, a pattern in both new and existing code to extract. Every change connects back to what the
story produced. On Laravel, delegate to `laravel-simplifier`; otherwise review it yourself. Retest
after, and revert whatever broke.

### 6. Complete

**Status.** `dpm_update_task` with `status: 'complete'`. At a verification gate,
`dpm_update_story` the same way.

**Observation.** Every completed story produces one, and it is the only input `dpm-retro` has to
work with. `dpm_create_observation` with this `story_id` and the text, then
`dpm_create_observation_category` with the category's `taxonomy_id` from
`dpm_list_taxonomy`. Use the vocabulary the project holds rather than a list of names here;
a smooth delivery is worth recording as much as a surprise. On an implementation task an observation
is optional — the story's gate will cover it.

**Session.** `dpm_update_session` immediately after, carrying `phase` and the accumulated
`state`.

Then go straight to Step 7. Finishing a task, a story, or a commit is **not** a checkpoint.

### 7. Next task

Silent. The next pending task under this story, or — when there is none — the next ready story from
**Story selection**, or Step 8. No announcement, no summary, no asking whether to carry on.

### 8. Epic summary

**Close the epic.** Read its stories unfiltered. Complete throughout is a finished epic, and
`dpm_update_epic` with `status: 'complete'` is what says so — the same one-step
move Step 6 makes on a story, at the level above it.

**Nothing else in dpm sets that column**, so an epic left `pending` is not merely untidy. It goes on
being offered by `dpm_list_epic` with `ready: true` as work still to do, it goes on holding whatever
edges into it gate on `complete`, and it never reaches `dpm-retro`'s triage, which classifies the
epics whose `status` is `complete` and can only ever see an empty set without this.

Two cases are not a count and are not this run's to decide. Where any story is `superseded` or
`withdrawn`, whether the retired work was part of what the epic promised is a judgement the rows do
not answer — **render the retired story and what it promised in the message body**, then put it to
the `question` tool and leave the status until it is answered. Where any story is
still `pending`, the epic is unfinished: `dpm_list_dependency` on that story says
what holds it, and that is the report rather than a status.

**Roll up the coverage.** `dpm_list_requirement` on the epic's source spec, and
`dpm_list_coverage` on each, both with `include_body` — the judgement below weighs bound
`spec_fragment`s against the requirement's own `text`, and both are withheld by default. A
requirement whose rows are all verified is discharged as far as the rows go; where the run judges
the bound fragments account for the requirement whole, say so with
`dpm_update_requirement` and `coverage_claimed_at`. **That is a claim and not a computation**,
which is why a human makes it: connective prose carries no obligation, and two obligations in one
sentence can be discharged by a fragment covering either. Leave it unclaimed rather than guess.

**A criterion is accounted for by `accounted_for`, which `dpm_list_story_criterion` returns
with `include_body` and nothing here works out.** It is true where the criterion has a live binding
**or** carries a warrant — an accepted decision constrains a story exactly as a requirement does,
and a criterion warranted by one has nothing to quote and so no coverage row to find. Report the
criteria where it is false, naming each by its `text`, which is why the body is asked for: a
criterion has no title, so a report that listed ids would name nothing anyone can act on. A run
deriving the judgement itself from the coverage rows would report every warranted criterion as a
gap.

**Say what the count is.** Every verification in it was recorded by this skill on its own work, so
the summary reports what this run claimed, added up. "Nine of nine rows marked verified by this run"
is what happened; "nine of nine requirements verified" reads as something someone else confirmed.

**And say which nine.** The denominator is the bindings still standing — what
`dpm_list_coverage` returns, which is the live rows and not every row ever
written. A binding somebody withdrew is
readable and is not counted, so "nine of nine" is a claim about the nine that remain rather than
about every binding this spec has ever held. Write the sentence so it says so: *"nine of the nine
bindings that remain"* rather than *"all nine bindings"*, because a requirement whose broken rows
were retired last week is discharged on a smaller set than the one a reader remembers, and the
short sentence quietly claims the larger one. **Do not pass `include_retired` to make the number
larger** — that argument is for auditing a withdrawal, and a roll-up that used it would count
bindings nobody stands behind toward a requirement being discharged.

**Retro.** Gather the epic's story observations with `dpm_list_observation` and `include_body`,
without which the rows carry their categories and not what was observed. Synthesis is
mandatory when any signal fired during the loop — a gate resolved unmet-but-continued, a `tdd` cycle
that needed more than one red, a test command that returned failures, a story left unfinished, or a
change moment resolved by amending a row. With no signal, skipping is permitted and the skip is **stated with
its reason**, so the absence is a decision rather than an oversight.

**Report by disposition, derived rather than narrated.** Read the terms from
`dpm_list_taxonomy` in the `disposition` domain and render the summary in their
`position` order. Every item comes from a row and takes its disposition from that row's state, not
from how the sentence reads once written — the same distinction the coverage claim above draws,
turned on the report itself:

- a coverage row this run verified, a change moment resolved by amending a row, and a refactoring
  pass that ran — the repository is different now;
- a criterion recorded `target-only`, and any check this environment cannot perform — still open,
  saying what would close it;
- a refactoring pass skipped or reverted — seen and not acted on, with its reason;
- a criterion unmet and continued past, a requirement left unclaimed, and a change moment whose
  artefact this run could not reach — still waiting on the reader, so each names what to do and
  where.

A story observation is `dpm-retro`'s input and not a report item: nothing is waiting on the reader
for it, and repeating it here is narration. The per-story refactoring outcomes come from the session
`state` and are dispositioned by the third and first clauses above.

Then offer the next ready epic from `dpm_list_epic` with `ready: true`.

## Change moments

A criterion that contradicts reality, a story whose scope is wrong, a missing requirement spanning
several stories — resolve it now rather than editing silently or deferring it to verification.

| Situation | Response |
|---|---|
| Wording fix or single-criterion clarification, no scope change | Amend the row, and record the change as a section on the epic |
| Scope change, or anything affecting another story or another document | `dpm-pivot` on the artefact that is wrong |
| A pattern or discovery, no scope change | Observation only, at Step 6 |
| Both | Pivot now, observation at story completion |

Present it as a gate with those four options. **When in doubt, pivot**: an amendment is quiet and
skips the cascade, and the cost of an unnecessary pivot is one skipped question.

**A criterion that is merely unmet is not a criterion that is wrong.** *The tests fail*, *I could not
implement it*, *this was harder than expected* — every one of those is a report about the run rather
than about the criterion, and treating them as contradictions is how a loop edits away the work it
found difficult. What licenses an amendment is a citation someone can check afterwards: a `file:line`
whose content contradicts the criterion, a named requirement in the source spec, or another
criterion in the same epic that cannot both be satisfied. Absent one, leave the criterion standing,
leave the story short of complete, and record what could not be done as an observation on it.

## Autonomous mode

When no human is present, the gates do not block. **Rendering stays mandatory** — each proposal is
still written into the message body, and the fact that nobody reads it as it is produced is exactly
why it has to be there to read afterwards.

The retro gate branches by category rather than deferring everything. **Codebase discoveries** and
**patterns worth reusing** are additive and low-ambiguity, so they are applied and carried into the
run; **scope surprises, criteria gaps, complexity underestimates and testing gaps** each imply a
re-planning call that belongs to a human, so they are deferred. Record both with
`dpm_create_retro_application`, and report them at Step 8 under the dispositions
that already separate them: a lesson applied with nobody watching changed this run, while a lesson
deferred unreviewed is waiting on a human to read it.

`dpm-pivot` is never invoked: it is interactive, and calling it produces exactly the stall this
branch exists to prevent. A change moment that would have gone there amends **this epic's rows and
nothing else**, and every artefact it could not reach gets a section on the epic naming the change,
the target, the story, and the citation that licensed it. One per artefact left out of step, so none
is silently covered by another's.

**Step 8's close runs on the count and stops at the judgement.** Complete throughout closes the epic
as it does with a human present — the rows say it, and leaving it open would make an unattended run
the one that quietly stops releasing work. A retired story does not: the status stays `pending` and
the epic gets a section naming which story was retired and that the close is waiting on a reader,
because an epic closed over work nobody decided to drop is a judgement taken with nobody watching.

**The source spec is read and never written.** It is the fixed point the run is measured against, so
a run able to edit it can move its own goalposts.

## Output

There is no file to save and no path to tell the user. Status, verification, observations and
dispositions are all rows; the epic doc and its coverage matrix are projections of them.

Prose the run produces that belongs to the epic — the reasoning behind a resolved change moment, a
gap found in the spec and left for a human — goes in `dpm_create_document_section`.

## Guidelines

- **Do the work.** This skill implements. Write code, create files, run tests.
- **Acceptance criteria gate completion.** Mark a story complete when its criteria are met, or when
  the user explicitly approves it anyway.
- **No unauthorised checkpoints.** The loop stops only at the gates named here: unmet criteria, an
  unroutable tag, a blocker, an ambiguous criterion, a change moment, and the epic-end offer.
  Task-to-task and story-to-story transitions are silent. Any prompt asking whether to carry on is
  an unauthorised checkpoint however it is worded — "shall I continue?", "ready for the next one?",
  "commit first?" — and the answer is to return to Step 7 instead.
- **Version control stays with the user.** Do not commit, stage, branch or push unless a task's
  criteria require it or the user asks.
- **Every value is an argument, never a formatted string.** A status, a note, a planning mark, a
  disposition and a verification are each a column.
- **Readiness is a query.** Ask which stories are ready; never maintain the answer.
- **Correct yourself sparingly**, per the shared convention.
