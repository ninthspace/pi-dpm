---
name: dpm-clean
description: Remove leftover session rows on demand. Lists every session with its skill, phase and age, marks the stale ones and this session's own, and deletes only the rows the user names. Run with /dpm-clean.
thinking: low
---

# Clean Session State

Remove session rows that outlived the runs they belonged to.

**This skill is stateless.** It opens no session of its own — it is the one that removes them, and a
run recording its own progress would leave behind exactly what it came to clear.

**It is interactive, and no autonomous loop reaches it.** `dpm-ralph` and anything else running
unattended never invokes it. Deletion is irreversible, a session row is the only thing a stopped run
left behind, and deciding which of those are finished is a judgement that has to be made by someone.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output** and **Written Deliverable Length**
from it. It uses **Session Startup** for nothing, being stateless, and neither **Library Check** nor
**Retro Awareness**, because it has no step a documented standard or a past lesson would change.

## Input

What the request names is optional.

1. **Session ids** are the user's selection. They do not skip the inventory or the confirmation — a
   named selection is a convenience, never a licence.
2. **A number of days** replaces the staleness cutoff for this run.
3. **Nothing** runs the full flow at the default cutoff.

## Process

### Step 1: The inventory

Call `dpm_list_session` with a `limit` above what the project plausibly holds and nothing else.
Every row comes back, whatever its age: this skill is the exhaustive counterpart to the staleness
check every other skill runs at startup, and a filter here would make it a second copy of that
instead of the thing it is.

**Leave `include_body` alone.** The blob is a skill's own memory and can run long; the inventory
needs the id, the skill, the phase and the age, and each of those is a column.

**If nothing comes back**, say so and stop. An empty inventory is not a reason to look elsewhere.

### Step 2: Which of them are stale

Call `dpm_list_session` again with `updated_before` set to the cutoff — three days before now,
unless the request said otherwise. What comes back is the stale set, selected by a `WHERE` clause on
`updated_at`.

Mark each row of the inventory:

1. **This session's own row**, whose id is `CPM_SESSION_ID`. Never offer it. It is live by
   definition, and the run that would delete it is the one asking the question.
2. **Stale** — present in the step 2 result.
3. **Superseded** — `superseded_by` is set, so a later session adopted this one and carried its state
   on. That is a finished row whatever its age.
4. **Live** — everything else. Listed, and eligible if the user names it, because a user knows things
   the columns do not.

### Step 3: Ask, then confirm

1. **Present the whole inventory** — id, skill, phase, age and marks, one row each. **Nothing is
   pre-selected.**
2. **Ask which to remove**, by id, or none.
3. **Show the exact rows the selection came to and confirm those.** **Only what is named and
   confirmed is deleted**, and a row that was listed and not named stays.

If the user wants to see what a row was carrying before it goes, `dpm_read_session` with
`include_body` returns its state. This is the last point at which anything can: the blob has no other
home, and after the delete there is no row to ask.

### Step 4: Delete what was confirmed

1. **Call `dpm_delete_session` once per confirmed row, oldest first.** It hands back the row it
   removed, which is what there is left to report it by.
2. **A refusal on one row is not a reason to stop.** Report it and carry on with the rest.

**The order is not presentation.** A predecessor is the row carrying `superseded_by`, so the row
something points *at* is the later one: deleting the live end of a chain while its predecessor
survives is refused, and deleting the predecessor is always allowed. Oldest first — the order the
inventory already came back in — never meets that refusal.

## Output

The rows are the output, by their absence. **Report by disposition**: read the terms from
`dpm_list_taxonomy` in the `disposition` domain and render them in `position` order.
A row this run deleted is gone from the database now; a row the user chose to keep was seen and
deliberately left; and a deletion the database refused is waiting on the reader, carrying the
refusal's own reason and what would clear it.

The refusals are the only part of that report anyone has to act on, and a run that lists them among
the deletions has hidden the one thing it could not do inside everything it did.

## Guidelines

- **Exhaustive, every time.** No age threshold on what is shown and no once-per-run gate — the full
  inventory appears on every invocation. That is the difference between this and the staleness check
  at every other skill's startup, which surfaces only what is past the cutoff and only once.
- **Every id is seen twice before it goes.** Once in the inventory and once in the confirmation.
- **Staleness is a signal, not a decision.** The cutoff decides what is marked; the user decides what
  is removed.
- **Never recover a session by reading a rendered file.** Everything here is a read tool away.
- **Degrade by saying so.** An empty inventory, a refused delete, a named id that no longer exists —
  report each and finish.
