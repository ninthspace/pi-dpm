---
name: dpm-status
description: Project status reconnaissance. Reports what exists, what is in flight and what needs attention from queries over the planning rows and read-only git history, with an optional spec coverage roll-up and an optional shareable full-picture page. Writes nothing. Run with /dpm-status.
thinking: off
---

# Project Status

Report where the project stands. Everything the report says about planning comes from a query;
everything it says about the code comes from read-only git.

**This skill writes nothing at all.** It opens no session, records no rows, and leaves no trace —
the one exception is a publish the user asked for and separately confirmed, which registers an
artifact. Every other dpm skill opens a session row because it has state worth resuming; this one
finishes in a single pass and has none, so it opens none. A `dpm:status` row in the session table
would be a resumable run that cannot be resumed.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length** and
**Artifact Publishing** from it.

## Input

What the request names is optional focus.

1. A **document id** focuses the report on that document and what hangs off it.
2. A **spec id** does the same *and* adds the coverage roll-up — Phase 3b. That is the only trigger
   for it; the roll-up is spec-scoped and no other focus produces it.
3. A **description** ("what's the state of the auth work?") guides which parts to emphasise.
4. A **request for the full picture** — "dashboard", "artifact", "share it" — produces the report as
   usual **and** offers the page in Phase 4. Focus still applies and shapes both.

**A spec id and a page request together are two different pages, so ask which.** The spec coverage
page and the project-wide picture answer different questions; offering one is not offering the
other, and confirming one is never confirmation for the other.

A request naming no focus produces the whole-project report, and offers neither page.

## Startup

### Library

Follow the shared **Library Check** procedure with scope keyword `status`. A project that has
recorded what it counts as done, or which epics are its own, says so there.

Nothing else runs at startup. **No session**: a report reads the rows and prints, so there is no
step a later run could resume from — and a run that recorded one would leave a row in flight for
every glance at the board. The session read in Phase 1 reports *other* skills' runs and is not this
one's own. No retro to consume either — a report changes no decision, so a lesson has nothing here
to change — and no roster.

## Process

Phases 1 and 2 gather; Phase 3 synthesises and prints. Phase 3b runs only for a spec, Phase 4 only
on request.

### Phase 1: The planning rows

Every kind has a list tool, and the inventory is those lists. Call each with a `limit` above what
the project plausibly holds — `dpm_list_spec`, `dpm_list_epic`,
`dpm_list_problem_brief`, `dpm_list_product_brief`, `dpm_list_adr`,
`dpm_list_retro`, `dpm_list_discussion`, `dpm_list_review`,
`dpm_list_audit`, `dpm_list_quick`, `dpm_list_runbook`,
`dpm_list_library` — and report counts rather than titles. **A list that comes back with
`more` set is one whose count is wrong**, and a count reported short reads as a smaller project
rather than as a truncated read; raise the `limit` and call again rather than reporting the page.

Then the roll-up, per epic: `dpm_list_story` on it, and `dpm_list_task` per story where
task-level detail is wanted. An epic's completion is its stories' `status`, counted.

**Retired stories leave the count rather than joining either side of it.** An epic with three
complete stories and one `withdrawn` is complete: a withdrawn story is not work waiting to be done,
and holding it against the total keeps the epic open for something nobody intends to do. Say how
many were retired alongside the fraction, so a denominator that shrank does not do it silently.

**Archived documents do not come back, and that is a `WHERE` clause rather than a rule this skill
remembers.** Every document list omits rows with `archived_at` set unless the caller passes
`include_archived`. Archival is orthogonal to `status` — an archived epic is complete *and* swept —
so nothing here filters on both, and the report's counts are of the working set by construction.
Pass `include_archived` only when the question is the record: "what has been archived" is a
different question from "where does the project stand", and answering the second with the first
inflates every count.

**Retro-waived epics are settled, and the column says so.** A completed epic carrying
`retro_waived_at` is retro-satisfied: do not recommend a retro for it, exactly as if one existed.
The waiver comes back on the row alongside its `retro_waived_reason`, so the report can say *why* it
was waived rather than only that it was.

