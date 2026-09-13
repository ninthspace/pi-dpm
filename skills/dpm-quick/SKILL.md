---
name: dpm-quick
description: Lightweight execution for a small, well-defined change. Classifies the input as a fix or a change, diagnoses root cause before proposing anything on the fix path, confirms a written record, executes, and closes that same record by deciding each criterion met or not. Run with /dpm-quick.
phases: classify:medium diagnose:high scope:medium propose:medium execute:medium close:off
---

# Quick Execution

Do a small, well-defined change with minimal ceremony: work out what is being asked, confirm it,
do it, and leave a record of what happened.

This is the lightweight path past the full pipeline. Use it when the change is clear, the scope is
small, and structured planning would cost more than it returns.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length** and
**Cross-References** from it.

## Input

The request is the change description — `add a --verbose flag to the deploy script`. If
there is none, ask for one.

The description seeds everything after it: the classification, the criteria, and the work.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:quick'`.

**The diagnosis belongs in `state`**, because a fix resumed after an interrupted execution otherwise
starts again from the symptom.

### Library

Follow the shared **Library Check** procedure with scope keyword `quick`. Coding standards bear on
the change directly, so read them before writing code rather than after.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated: a pattern worth reusing is applied directly where its conditions match, a codebase discovery
is a known constraint rather than something to rediscover, and a scope surprise in this area is a
reason to escalate sooner in Step 1b.

## Process

### Step 1: Classify and assess

**Deliver what was asked, at the scope intended — no narrower, no wider.** Make the routine calls
yourself and check in only where two readings would produce materially different work. If a better
approach appears, say so in a sentence and carry on with what was asked rather than quietly
substituting it.

**Fix or change.** A fix describes a symptom — broken, fails, wrong, used to work, should do X and
does Y. A change is everything else: an addition, a refactor, a configuration update. Say which path
you are taking in one line, and switch immediately if the user disagrees. The heuristic is meant to
be simple; the user corrects it.

#### Step 1a: Diagnose — the fix path only

**A fix is not started until its cause is found.** Reproduce or confirm the symptom in the code,
form a specific hypothesis — "the config loader returns null when the file is missing", not "config
handling has issues" — and trace the path to confirm it, including what else the same cause
reaches.

Then, in two steps:

1. **Render the diagnosis in the message body** — symptom, investigation, root cause, and your
   confidence in it.
2. **Then gate** on it with the `question` tool: `Confirmed` / `Partially right` / `Wrong`.

On anything but confirmed, take the correction and investigate again.

**Nothing is proposed before this gate passes**, because the alternative is a patch on the symptom
that leaves the cause in place — and a change path skips this step precisely because it starts from
a known modification rather than from something broken.

#### Step 1b: Assess the scope

Explore enough of the codebase to have a real opinion: which files change, what pattern already
exists, what depends on what. On the fix path this assesses the *fix*, not the symptom.

There are no thresholds. Ten files following an existing pattern are fine; two files introducing a
new one may not be.

If it looks too big, say why — which factors — and offer escalation **once**, to `dpm-discover`,
`dpm-spec` or `dpm-epics`, with carrying on as the fourth option. Then respect the answer. The
concern is raised once and not again.

### Step 2: Propose, confirm, and write the record

On the fix path, the criteria come in two kinds and both are written: what now works, and what
proves the specific failure cannot recur. The second is the one a happy-path check misses.

Two steps before any row exists:

1. **Render one tight block in the message body**: what will change, which files, and the criteria
   — observable outcomes rather than implementation steps. "The config file carries the new key",
   not "edit the config file".
2. **Then gate** with the `question` tool: "Ready to execute?" with `Execute` / `Adjust`.

Iterate until confirmed. Then:

1. `dpm_create_quick` with a short kebab-case `slug` and a `title`. That call assigns the
   number, which nothing here works out. Leave `status` at its default and set `status_note` to say
   the record is confirmed and awaiting execution.
2. `dpm_create_quick_criterion` per criterion, with its `text` and its `position`. Leave `met`
   unset — it is a tri-state, and unset means undecided rather than failed.
