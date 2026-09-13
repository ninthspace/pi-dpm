---
name: dpm-ralph
description: Launch an autonomous loop that wraps dpm-do across epics, or works a spec from scratch. Probes the stop hook, resolves what the run will work from the rows, assembles the prompt and confirms before arming. Run with /dpm-ralph.
phases: preflight:low prompt:medium launch:off
---

# Autonomous Multi-Epic Execution

Arm a ralph loop that runs `dpm-do` unattended, across several epics or across a whole spec.

**The loop's memory is a `session` row.** Its iteration count, what each iteration measured, and where
it had reached are `state` on that row, and a run resumed under a new session id adopts the old row
rather than starting over. That is the one thing an unattended run cannot afford to get wrong: nobody
is watching when a resume silently begins again, and a second pass over finished work looks exactly
like a first pass over unfinished work.

**`.claude/ralph-loop.local.md` is the plugin's file, not this one's.** It is how the stop hook knows
a loop is armed, and it stays a file because the hook reads it. Everything else this skill used to
keep on disk is a row.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Session Startup**, **Library Check**, **Gate Presentation**, **Conversational
Output** and **Written Deliverable Length** from it. It does not use **Retro Awareness**: an
autonomous run's lessons are dispositioned by `dpm-do` inside the loop, and offering them again here
would ask a question about a run that has not started.

## Input

What the request names is optional, and **the mode comes from what it names, never from a flag**.

1. **One or more epic ids**, or a range of epic numbers — **epic mode**, working those.
2. **A spec id** — **spec mode**: the loop generates that spec's epics itself, then works them.
3. **Nothing** — epic mode over every epic with work left.
4. `--max-iterations N` (default 50), `--story-filter`, `--dry-run` may accompany any of them.

Two spec ids, or a spec id mixed with epic ids, is an error: report what was given and stop rather
than guessing which was meant. Resolve the mode once, here, and let every later step read it.

## Startup

Follow the shared **Session Startup** procedure. This skill's `state` is the loop's memory: the
iteration entries appended below, and the mode and epic set pre-flight resolved. It holds nothing
that is a column — no status, no verification mark — because the loop re-reads those every iteration
and a copy would be a second answer going stale between them.

Follow the shared **Library Check** procedure with scope keyword `ralph`. A project with rules about
what an unattended run may commit, which branch it may work on, or how long it may run says so there,
and those rules bind the prompt this skill assembles.

## Process

### Step 1: Pre-flight

#### 1a. What the run will work

**Epic mode.** `dpm_list_epic` with a `limit` above what the project holds. What comes back is
the working set — archived epics are already excluded — so keep the ones whose `status` is `pending`.
A `complete` epic has nothing to run, and a `superseded` or `withdrawn` one is work that will not be
done; neither is a failure to report, and both are simply not in the list.

**Spec mode.** `dpm_list_epic` scoped by `parent_id` to the spec. There is no source field to
read out of a file and nothing to compare it against: an epic's spec is its parent.

**Zero epics means different things in the two modes.** In epic mode it is a stop — say so, and name
the specs `dpm_list_spec` returns with one line: spec mode runs a spec from scratch. **Do not
offer spec mode and do not ask which to use**, because the mode comes from the request and a gate
that resolved one would move that decision into a question — and spec mode commits a loop to
generating and delivering a whole epic set, which is much larger than the run that was asked for. In
spec mode zero epics is the starting state: report it and carry on, because phase 1 is what writes
them.

Present what was resolved and confirm it. In spec mode present the spec alongside, since the epics
found are a starting position rather than the run's scope.

#### 1b. Clear the plan gates

A story marked for formal planning opens an interactive approval gate, which stalls an unattended
run. For each resolved epic, `dpm_list_story` scoped by `epic_id`, and for every story whose
`plan` is 1, `dpm_update_story` with `plan` set to 0. Report one line per story cleared.

**This is a column, so there is nothing to find and nothing to leave behind.** Scan no headings and
edit no text; a story either carries the flag or does not, and clearing it cannot damage the sentence
it used to sit in.

#### 1c. The stop hook, and which direction it fails in

