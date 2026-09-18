---
name: dpm-spec
description: Build a structured requirements and architecture specification through facilitated conversation. Takes a problem brief, a product brief or a user description as input and records requirements with their class and priority, architecture decisions, scope boundaries, and a testing strategy as typed rows. Run with /dpm-spec.
thinking: medium
phases: recap functional nonfunctional environment decisions scope vocabulary criteria integration reconcile present review
---

# Requirements & Architecture Specification

Build a spec through facilitated conversation, one gated section at a time.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Perspectives**, **Conversational Output**, **Written
Deliverable Length**, **Cross-References** and **Artifact Publishing** from it.

## Input

Resolve the starting context in this order.

1. If the request names a document — a ULID, or a human reference as another skill printed it —
   read that document. A reference goes through `dpm_resolve_reference` first,
   which returns the row it names or refuses; a ULID is already the id and needs no resolving.
2. If the request is a description, use it as the starting context.
3. Otherwise offer what the project already holds, product briefs first because they carry vision,
   value and constraints already argued over:
   - `dpm_list_product_brief` — offer the results with the `question` tool, showing each title.
   - If there are none, `dpm_list_problem_brief` and offer the most recent.
4. If neither returns anything, ask the user to describe what they want to build.

An empty database gets step 4, which is the expected first run rather than a failure.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:spec'`, putting the section about
to start in `phase` and moving it on as each section is approved.

**On a resume, the rows say what is written** — the Session Startup rule. A section's rows are
written when it is approved and `phase` moves after, so a stop between the two leaves a section
written and still recorded as the one to do. Before proposing a section again, list what it writes:

- `recap` — `dpm_list_document_section` with the spec's id as `document_id`, and `dpm_list_dependency` with it as `source_document_id`;
- `functional`, `nonfunctional`, `environment` — `dpm_list_requirement` with `spec_id` and `include_body`, since the text is how a written requirement is told from a proposed one;
- `decisions` — `dpm_list_adr` with the spec as `parent_id`, then `dpm_list_adr_option` with `adr_id` for each ADR;
- `scope`, `integration` — `dpm_list_document_section` with the spec's id as `document_id`;
- `criteria` — `dpm_list_acceptance_criterion` with `requirement_id` and `include_body` for each requirement, then `dpm_list_criterion_approach` with `criterion_id` for each criterion.

### Roster

`dpm_list_agent` with `include_body`, for **Perspectives** in Sections 4 and 5. The traits are
body columns, so without it the roster arrives as names and roles. Use only what the row carries.

### Library

Follow the shared **Library Check** procedure with scope keyword `spec`. Carry what it returns into
Sections 4 and 5, where decisions meet recorded standards.

### Prior decisions

`dpm_list_adr`, then `dpm_read_adr` on each — the list carries identity and the read
carries the decision, and Section 4 references what was decided rather than what it was called.
Summarise: "Found {N} existing decisions: {titles}. I'll reference these in Section 4 and only
facilitate the gaps." If there are none, Section 4 facilitates from scratch.

### Constraint inheritance

Constraints are captured once, in the problem brief, and Step 3a facilitates only the gaps.

1. If the resolved input is a problem brief, that is the source.
2. If it is a product brief, `dpm_list_problem_brief` and **ask which one this brief came from**.
   Do **not** substitute the most recent — recency answers a different question, and the two
   diverge the moment a project has more than one line of work. An empty list means there is no
   problem brief, which is not an error.
3. `dpm_list_document_section` on the resolved brief with `include_body` and read the section
   headed *Constraints*, along with the context and consequences of any decision bearing on the
   environment. The heading is what the listing returns by default; the constraints are in the body.
4. Carry both into Step 3a as entries already known.

**The product brief is a waypoint, not the source** — its constraints are derived and lossy by the
time features have been argued over. Reach past it.

### Retro awareness

Follow the shared **Retro Awareness** procedure. Where a lesson is incorporated, it routes by
category:

- **Criteria gaps** inform Section 2 and Step 6b.
- **Scope surprises** inform Section 5 — surface the boundary that caused the surprise.
- **Testing gaps** inform Section 6 — an untestable criterion gets rewritten or raised to an
  integration boundary.
- **Patterns worth reusing** inform Section 4.

### Codebase grounding

Explore the existing code before facilitating requirements — structure, dependency manifests,
conventions — and propose requirements that build on what is there.

## Process

Gate each section with the `question` tool. Approving one moves to the next; Section 7's approval
ends the run. Each section converges in one or two rounds.

**A step that records rows carries its own gate**, also with the `question` tool, because the rule
above reaches sections and a step inside a section is not one. Work through such a step one item at
a time, one gate per turn. A rendered proposal is not an approved one, and a turn that ends on one
has recorded nothing and asked nothing.

