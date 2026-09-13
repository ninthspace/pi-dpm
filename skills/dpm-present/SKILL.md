---
name: dpm-present
description: Audience-aware transformation of planning rows into communications. Takes one or more documents as sources, gates audience then format then draft, and produces derived content — published as a shareable page whose link back to its sources is a row. Regenerable, because the sources are an edge rather than a line of prose. Run with /dpm-present.
thinking: medium
phases: sources audience format draft record
---

# Audience-Aware Transformation

Turn planning rows into something a reader outside the project can open. The content is **derived**
from its sources and never written from scratch, and the same sources support several
communications — an executive memo and an onboarding guide are different reframings of one set of
rows, not different documents.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Conversational Output**, **Gate Presentation**, **Written Deliverable Length**,
**Cross-References** and **Artifact Publishing** from it.

## Input

The request is either a description of what to communicate, which guides source selection below, or
nothing, in which case the selection starts from the whole corpus.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:present'`.

**`state` holds the source ids, the audience and the format**, because each is a gate the user
passed and re-asking is the one failure a resumed run can produce without noticing. It does not hold
the draft: the draft is derived from the three, and a copy in the blob is a second answer that goes
stale the moment a source moves.

### Library

Follow the shared **Library Check** procedure with scope keyword `present`. Brand guidance and
glossaries bear here more than in any other skill — this is the skill whose output leaves the
project, so a house style or a preferred term is read **before** the draft rather than applied to it
afterwards.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated: a lesson about how something was communicated shapes the audience gate below. Most
categories have nothing to route to here, and a lesson that cannot be turned into a choice this
skill offers is one to leave.

## Process

### 1. Select the sources

The corpus is queried, one call per kind the selection could plausibly draw on:
`dpm_list_spec`, `dpm_list_epic`, `dpm_list_problem_brief`,
`dpm_list_product_brief`, `dpm_list_adr`, `dpm_list_retro`,
`dpm_list_review`, `dpm_list_quick` and `dpm_list_audit`. **Pass a `limit` above
what the project plausibly holds** — a source the user would have chosen but never saw offered is
indistinguishable, from inside the run, from one they declined.

Present them grouped by kind and let the user multi-select. A communication usually draws on more
than one: a spec for what was decided, its epics for what was built, a retro for what it cost.

Read the chosen ones with `dpm_list_document_section` and
`dpm_read_document_section`, passing `include_body`. Without it a section returns a heading
and no text, and a draft derived from headings alone is a table of contents with confident prose
around it.

**Hold the source ids.** They are the input to every step that follows and the thing written down at
the end.

### 2. Gate the audience

Offer, and let the user choose before the format is discussed:

- **Executive** — outcome-focused, assumes no technical knowledge, leads on value, risk and the
  decisions being asked for.
- **Client** — external-facing, covers what is being delivered and why it matters to them, and
  carries no internal process.
- **Technical stakeholder** — peers who understand technology but are not in the code: architecture,
  trade-offs and the decisions behind them, without implementation detail.
- **Team onboarding** — context for someone arriving: what exists, why it is arranged this way, and
  where to start.
- **Custom** — the user describes it. Ask what they know, what they care about, and what tone fits,
  before moving on.

### 3. Gate the format

Then, and not before — the format that suits an executive is not the one that suits an onboarding
reader, so offering both at once asks the user to hold two decisions that only make sense in order.
Say which formats fit the audience just chosen, and offer:

- **Summary memo** — one or two pages. Executives and clients.
- **Status update** — done, in progress, blocked. Stakeholders and team leads.
- **Presentation outline** — slide headings with the points under each. Executives and clients.
- **Changelog** — what changed and why, in order. Technical stakeholders.
- **Onboarding guide** — the long one. New team members.

### 4. Derive the draft, and gate it

Write the content **from the sections read in step 1**. Every claim, number, status and decision
traces to one of them; nothing arrives from outside them, and a gap in the sources is reported as a
gap rather than filled in.

Reframing is the work. Language and depth follow the audience; structure follows the format. A draft
that reproduces a source's own headings in its own order has transformed nothing, and is the shape
to watch for when the sources are good — a well-written spec is the easiest thing in the world to
lightly reword.

