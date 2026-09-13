/**
 * Which document kinds each edge kind admits, as `[kind, source_kind, target_kind]`.
 *
 * **Every row here is a pair a shipped skill writes, and nothing else.** That is the discipline the
 * register's deferral was protecting: the matrix was left unwritten rather than guessed at, and the
 * evidence for filling it in now is not that the pairs look reasonable but that `skills/` instructs
 * them. Each entry names its writer for that reason — a row nobody can trace to a caller is a
 * refusal waiting to happen in a project that does the thing the skill told it to.
 *
 * **A kind absent from this list is unconstrained**, which is how `blocks` is treated: its ends may
 * be stories, and a story is not a document kind. See `024-dependency-endpoint.sql`.
 */
export const DEPENDENCY_ENDPOINTS = [
  // The original rule, and the one the kind was seeded for: spec-to-spec lineage.
  ['builds_on', 'spec', 'spec'],
  // `dpm-spec` Section 1 — "if the input was a brief, record the lineage". Both brief kinds, since
  // the section resolves either as its starting context.
  ['builds_on', 'spec', 'problem_brief'],
  ['builds_on', 'spec', 'product_brief'],
  // The same lineage from a consultation: `dpm-consult` hands its discussion to `dpm-spec`, and the
  // spec that results came from it exactly as one from a brief did.
  ['builds_on', 'spec', 'discussion'],
  // `dpm-audit` Step 5 — the library wrapper carrying an audit's findings into other skills' Library
  // Check, edged back to the audit that produced it.
  ['builds_on', 'library', 'audit'],
  // `dpm-architect` Phase 5, and the pair entry 6 already named.
  ['constrains', 'adr', 'adr'],
  // `dpm-architect`'s supersession, whose direction is stated on the kind: the source is the
  // superseded end. Constrained here because the skill writes it between two ADRs and nothing else
  // writes it at all.
  ['supersedes', 'adr', 'adr'],
];