3. `dpm_create_document_section` for the change summary and the files affected, so what was
   agreed is readable next to what was decided.

**The written record is a hard gate on Step 3, and it is the row that makes it one.** Implementation
does not begin until `dpm_read_quick` returns the record and `dpm_list_quick_criterion`
with `include_body` returns its criteria. Those criteria are what Step 4 decides against — read them
back rather than working from the conversation, which is the only copy that can drift. Read without
`include_body`, the rows are a count of criteria and the conversation is again the only copy.

### Step 3: Execute

Read the criteria back first, per the gate above. Then check whether the change touches an
architectural decision: `dpm_list_adr` and `dpm_read_adr` on anything that bears on it.
A decision already taken is a constraint on this change, not a suggestion.

Break the confirmed work into tasks, do them in order, and write or update tests where the change
alters behaviour — following the patterns already in the project rather than importing one. Keep the
commentary between tasks short: the proposal was agreed, and this is the doing of it.

### Step 4: Close the record

Verify each criterion against the codebase as it now stands. Run the project's tests where there are
any; where they fail, report the output and let the user choose to fix, accept, or stop.

Then close it, in this order:

1. `dpm_update_quick_criterion` per criterion, setting `met` and a `note` saying what settled
   it.
2. `dpm_create_document_section` for what changed and how it was verified.
3. `dpm_create_observation` with the quick record as `quick_id` and one sentence of `text`,
   then `dpm_create_observation_category` with a term from `dpm_list_taxonomy` in the
   `observation` domain.
4. `dpm_update_quick` setting `status` to `complete` and `closed_at` to the time it closed.

**The record is not replaced when it ships; its status moves.** The same row that was confirmed in
Step 2 is the one that closes, so "what was agreed" and "what happened" are one artefact with a
history rather than two documents where the second overwrote the first. Nothing is rewritten and
nothing is deleted.

**`met` is a tri-state and the third state is the useful one.** Unset means undecided, `false` means
decided against — a criterion that was not achieved is recorded as not met with a note saying why,
which is a different and more honest thing than a criterion quietly dropped.

**Report each criterion under the disposition its own row gives it.** Read the terms from
`dpm_list_taxonomy` in the `disposition` domain and render them in `position` order.
The column decides, not the sentence: `met` true is a criterion whose work is in the codebase now;
`met` false whose `note` records a deliberate decision is one seen and not acted on; `met` false
because nothing here could perform the check is still open, and the `note` says what would close it;
and `met` still unset at close is waiting on the reader, so it says what would settle it and where.
Three of those are a record and one is an action, which is the distinction a closing summary exists
to draw.

**The observation is mandatory, carries exactly one category, and hangs off this record rather than
a retro.** `quick_id` is its origin, the same way `story_id` is for work done under an epic, so
`dpm-retro` gathers it later by setting `retro_id` and the origin is never cleared. Write it even
when nothing went wrong — "smooth delivery" is a finding, and a corpus that only records trouble
misreports how the work actually goes. Do not create a retro here to hold it: an observation that
arrives already grouped is one no retro can gather.

## Output

There is no file to save. The record is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without — and there is no second path for the completion record, because it is the
same record.

## Guidelines

- **Lean, not hurried.** Lean means no wasted steps. It does not mean skipping the diagnosis, the
  confirmation or the verification — each exists because a small change went wrong without it.
- **Scope honesty, once.** If it is too big for this path, say so and let the user decide.
- **Fixes are diagnosed; changes are not.** A fix starts from a symptom that has to be understood; a
  change starts from a modification already known. Skipping diagnosis on a fix yields a patch on the
  symptom; running it on a change is ceremony.
- **Do the work.** This skill changes the codebase. It writes code, edits files, and runs tests.
- **Minimal change, scoped to the request.** No speculative abstractions and no features nobody
  asked for. Where a smaller change does the job, prefer it.
- **Solve generally, not to the test.** Write for the whole range of valid inputs rather than the
  examples a test happens to name. Tests are evidence, not the specification.
- **Correct yourself sparingly**, per the shared convention.
