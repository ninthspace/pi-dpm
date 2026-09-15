---
name: dpm-inspect
description: Code, after execution — presents what a change set actually did and where it sits in the repository. Resolves a commit range, branch or working tree, works out the axis that best explains the change, situates it against what was already there and what was deliberately left alone, and joins it to the planning rows that record intent. Run with /dpm-inspect.
thinking: medium
phases: axis situate join verify unread report
---

# Change-Set Inspection

`dpm-inspect` answers one question: **what did this work actually do, and where does it sit?**

Not "is this code any good" — that is `dpm-audit`, over a different scope. Not "does this plan hold
up" — that is `dpm-review`, and it runs before execution rather than after. This skill takes a
change set and produces the account a colleague would want if they had to understand the work
without opening the repository.

| Skill | Question | When |
|---|---|---|
| `dpm-review` | Do these plans hold up? | Before execution |
| `dpm-inspect` | What did this change do, and where does it sit? | After execution |
| `dpm-audit` | How healthy is this codebase? | Any time |

**The line against `dpm-audit` is the one worth holding.** Findings about code quality are
`audit`'s output, and a change-set analysis that drifts into them stops answering its own question.
Where the work under inspection has quality problems worth raising, name them in a sentence and
point at `dpm-audit`.

**The repository does not need to be a dpm project.** Everything below degrades to whatever is
actually there, and says which channel it fell back to.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Conversational Output**, **Written Deliverable Length** and **Artifact
Publishing** from it.

## Input

The request carries a selector: a commit, tag, branch, range, `--since <ref>`, `--working-tree`, or a
phrase like "3 days ago".

**If it is absent**, work out a baseline — the last release tag, the last merge to the default
branch — and **say which you chose and why** before going further.

**Always include uncommitted working-tree changes, and always report them separately from committed
ones.** Whether work has landed is a fact about the change set, not a footnote.

### Resolving it

Resolution is git and nothing else, and it is the one deterministic step here. Resolve the selector
explicitly and **say what it resolved to** before reading anything:

- `<A>..<B>` — `git log --format=%H A..B` and `git diff --name-only A..B`.
- A branch name — measure from its **fork point**, `git merge-base --fork-point <branch>` falling
  back to `git merge-base`. Diffing against the tip of the default branch instead is the plausible
  wrong answer: it attributes every commit that landed on the base since the branch started.
- `--since <ref>` — `<ref>..HEAD`.
- `--working-tree` — `git status --porcelain` and `git diff --name-only`, plus untracked files.
- A tag, a date phrase, or a derived baseline — resolve with git and state the resolution.

**A selector matching nothing is an error, not an empty change set.** Say the selector back and
stop. Do not widen it to find something to talk about.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:inspect'`.

**The selector and the axis both belong in `state`, and the axis especially**, because it is the
expensive decision and a run that re-derives it after an interruption classifies the second half of
the change set on a different definition from the first.

### Library

Follow the shared **Library Check** procedure with scope keyword `inspect`. An architecture document
bears before judging where a change sits; a coding standard bears before calling something a
deviation.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated: a codebase discovery is context for Section 2 — it often explains why something
sits where it does, and saves reporting a deliberate arrangement as an oddity. A testing gap is
worth naming in Section 4 when reporting what the change set's own tests do and do not reach.

## Process

### 1. Derive the axis before you use it

The organising question is which changes are **static** and which are **dynamic** — but that
distinction is domain-relative, and it has to be defined for **this** repository before anything is
classified. Read enough of the codebase to work out what the split actually is here. Depending on
the stack it may be deterministic code against model-driven prose or configuration; build-time or
generated against run-time; schema, migrations and wiring against request-path behaviour; a
statically analysable surface against reflection and runtime registration; server-rendered against
client-interactive; vendored or generated against hand-authored.