**Every one of those gates is two steps, and the first one is the one that gets dropped.** Render
what is being decided in the message body; *then* call `question` with the decision alone. The
failure has no error in it — a gate arriving with nothing above it reads as a run awaiting an
answer, while the user is being asked to approve something they have not been shown.

Where the user needs information the session does not hold, note the gap, carry on, and raise it at
Section 7. Where they cannot decide after one clarification round, offer a recommended default; if
they still cannot, record both options and move on — **except in Step 3a**, which blocks.

### Section 1: Problem recap

Two steps, as every gate in this skill is:

1. **Render the problem recap in the message body** — the problem, who has it, and what a solution
   would change — as the section will read.
2. **Then gate** with the `question` tool. From a brief this is quick: the recap is the brief's, and
   what is being confirmed is that nothing has changed.

On approval, agree a title and a short kebab-case slug and call `dpm_create_spec` — that call
assigns the number, which nothing here works out. Everything after hangs off the id it returns,
starting with the recap as a `dpm_create_document_section` row.

If the input was a brief, record the lineage with `dpm_create_dependency`: `kind: 'builds_on'`,
this spec as `source_document_id`, the brief as `target_document_id`. A spec takes no parent, so the
lineage is an edge.

### Section 2: Functional requirements

Facilitate what the system must do, prioritised: **must have** (without which it fails), **should
have** (important, works without them), **could have** (if time allows), **won't have** (ruled out
this iteration).

Give each requirement its `FRn` label as it is agreed, numbered once across must, should and could
rather than restarting under each — the label is what the user refers to for the rest of the
session.

The draft is two steps, and the first is the one that gets dropped:

1. **Render the requirements in the message body**, every one of them, grouped under must, should,
   could and won't, each with its `FRn` label and its full text as it will be recorded.
2. **Then gate** with the `question` tool. Refine in the body and re-render; a gate arriving with
   nothing above it is asking the user to approve a set they have not been shown.

Each agreed requirement is one `dpm_create_requirement` call:

- `class` is `functional` here, and is **an argument, never inferred from the label**. `FR1` is a
  display string beside the row; the value passed is what makes the row functional.
- `moscow` is `must`, `should`, `could` or `wont` — a value, not a heading it sits under.
- `text` is the requirement, `position` its display order, `spec_id` the document.
- A requirement refining another passes `parent_id`. `FR1a` under `FR1` is a row pointing at a row.

**Every won't-have carries `exclusion: 'deferred'` or `'out_of_scope'`, and is refused without
one.** The band says the requirement is out of this release; the exclusion says which decision put
it there — deferred to a later one, or ruled out of the product. A spec run wrote "Deferred: a
`--year` filter, a machine-readable output option" into its scope-boundary section and left the
column NULL on every row, so the reason was on record twice in prose and in no place a check reads.
Nothing else is demanded: a could-have with no exclusion is undecided rather than wrong, and stands
as a warning until somebody settles it.

### Section 3: Non-functional requirements

Cover only what applies — performance, security, scalability, reliability, usability.

1. **Render the non-functional requirements in the message body**, each with its `NFRn` label and
   its full text as it will be recorded. Where none apply, say so in the body and say why, rather
   than gating on an empty set the user cannot see.
2. **Then gate** with the `question` tool.

Each agreed one is a `dpm_create_requirement` call with `class: 'non_functional'`.

#### Step 3a: Environmental constraints

**This step is not skippable.** It runs on every spec and ends in either recorded entries or an
explicit "none apply" — a spec that was never asked is indistinguishable from one whose target has
no constraints, and it is the first that ships a fully verified coverage set over software that
cannot run where it has to.

Cover both environments and both classes:

| | **Requirement** — must be available | **Restriction** — must not be required |
|---|---|---|
| **Development** | test runner, browser automation, language version, test data, CI that runs the suite, stubs for external services | tooling a contributor cannot install |
| **Production** | runtime version, hosting model, services the host provides | anything the host cannot supply |

The two classes are not two phrasings of one thing: "Pest is available" is satisfied by installing
something, and "must not require a queue worker" invalidates a design.

Ask about **development tooling explicitly**, not only production — on a greenfield project there
is no manifest to infer it from, and what is captured here drives the installation. **This is the
only place test tooling is captured**; Step 6d reconciles against it and records nothing.

**Which environment an entry names decides its approach tag.** A development entry is a claim about
the machine the work happens on, so an ordinary automated tag fits. A production entry is a claim
about a host nobody here has, so it takes `target`. The class does not enter into it — tagging a
development entry `target` makes it unverifiable by the only thing positioned to verify it.