The stop hook is this skill's only external dependency: it intercepts session exit and feeds the
prompt back. Three plugins provide it — `ralph-loop@ninthspace-ralph` 1.2.0 or later is the supported
one, `ralph-loop@claude-plugins-official` the line it forked from, and `ralph-wiggum@claude-code-plugins`
the original. All three install the same hook under two plugin names, so **no name may be treated as
the dependency**: a check written against one reports "not installed" on a machine running another.

1. Scan the session's registered hooks for a Stop hook referencing `ralph-loop`, `ralph-wiggum` or
   `stop-hook.sh`. If none is found, say what to install and gate on **Continue anyway** / **Stop**.
2. **Probe what the hook does**, by running the plugin's `hooks/lib/ralph-hook-probe.sh` and
   branching on its exit code. `0` — it fails closed; continue without comment. `2` — no hook on
   disk; fold into the warning above rather than reporting twice. `1` — the probe could not run; say
   so and let the user decide, because an unrun probe is not a pass. `3` — **a hook fails open**:
   report that the installed hook deletes the loop's state file on a normal turn shape and exits 0,
   so an unattended run would end silently and look like a clean finish. Name the hook the probe
   reported, and gate on **Patch or switch plugin first** / **Arm the loop anyway**.

**Registration is not the property that matters**, which is why step 2 exists and step 1 is not
enough. A hook can stay registered throughout a run in which it deletes the state file at the first
iteration boundary. What a hook *does* on a turn ending in a tool call is a different question from
whether it is present, and the only way to ask it is to run the hook.

**Both plugins enabled is a real configuration and the dangerous one wins.** Two registered Stop
hooks both fire on the same session, and the state file only has to be deleted by one of them. The
probe therefore runs every hook it finds and lets a single fails-open verdict decide.

**Probe every launch rather than once.** The hook lives in a plugin cache that is overwritten on
update, so a machine where this was fixed by hand is one update away from being a machine where it is
not, and nothing announces that. The failure it guards against is the silent one.

#### 1d. Test runner discovery

**In spec mode, ask the spec first.** `dpm_list_requirement` scoped to it with `include_body`,
and take the test tooling from the environmental requirements that name it. Report whether the spec
named a *tool* or a *command* — a tool is what the run must install before it can have a command, so
saying which was found matters more than finding something.

Then check the project's own config files. In spec mode they confirm or complete what the spec said;
in epic mode they are the only source. If nothing is found, say so — the prompt will tell `dpm-do`
to discover one at runtime.

**The spec is consulted first only in spec mode**, and the asymmetry is the point: a greenfield
spec-mode run has no config files, because the application is what the run is about to build. A
discovery consulting only those files cannot succeed in the case spec mode exists for.

#### 1e. Resume detection

Startup asked what is open. This asks the narrower question — was there a previous run of *this*
skill, and did it finish?

1. `dpm_list_session` filtered by `skill`. The rows come back oldest first, so the last is the
   most recent.
2. On a hit, `dpm_read_session` with `include_body` for what it was carrying — how many
   iterations ran, what the last few measured, and whether they repeat. **A run that ended on
   repeated measurements stalled rather than finished**, and that is the single most useful thing to
   know before arming another one.
3. Present it and gate on **Resume** / **Start fresh**.
4. On **Resume**, `dpm_adopt_session` with this session's id, the previous row's, and
   `include_body`. It hands back the state and points the old row at this one, so the chain has one
   live end and nothing has to decide which of two rows is current. `state` is a withheld column, so
   an adopt that does not ask for it resumes onto an empty state and reads as a fresh start.

**Start fresh leaves the old row alone.** It is a decision about this run, not a deletion: nothing
here removes a session row, and the stalled run stays readable for whoever comes to diagnose it.

**Adoption refuses rather than overwriting**, in the two cases where carrying state forward would
destroy something: a predecessor already adopted, and an adopting session that already carries state
of its own. Report the refusal and let the user choose; do not retry it as a fresh start, because a
predecessor that was already adopted means another run is live.

#### 1f. Loop state in the repository's ignore file

The prompt tells the loop to commit after each story, and an unattended run stages everything.
`.claude/ralph-loop.local.md` changes every iteration and belongs in no commit.

Check whether the project ignores it. If not, show the line that would be added and gate on **Add
it** / **Continue without** / **Stop** — this edits a file in their repository. If declined, say once
that the loop's own state will appear in its commits.

