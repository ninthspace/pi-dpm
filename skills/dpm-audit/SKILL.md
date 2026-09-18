---
name: dpm-audit
description: Structured audit of the codebase across the project's dimensions of code health. Findings are rows carrying a citation, a dimension and a severity as typed references; the audit is pinned to the commit it was taken at, and its results can be piped into the library, a spec or a quick change. Run with /dpm-audit.
thinking: medium
phases: orient sweep rank write handoff
---

# Codebase Audit

Sweep the codebase for debt, and record what is found as findings that cite `file:line (symbol)`,
say what is wrong, and say what would fix it.

Everything this skill records is a typed tool call. It composes no markdown, allocates no numbers,
names no files, and never reads back what it or another skill wrote.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Gate Presentation**, **Conversational Output**, **Written Deliverable Length**,
**Cross-References** and **Artifact Publishing** from it.

## Input

The request may carry a scope hint — `auth`, or `src/billing`.

**A hint changes weight, not membership.** Every dimension is swept on every run; the hint says
where to look hardest. Where it matches more than one plausible reading of the tree — `auth` as
`src/auth/` and as `tests/auth/` — disambiguate with the `question` tool before orienting, offering
the candidates and a sweep-everything fallback. Once per run.

A scoped audit and a full sweep are the same kind of document. The narrowing lives in the `title`
and `slug` this run supplies, so two audits of the same commit read side by side without
reformatting — neither composed its own shape.

## Startup

### Session

Follow the shared **Session Startup** procedure with `skill: 'dpm:audit'`.

**Every finding belongs in `state` as it is found, and so does the commit SHA**, because the sweep
is the long half and nothing is written until Step 4: a run resumed after an interrupted sweep has
no other way back to what it saw, or to the state of the tree it saw it in.

### Library

Follow the shared **Library Check** procedure with scope keyword `audit` — coding standards before
the consistency dimension, a security policy before the security one. A finding citing a recorded
standard is one the project has already agreed with; a finding citing taste is an argument.

### Retro awareness

Follow the shared **Retro Awareness** procedure.

If incorporated: a codebase discovery is context the sweep does not spend time rediscovering, a testing gap
is evidence the test-debt dimension starts from, and a pattern worth reusing is what a
recommendation should point at by name.

## Process

### Step 1: Orient

Reads only — no findings, no recommendations, nothing written. Orient exists so the sweep starts
project-shaped rather than from a blank slate.

- **The surface**: the README, every package manifest the stack detection below turns up, and the
  top-level tree. Do not descend recursively; the sweep reads deeply where a finding warrants it.
- **The history**: `git log --oneline -200` for the shape of activity, and
  `git log --stat --since="6 months ago"` for what has churned.
- **The pin**: `git rev-parse HEAD`. This is what the audit is taken at, and it is what makes a
  finding reproducible against a known tree. Carry it in the session state until Step 4 writes it.
  Where the project is not a git repository, say so under Open Questions and carry on.
- **Two rankings**: the twenty largest files by line count, excluding vendored and generated trees,
  and the twenty most-modified from the six-month log. Compute the intersection explicitly — a large
  file that changes often is where debt collects.
- **The planning rows, as context only**: `dpm_list_spec`, `dpm_list_epic`,
  `dpm_list_adr` and `dpm_read_adr` on what bears on the code. Tell the user what the
  audit has seen.

  **Non-negotiable: none of it may skip a dimension, shorten a sweep, or soften a finding.** That a
  problem is already specified, already planned, or already decided against is not evidence it is
  absent from the code. The audit's whole value is that it looks at what is there.

  Nothing here reads a projected document. A spec is rows, an ADR is rows, and both are reached by
  asking for them — there is no file to open and no header to parse.

**Stack detection**, from the manifests present at the root. Every applicable stack is detected, and
a polyglot repository runs all of their toolchains in Step 2:

| Manifest | Stack |
|---|---|
| `package.json` | TS/JS |
| `composer.json` | PHP |
| `composer.json` **and** `artisan` | Laravel — an overlay, added to PHP and never instead of it |
| `pyproject.toml`, `requirements.txt` or `setup.py` | Python |
| `Cargo.toml` | Rust |
| `go.mod` | Go |

Then one `question` call: focus somewhere specific, or sweep evenly. The answer is a weight, not a
filter, and it is the last chance to shape the sweep before it starts.

### Step 2: Sweep

`dpm_list_taxonomy` in the `audit_dimension` domain, swept in `position` order.