1. **Render the full draft in the message body** — all of it, as the audience will read it.
2. **Then gate** it with the `question` tool: approve, request changes, or stop.

Follow the shared **Gate Presentation** convention — the draft goes in the body, and the question
carries only the decision. A draft this skill never rendered is one the user is being asked to
approve on the strength of the fact that a tool call happened.

### 5. Record it

**A communication becomes durable by being published, and its sources are rows on the way there.**
Follow the shared **Artifact Publishing** procedure: it is separately confirmed, and never assumed
from the draft having been approved.

Before offering, ask whether one already exists. Call `dpm_list_artifact_document` scoped by
`document_id` for each source and take the artifacts common to all of them; `dpm_read_artifact`
gives each one its `title` and `url`. Where one comes back, **offer update-in-place** — republish to
its recorded URL and `dpm_update_artifact` for the `title`, the `description` and
`published_at`. Minting a second artifact from the same sources leaves every link already shared
pointing at a copy that will not be updated again, and the person holding that link has no way to
find out.

**The artifacts common to every source, not the ones any source has.** A source that appears in an
earlier communication alongside different company is a different communication, and offering to
overwrite it is the same mistake as minting a duplicate, made in the other direction and over
someone else's work.

Where none comes back, `dpm_create_artifact` with the `url`, `title` and `description`, then
one `dpm_create_artifact_document` per source.

**Write the join, always.** It is what makes this run findable by the next one, and it is why a
source that has been deleted fails here rather than surviving as a link a reader follows into
nothing. The index of what has been published and the backlinks inside each source are both renders
of these rows, so the two cannot disagree.

**Where publishing is declined or refused, the draft is kept as a `communication`.** Call
`dpm_create_communication` with the title the draft was gated under, then one
`dpm_create_document_section` per section of it, each with its `heading`, its `body` and its
`position`. Say that it was stored and not published — a run that ends quietly reads as one that
did neither. This is the case to expect when a communication presents itself as issued by an
organisation the user does not represent: keep it local, do not offer publishing, and do not look
for another way to put it somewhere.

**A communication takes no parent, and an unpublished one has no source join.** An audience is not
a lineage, and `artifact_document` hangs off an artifact that this branch deliberately does not
write. The source ids stay on the session `state` where step 1 put them; they are not recorded as
an edge, and the honest answer to "what was this drafted from" for a local communication is that
the run said so in conversation.

**Never write an `artifact` row for a communication that was not published.** `url` is the
artifact's identity, so recording one means inventing a URL — a placeholder, a `pending` marker, a
repository path that is not a link — and every one of those is something a reader will click. The
absence of an artifact is how the corpus says this was never published, and it says it only while
nothing fills the gap.

## Degradation

| Missing | Behaviour |
|---|---|
| The corpus is empty | Say so and stop. There is nothing to derive from, and a communication written without sources is the one thing this skill does not do. |
| A chosen source has no sections | Report it by name and offer to continue without it. Do not pad the draft to cover the hole. |
| The Artifact tool is absent | Say so, and take the local branch: the draft is stored as a `communication`, and no artifact row is written because there is no URL for one to carry. |
| An existing artifact's URL no longer resolves | Report it and let the user decide between republishing to it and starting a new one. Do not silently mint a second. |
| A source was deleted after selection | The join write fails as a foreign-key error. Say which source, and re-run step 1 rather than dropping it. |

## Output

The draft in conversation, and then one record or the other. On publication, an `artifact` row with
one `artifact_document` per source and **no document row**: the page at the URL is the
communication, and a second copy of its content in `document_section` goes stale the moment a
source moves — which is the same reason the sources are an edge and not a list of paths written
into the text. Where publishing was declined, a `communication` document and its sections, and no
artifact.

**The two are exclusive, and which one exists is the answer to whether this went out.**

## Next Action

After publishing, offer — do not run — `dpm-present` again for a second audience over the same
sources, which is the cheap case this design exists for, or `dpm-artifact` to review what the
project has published and to whom it points.
