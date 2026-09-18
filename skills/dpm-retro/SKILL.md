---
name: dpm-retro
description: Lightweight retrospective over a finished epic or quick record, and the three passes that keep the corpus honest — promoting a durable lesson into the library, retiring a spent one, and waiving a clean epic that has nothing to reflect on. Observations are rows that keep their origin. Run with /dpm-retro.
thinking: medium
phases: gather synthesise write library handoff select promote retire classify waive
---

# Lightweight Retrospective

Turn what a run learned into something the next run reads. Observations are written during the work
and gathered here; the durable ones graduate to the library and the spent ones stop being offered.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length**,
**Cross-References** and **Artifact Publishing** from it.

## Input

Four modes, and they never run together. The request selects one:

- **`learn`** — promote a durable lesson into the library and retire it at the source.
- **`retire`** — retire a spent lesson, which has no library entry to go to.
- **`triage`** — waive the completed epics that finished clean, so nothing goes on asking them for
  a retro they do not need.
- **anything else, or nothing** — synthesise. This is the default and everything under **Process**.

**The four are separate because their terminus differs, not their subject.** `learn` retires a
lesson because it graduated; `retire` retires one because it is spent; `triage` records that there
was never anything to retire; synthesis creates the grouping the other three act on. A run does one.

For synthesis, resolve the subject:

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   `dpm_read_epic` or `dpm_read_quick` on it. A reference goes
   through `dpm_resolve_reference` first, which returns the row it names or
   refuses; a ULID is already the id and needs no resolving.
2. Otherwise `dpm_list_epic` and `dpm_list_quick`, and offer them with the `question` tool,
   showing each title and status. **Ask which one; never take the most recent.**
3. If there are none, say so and stop.

**An epic and a quick record are the same input here.** Both hold observations written against
their work, and an observation carries where it came from in `story_id` rather than in the shape of
the text around it — so there is no source kind to detect and no second parse for the other one.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:retro'`, putting the mode and the
step about to start in `phase`.

**The mode belongs in `state`**, because a run resumed into the wrong one would retire what it was
asked to synthesise.

### Library

Follow the shared **Library Check** procedure with scope keyword `retro`. This is also the corpus
`learn` writes into, so knowing what is already there is what stops a second entry saying the same
thing.

## Process

Synthesis. The three other modes are below.

### Step 1: Gather the observations

`dpm_list_story` on the epic, then `dpm_list_observation` with each `story_id` and
`include_body`. On a quick record, `dpm_list_observation` scoped to its `quick_id`, again with
`include_body`. Step 2 writes what a group of observations says that no one of them says; over rows
whose `text` was withheld it is a synthesis of their categories.

**The two scopes are the two places work happens, and neither is the retro.** A `do` run writes an
observation against the story it was working; a `quick` run writes one against the quick record. Both
arrive here ungathered, which is the state this step exists to end.

**A retired observation is not returned, and that is the tool's doing rather than this skill's.**
The list omits them unless a caller passes `include_retired`, which synthesis never does — so there
is no marker to look for in the text and no rule here to remember. Pass it only when the question is
the audit trail rather than the work.

Then each one's categories: `dpm_list_observation_category` per observation, resolved against
`dpm_list_taxonomy` in the `observation` domain, called with a `limit` above the seeded count
so a project that added terms of its own does not lose them to the default page — a category that
falls off the end reads here as an observation with no category at all. An observation may carry
more than one, and
that is deliberate — a finding that is both a testing gap and a pattern worth reusing is two
categories on one row rather than an invented compound.

Summarise what was found — how many observations, across which categories, from how many stories —
and proceed.

### Step 2: Synthesise

Group the observations by category and write, per category, what the group says that no single
observation in it says. That paragraph goes on the observations as `synthesis`, which is why the
grouping is worth doing rather than listing.

**Signal over noise.** Two sharp observations beat ten vague ones. Where a category holds one
observation and nothing to draw from it, leave `synthesis` unset rather than restating the text.

Where there are no observations at all, the retro is still worth writing: the story outcomes are the
content, read from `dpm_list_story` and its `status`. Say what completed, what did not, and
what that implies.

### Step 3: Write the retro

Two steps before any row changes:

1. **Render the retro in the message body** — each category, the observations grouped under it,
   and the synthesis Step 2 wrote for it.
2. **Then gate**, with the `question` tool: "Record this retro?" with `Approve` /
   `Request changes` / `Stop`.

On approval:

1. `dpm_create_retro` with the epic or quick record as `parent_id`, a short kebab-case `slug`
   and a `title`. That call assigns the number, which nothing here works out.
2. `dpm_update_observation` per observation, setting `retro_id` to the new retro, `position`
   for the order it reads in, and `synthesis` where Step 2 wrote one.

**Setting `retro_id` is the gathering, and nothing else changes.** `story_id` and `quick_id` are
where the observation came from; neither is cleared, re-supplied, or moved. An observation written
against Story 3 and gathered into a retro is still queryable as Story 3's, and one written against a
quick record is still that record's — which is what makes "where did this lesson come from?"
answerable after the promotion that follows.

**Do not create a new observation on the retro.** A run that wrote fresh rows instead of pointing
the existing ones at the retro would leave every count the same and every origin gone.

### Step 4: Library write-back

Where an observation bears on a library document already read at startup — a codebase discovery
against an architecture entry, a criteria gap against a standards one — offer to amend it.
`dpm_create_document_section` on that library document, with the observation as the body and a
heading naming the date. Present every proposed amendment before writing any, and write only what
was approved.

