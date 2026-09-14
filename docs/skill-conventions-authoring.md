# Writing `shared/skill-conventions.md`

The conventions document is read in full by every skill run, so everything in it is paid for in
context on every turn that follows. This note holds what a maintainer needs and a running skill does
not; it was the document's preamble until it was moved here.

**Skills ask for the document** with `dpm_read_shared_document` and `name: "skill-conventions"`.
dpm ships no session hook, so nothing injects these sections; a skill calls for them, which costs one
tool call per run rather than the sections repeated in every skill file.

**A tool call rather than a file read, and the difference is the point.** A file read of a path
outside the project is rejected by one host and unreachable on the other, and it fails by returning
nothing — so a skill would open without its conventions and nothing anywhere would say so. A tool
call reaches the same bytes through the one boundary both hosts share, and when it cannot, it says
so out loud.

**What earns a place there.** A section belongs in the file when several skills reference it. One
referenced by a single skill belongs in that skill; one referenced by none is documentation rather
than context, and belongs here or wherever else the project keeps its documentation.

**Nothing there describes what a tool already does.** Prose restating a tool's behaviour is a second
specification of it, and the two drift — the prose being the copy that no test holds to account.
Numbering is the clearest case: `dpm_create_epic` allocates, and a paragraph explaining how would be
a rule nothing enforces.

**A procedure carrying judgement the tool does not is a different thing, and it belongs there.**
Which sessions are stale, how many observations to select and on what, whether a retro's lesson is
presented before it is used — none of that is in a tool, and all of it has to be the same in every
skill or the corpus behaves differently depending on which one a project happens to run. The test is
not "does this mention a tool" but "would two skills implementing it separately agree".

**Rationale goes here, not there.** A paragraph explaining why a rule exists helps the next person to
edit it and costs every run that reads it. Keep the rule and a clause of reason in the document, and
put the argument in this note.