**State the definition chosen in a sentence or two, and say what in the repository made it the right
one.** Where more than one reading is defensible, take the one that explains the most of *this*
change set and name the runner-up.

Where the repository has no meaningful static/dynamic split, **say so plainly and propose the axis
that does explain the change set instead**. Do not force the frame — a forced axis produces an
account of the frame rather than of the work.

Then classify every changed component. **Components on the boundary — especially one tier guarding
the other — are usually the most interesting thing in the change set.** Call them out rather than
rounding them to a side.

### 2. Situate the changes in the repository

Answer with figures actually measured:

- **Proportion** — how large is each touched area against what was already there? *"This directory
  held 2 files and now holds 17"* is worth more than any diffstat.
- **Layering** — entry points, domain, infrastructure, tests, build, docs. Does the change set
  introduce a layer, thicken one, or cut across all of them?
- **Negative space** — what sits immediately adjacent and was **not** touched, and is that
  deliberate or an omission? **Often the highest-signal part of the analysis**: a file everything
  pays a cost for and this work avoided is a finding in its own right.
- **Naming against reality** — does anything now live somewhere whose name no longer describes it?

### 3. Join the change set to what records intent

**Where the planning rows exist, they are the record**, and every one of them is a query:

- The chain: `dpm_list_spec` and `dpm_read_spec`, `dpm_list_requirement`,
  `dpm_list_epic`, `dpm_list_story`, `dpm_list_task` and
  `dpm_list_story_criterion`.
- The traceability: `dpm_list_coverage` scoped by `requirement_id` or by
  `story_criterion_id`. **Coverage is the join and it runs both ways**, which is what lets the gap
  queries below be asked from either end — "which requirement has nothing behind it" and "which
  criterion answers nothing" are the same rows read in opposite directions.
- The rest of the pipeline: `dpm_list_retro` scoped by `parent_id` to the epic in hand,
  `dpm_list_observation`, `dpm_list_quick`, `dpm_list_problem_brief`,
  `dpm_list_product_brief`, `dpm_list_adr`, and `dpm_list_artifact` for what has
  been published.

**Every one of these takes a `limit`, and the bound is a default with no ceiling** — so raise it
where the answer needs more rather than working around its absence. A gap query answered from a
truncated page reports an absence that is really a second page, which is the one failure mode a gap
query cannot survive: it is *designed* to report absences, so a false one is indistinguishable from
its whole output.

The three gap queries worth running, each a comparison between two reads rather than a scan:

- **A requirement with no coverage rows** — `dpm_list_coverage` on it comes back empty. The
  breakdown missed it.
- **A coverage row carrying `verified_at` with no automated approach behind it** —
  `dpm_list_story_criterion_approach` says what the criterion was actually tagged, and
  `dpm_list_criterion_approach` says what the spec asked for. That list takes an acceptance
  criterion's id, not the requirement's, so reach it through `dpm_list_acceptance_criterion` with
  the `requirement_id`. A mark resting on `manual` or `target` is not a mark a test produced.
- **A completed epic with no retro** — the scoped `dpm_list_retro` answers it directly. A
  retired epic is not one of these: asking what was learned from work that was dropped is asking
  about a decision to stop, and the gap query would report one for every such epic forever.

**A retired item is reported as retired, in both directions.** `superseded` and `withdrawn` are
terminal without being delivery, so a report that reads the four statuses as two puts them in one of
two wrong places: `pending` says the work is still coming, `complete` says it shipped. A change set
tracing to a story or an epic in either state is a finding in its own right — code written against
work somebody stopped — and it is precisely the finding that disappears when the vocabulary is
flattened.

**Where the rows do not exist**, fall back through whatever the repository has: ADRs or decision
records, RFCs, design docs, CHANGELOG, README, issue references, commit trailers, branch names. Say
which channel was used.

**If nothing records intent, say so and move on.** An absent planning record is a finding to report,
never a reason to fail or to invent one.