**Every entry states a condition something can check.** "PHP 8.2 or later on the host" is
checkable; "the environment should be modern" is not. An unfalsifiable entry is worse than a
missing one, because it is recorded and then marked delivered by whoever decides it feels
satisfied. **Refuse it, and name which entry**: say what about it cannot be checked and offer the
checkable form. That is a refinement round, not a rejection of the concern.

**Fail closed.** An entry that cannot be made falsifiable, or belongs to neither class, is reported
and **blocks this step**. Never dropped, never silently reclassified, never recorded without its
class.

**Gate the entries before recording them**, in two steps:

1. **Render the entries in the message body**, each with its class, so what is being approved is a
   readable list rather than a count.
2. **Then gate** them with the `question` tool. An entry refused above comes back through the same
   gate in its checkable form.

Record each as `dpm_create_requirement` with `class: 'environmental_requirement'` for something that
must be available and `class: 'environmental_restriction'` for something that must not be required,
so the roll-up traces them as it traces the others.

### Section 4: Architecture decisions

**When decisions already exist**: render each one's choice, rationale and consequences in the
message body, then ask whether they still hold for this spec's scope; then identify the **gaps**
and facilitate only those. **When none exist**: facilitate from scratch, capturing for each
decision what was chosen, why, and what else was evaluated.

Either way, each decision is agreed in two steps:

1. **Render the decision in the message body** — the choice, the options weighed against it, and
   the reasoning on each — before anything is recorded.
2. **Then gate** it with the `question` tool. The rejected options are part of what is shown: a
   decision presented as a single choice gives the user nothing to decide.

Cover as relevant: stack and framework, data storage, key integrations, deployment model, major
structural patterns.

Each decision is `dpm_create_adr` with `parent_id` set to this spec — a decision is a child
document of the artefact that raised it. Its `decision` is the choice in one sentence. Each option
is `dpm_create_adr_option` carrying its reasoning as `rationale`, with `chosen` on the one
taken, and each axis they were weighed on is `dpm_create_adr_option_tradeoff`. The rejected
options carry their reasoning too — a decision that records only the choice records no decision.

**A settled decision is accepted last**, by `dpm_update_adr` setting `decision_status` to
`accepted`. An ADR is created `proposed`, because at the moment it is created it has no options and
an accepted one has exactly one chosen — a rule the tool enforces rather than reports. So the order
is the ADR, then its options, then `decision_status`.

**Perspectives**: before presenting each major decision, follow the shared **Perspectives**
procedure — two or three agents whose expertise bears on it.

### Section 5: Scope boundary

Consolidate what is **in scope**, what is **explicitly out of scope**, and what is **deferred**.
Then, before recording it:

1. **Render the three lists in the message body**, item by item.
2. **Then gate** the boundary with the `question` tool.

This is the section where a spec grows past what anyone intended, and the gate is what stops it —
which it can only do if Step 1 put the boundary somewhere the user could read it.

Record the three with `dpm_create_document_section`. A requirement that turns out to be out of
scope takes `exclusion` on its own row rather than moving into prose here.

**Perspectives**: before finalising, follow the shared **Perspectives** procedure — two or three
agents on keeping scope tight, on foundational work, and on dependencies that force items in.

### Section 6: Testing strategy

#### Step 6a: Confirm the vocabulary

`dpm_list_test_approach` returns the approaches this project recognises, each with its meaning.

1. **Render them in the message body**, each approach with the meaning the tool returned, so what
   the user is adjusting is a readable list rather than a count.
2. **Then gate** with the `question` tool, and let the user adjust.

`target` is not a weaker `manual`. The check *is* mechanical; only the environment is missing.
Self-assessing one from a development machine — confirming "runs on PHP 8.2 or later" on a machine
where it does — is the false pass it exists to stop.

#### Step 6b: Give each requirement a criterion and a tag

For each must-have functional requirement **and each non-functional requirement**, propose
acceptance criteria and an approach for each. Work through them one at a time, one gate per turn,
and each turn is two steps:

1. **Render one requirement's criteria, approaches and must-not clauses in the message body**,
   together, with the requirement's own text above them so the two can be compared.
2. **Then ask** with the `question` tool, before taking up the next requirement.

**Default to automation.** Boundary-crossing is `integration`, isolated logic is `unit`, a
user-visible workflow is `feature`. Propose `manual` only where automation is genuinely infeasible,
and say in one line what blocks it.

**Refuse a criterion too vague to tag, and say which one.** A criterion nobody can check is worse
than a missing one: it is recorded, and then it passes on somebody's impression. Name it, say what
about it cannot be checked, and offer the checkable form.

**A requirement with no criterion is admissible here and blocking downstream.** The one most likely
to land there is phrased as an absence — *no dependencies*, *never mutates X* — because there is no
artefact to point at. Give it an observable: a check that the absence holds is a criterion; the
absence itself is not.

