---
name: dpm-architect
description: Facilitated architecture exploration. Takes a brief, spec or discussion as input, identifies the architectural decisions the product actually needs, explores options and trade-offs for each, and records them as ADRs with typed options and axes. Run with /dpm-architect.
thinking: medium
phases: context decisions options operations dependencies record
---

# Facilitated Architecture Exploration

Explore architectural decisions through guided conversation. Each decision is derived from the
product's actual needs, and each is recorded with the options that were weighed and what they were
weighed on.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Perspectives**, **Conversational Output**, **Written
Deliverable Length**, **Cross-References** and **Artifact Publishing** from it.

## Input

Resolve the document these decisions belong to, in this order.

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   read it with the tool for its kind. A reference goes through
   `dpm_resolve_reference` first, which returns the row it names or refuses; a
   ULID is already the id and needs no resolving.
2. Otherwise `dpm_list_product_brief`, and offer the results with the `question` tool. Fall back
   to `dpm_list_problem_brief`, then `dpm_list_spec`, then `dpm_list_discussion`.
   **Ask which one; never take the most recent.**
3. If none exist, ask the user to describe the system, and say that the decisions will need a
   document to hang off before they can be recorded.

**An ADR is a child document, and the parent is chosen here rather than derived.** Four kinds may
hold one — problem brief, product brief, spec and discussion — and `dpm_create_adr` refuses
any other, so the choice made now is the one checked at write time.

Read the chosen document with the tool for its kind — `dpm_read_product_brief`,
`dpm_read_problem_brief`, `dpm_read_spec` or `dpm_read_discussion` — and its prose
with `dpm_list_document_section` and `dpm_read_document_section` with `include_body`.
The constraints and success criteria it records are what makes a decision this product's rather than
boilerplate, and they are in the section body a read that does not ask for it leaves out.

Then `dpm_list_adr` on that parent for decisions already recorded, and
`dpm_read_adr` on each. Summarise them and ask whether they still hold. Facilitate only the
gaps.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:architect'`.

**The resolved parent's id belongs in `state`**, along with each decision settled so far, because
Phase 3 iterates and a run resumed mid-iteration has no other way back to the decisions already
agreed.

### Roster

`dpm_list_agent` with `include_body`, for **Perspectives** in Phases 2 and 4. The traits are
body columns, so without it the roster arrives as names and roles. Use only what the row carries.

### Library

Follow the shared **Library Check** procedure with scope keyword `architect`. Carry what it returns
into Phases 2 and 3 — an architecture document or a coding standard constrains which options are
live, and an option a standard rules out should be presented as ruled out rather than quietly
dropped.

### Retro awareness

Follow the shared **Retro Awareness** procedure. If incorporated:

- **Codebase discoveries** inform Phase 2 — a surfaced limitation may be a load-bearing decision
  nobody has written down.
- **Complexity underestimates** inform Phase 3 — they name the axis this team habitually misreads.
- **Patterns worth reusing** inform Phase 3 — a proven approach belongs in the option set.
- **Testing gaps** inform Phase 4 — a decision that made something hard to verify is an
  operational cost, not a testing accident.

### Codebase grounding

Survey what already exists — structure, dependency manifests, deployment configuration,
conventions — and read enough of it to know the technology already in play. Carry it into every
phase; Phase 1 reports it and Phase 2 derives from it. A greenfield project has none, which is a
finding rather than a failure.

## Process

Work through the phases **one at a time**, one gate per turn, each with the `question` tool.

**A gate is two steps.** Render what is being
decided in the message body; *then* call `question` with the decision alone. A gate arriving with
nothing above it asks the user to approve something they have not been shown.

### Phase 1: Context

Summarise what already exists — stack, patterns, deployment shape, and the decisions already
embedded in the code whether or not anyone wrote them down — together with the product context read
in Input. Confirm the understanding before proposing anything.

### Phase 2: Identify the decisions

Which decisions this product actually needs taken. Each has a label, a reason it matters *for this
product*, and the feature or constraint that drives it.

**A decision that could be asked of any product is boilerplate.** "Choose a database" is not a
decision; "where booking availability is held given concurrent writes" is. If the driving
requirement cannot be named from the parent document or the codebase, that is the signal to drop it
rather than to invent one.

Aim for three to eight, in two steps:

1. **Render the list in the message body**, each decision with its label, why it matters for this
   product, and the feature or constraint that drives it.
2. **Then gate** and refine — the user will know of decisions already taken and of ones not worth
   taking yet.

**Perspectives**: after the list is drafted, follow the shared **Perspectives** procedure — two or
three agents on what is missing, what is premature, and what is operational rather than structural.

### Phase 3: Options and trade-offs

One decision at a time. For each: two to four options, each a path someone would genuinely take,
and an assessment of each against the axes that matter.

**Default axes**: complexity, scalability, team capability, operational cost, time to market. They
are a starting set rather than a schema — a decision turning on data residency or on reversibility
adds that axis, and one where an axis is irrelevant drops it. **Use the same axes across the options
of a single decision**, because the comparison is the point: an option assessed on axes the others
were not is an option nobody can weigh.