**This is pre-flight and not a prompt clause** because the leak is caused by the first commit: a run
that discovers it later has already made it, and adding the ignore afterwards untracks the file but
leaves it in the commits already written.

### Step 2: Prompt assembly

Assemble the prompt as **plain text — no markdown, no code fences, no backticks and no XML tags**,
because the stop hook feeds it back verbatim on every iteration. Use `--` where a dash is wanted, and
let no line of the assembled text be exactly `---`: the hook's body parser drops every such line, so
one in the body is silently lost.

Interpolate what Step 1 resolved: the epic set and its label, the spec in spec mode, the maximum
iterations, the session id, and the story-filter, test-runner and resume clauses where they apply.

**One promise per mode, fixed at launch.** `ALL_EPICS_COMPLETE` in epic mode, `SPEC_DELIVERED` in
spec mode, following from the mode rather than from a question. The hook compares the promise tag's
contents to that string exactly, so **evidence goes beside the tag and never inside it** — a tag
carrying counts or a summary matches nothing, and the loop runs to its iteration cap on finished
work.

#### The completion check is a traversal, and the loop relays it

There is no script and no exit code. The loop reads the rows:

1. `dpm_list_story` scoped by `epic_id`, then `dpm_list_story_criterion` scoped by
   `story_id` for each, with `include_body` — the unverified ones are named back to the user below,
   and a criterion has no title to name it by.
2. `dpm_list_coverage` scoped by `story_criterion_id`. A row whose `verified_at` is set is
   verified; one where it is null is not.
3. For every unverified row, `dpm_list_story_criterion_approach` scoped by
   `story_criterion_id`. **A row whose only approach is `target` is unverifiable from here** —
   checkable against the real deployment host and nowhere else.

That gives three answers rather than six exit codes, and the three are the ones that differ in what
the loop does next: **nothing unverified** — emit the promise; **unverified rows that are not
target-only** — name them and keep working; **every remaining row target-only** — name them and stop,
because nothing in this environment can close them.

**In spec mode there is a fourth reading, and it is the one epic scope cannot produce.**
`dpm_list_requirement` scoped by `spec_id`, then `dpm_list_coverage` scoped by
`requirement_id`: a requirement no row claims is **untraced**. Phase 1 is over when nothing is
untraced. Epic scope has no requirement list to compare against, so an epic-mode run can say "the
epics I was pointed at have no unverified rows left" and can never say a spec is delivered.

**The loop relays; it does not compute.** It names the rows it read and repeats what they said. It
never decides for itself that a requirement is traced or a row verified — `verified_at` is the
database's answer, placed by `dpm-do` on its own work, which is why the completion line says
**aggregation, not verification**. A wall of green means every row was marked, not that anything
works.

**Phase is re-read every iteration, never carried.** The rows describe the epics that exist now
rather than the ones that existed at launch, which is what makes a resumed run correct.

#### The iteration record, and the stall it makes visible

Before anything else each iteration, the loop appends one entry to its session `state` with
`dpm_update_session`: the iteration number, the counts it just read verbatim, the short commit
hash, and a fingerprint of the working tree. Then it reads the last three entries. **If all three
carry the same counts, the same commit and the same tree, the run has stalled** — report it and stop.

**Only facts something produced.** Every field is the output of a call or a command already run this
iteration. Nothing here is the loop's account of what it did, and that is deliberate rather than
economical: a narrative clause is the kind that quietly stops being obeyed, and an entry that is
either appended or absent cannot decay that way.

**Three conditions, and the third is the only independent one.** Counts alone false-positive on a
legitimately long iteration. The commit looks like it disambiguates that and mostly does not — the
counts move when `dpm-do` marks rows and the commit moves when it commits, and both happen because a
piece of work finished, so two readings of one event are not two conditions. The tree fingerprint is
the one signal that moves *while* work is in progress rather than when it lands, and the only one
that moves at all during phase 1, where nothing commits and no row is marked.

**A repository with no commits is a normal first iteration.** The commit field falls back to a
literal rather than carrying an error string, or the column a diagnostician reads first holds a
message about `HEAD`.

#### Stopping without the promise