**Probe for must-not clauses.** Carry the question into that requirement's gate: "are there
behaviours this allows that you would reject?" A rejected behaviour is its own criterion with
`polarity: 'must_not'` — a value on the row, not the words "must NOT" at the front of the text.

**A must-not criterion's text names the rejected outcome as though it happened.** The spec document
writes "must NOT — " in front of it, so the text supplies only what is rejected:

- *a raw stack trace reaches the user* reads "must NOT — a raw stack trace reaches the user";
- *tally does not print a stack trace* reads as a double negative;
- *tally print a stack trace*, with "must not" cut from the middle, reads as neither.

Each criterion is `dpm_create_acceptance_criterion` under its requirement, and each approach is
`dpm_create_criterion_approach` naming the criterion and the tag. A criterion verified two ways
carries two of them.

#### Step 6c: Integration boundaries

Identify the seams between components — contracts, event shapes, data flows — from the decisions
recorded in Section 4. These are where integration coverage belongs.

1. **Render the seams in the message body** and refine them there.
2. **Then gate** with the `question` tool, and record with `dpm_create_document_section`.

#### Step 6d: Reconcile the tags against the constraints

The tags just assigned imply tooling: `feature` implies something that drives an end-to-end run,
`integration` a way to stand up a boundary, `tdd` a runner fast enough for a red-green loop.

For each kind implied, check Step 3a recorded a constraint for it. **Where one is missing, go back
to Step 3a and record it there.** **Record nothing here** — Step 3a is the single capture site, and
this is a check rather than an elicitation only because Section 3 ran before the tags existed.

**Everything this step adds is development tooling, so none of it is `target`.** A runner, a
driver, test data and a CI job are claims about the machine the work happens on; routing them to
`target` makes a spec's own tooling permanently unverifiable.

#### Step 6e: Present and refine

1. **Render the complete strategy in the message body** — the tagged criteria, the boundaries, and
   anything Step 6d sent back to Step 3a — in full rather than as a summary of what was agreed.
2. **Then gate** with the `question` tool, and refine before proceeding.

### Section 7: Review

Two steps, and the second one is not this section's product:

1. **Render the complete spec in the message body**, from the rows just written — read them back
   with `dpm_read_spec`, `dpm_list_requirement`, `dpm_list_acceptance_criterion`, `dpm_list_adr`
   and `dpm_list_document_section`, each list carrying a `limit` above what the spec just wrote,
   and `include_body` wherever the tool takes it.
2. **Then gate**, with the `question` tool: "Approve this spec?" with `Approve` /
   `Request changes` / `Stop`.

Step 1 is the whole of what this section delivers. A run that reaches Section 7 and asks the
question without rendering anything has ended the spec on a gate about a document nobody read.

On approval, `dpm_update_spec` sets `status` to `complete`. On *Request changes*, return to the
section the change belongs to and leave the status alone.

**Read the rows, not the rendered document.** A value that never reached a row renders as an
absence, and an absence reads as a section that was not needed.

**A withheld column reads exactly the same way, which is why the render asks for one.** A
requirement's `text`, a criterion's `text` and a section's `body` are withheld by default, so a
review rendered from a read that did not ask for them is every label, every count and every heading
the spec has, with nothing underneath any of them — structurally complete, and saying nothing a user
could approve.

## Output

There is no file to save. The spec is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without, and it is wrong the moment the projection moves where a kind renders.

Write the sections that carry prose — the problem recap, the scope boundary, the integration
boundaries — with `dpm_create_document_section`, each with its heading and position. Everything
else is already a row: requirements, criteria, approaches, decisions, options.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

### Companion visuals

Where a requirement is inherently visual — a screen, a layout, a flow that words only approximate —
a self-contained HTML companion may be generated and published alongside the spec. Generation is
driven by the requirement's nature, never by a flag, and the visual has to earn its place: state in
one line what it carries that the prose cannot, and if that line cannot be written, do not generate
it.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this spec — so the rows never
claim a visual a reader cannot reach.

### After the spec

- the `dpm-epics` skill to break the spec into epics, stories and tasks (recommended)
- the `dpm-architect` skill where the decisions are non-trivial and Section 4 only scratched them

## Guidelines

- **Facilitate, then let the user decide.** Present options and trade-offs; the user owns the call.
- **One section at a time**, and match depth to complexity.
- **Build on what exists** — a brief, prior decisions, the code.
- **Every value is an argument, never a formatted string.** A class, a priority, a polarity and an
  approach are each a column. The moment one becomes a prefix on some text, whatever reads it next
  has to parse it back out — and a parse that can misread is a parse that will.
- **Refuse rather than record something nobody can check.** Step 3a and Step 6b both turn on this.
- **Correct yourself sparingly**, per the shared convention.