Then the recommendation and why, and what the choice constrains or depends on among the other
decisions.

Each decision takes two steps, and neither is the other:

1. **Render the options, their assessments and the recommendation in the message body**, laid out
   so the options can be compared against the same axes.
2. **Then gate** that decision with the `question` tool, before moving to the next.

Record what was settled in the session `state` as it is settled.

### Phase 4: Operational architecture

Deployment, monitoring, failure modes, data lifecycle, security boundaries. Not every concern
applies; skip what does not. Some of these become decisions of their own and go back through
Phase 3; the rest is context that sharpens decisions already taken.

**Perspectives**: follow the shared **Perspectives** procedure — two or three agents on what breaks
in production and how anyone would know.

### Phase 5: Dependencies

1. **Render the decisions as a set in the message body**: which constrain which, which must be
   taken first, which are independent.
2. **Then gate**, flagging any cycle or conflict, and work it through with the user.

### Phase 6: Record the decisions

One ADR per decision, and each one takes two steps before any row exists:

1. **Render the ADR in the message body**, from what the phases settled — its context, the options
   with the reasoning for each, the decision, and the consequences.
2. **Then gate**, with the `question` tool: "Approve this decision?" with `Approve` /
   `Request changes` / `Stop`.

On approval, write it:

1. `dpm_create_adr` with the resolved parent as `parent_id`, a short kebab-case `slug`, a
   `title`, and the choice in one sentence as `decision`.
2. Its context and its consequences as `dpm_create_document_section` rows against the id it
   returned, with headings and `position`: *Context*, *Consequences*.
3. Each option as `dpm_create_adr_option` with `name`, `position`, and the reasoning as
   `rationale` — the rejected options carry theirs too, which is what makes the record worth having.
   `chosen` goes on the one taken.
4. Each assessment as `dpm_create_adr_option_tradeoff` with the option, the `axis` and the
   `assessment`.
5. `dpm_update_adr` setting `decision_status` to `accepted`.

**The order matters and the tool enforces it.** An accepted ADR has exactly one chosen option, so
the status is written last — an ADR has no options at the moment it is created, and a second
`chosen` is refused rather than stored. `decision_status` also has values for a decision that has
not settled: leave one `proposed` where the user is not ready, and `rejected` records that the
question was asked and answered no.

**The axes are rows, not a layout.** Each assessment is its own row keyed by option and axis, which
is why the same axes can be compared down a column. Do not format a table — the projection renders
one from the rows.

Then the relationships from Phase 5: `dpm_create_dependency` with `kind: 'constrains'`, the
constraining decision as `source_document_id` and the constrained one as `target_document_id`. Check
the kinds available with `dpm_list_dependency_kind` rather than assuming this list is current.

**Write nothing until the decision is approved.** A half-written ADR is one a later run will read
back as settled, and nothing on it says which of its options were real.

#### Revisiting a decision

When a decision replaces an earlier one, **render both in the message body first** — the decision
being superseded and the one replacing it, with the reasoning that changed — and gate on that.
Superseding is not a correction to be applied quietly; it is the decision.

On approval, three calls in this order: `dpm_create_adr` for the new decision, then
`dpm_create_dependency` with `kind: 'supersedes'`, the new ADR as `source_document_id` and the old
one as `target_document_id`, then `dpm_update_adr` moving the old one's `decision_status` to
`superseded`.

**The edge comes before the status, because the old decision is only findable through it.** A
superseded ADR with nothing pointing at it is a decision a reader can see was abandoned and cannot
see what replaced it — which is the state the integrity register reports, and writing the edge is
what stops it being created. Do not edit the old ADR's prose to say it was superseded: the status
is a column and the replacement is an edge, and a sentence saying so is a third copy that will
disagree with them.

## Output

There is no file to save. An ADR renders inside the document it hangs off — its options, their axes
and its prose all in place — and the projection decides where that is.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without, and an ADR has no number of its own to build one from.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

For `architect` the artifact is a decision map: the ADRs as one connected set, drawn from the
`constrains` and `supersedes` edges — so the decision everything hangs off is visible, and so is the
one nothing references. A single ADR cannot show that, because the relation lives between them. If
you cannot write the one-line justification for what the visual carries that the prose cannot, it
has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to the parent document — so the
rows never claim a visual a reader cannot reach.

### After the decisions

- `dpm-spec` to build requirements with these decisions as architectural context
- `dpm-epics` where a spec already exists and needs aligning to them

## Guidelines

- **Facilitate, let the user lead.** Present analysis, not prescriptions.
- **Explore before proposing.** Understand what exists before suggesting what should.
- **Product-derived decisions.** A decision that cannot name its driving requirement is boilerplate.
- **Honest trade-offs.** Every option carries its genuine costs, including the one recommended.
- **Operational architecture is architecture.** Deployment, monitoring, failure and security get the
  same rigour as structure.
- **One decision at a time** in Phase 3, and one gate per decision in Phase 6.