**Whether a completed epic has a retro is a scoped list, not a comparison.**
`dpm_list_retro` scoped by `parent_id` to that epic answers it directly. Do not list every
retro in the project and match parents in the run — that is a join in the caller, and it goes wrong
quietly the moment there are more retros than one page.

**Active sessions replace the progress-file scan.** `dpm_list_session` reports which skills
have runs in flight, with `phase` saying where each reached. `updated_before` narrows to the stale
ones — a session that has not moved in a long time is the thing worth mentioning, and an age is a
bound rather than a status.

### Phase 2: Git activity

Read-only, and the one part of this skill that is not a query — the code's history is not in the
planning rows.

- `git status --short` and `git branch --show-current`: uncommitted work, untracked files, branch.
- On a non-main branch, `git diff --stat main...HEAD`. Fall back to `master`; skip if neither exists.
- `git log --oneline -1 --format=%ct` for the last commit's age, which sets the window: under a day
  looks back three days, one to seven days looks back a fortnight, over seven days takes the last
  twenty commits regardless of date.
- `git log --oneline` and `git log --format=%s` over that window. The subject lines are the raw
  material for the narrative.

### Phase 3: Report

Print to stdout. One screenful, narrative rather than a data dump.

**Summary** — two to four short paragraphs answering what someone picking the project up would ask:
what this project is (inferred from titles and commit subjects), what has been built (epics grouped
into themes, not listed), what happened recently (the commit subjects read as threads, with the gap
named if there is one), and what needs attention. Lead with active work if there is any.

If no rows exist at all, say so: the project has not started the dpm pipeline yet.

**Recommended next steps** — one to three, in priority order, each with a runnable command. **The
order of the table is the priority order.** `dpm-do`, `dpm-epics` and `dpm-retro` appear in that
relative order because it is the candidate ordering in the shared status model — `dpm_read_shared_document`
with `name: "status-model"` — work that can start now, then work that needs planning, then the
follow-up on work already done.

**Each command is written out with the target's reference in it**, which every row of the lists
above already carries beside its columns. The command is then one a reader can copy, and the skill
it names accepts what it was given — see **Naming a Document** in the shared conventions.

| What the rows say | What to recommend |
|---|---|
| Nothing at all | `dpm-discover` or `dpm-brief` |
| An epic the `ready` filter returns | `dpm-do` and the epic's reference |
| An epic held by an incomplete blocker | Nothing to run — name the blocker from the edge that holds it; the action is to unblock |
| Specs but no epics | `dpm-epics` and the spec's reference |
| Briefs but no specs | `dpm-spec` and the brief's reference |
| A retired epic, or one whose only incomplete stories are retired | Nothing — it will not be worked, and no retro is owed on it |
| A complete epic, no retro, no `retro_waived_at` | `dpm-retro` and the epic's reference |
| A complete epic carrying `retro_waived_at` | Nothing — it is settled |
| A session in flight | Resume it — name the skill and its `phase` |
| Uncommitted changes | Commit before starting new work |

**Readiness is asked for, not inferred from the stories.** `dpm_list_epic` with
`ready` applies dpm's own rule — the epic is `pending`, unarchived, and nothing incomplete blocks
it over an edge kind whose `gates_work` is set. An epic with incomplete stories is *not* the same
thing: one waiting on a blocker cannot be picked up, and recommending `dpm-do` on it sends someone
at work they cannot start. When an epic is held, `dpm_list_dependency` names what
holds it, because the edge is a row.

**Two of the four statuses are neither outstanding nor delivered, and the report says so in its own
word.** `pending` and `complete` are the working pair; `superseded` means replaced by other work and
`withdrawn` means dropped, both terminal and both set by a person. Report them as **retired**, on a
line of their own. Folded into "complete" they overstate what was built; folded into "pending" they
are work somebody will pick up. Neither error is visible in a total, which is why the word is worth
a line rather than a parenthesis.

**A status that cannot be read is flagged, never guessed, and counts as not-done.** `status` is a
closed set the database enforces, so an off-vocabulary status cannot reach this report — it is
refused at the write. What *can* reach it is a `status_note` that reads like a status on a row whose
`status` is `pending`: "superseded", "withdrawn", "folded into Story 10". Report those in a callout
of their own, naming the document and quoting the note verbatim, count the row by its `status`
column, and recommend setting the status the note describes. **Do not read a note as a status** —
treating it as retired closes work nobody closed, and here the remedy is one call the reader can
make rather than a vocabulary the project lacks.

