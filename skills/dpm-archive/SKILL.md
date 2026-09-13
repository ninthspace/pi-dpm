---
name: dpm-archive
description: Sweep settled planning artefacts out of the working set. Finds what is finished by reading columns, walks each chain by parentage, and stamps `archived_at` on what the user selects. Run with /dpm-archive.
phases: survey:off chains:medium settled:high stamp:off
---

# Archive Planning Documents

Take planning artefacts that are finished out of the working set, without taking them out of the
project.

**Archival is a column, and it is not a status.** `archived_at` says a document is out of the way;
`status` says what became of the work. A completed epic that is archived is both — complete and put
away — and neither answer costs the other. The two are asked separately because they are different
questions, and a run that collapsed them would lose whichever one it did not write.

**Nothing moves.** There is no archive directory, no mirrored tree, and no file to relocate. A
document's path is derived from its kind and its number when the projection renders it, so archiving
one is a write to its row. That also settles what a mirrored tree was for: numbers are allocated from
`number_sequence`, which keeps its counters whether a document is archived or not, and no create tool
accepts a number. A number issued before an archive cannot be issued again after it, and nothing here
has to arrange that.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Session Startup**, **Library Check**, **Retro Awareness**, **Gate Presentation**,
**Conversational Output** and **Written Deliverable Length** from it.

## Input

What the request names is optional.

1. A **document id** narrows the survey to the chain that document sits in.
2. A **description** ("the auth work") filters the survey by title and slug.
3. **Nothing** surveys the project.

## Startup

Follow the shared **Session Startup** procedure. `state` holds what the survey found settled and
which units the user has decided on, so a run interrupted partway resumes at the next undecided unit
rather than re-surveying. It holds no `archived_at` values and no statuses: those are columns, and a
copy of a column goes stale.

Follow the shared **Library Check** procedure with scope keyword `archive`. A project that keeps
artefacts live past completion — for audit, for a compliance window — says so there, and that
overrides every signal below.

Follow the shared **Retro Awareness** procedure. A lesson about scope informs Phase 2, where a
chain's reach is decided.

## Process

### Phase 1: Survey

Call the lists for the kinds a project archives, each with a `limit` above what it plausibly holds:
`dpm_list_problem_brief`, `dpm_list_product_brief`, `dpm_list_spec`,
`dpm_list_epic`, `dpm_list_adr`, `dpm_list_retro`, `dpm_list_quick`,
`dpm_list_discussion`.

**Leave `include_archived` alone.** It defaults to false, so what comes back is the working set and
already-archived documents are excluded by a `WHERE` clause rather than by anything this run
remembers. Pass it only to answer a question about the record — "what was archived last month" — and
never while building the candidate list, or the run offers to archive what it already did.

**Library documents are not surveyed.** They have their own lifecycle in `dpm-library`, and a
library document is a reference rather than a record of work.

### Phase 2: Chains

A chain is a document and what hangs off it, read from parentage.

`dpm_read_document_kind` on a surveyed document's kind returns `children` — the kinds that may
hang off it. For each, call that kind's list scoped by `parent_id` to that document —
`dpm_list_epic`, `dpm_list_coverage_matrix`, `dpm_list_adr`,
`dpm_list_review`, `dpm_list_product_brief`, and `dpm_list_retro` again in its
scoped form — and repeat on what comes back. It terminates on its own: a kind nothing hangs off
returns `children` empty.

**Scope every one of those calls by `parent_id`.** Unscoped, a list returns every document of that
kind in the project, and a chain assembled by then matching parents in the run is a chain that will
sometimes sweep away an artefact belonging to different work — quietly, because the candidate list
looks the same either way.

**A coverage matrix is a child of its epic, so it travels with it and cannot be left behind.** It is
reached by the same traversal as everything else, and there is no filename to rebuild, no prefix to
match, and no separate step that could be skipped. Say so when reporting the unit, because a user who
has archived epics before will look for it.

**The walk goes down and never up.** From an epic, its stories, its coverage matrix, its retros and
its reviews. Never from an epic to the spec above it: a spec belongs to the chain only when the
survey reached the spec itself, and a chain that grew upward would carry a live specification out of
the working set on the strength of one finished epic.

### Phase 3: What is settled

Read the columns; do not infer. Every signal below is a value the project already holds, and a
document that fires none is still offered — the user may have their own reason.

1. **A finished epic.** `status` is `complete`, and `dpm_list_story` scoped to it returns
   stories that are all `complete`.
2. **A delivered spec.** Every epic under it is *resolved* — `complete`, `superseded` or `withdrawn`.
   All three end the work; only the first delivers it.
3. **A retired epic.** `status` is `superseded` (replaced by other work) or `withdrawn` (dropped).
   This fires whatever its stories say: retirement is a decision about the epic, and stories left
   `pending` under it are what being retired looks like.
4. **A spent retro.** Its parent is resolved.
5. **An orphaned brief.** A problem brief or product brief whose `children` lists return nothing —
   the work it proposed was never taken up.

**This file names status values, and that is deliberate.** Elsewhere a skill passes through whatever
the tool accepts, because it is carrying the user's choice rather than judging it. Here the judgement
*is* the difference between them: signal 2 needs `withdrawn` to count as an ending and signal 1 needs
it not to count as a delivery, and no tool schema carries that distinction. A project adding a fifth
status will find these signals silent about it, which is the right failure — silent, and visible in
the survey as a document nothing flagged.

### Phase 4: Decide, then stamp

1. **Render each unit in the message body** with the signals that fired and every document it
   contains. Units that fired something come first.
2. **Gate each unit on its own with the `question` tool** — archive, skip, or open it and choose
   within. Never present several for one approval, and never carry an approval forward.
3. **Offer a retired epic under a spec with live siblings separately.** It is **its own unit**, not
   part of any chain, and it takes its coverage matrix and nothing else.
4. **On approval, stamp every document in the unit**: call the kind's update tool with `archived_at`
   and **nothing else** — `dpm_update_epic`, `dpm_update_spec`,
   `dpm_update_coverage_matrix`, `dpm_update_retro`, and so on for whatever the
   traversal reached. **Never pass `status` on an archive call**, and never pass `status_note`.

A retired epic's spec is still owed the rest of its epics, so sweeping it out because one branch of
it was abandoned would archive work that has not been done.

Archiving a document says nothing about how its work ended, and a run that wrote a status alongside
would be recording a conclusion nobody reached — over the one the user did reach, in the same call,
with no error and nothing to compare against afterwards.

Each call lands as it is made, so a run stopped midway leaves what it already archived archived.

**Report by disposition**: read the terms from `dpm_list_taxonomy` in the
`disposition` domain and render them in `position` order. A document this run stamped is archived
now; one skipped was seen and deliberately left, with the reason it was skipped; and a document the
run never reached before it stopped is waiting on the reader, naming what is left to sweep. That last
is the case a run stopped midway has to say out loud — the rows it did write look identical either
way.

## Output

The rows are the output. An archived document keeps its number, its parentage and its prose, and
stays readable through its read tool and through any list passed `include_archived`. Archiving is
reversible by clearing the column — say so if the user asks, and leave the decision with them.

## Guidelines

- **Every archive is the user's.** Survey, group, flag, and wait. The value is that someone sees what
  is about to leave the working set.
- **Read the columns.** A signal derived from prose is a guess with a confident tone.
- **Never recover a document by reading a rendered file.** Everything this skill needs is a read tool
  away, and a generated file is a projection of the rows rather than a source of them.
- **Degrade by saying so.** A survey that flags nothing is a project with nothing settled; report that
  and finish. A chain whose only member is the document named is a chain, not a failure.
