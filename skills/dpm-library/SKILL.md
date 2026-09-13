---
name: dpm-library
description: Curate a project reference library. Takes in an external document, derives what every other skill needs in order to find it, and records its scope as rows the Library Check filters on. Also consolidates accumulated amendments back into a clean document. Run with /dpm-library.
phases: read:off derive:high write:off gather:off reconcile:high rewrite:off
---

# Project Reference Library

A library document is what a project knows that its planning rows do not say: a coding standard, an
architecture note, a domain glossary. Every skill's **Library Check** reads them, which is what makes
this collection different from a folder of useful files — and what makes its **scope** the only field
that has to be exactly right.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Conversational Output**, **Gate Presentation**, **Written Deliverable Length** and
**Cross-References** from it.

## Input

The request selects the action:

- **A file path or a URL** — intake. Read the source and bring it in.
- **`consolidate`, then a document** — reconcile the amendments that have accumulated on it.
- **Nothing** — ask which of the two, and for the source or the document.

**There is no batch pass over documents missing their fields.** `doc_type` is `NOT NULL` and scope is
a set of rows, so a library document that lacks either cannot exist to be found and fixed.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:library'`.

**`state` holds the action, the source, and the derived fields once confirmed.** Re-deriving them
after an interruption asks the user to approve the same three answers twice, and the second set will
not be identical to the first.

### Library

Follow the shared **Library Check** procedure with scope keyword `library`. This skill reads the
collection it writes to, which is worth doing rather than skipping: a project with a convention about
what belongs here has recorded it here.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated: a lesson about where a document was filed, or about a scope that turned out too
narrow, bears on the scope gate below. Nothing else here routes.

## Intake

### 1. Read the source

A file path is read with the file-reading tool; a URL is fetched. **A source that cannot be read
stops the run** — say which and why, and do not import a placeholder.

Summarise what it covers and how long it is, so the user can tell straight away whether the right
thing was read.

### 2. Derive what the library needs, and confirm it

Five things, derived from the content and **all five presented together before anything is written**:

- **`title`** — what a reader would call it.
- **`slug`** — short, kebab-case.
- **`source`** — where the document came from, for one brought in from outside this project: the URL
  fetched, or the path it was copied from. **Left unset for a document written here**, and that
  absence is the answer rather than a field nobody filled in. A URL is its own provenance and is
  recorded as read; a file path is the case worth asking about, because a file inside the project
  may equally be one the team wrote and one somebody dropped in last year.
- **`doc_type`** — `architecture`, `coding-standards`, `domain`, and so on. It is free text, so look
  at `dpm_list_library` first and reuse a value the project already has rather than minting a
  synonym. Two spellings of one type is the same defect as two words for one scope.
- **The scope**, one value per skill this document bears on, or `all` alone. Suggest from the
  content:

  | Content | Suggested scope |
  |---|---|
  | Architecture decisions, system design, component boundaries | `discover`, `spec`, `do` |
  | Coding standards, style guides, naming conventions | `do` |
  | API contracts, data models, schema definitions | `spec`, `epics`, `do` |
  | Business rules, domain logic, workflow descriptions | `discover`, `spec`, `epics` |
  | Security policies, compliance requirements, access control | `spec`, `do` |
  | Team conventions, process guidelines, collaboration norms | `all` |
  | Glossaries, terminology, domain language | `all` |

**Suggest the scope, then let the user adjust it — do not apply it.** This is the one field whose
error is silent in both directions: too narrow and the document is never loaded by the skill that
needed it, too broad and it is loaded by every skill that did not. Neither shows up as a failure.

1. **Render the five in the message body**, each named and with the value proposed for it.
2. **Then gate** them with the `question` tool: accept, adjust, or stop.

### 3. Write it

On approval, and in this order:

1. `dpm_create_library` with the `slug`, `title`, `doc_type` and, for an imported document,
   `source`. That call allocates the number, which nothing here works out.
2. `dpm_create_library_scope` per scope value — one call each, because scope is a set of rows
   and a document scoped to three skills is three rows.