### Phase 3b: Spec coverage roll-up (only for a spec)

Only when the focus resolves to a spec. It answers what the project-wide view cannot: **is this spec
delivered?**

`dpm_list_requirement` on the spec with `include_body` and a `limit` above its requirement
count, then `dpm_list_coverage` scoped by `requirement_id` for each. Three states, from the
rows:

- **Untraced** — no coverage rows at all. The breakdown missed it. This is a gap in the plan rather
  than slow progress, and it is the load-bearing measurement.
- **In progress** — coverage rows exist, not all carry `verified_at`.
- **Delivered** — every coverage row carries `verified_at`.

**Never a proportion.** Four rows verified of five is *in progress*, not 80% delivered.

Render untraced first, before the counts. Then the rest grouped by `moscow` in the spec's own order
— must, should, could — quoting each requirement's `text` **verbatim**, because that text is what
was asked for and paraphrasing it here is how the thing asked for stops matching the thing built.
List requirements carrying an `exclusion` separately, as ruled out rather than outstanding. Close
with the counts.

**Say what `verified_at` means wherever the section shows it: aggregation, not verification.** Every
one was set by `dpm-do` on its own work. Reporting them together reports what `do` claimed, more
conveniently, and adds no independent evidence. A wall of green is not confirmation that anything
runs. The untraced count is the part that discriminates, because the requirements are written by a
person and the coverage rows are made later against them.

**And separate the marks a test produced from the ones nothing could.** The spec's own tag for a
requirement is `dpm_list_criterion_approach`; the tag on the criterion the breakdown actually
wrote is `dpm_list_story_criterion_approach`, and the two need not agree. `target` and
`manual` are the approaches whose marks rest on something other than a test having run, so where any
verified row carries either, say how many and which — in the same breath as the counts. Do not
reweight anything: a mark is a mark, and this is a statement about what the marks rest on. A spec
tag of `target` over an automated criterion is worth its own line: it means the spec withheld from
verification something the breakdown found a way to check, which is almost always a mis-tag rather
than a decision.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is always separately confirmed, and never the default. For `status` this page is the
one view that spans a spec's epics: every requirement with its state and the rows behind it, in a
form that can be handed to someone with no repository. Render it from the rows already read, by the
rules above — a second read could disagree with the section the reader just saw. Carry the
aggregation statement onto the page, which is the artefact most likely to reach someone who was not
in the session.

### Phase 4: The full picture (on request only)

Only when it was asked for. The stdout report is produced and printed unchanged either way, and this
is offered in addition — offered, not published, separately confirmed, and never the default. A
declined offer leaves a complete run behind it.

Follow the shared **Artifact Publishing** procedure. The page is built from the rows Phases 1 and 2
already read, so its numbers and the narrative's are the same numbers; state the headline as
"{complete} of {total} epics complete" and make it match. Sections: an at-a-glance RAG view, what is
in progress and what is blocked, the epic and story completion grid, recent git activity, and the
same recommended next steps.

For `status` the page carries what one screen of narrative deliberately omits — the whole grid, at a
size stdout cannot hold. That justification is the test for anything else it might carry: if you
cannot write the line saying what the visual carries that the prose cannot, it has not earned its
place.

**When the Artifact tool is absent**, say so and stop after Phase 3. The narrative is the
degradation path and it is complete on its own. Nothing is written to disk in its place.

## Output

The report is printed and the run ends. There is no document, no rows, and nothing to project — the
only durable thing a run can leave is the register row a confirmed publish writes.

## Guidelines

- **Read-only, and structurally so.** Every planning read is a list or a read tool; every git command
  is `log`, `status`, `diff` or `branch`. Nothing here has a write tool available to misuse.
- **Degrade quietly on absence.** A kind with no rows is a count of zero, not a failure. A project
  with no git repository loses Phase 2 and keeps the rest.
- **Match depth to what is there.** An empty project gets a short "start here". A project with
  twenty epics gets the inventory.
- **Actionable recommendations.** Each carries a command that can be run as written, with the id in
  it.
