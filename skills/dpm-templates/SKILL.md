---
name: dpm-templates
description: Template discoverability. Lists every document kind this project can hold, with where its file lands and how it is numbered, and renders an example of any of them so the format can be read before anything is written. Run with /dpm-templates.
thinking: off
---

# Template Discoverability

Every document dpm produces is rendered from the database by one template per kind. This skill makes
those templates readable: what the kinds are, where each one's file lands, and what one looks like.

**A preview is a render, not a description.** `dpm_preview_document_kind` builds an example
document of the kind and returns the bytes its own template produces. So a preview cannot be out of
date, and this file carries no copy of any format — a format written down here would be right the day
it was written and silently wrong after the next template change.

**It opens no session, consults no library and reads no retro.** Every action is one read and a
message; there is no step to resume, and nothing a project writes down changes what its own renderer
produces.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Conversational Output** from it.

**No session**: both actions are one read and one render, and neither carries anything from the
call before it. There is no phase to move on and no state to accumulate, so a run has nothing a
later one could adopt.

## Input

The request selects the action:

- **Nothing**, or **`list`** — list every kind. Read-only.
- **`preview {kind}`** — render an example of that kind. Accept the kind with or without a `dpm:`
  prefix, and match it against what `dpm_list_document_kind` returned rather than against a
  list held here.
- **Anything else** — say what the two actions are and stop.

## List

`dpm_list_document_kind` with a `limit` above what the project plausibly holds, then a table:

| Kind | Output | Numbered |
|---|---|---|

- **Kind** is `kind`, which is also what `preview` takes.
- **Output** is `dir`. **A kind with no directory has no file of its own** — it renders inside its
  parent, and previewing it is the only way to see the block a parent splices in.
- **Numbered** is `numbering`: `root` means unique across the project, `child` means unique within
  one parent.

**The kinds come from the tool, never from this file.** A project that has seeded a kind the plugin
never shipped is listed here with everything else; a list written down here would omit it and there
would be nothing to notice.

## Preview

`dpm_preview_document_kind` with the `kind`. It returns the rendered markdown, and the `path`
the example would have been written to — which is how the naming convention is shown rather than
stated. Print both, and say the example is generated: a reader who takes it for a real document of
theirs will go looking for it.

**The example carries both sides of anything the template renders differently** — a must and a
must-NOT criterion, a chosen and a rejected option, a met and an unmet check. That is a property of
the example rather than of this skill, and it is why a preview is worth reading in full.

## There is nothing to override

**Every template is fixed, and no project-level file replaces one.** When asked to customise a
format, say so and say why rather than writing a file that will not be read.

The reason is the projection, not a policy about customisation. Every rendered file is generated
whole from rows and is never read back, and the pre-commit guard regenerates and compares bytes — so
a template a project edited on disk would either be overwritten on the next projection or fail the
commit as divergence. An override needs the renderer to read a file before it writes one, which is
the one thing it may not do.

Offer what does work instead: a house style belongs in a library document, which every skill reads at
startup, and which changes what gets *written* rather than how it is rendered.

## Degradation

| Missing | Behaviour |
|---|---|
| The kind named is not one this project holds | Say so, and list the kinds. Do not guess at the nearest match — previewing the wrong format silently is worse than an error. |
| The kind exists but has no example | Report it as that, and list the ones that do. The kind is real; the plugin ships no example for it. |
| `preview` was given no kind | List the kinds and ask which. This is the one place a question is worth a round trip. |

## Output

**Nothing is written.** Both actions are a read and a message — no document, no session row, no file.

## Next Action

Nothing follows. Offer the skill that writes the kind just previewed, where there is an obvious one,
and otherwise stop.