**Beware the signal that cannot discriminate.** Where every file in the change set traces to the
same record — one squashed commit carrying a whole epic chain — that mapping tells a reader nothing
about any individual file, and reporting it as provenance overstates it. Say that it is uniform and
why. This is why the join is read and judged rather than computed: a mapping that links everything
to something is reproducible, says nothing, and reports its own emptiness as "no orphan changes".

### 4. Verify before you assert

Where the repository has tests, a linter, a type checker or a build, **run what is cheap and
relevant and report what was actually observed**. Never describe a suite as passing without running
it. Where something could not be run, say which and why.

**Distinguish throughout between what was measured, what was read in a record, and what was
inferred.** Do not present an inference in the same voice as a count.

### 5. Say what was not read

A large change set will not fit in one careful pass. That is expected; hiding it is not.

**Name every file not examined**, or characterise them exactly where the list is long — *"the 25
test suites under `tests/`, none read"*. A count is not enough: it is precisely the shape of
disclosure that lets a reader move on without checking. An analysis that silently samples reads as
complete, and the larger the change set the more confident that silence sounds.

### 6. Report

Lead with the finding: the one sentence that characterises this change set. Then the axis and what
sits either side of it, where the change sits in the repository, what it traces to, what was
verified, and what was not read.

**Report by disposition.** Read the terms from `dpm_list_taxonomy` in the
`disposition` domain and render them in `position` order. An inspection changes nothing, so the
first disposition never has items and never appears; something checked and found sound is a record;
a claim this environment could not check is still open, with what would close it; and anything the
reader has to act on comes last, each naming the action and where.

**Step 5's unread files belong in that last block, not among the unchecked.** A pass that did not
reach them had road left and ran out of it, which is a fact about the run rather than about the
environment — so they are the reader's to read. Filing them as something nothing here could have
checked is the one move that would make Step 5's disclosure cost nothing, which is the whole of what
it is for.

## Publishing

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is always separately confirmed, and never the default.

This skill's output is the case where a page usually earns itself: the analysis is what a reader
wants instead of the diff, and it is the thing no diff can render. **Lead with the finding, not the
diffstat** — someone without the repository open should finish the page knowing what changed, which
tier it belongs to, where it sits, and what it traces back to. **Report counts and paths, not
wholesale source**: quote code only where a specific point needs it, because an unbounded excerpt is
a diff and rendering a diff is a mirror that earns nothing. The axis from Section 1 is usually the
page's organising idea, and is often worth encoding structurally rather than labelling repeatedly.

**Where the change set is small, unremarkable or has no interesting structure, say that and keep the
page short.** Do not inflate a routine change into an architectural narrative.

## Degradation

| Missing | Behaviour |
|---|---|
| The planning rows are empty | Section 3 falls back to ADRs, CHANGELOG, commit trailers, branch names. Say which channel was used. |
| No intent record of any kind | Report that plainly. Sections 1, 2, 4 and 5 are unaffected, and 2 usually carries the analysis on its own. |
| No tests, linter or build | Section 4 reports there was nothing to run. Do not describe the change as verified. |
| No meaningful static/dynamic split | Section 1 says so and proposes the axis that does explain the change set. |
| A selector matching nothing | Say the selector back and stop. |
| Not a git repository | Resolution fails. There is no degraded reading of a change set with no repository to take it from. |
| The Artifact tool is absent | Say so and skip publishing. The report is unaffected. |

## Output

The report in conversation and, on request, a published artifact with its row. **This skill writes
no planning row of its own.** What it produces is a reading, and a reading recorded as a row would
be a second account of the change set beside the one the rows already hold.

## Next Action

After the report, offer — do not run — one of `dpm-audit` where the change set raised
code-quality questions worth a proper sweep, `dpm-quick` for something small and well-defined it
turned up, `dpm-spec` where it describes work that needs planning, or `dpm-retro` where the change
set is the end of an epic chain.
