---
name: dpm-brief
description: Facilitated product ideation. Takes a problem brief as input, explores solution approaches, and records vision, value propositions, key features, differentiation and user journeys as a product brief. Run with /dpm-brief.
phases: recap:off approaches:high vision:medium value:medium features:medium differentiation:high journeys:medium summary:off
---

# Facilitated Product Ideation

Turn a problem brief into a product brief through guided conversation. The product brief captures
*what* is being built and *why this approach* — the bridge between problem discovery and
requirements.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Perspectives**, **Conversational Output**, **Written
Deliverable Length**, **Cross-References** and **Artifact Publishing** from it.

## Input

Resolve the problem this brief builds on, in this order.

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   `dpm_read_problem_brief` on it. A reference goes through
   `dpm_resolve_reference` first, which returns the row it names or refuses; a
   ULID is already the id and needs no resolving.
2. If the request is a description, use it as the starting context.
3. Otherwise `dpm_list_problem_brief` and offer the results with the `question` tool, showing
   each title. **Ask which one; never take the most recent.** Recency answers a different question,
   and the two diverge the moment a project has more than one line of work.
4. If there are none, ask the user to describe the product.

**There is no chain to discover and no slug to match.** A brief either names a problem brief that
exists or names none; the id resolved here becomes `parent_id` in Phase 8, and
`dpm_read_problem_brief` refusing an id is the only "does it exist" check there is.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:brief'`.

**The resolved problem brief's id belongs in `state`**, because Phase 8 needs it and a run resumed
after Phase 1 has no other way back to it.

### Roster

`dpm_list_agent` with `include_body`, for **Perspectives** in Phases 2 and 5. The traits are
body columns, so without it the roster arrives as names and roles. Use only what the row carries.

### Library

Follow the shared **Library Check** procedure with scope keyword `brief`. Carry what it returns into
Phases 2 and 6, where approaches and claims meet recorded standards.

### Retro awareness

Follow the shared **Retro Awareness** procedure. If incorporated:

- **Patterns worth reusing** inform Phase 2 — a proven approach belongs in the candidate set.
- **Codebase discoveries** inform Phase 6 — a surfaced strength or limit bounds what can be claimed.
- **Scope surprises** inform Phase 5 — a category that ran large is where essential and enhancing
  need a sharper line.
- **Criteria gaps** inform Phase 4 — a value claim that proved untestable is made concrete.

## Process

Work through the phases **one at a time**, one gate per turn, each with the `question` tool.

**A gate is two steps, and the first one is the one that gets dropped.** Render what is being
decided in the message body; *then* call `question` with the decision alone. A gate arriving with
nothing above it asks the user to approve something they have not been shown.

### Phase 1: Problem recap

Summarise the problem from the resolved input and confirm it. From a problem brief this is quick:
verify nothing has changed.

Read its constraints with `dpm_list_document_section` and `dpm_read_document_section` with
`include_body`, and restate them for confirmation rather than asking again — a restatement is a
quotation, and the body it quotes is withheld unless asked for. Add whatever has changed since.

**Constraints are collected here and nowhere else in this skill**, so anything not surfaced now is
lost to the product brief.

### Phase 2: Solution approaches

Explore 2–4 distinct approaches, each a plausible path rather than a strawman: what it looks like
in practice, its strengths and risks, and how it sits against the constraints.

An approach ruled out by a constraint identifies a constraint worth recording — add the deciding
one to the set Phase 1 collected, whether or not the problem brief already named it.

Converge on a direction rather than locking in every detail.

**Perspectives**: after presenting the approaches, follow the shared **Perspectives** procedure —
two or three agents whose expertise bears on the choice.

### Phase 3: Vision

What the product is, who it is for, and why it matters, in a paragraph. Not a tagline — an
articulation of intent that can settle decisions downstream.

1. **Render the paragraph in the message body**, written out as the section will read rather than
   described.
2. **Then gate** and refine.

### Phase 4: Value propositions

Two to four propositions, each answering why someone would use this rather than the alternative.
Outcomes, not features.

**Each has to be concrete enough to be wrong.** "Saves time" is a promise nobody can hold the
product to; "a brief that took two days takes an afternoon" is one they can. Where a proposition
cannot be stated that way, say which and offer the form that can be.

### Phase 5: Key features

The capabilities that deliver those propositions, grouped as **essential** — required for the first
iteration — and **enhancing**. Each feature traces back to at least one proposition; one that
traces to none is either a proposition nobody stated or a feature nobody needs, and saying which is
the point of asking.

**Perspectives**: after the list is drafted, follow the shared **Perspectives** procedure — two or
three agents on complexity, testability and priority.

### Phase 6: Differentiation

What makes this different from what already exists — in approach, scope, audience, experience or
technology, not only in features. Be honest about where an alternative is stronger; a
differentiation that concedes nothing is one nobody will believe.

### Phase 7: User journeys

Two or three narratives, each from trigger to outcome: who the user is and in what context, what
prompts them, what they do — steps rather than screens — and what they end up with. Stories, not
flowcharts.

### Phase 8: Summary

1. **Render the complete brief in the message body**, from what the phases settled — every section
   in order, as the document will read.
2. **Then gate**, with the `question` tool: "Approve this brief?" with `Approve` /
   `Request changes` / `Stop`.

Step 1 is a step rather than a preamble because nothing is written until Step 2 is answered. A gate
that arrives on its own is asking about a brief that exists nowhere — not in the message, and not
yet in a row the user could go and read instead.

On approval, agree a title and a short kebab-case slug and call `dpm_create_product_brief`,
passing the problem brief resolved in Input as `parent_id`. That call assigns the number, which
nothing here works out.

**`parent_id` is the lineage, and it is checked as it is written.** The row carries a `parent_kind`
pinned by a composite foreign key, so a brief hung off a spec or a review is refused rather than
stored — where a slug that matched the wrong file resolved silently and stayed wrong. A brief with
no problem behind it passes no `parent_id` at all; the argument is optional, and an absent parent is
a brief that started from a description.

Each phase's prose is then one `dpm_create_document_section` row against the id it returned, with
its heading and its `position`: *Vision*, *Value Propositions*, *Key Features*, *Constraints*,
*Differentiation*, *User Journeys*.

Then `dpm_update_product_brief` sets `status` to `complete`. On *Request changes*, return to the
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

For `brief` the artifact is a value-proposition canvas: each proposition set against the user need
it answers and the features that serve it — so a proposition nothing delivers shows up as an empty
column, and a feature serving nothing shows up as an orphan. The rows state both halves; only the
canvas makes the mismatch a shape rather than a cross-reference. If you cannot write the one-line
justification for what the visual carries that the prose cannot, it has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this brief — so the rows never
claim a visual a reader cannot reach.

### After the brief

- `dpm-architect` to explore architecture and record decisions (recommended for non-trivial products)
- `dpm-spec` to go straight to requirements where the architecture is already clear

## Guidelines

- **Facilitate, stay conversational.** These are conversations, not forms.
- **Build on answers.** Each question responds to what the user just said.
- **Skip what the input already covers**, acknowledge it, and move on.
- **One phase at a time**, and match depth to the product.
- **Product, not project.** What it is and why it matters — not timelines, teams or delivery.
- **Concrete over abstract.** Phases 4 and 6 both turn on this: a proposition has to be falsifiable
  and a differentiation has to concede something.
- **Correct yourself sparingly**, per the shared convention.
