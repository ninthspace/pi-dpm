---
name: dpm-discover
description: Facilitated problem discovery. Understand the problem before proposing solutions. Produces a problem brief as typed rows through guided conversation. Use when starting a new product, complex feature, or any work where the problem isn't well-defined yet. Run with /dpm-discover.
thinking: medium
phases: why who current success constraints summary
---

# Facilitated Problem Discovery

Guide the user through understanding their problem before jumping to solutions. Each phase is a
gate the user controls.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Perspectives**, **Conversational Output**, **Written
Deliverable Length**, **Cross-References** and **Artifact Publishing** from it.

## Input

Where the request carries a starting context, use it for Phase 1 rather than asking from
scratch, and still confirm the understanding before proceeding. Otherwise begin at Phase 1.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:discover'`.

`state` holds what each phase settled, written as it is settled — this skill's phases build on each
other, so a phase recorded only in the conversation is one that has to be re-facilitated after a
compaction.

### Roster

`dpm_list_agent` with `include_body`, for **Perspectives** in Phases 1 and 5. The traits are
body columns, so without it the roster arrives as names and roles. Use only what the row carries.

### Library

Follow the shared **Library Check** procedure with scope keyword `discover`. Carry what it returns
into Phase 5, where constraints meet recorded standards.

### Retro awareness

Follow the shared **Retro Awareness** procedure. The category is what the four rules below key on,
so an observation whose category was not resolved cannot be routed to a phase. If incorporated:

- **Scope surprises** inform Phase 5 — a boundary that surprised someone gets sharper edges here.
- **Criteria gaps** inform Phase 4 — a category the last round missed is probed explicitly.
- **Codebase discoveries** inform Phase 5 — a surfaced limitation is a constraint, not context.
- **Testing gaps** inform Phase 4 — last round's vague outcome is made concrete this round.

### Codebase grounding

Survey what already exists — structure, dependency manifests, conventions — and read enough of it
to know the technology choices and the domain model. Carry it into every phase; Phase 3 depends on
it most directly. A greenfield project has none, which is a finding rather than a failure.

## Process

Work through the phases **one at a time**, one gate per turn, each with the `question` tool.

**A gate is two steps, and the first one is the one that gets dropped.** Render what is being
decided in the message body; *then* call `question` with the decision alone. A gate arriving with
nothing above it asks the user to approve something they have not been shown.

### Phase 1: Why

What the user is trying to accomplish and why it matters — the motivation, not the feature request.
What problem is being solved, why now, and what happens if it is not.

**Perspectives**: after the user describes the problem and before Phase 2, follow the shared
**Perspectives** procedure — two or three agents whose expertise bears on it.

### Phase 2: Who

Who will use this, what they are trying to accomplish, and how technical they are.

### Phase 3: Current State

How this is handled today, what is broken or missing about it, and what tools, code or workarounds
are already in play. Ground the answers in the codebase read at startup rather than in what the
user recalls of it.

### Phase 4: Success Criteria

What "done" looks like: how anyone will know it works, what the happy path is, and which outcomes
are measurable.

**An outcome nobody can check is worth less than a missing one**, because it is recorded and then
passes on somebody's impression. Where one cannot be checked, say which, say what about it cannot
be, and offer the checkable form. That is a refinement round, not a rejection of the concern.

### Phase 5: Constraints

Technical constraints (language, framework, infrastructure), business constraints (budget,
timeline, compliance), and what is explicitly out of scope.

**This is where constraints are captured for the whole pipeline.** `dpm-spec` reaches back past the
product brief to read this phase's section and facilitates only the gaps, so a constraint left out
here is one the spec has no reason to ask about.

**Perspectives**: before finalising, follow the shared **Perspectives** procedure — two or three
agents on scalability, on deployment, on testability.

### Phase 6: Summary

1. **Render the complete brief in the message body**, from what the phases settled — every section
   in order, as the document will read.
2. **Then gate**, with the `question` tool: "Approve this brief?" with `Approve` /
   `Request changes` / `Stop`.

Step 1 is a step rather than a preamble because nothing is written until Step 2 is answered. A gate
that arrives on its own is asking about a brief that exists nowhere — not in the message, and not
yet in a row the user could go and read instead.

On approval, agree a title and a short kebab-case slug and call `dpm_create_problem_brief` —
that call assigns the number, which nothing here works out. Each phase's prose is then one
`dpm_create_document_section` row against the id it returned, with its heading and its
`position`: *Why*, *Who*, *Current State*, *Success Criteria*, *Constraints*, *Scope Boundaries*.

Then `dpm_update_problem_brief` sets `status` to `complete`. On *Request changes*, return to the
phase the change belongs to and leave the status alone.

**Write the rows only once the brief is approved.** A brief half-written and then abandoned at the
gate is a document a later run will offer as input, and nothing on it says which phases were real.

## Output

There is no file to save. The brief is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without, and it is wrong the moment the projection moves where a kind renders.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

For `discover` the artifact is a problem map: the problem at the centre with who it affects, how it
is solved today, what constrains a fix, and where the scope boundary falls arranged around it — so
which constraint bites which user is visible at a glance, where six sequential sections leave it to
be inferred. If you cannot write the one-line justification for what the visual carries that the
prose cannot, it has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this brief — so the rows never
claim a visual a reader cannot reach.

### After the brief

- `dpm-brief` to explore vision, value propositions and key features (recommended for most problems)
- `dpm-spec` to go straight to requirements where the solution approach is already clear
- `/plan` where the scope is small enough to skip planning artefacts entirely

## Guidelines

- **Facilitate, stay conversational.** These are conversations, not forms.
- **Build on answers.** Each question responds to what the user just said.
- **Skip what is already covered.** Where the opening description settles a phase, acknowledge it
  and move on.
- **Stay curious.** Follow up where an answer is vague or an assumption looks risky.
- **One phase at a time**, and match depth to the problem.
- **Refuse rather than record an outcome nobody can check.** Phase 4 turns on this.
- **Correct yourself sparingly**, per the shared convention.