Skip in silence where nothing matches. An amendment nobody needed is a document nobody trusts.

### Step 5: Handoff

- `dpm-pivot` where a criteria gap or scope surprise means the spec or epic missed something
- `dpm-retro` with `learn` where an observation has proved durable across runs
- `dpm-spec` or `dpm-epics` where the retro is the starting context for the next cycle

## Lesson promotion (`learn`)

A lesson that keeps proving true belongs in the library, where **Library Check** reads it every run,
rather than in the retro layer where it is re-judged every time.

### Step L1: Select

`dpm_list_observation` with no scope and `include_body` for the whole corpus, then
`dpm_list_observation_category` on each. Where the request carried text after `learn`, narrow
to it. The candidates are presented for a user to choose a lesson from, and a candidate is its text.

**The candidates are what the list returns, and a promoted lesson is not among them.** Promotion
retires at the source, and the list omits retired rows — so a lesson cannot be offered twice, and
nothing here has to check whether it was promoted before. That is the same predicate synthesis
relies on, doing the work a scan for a marker used to do.

Present the candidates grouped by category, each naming its retro and its story so the user sees
where it came from. Support selecting more than one.

### Step L2: Preview, then promote

**Preview both halves before writing either.** For each selection show the library entry that will
be created — its title, its `doc_type`, its scopes, its body — *and* the retirement that will follow
it. Confirm. Nothing is written until this is confirmed, because a promotion the user did not expect
is a lesson that has left the retro layer and cannot be found by looking there.

On confirmation, per lesson, in this order:

1. `dpm_create_library` with `slug`, `title` and `doc_type` — the kind of document it is, as
   **Library Check** groups them.
2. `dpm_create_library_scope` per scope, one row each. A lesson about testing scopes to `do`;
   one about terminology may scope to `all`.
3. `dpm_create_document_section` for the lesson, written as standalone guidance rather than as
   a quotation of the observation.
4. `dpm_update_observation` setting `library_doc_id` to the new document, with `retired_at` and
   `retired_reason` **in the same call**.

**The retirement travels with the link, which is what makes the pair atomic.** A lesson retired but
not promoted is one that has disappeared from both places, and splitting step 4 into two calls is
what would create it. The order matters too: the library entry exists before anything points at it.

**Provenance is the foreign key and there is no source line to write.** `library_doc_id` says which
entry this observation became, its origin column still says which story or quick record raised it,
and "what was promoted from where" reads from either end. Do not write the trail into the entry's prose as well — a second
copy is one that will disagree.

## Lesson retirement (`retire`)

Same selection as L1, and the same reason it needs no marker scan.

Ask for a one-line reason each lesson is spent — what changed so that it no longer holds — and
preview the retirement before writing it. Then `dpm_update_observation` with `retired_at` and
`retired_reason`, and nothing else.

**Retirement means the lesson is no longer true anywhere.** It is not the answer to "this does not
apply to the work in front of me" — that is `do`'s per-run disposition, which writes a
`retro_application` row and leaves the observation alone.

**Retiring is durable and this skill does not undo it.** The row is never deleted, so the
observation and its reason stay readable under `include_retired` and the audit trail survives the
judgement — but there is no call here that puts a lesson back on offer. Ask before retiring, not
after.

## Triage (`triage`)

A retro is not mandatory. An epic that finished clean has nothing to synthesise, and something has
to record that so it stops being asked.

### Step T1: Classify

`dpm_list_epic`, then for each whose `status` is `complete`: `dpm_list_retro` scoped by
`parent_id` to that epic for the retros already written, and `dpm_list_story` with
`dpm_list_observation` and `include_body` per story for what it holds — the waivable outcome is
*no observations worth synthesising*, which is a judgement about what they say. Archived epics do not
come back and are not classified — an epic that was swept is not one waiting on a decision.

Three outcomes, and only one of them is actionable:

- **Settled** — it already has a retro, or already carries `retro_waived_at`. Skip in silence.
- **Waivable** — no retro, and no observations worth synthesising.
- **Has observations** — no retro, but real ones are sitting there. **Report these; never waive
  them.** Recommend `dpm-retro` on the epic instead.

### Step T2: Confirm and waive

1. **Render the waivable epics in the message body**, each with the one-line reason it reads
   clean, and support waiving some of them rather than all.
2. **Then gate with the `question` tool** — which epics to waive — **and write only what it
   returns.**

Then `dpm_update_epic` with `retro_waived_at` and `retro_waived_reason` together.

**Both or neither — the database refuses one without the other.** A waiver with a date and no reason
is a decision with no record of why it was made, so the pairing is enforced rather than encouraged.

It is never a marker in prose: nothing greps for it, because it is a column. And as with retirement,
this skill writes a waiver and does not lift one — so confirm before waiving rather than waiving
broadly and correcting after.

## Output

There is no file to save. The retro is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

For `retro` the artifact is a trend view across retros: this retro's observations set against the
ones before it, category by category, so a lesson recurring across several epics reads as a run
rather than as one bullet in one file. That judgement no single retro carries — the pattern exists
only in the sequence. If you cannot write the one-line justification for what the visual carries
that the prose cannot, it has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this retro.

## Guidelines

- **Signal over noise.** Synthesise into patterns, not reformatted lists.
- **Actionable.** A recommendation that changes nothing about how the next cycle is planned is an
  observation wearing a different hat.
- **Works without observations.** Story outcomes alone make a useful retro.
- **Promotion is graduation, not duplication.** A lesson lives in one place — the retro layer until
  it proves durable, then the library.
- **Retirement is deliberate and durable**, and never a substitute for "not relevant here".