**The dimensions are rows, and that is what makes the sweep the project's rather than this file's.**
A dimension the project added is swept because it is in the table, with no plugin change; a retired
one is not returned and is not swept. Read them at the start of the sweep rather than working from
the list below — the guidance is what the seeded nine ask of a reader, and a dimension the project
named itself is swept on the terms its own name states.

| Dimension | What to look at |
|---|---|
| Architectural decay | Module boundaries, layering, dependency direction. God modules, cycles, a shared utility file that has become a graveyard, a layer reaching past the one below it. |
| Consistency rot | Two ways of doing one thing in one module. Mixed naming, drifting error shapes, a ported module keeping its old idioms. Cite the canonical form as well as the drift. |
| Type & contract debt | Type holes, unchecked casts, stringly-typed APIs, validators that disagree with the declared type, a DTO that no longer matches the wire. Cite both sides of the drift. |
| Test debt | Modules with no test, integration tests that mock everything below the entry point, tests that pass against an empty implementation, suites too slow to run. |
| Dependency & config debt | Advisories from the stack's audit tool, abandoned packages, two semver-incompatible copies of one library, environment files in the repository. |
| Performance | Queries inside loops, synchronous I/O on a hot path, missing pagination, unbounded recursion, leaked handles and listeners. |
| Error handling & observability | Swallowed exceptions, catch-alls, error returns nobody checks, `panic`/`die` in library code, logs with no context around an external call. |
| Security | Auth and authorisation gaps, unvalidated input reaching a shell or a query, hand-rolled crypto, permissive CORS, secrets read without validation. |
| Documentation drift | A README whose setup steps fail, a comment contradicting the code beneath it, API documents describing a deleted route. Cite both sides. |

**Find everything; curate nothing here.** Report every issue the dimension surfaces, including the
ones that look minor or that you are unsure of. Filtering happens in Step 3, and only there.

Each finding carries its dimension, a severity, the location as `file` with `line` where there is
one and `symbol` where the location has a name, one sentence saying what is wrong, and the scoped
change that would fix it where one is known.

**Cite, never quote.** The citation is a location. A hard-coded credential is recorded as its file
and line and the class of problem — never as its value, however plainly the finding would read with
it.

**Severity is the `severity` vocabulary, and there is no second scale.** Read the domain rather than
remembering it; a project may have added a term or retired one. Do not open a summary with an effort
or confidence marker to make up for the absence of a column — a scale smuggled into prose is one
nothing can sort by, and Step 3 weighs how well a finding is evidenced anyway.

**Stack tooling.** For each detected stack, run at least one and feed its output into the dimensions
it speaks to: `npm audit`, `npx madge --circular`, `tsc --noEmit` (TS/JS) · `composer audit`,
`phpstan` or `psalm` (PHP) · `larastan`, `pint` (Laravel, alongside the PHP set) · `pip-audit`,
`ruff check`, `mypy --strict` (Python) · `cargo audit`, `cargo clippy` (Rust) · `govulncheck`,
`staticcheck` (Go). A project with stronger tooling of its own adds it.

**A tool failure never aborts the audit.** A missing binary, a crash, a timeout or unparseable
output each become one line for Open Questions — `Tool: <name> — <reason>` — and the sweep moves to
the next dimension. The audit always completes; the gap is recorded rather than the audit abandoned.

**Where a later dimension invalidates an earlier recommendation**, rewrite that recommendation on
the spot and note it for Open Questions as `Conflict: <earlier> superseded by <later>`. Once per
conflict — a third dimension amends the note rather than adding a second.

Say which dimension is starting as each one starts, so a long sweep has a heartbeat.

### Step 3: Rank

The sweep found; this selects. Weigh each finding's severity against how well it is evidenced, and
draw out at most ten points for the summary, ranked by impact.

**The cap belongs here and not in the sweep.** A cap the sweep can see is a cap it stops short of,
and what goes unfound cannot be curated back. Every finding is written in Step 4 — the ranking is a
selection from the record, not a filter on it.

### Step 4: Write the audit

Two steps before any row exists:

1. **Render the audit in the message body** — the ranked findings with their dimensions and
   severities, and the sections about to be written.
2. **Then gate**, with the `question` tool: "Record this audit?" with `Approve` /
   `Request changes` / `Stop`.

On approval:

1. `dpm_create_audit` with a short kebab-case `slug` and a `title`. That call assigns the
   number, which nothing here works out.