**A loop cannot stop by saying it is stopping.** Ending a turn is what the stop hook exists to
intercept: it blocks the exit and feeds the prompt back. An instruction to stop that names no action
is not an instruction — the model writes *stopping*, the hook blocks, and the same iteration runs
again to the cap.

So every clause that tells the loop to stop names the action, and there is one: **delete
`.claude/ralph-loop.local.md`**. That is what the hook itself does on a matched promise and on
reaching the iteration cap, so a run that stops here leaves the project in the same state as one that
finished — which is honest, because nothing further in this environment can change the verdict. The
state worth keeping was never in that file: the session row holds the run, and the rows hold the
work.

**Not `active: false`.** The field is inert on two of the three plugins, so a pause needs a second
clause escalating to the delete anyway, and a stop mechanism with a retry is one the loop can get
wrong once.

**This is the only sanctioned way to end a run without the promise**, and it stays that way: a loop
that may end itself for any reason it finds persuasive is a loop whose completion means nothing.

#### The autonomy overrides

The prompt carries these, and every one of them is an override without which the loop stalls or
drifts:

- Make every decision autonomously — choose the most reasonable option at each gate rather than
  waiting. Use inline planning for all stories.
- A story is complete when its criteria whose approach is `unit`, `integration` or `feature` have
  passing test results, and its `manual` criteria have a recorded self-assessment. A `target`
  criterion is checkable only against the real deployment host: **never self-assess one and never
  count it as met** — record it as unverifiable here, name it in the run summary, and let the other
  criteria decide. An unrecognised approach is reported the same way.
- A failure, for the three-strike skip rule, is a test command exiting non-zero after a code-change
  attempt. Tool errors and permission denials are retries, not failures.
- If criteria are ambiguous and completion cannot be determined, mark the story blocked with the
  reason and continue to the next.
- At `dpm-do`'s retro gate, do not block: auto-apply the safe categories and defer the
  judgement-heavy ones, recording each disposition, and list both in the run summary. Never retire an
  observation.
- At `dpm-do`'s change-type gate, do not block and do not pick one of its options — take its
  autonomous branch, and never `dpm-pivot`.
- Commit after each completed story. Keep all commits local.

**Spec mode swaps two sentences, not the template.** Every rule above is about how `dpm-do` behaves
without a human, which the mode does not alter, so spec mode replaces the opening sentence with its
phase clause and the completion clause with its own, and everything between survives unchanged.

### Step 3: Write the state file and launch

1. **If `.claude/ralph-loop.local.md` already exists**, read it, report its iteration and the opening
   of its prompt, and gate on **Overwrite** / **Abort**.
2. **Capture the time with a command**, never by writing one out. Display the state file exactly as
   it would be written — the hook's fields, then the assembled prompt. If `--dry-run` was given, stop
   here.
3. **Gate on Launch / Edit first / Save and exit.** On launch, write the file with `active: true`,
   `iteration: 1`, the maximum, the completion promise, the timestamp, and `session_id` set to this
   session's id — the same id the session row is keyed on.

**Write the real session id or omit the field — never a placeholder.** An absent or empty field reads
as legacy and the hook behaves as it always did. A field holding a *wrong* id matches no session, so
every Stop hook exits early, the prompt is never fed back, and the loop silently does not run — which
looks exactly like the loop having finished.

**Say which pause behaviour the user has.** `active: false` pauses a run on the supported plugin and
is inert on the other two, where the loop continues to its cap with no error. Step 1c has already
established which hook is installed. Deleting the state file stops the loop on all three, and that is
the one instruction that holds everywhere.

Report the launch, then output the assembled prompt so the loop begins.

## Output

`.claude/ralph-loop.local.md`, and a `session` row carrying the run. The row is what survives the
loop: its `state` holds every iteration's entry, and a later run reads it rather than reconstructing
what happened.

## Guidelines

- **Facilitate the setup, automate the execution.** The interactive part is pre-flight and the launch
  confirmation. After that, nothing asks.
- **Deterministic prompts.** The same input and the same rows produce the same prompt.
- **Fail fast in pre-flight.** Only assemble a prompt that can succeed.
- **Dry run before arming.** The user sees exactly what will be written.
- **Never recover the run's position by reading a rendered file.** The rows are the position, and the
  session row is the memory.