3. `dpm_create_document_section` with a `Summary` heading at `position` 0, then the source's
   own content as the sections that follow it.

**The summary is written for skills, not for a reader browsing.** Every Library Check triages on it,
so it says what the document *constrains* — "PSR-12, enforced by Pint. Repository pattern for data
access. No inline SQL outside migrations." — rather than what it is about. A paragraph describing
the document is a paragraph nothing can act on.

**Keep the source's own content intact.** One source, one document; sections follow its structure
rather than a shape imposed here.

**Provenance is the column and never a section.** Do not open the document with a bolded source
line, a *Provenance* heading, or a sentence in the summary saying where it came from — each is the
field written into the prose it describes, and a second copy that disagrees with `source` the first
time either is edited. The facts that sit next to it are prose or are already held: the summary is
the section at `position` 0, and when the document arrived and when it was last touched are
`created_at` and `updated_at`.

## Consolidation

Amendments arrive as sections: `dpm-retro` appends one to a library document when an observation
bears on it, headed with the date it was written. They accumulate, and eventually the document says
one thing in its body and something later in an amendment.

### 1. Read what is there

`dpm_list_library` for the document, `dpm_list_library_scope` for its scope, and
`dpm_list_document_section` with a `limit` above what the document plausibly holds, each read
with `dpm_read_document_section` and `include_body`.

Amendments are the sections a retro added; the rest is the body. **If there are none, say so and
stop** — there is nothing to reconcile, and a run that reconciled anyway would rewrite a document
nobody asked it to touch.

### 2. Reconcile

Produce the document as it should now read: the amendments' substance folded into the body, in the
body's own voice. A clean current document, not the original with patches appended.

**Where an amendment contradicts the body or another amendment, surface the contradiction and ask
which way to go.** Do not resolve it quietly. A contradiction is the most valuable thing this pass
finds, and resolving it in silence spends it.

### 3. Write it back

Two steps before any row changes:

1. **Render the reconciled version in the message body**, showing what changed against what is
   there now.
2. **Then gate** it with the `question` tool: save, adjust, or cancel.

Then:

1. `dpm_update_document_section` setting the new `body` on each body section the
   reconciliation changed, and its `heading` where the reconciliation renamed one.
2. `dpm_update_document_section` setting `superseded_at` on each amendment that was folded in.
3. `dpm_update_library` where `doc_type` should change, which also moves the document's
   `updated_at` — the answer to "when was this last reviewed".

**A folded amendment is superseded, never removed.** It stays readable — `include_superseded` on
`dpm_list_document_section` returns it — because it is the record of how the document came to
say what it now says, and a reconciliation that erased its own inputs cannot be checked. What
supersession buys is that the document stops rendering the same material twice: the reconciled body
and the amendment it absorbed are no longer both part of the document.

## Degradation

| Missing | Behaviour |
|---|---|
| The source file or URL cannot be read | Say which and stop. There is nothing to import, and an empty document is worse than none. |
| No `doc_type` fits | Mint one, and say that it is new. A wrong reuse is harder to find later than an extra value. |
| Where the document came from cannot be established | Leave `source` unset and say so. An unset column reads as "written here", which is wrong but recoverable; a guessed URL reads as a citation. |
| The user wants no scope at all | Refuse, and say why: a document scoped to nothing is never loaded, which is the same as not importing it. |
| The document to consolidate has no amendments | Say so and stop. |
| An amendment cannot be reconciled | Leave it un-superseded and name it. A section that still says something the body does not is still doing its job. |
| The library is empty | Intake works; consolidation says there is nothing to consolidate. |

## Output

A `library` document row carrying its `doc_type` and, where it was imported, its `source`; its
`library_scope` rows; and its sections — or, on consolidation, the same
document with its body updated and its absorbed amendments superseded. **What is written is rows, and
the file a reader opens is a render of them** — which is why nothing here constructs a filename, and
why the scope filter every other skill runs is a `WHERE` clause rather than a parse of the file.

## Next Action

After intake, offer — do not run — `dpm-consult` to put the new document to an agent whose domain it
covers, or nothing at all: a library document earns its place by being read on every future run,
which needs no follow-up now.
