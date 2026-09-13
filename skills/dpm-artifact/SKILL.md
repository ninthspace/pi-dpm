---
name: dpm-artifact
description: The register of published artifacts and the work they came from. Records what a page is, why it was made, and which documents it was published from, so a URL produced weeks ago can be found, reviewed and amended rather than rebuilt. Run with /dpm-artifact.
thinking: off
---

# Artifact Register

A published artifact is a hosted page whose only handle is a URL. Unregistered, that URL exists in
the transcript of the session that made it and nowhere else — which is why a page produced three
weeks ago is effectively lost while still being live.

**The register is rows, and it has two readers.** One asks *"what have we produced?"* and reads the
project-wide register; the other asks *"what came out of this work?"* and reads the **Published
Artifacts** table at the foot of a source document. Both are rendered from the same `artifact` and
`artifact_document` rows, so there is nowhere for them to disagree — which is the whole of what this
skill is for, and the reason it writes neither.

**It opens no session.** Every action here is one bounded read and one bounded write; there is no
step to resume, and a resumable run that cannot be resumed is worse than none.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Conversational Output**, **Gate Presentation** and **Cross-References** from it.

## Startup

Follow the shared **Library Check** procedure with scope keyword `artifact`. A naming convention or
a house style bears on what an entry is called, and this is the collection whose names leave the
project.

**No session**: each action here is one write — register an entry, or retire one — settled in the
call that makes it. There is no accumulated state a later run could adopt, and a session row opened
for a single write is one more thing to close than the work itself.

**No retro awareness.** A lesson changes how work is done; a register entry is a record of what was
published, and there is nothing in it for a lesson to inform.

## Input

The request selects the action:

- **A URL** — register it. Any text alongside is taken as the description and an association hint.
- **`list`** — print the register and stop. Read-only.
- **Nothing** — show the register and offer to add, amend or retire an entry.
- **Anything else** — a search term. `dpm_list_artifact` with a `limit` above what the project
  plausibly holds and `include_body`, then match the term against title and description over the
  rows returned — `description` is withheld by default, so without it the match runs against titles
  alone and reports the miss as an absence.
  **That is a scan, not a query, and it is worth saying so**: the search index does not cover this
  table, so the match happens in the run. Honest at a register's size and not at a corpus's.

## The four facts

Every entry records four things, and **none of them is ever invented — ask**:

1. **`url`** — the address. Without it there is no entry to make.
2. **`title`** — what it is, in a few words. Where the page can be read, **propose its own title and
   confirm it** rather than assuming: a page's title is often not how its author would describe it.
3. **`description`** — one sentence on why it was made and who it was for. This is the field that
   makes an entry worth having; a URL and a date do not tell a reader, six weeks later, whether a
   page is worth reopening.
4. **The sources** — the documents it was published from.

For the sources, offer the candidates rather than asking for anything to be typed:
`dpm_list_spec`, `dpm_list_epic`, `dpm_list_problem_brief`,
`dpm_list_product_brief`, `dpm_list_adr`, `dpm_list_review`,
`dpm_list_retro`, `dpm_list_quick` and `dpm_list_audit`, each with a `limit` above
what the project plausibly holds. Multi-select — an artifact drawing on several epics names all of
them.

**An artifact that genuinely stands alone records no sources.** Do not force one. A link to a
loosely-related spec is worse than none, because it sends a future reader to the wrong document.

## Registering

### 1. Resolve before creating

Two questions, in this order:

- **Is this URL already registered?** `dpm_list_artifact` and match on `url`, which is unique.
- **Have these sources already produced an artifact?** `dpm_list_artifact_document` scoped by
  `document_id` for each source, and take the artifacts **common to all of them** —
  `dpm_read_artifact` with `include_body` for the title and description of each.

**Common to all, not held by any.** A source that appears in an earlier artifact alongside different
company is a different artifact, and offering to overwrite it is the same mistake as registering a
duplicate, made in the other direction and over someone else's entry.

Either hit means the same row, updated. One row per artifact.

### 2. Confirm, then write

1. **Render the four facts in the message body**, each named and with its value.
2. **Then gate** them with the `question` tool.

On approval:

- **A new entry** — `dpm_create_artifact` with the `url`, `title`, `description` and
  `published_at`, then one `dpm_create_artifact_document` per source.
- **An existing one** — `dpm_update_artifact` with whatever changed, including the `url` when
  a republish moved it. The row keeps its identity, so every link already shared goes on resolving
  to the entry a reader will find.

**No backlink is written into anything.** The join row *is* the backlink; each source document
renders it. A run that also edited a field into those documents would be recording one relationship
twice, which is the defect this register exists to remove.

**A source that does not exist is a foreign-key failure**, not a broken link discovered later by
whoever followed it.

## Retiring

An artifact that has been superseded or taken down is **retired, not removed** —
`dpm_update_artifact` with `retired_at` and a `retired_reason`. It stops being offered and
stays readable; `include_retired` returns it, and the register renders it struck through with the
reason. A register that silently drops entries cannot answer *"what happened to that page?"*, which
is one of the questions it exists to answer.

**The reason carries the fact the date cannot.** "Superseded by the new explorer" and "the page is
gone" are the same column and different things, and only the second means the URL is dead.

## Degradation

| Missing | Behaviour |
|---|---|
| No artifacts registered yet | Say so. Do not render an empty register — there is nothing to show. |
| The page cannot be read to propose a title | Ask for one. A title is a fact like the others and is not guessed at. |
| The user offers no description | Ask once, and say why the entry is thin without it. Write it if they decline; a URL with no reason still beats a lost URL. |
| A named source does not exist | Say which, and register the artifact without it. A missing association is a smaller loss than a lost URL. |
| Two artifacts share every source | Show both and ask which is being amended. Do not pick the first. |

## Output

An `artifact` row and one `artifact_document` row per source. **Nothing here writes a file.** The
register and the per-document backlinks are both renders of these rows, which is what makes the two
directions structurally unable to disagree rather than kept in step by hand.

## Next Action

After registering, offer — do not run — `dpm-present` for a second audience over the same sources,
or nothing: a register entry earns itself the next time somebody asks what came out of this work.