2. `dpm_update_audit` setting `commit_sha` to the SHA captured at orient.
3. `dpm_create_audit_finding` per finding — **every one, not the ranked ten** — with the audit,
   its `position`, `dimension_id`, `severity_id`, `file`, `line` and `symbol` where they apply, its
   `summary`, and its `recommendation` where the sweep found one.
4. `dpm_create_document_section` per section below, positioned in this order.

**The dimension and the severity come from different vocabularies and the tool knows which.** Each
is a domain-scoped reference, so a severity handed to `dimension_id` is refused rather than stored —
the mistake that makes a findings table unsortable, caught where it is made.

The sections, in order:

- **Executive Summary** — the ranked points from Step 3, at most ten.
- **Architectural Mental Model** — a paragraph or two of plain prose on how the codebase is
  organised: entry points, dominant patterns, where the logic lives. It is what a reader arriving
  cold needs before the findings mean anything.
- **Top 5 Priorities** — five refactor outlines drawn from the findings: what to change, where, and
  what it buys.
- **Quick Wins** — a checklist of changes each doable in under an hour.
- **Things that look bad but are actually fine** — **required on every audit, with no exception.**
  Patterns an inexperienced reader would flag, each with the one line explaining why it is correct
  as it stands. Where the sweep found none, write the most counter-intuitive thing it decided to
  leave alone. Its presence is what shows the audit weighed counter-evidence rather than collecting
  complaints.
- **Open Questions** — the tool failures, the conflicts, and what could not be settled without
  information the audit did not have.

**Do not write a Findings section.** The findings are rows, and the projection renders and orders
them; a section holding a second copy disagrees with the rows the first time either is touched.

**Report each finding under the disposition its row gives it.** Read the terms from
`dpm_list_taxonomy` in the `disposition` domain and render them in `position` order.
A finding carrying a `recommendation` is waiting on the reader and names the change and where; one
without is a record of something seen and left; and a dimension this environment could not sweep is
still open, with what would close it — the same thing Open Questions holds, said as a disposition
rather than only as a section. An audit changes nothing, so the first disposition never has items
and never appears; a report that opens with the second is the honest shape of an audit rather than a
gap in it, and the same rule **No padding** applies to a dimension applies to a disposition.

**No padding.** A dimension that found nothing contributes no rows and no narrative. Never write
"Nothing material" or "N/A" for it — an absent category signals confidence, and a placeholder
signals box-ticking.

### Step 5: Handoff

- **Into the library**, so other skills pick the findings up through their own Library Check:
  `dpm_create_library` with `doc_type: 'reference'`, then `dpm_create_library_scope` per
  scope keyword — `audit`, plus the dimensions the findings cluster in, chosen with a multi-select —
  then `dpm_create_dependency` with `kind: 'builds_on'`, the library document as
  `source_document_id` and this audit as `target_document_id`.

  **One wrapper per audit, not one per dimension.** The scopes are rows on that one document, so the
  next skill's Library Check finds it by asking which documents are scoped to its own work, and the
  edge is what carries "this reference came from that audit" — both ends readable, neither a string.
- `dpm-spec` on this audit, where the priorities are work worth specifying.
- `dpm-quick` on this audit, for the quick wins.
- Done.

## Output

There is no file to save. The audit is the rows; the document is a projection of them, and a
pre-commit check keeps the two from diverging.

**Do not tell the user a path.** Building one from a number and a slug is the filename construction
this skill does without.

An artifact can be published from this output on request — follow the shared **Artifact Publishing**
procedure. It is separately confirmed and never the default.

For `audit` the artifact is a dimension dashboard: severity read across every dimension at once, so
where the debt clusters is visible without holding dozens of findings in the head. The summary ranks
ten; the dashboard shows the distribution that ranking came out of. If you cannot write the one-line
justification for what the visual carries that the prose cannot, it has not earned its place.

Record it only once published, with `dpm_create_artifact` carrying its address, title and
publication time, then `dpm_create_artifact_document` binding it to this audit.

## Guidelines

- **Cite, don't quote.** Every finding names a location. No secret's value ever enters a row.
- **No rewrites.** A recommendation is a scoped change — which file, which symbol, what to change it
  to. "Rewrite", "replace entirely" and "rebuild" are not recommendations; a finding that genuinely
  warrants one is a conversation for `dpm-spec`, and the audit records the symptom.
- **Sweep every dimension the vocabulary returns**, whatever the hint said and whatever the planning
  rows claim is already handled.
- **Severity is a judgement, not a flourish.** An audit where everything is critical has ranked
  nothing.
- **Find comprehensively, then curate.** Steps 2 and 3 are not a formality.
