---
name: dpm-publish
description: Regenerate the markdown projection and the committed dump from the database, so what is on disk matches what the planning database holds. Names every file that would be removed and asks before removing it. Run with /dpm-publish.
thinking: off
---

# Publish

Bring the generated files into agreement with the database.

Two artefacts are generated and committed: the markdown projection, and the database's committed
text form. Neither is an input — the database is. This skill is what regenerates them, and it is the
command the pre-commit guard sends you to when it refuses a commit, because the guard reports
divergence and deliberately fixes nothing.

**Where either of them lives is not stated here, and that is deliberate.** The record names every
file it touched; a path written into this file would be a second answer to where the projection
goes, and the run that found the two disagreeing would be the one that published into the wrong
place.

**This skill is stateless.** It opens no session. There is nothing to resume: a run either brought
the tree into agreement or it did not, and the answer to a half-finished run is to run it again.

**It writes no file itself.** Every write, every removal and every decision about which is which
belongs to `dpm_publish`. A skill that wrote a file would be a second renderer, and a skill
that removed one would be a second answer to which files no longer belong — and the two answers
would disagree the first time anything was renamed, silently, in the direction that deletes.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output** and **Written Deliverable Length**
from it. It uses **Session Startup** for nothing, being stateless, and neither **Library Check** nor
**Retro Awareness**, because it has no step a documented standard or a past lesson would change.

## Input

What the request names is optional, and is one value.

1. **`preview`** stops after step 1. Nothing is written and nothing is removed.
2. **Nothing** runs the full flow.

Anything else is a misunderstanding worth naming rather than guessing at — say what was passed and
what the two accepted values are.

## Process

### Step 1: What would change

Call `dpm_publish` with `dry_run` set to true.

What comes back is the record the real run would produce: what is new, what would be rewritten, what
already matches, and what would be removed. It is the same call with its last step withheld, not a
separate opinion about it — which is why it can be trusted to gate on.

**If the call raises**, a document could not be rendered. The message names every one of them and
why. Report it and stop: nothing was written, the tree is exactly as it was, and the fix is in the
database or in a template rather than here. Running again changes nothing until one of those moves.

**If nothing would change**, say so and stop. A tree already in agreement is the ordinary outcome
and needs no ceremony.

### Step 2: The removal gate

**If the record names nothing to remove, skip this step entirely.** Writing a generated file is
reversible — the database still holds what produced it, so the next run puts it back. Removal is
not, and it is the only thing here that is not.

**If the record names files to remove**, list them, one line each, and ask before continuing.

Say why each one is going. A removal almost never means someone deleted something: far more often a
document was renumbered, and its old filename is what a renumber leaves behind. That is the case the
gate exists for — the file about to be deleted may be one that was open five minutes ago, under a
name that has since moved, and it looks like loss when it is a rename.

The user's options are to go ahead, or to stop. **Stopping is a complete outcome**, not a failure:
the tree keeps its extra files and the guard keeps reporting them, which is a state someone can look
at again tomorrow.

There is no third option that removes some and not others. What no document produces is not a menu —
a tree holding half the orphans is one nothing describes, and the next run would offer the rest.

### Step 3: Publish

Call `dpm_publish` with no arguments.

**Report what the record says, and nothing else.** The record is the only account of what happened:

- **New** — files that were not there before.
- **Rewritten** — files whose text moved.
- **Removed** — files no document produces any more.

What already matched is a count, not a list. A report that named every unchanged file would read
the same whether the run did everything or nothing, which is the one thing a reader needs it to
distinguish.

**Describe the run, never the database.** It is tempting to say what the project now contains — the
counts are right there — and it is a different claim from what this run did. A tree that was already
current and a tree this run rebuilt are indistinguishable in a description of their contents, and
the second is the one the user asked about.

### Step 4: What to commit

Name the two artefacts — the markdown projection and the database's committed text form — and stop
there. The record already named every file in each, so there is nothing to construct.

**Commit nothing.** Version control is the user's, and a skill that committed would decide on their
behalf what a change was worth recording as. Say what is ready; leave the decision where it lives.

## Output

The files are the output. Report the three groups from step 3, whatever was refused, and the two
artefacts to commit.

## Guidelines

- **The tool writes; this skill asks.** Every file operation is a tool call. There is no step here
  that opens, creates, moves or deletes anything.
- **Preview, then act.** The gate is only worth having because the preview is the same call — a
  check computed some other way would agree with the publish until the run where it mattered.
- **Removal is the only irreversible step**, so it is the only one that gates. Gating on writes
  would train the habit of approving without reading, and then the gate that matters is noise.
- **Report the run, not the contents.** The record is the account. Anything derived from asking the
  database what it holds describes a tree this run may have had no part in.
- **Degrade by saying so.** A refusal, a stopped gate, a tree already current — each is an outcome.
  Report it and finish.
