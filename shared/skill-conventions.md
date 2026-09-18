# dpm Shared Skill Conventions

Procedures used by several dpm skills. A skill that says "follow the shared **X** procedure" means
the section of that name below.

A skill reads this document with `dpm_read_shared_document` and `name: "skill-conventions"`.
Each procedure names the small part that is genuinely per-skill — the scope keyword, what the
session `state` must hold, what an incorporated lesson changes — and the skill states that part.

## Session Startup

Every skill's run is one `session` row, and nothing else on disk records where it reached.

1. `dpm_list_session` for what is open. A row whose `updated_at` is more than three days old
   is stale; present those and let the user decide, deleting nothing that was not named.
2. On a resume, `dpm_adopt_session` with the new session id and the predecessor's, passing
   `include_body` so the state comes back. It returns what the earlier run carried and points the
   old row at this one.
3. Otherwise `dpm_create_session` with the harness's session id, the skill's own name as
   `skill`, and the step or phase about to start as `phase`.

As each step closes, `dpm_update_session` moves `phase` on and carries the accumulated
`state` — a blob the skill defines and dpm does not interpret.

**On a resume, the rows say what is written, and `phase` and `state` say where to look.** A run can
stop after a write and before the `dpm_update_session` that records it, so both may lag the rows.
Before a resumed step writes anything, list the rows that step writes, under the parent it writes
them to, and propose only what is missing — never a row a list has just returned. What was settled
in conversation and not yet written, such as a finding held for a later step, is the part only
`state` holds, and that part is read from it.

**When the skill's phase ids are listed at the start of the run, `phase` is one of them and nothing
else** — the id of the step about to start, not its heading, and `complete` once the run is
finished. A value outside the list is refused with the list, and nothing is recorded until the call
is made again. Move it at every step, including steps whose work looks like the last one's: each
answered gate is reminded of the phase last recorded, and a phase left behind points that reminder at
a step the run has already finished.

**Two things about that call are refused, and both are easy to get wrong.** `id` is required — the
session's own id, the one step 2 or step 3 established. And **`state` is a string**: a JSON document
you serialise yourself, not an object, whatever "a blob" in its description suggests. Both hold for
`dpm_create_session` as well.

**What `state` holds is the per-skill part, and it is the part worth stating.** It is the run's
memory: what a step settled goes in as it is settled, because a step summarised only in the
conversation is one that has to be re-facilitated after a compaction. **It does not hold anything
that is a column** — a status, a number, a flag — because a copy in the blob is a second answer that
goes stale the moment the row moves.

## Handoff

A skill whose run works through units of one kind — epics, stories — ends each unit here, and the run
continues in a fresh context. One context then holds one unit, however many units there are and
whatever model runs them: a run that keeps everything in one context grows until the model server
runs out of memory or the model loses the thread. What was written down survives the handoff, because
the continued run adopts the session and reads the rows. What was only said does not, and that is the
whole of the procedure.

When the skill says to hand off:

1. **Put in `state` everything the rest of the run needs that is not a row** — the unit that comes
   next, and anything a later unit was promised: a clause left for another unit to bind, a finding
   held for a later step. The continued run has that state, the rows and the skill, and nothing else
   this context was told.
2. `dpm_update_session` with that `state`, and the `phase` the continued run starts at.
3. Say in one line what is finished and what continues.
4. **Call the host's `handoff` tool in a message of its own, then end the turn with nothing
   further.** The session update in step 2 goes in the message before it. The host opens a fresh
   context and invokes the skill again with the arguments it was first given. Where the host has no
   `handoff` tool, tell the user to start a fresh session and invoke the skill again with the same
   arguments.

**A continued run is a resume, and it is told so.** It adopts the predecessor at Session Startup,
reads its `state`, and goes on from the phase recorded. It does not facilitate again what the state
records as settled — a gate already answered, a startup discovery already weighed. It does read again
what its next step works from, because reading decides nothing: text read in the earlier context is
not in this one, and a step quoting it from memory is quoting what it cannot see.

## Library Check

1. `dpm_list_library`, then `dpm_list_library_scope` on each, to find those scoped to
   the skill's own keyword or to `all`.
2. Read the ones that apply with `dpm_list_document_section` and
   `dpm_read_document_section`, passing `include_body` — without it a section comes back as a
   heading with no text, and a run that omitted it has read nothing and does not know.

A section a consolidation has superseded is not returned — the list omits it — so a document that has
been amended and reconciled reads as one document rather than as a body followed by the amendments it
already absorbed.

The per-skill part is the scope keyword and *when* the documents bear: a coding standard is read
before code is written, an architecture document before a structural decision.

## Retro Awareness

1. `dpm_list_retro`, then `dpm_list_observation` on the ones whose subject overlaps this
   work, passing `include_body`.
2. Each observation's category is `dpm_list_observation_category` resolved against
   `dpm_list_taxonomy`, which is called with a `limit` above the seeded count so a project
   that added terms does not lose them to the default page.
3. **Select the few most relevant rather than everything from the newest retro**, judging by subject
   overlap and category and using recency only to break a tie.
4. Present the selection, naming its source retro, and ask whether to incorporate.

A retired observation is not returned — the list omits it — so there is nothing to skip and no
marker in the text to read for.

The per-skill part is what an incorporated lesson *changes*: which step or phase a category routes
to, or, where a skill has no such routing, what a lesson turns into instead. A lesson that cannot be
turned into something this skill does is one to leave.

**A skill that must not merely offer this may replace step 4 with a gate of its own** — `dpm:do`
does, requiring a disposition per observation and recording each as a row. Steps 1 to 3 are the same
either way.

## Gate Presentation

The host's tool is **`question`**, and every gate in every skill goes through it. It carries the
*gate*, not the *content*: the panel that renders it is sized for short prompts and short option
labels, and long content is truncated there.

**A gate is two steps, and every skill writes them as two steps.**

1. **Render** what is being decided in the message body — documents, drafts, alternatives, tables,
   lists of proposed changes. If what the user needs to read runs past a sentence or two, it
   belongs here. It belongs in the same message as the call in step 2: not in reasoning, which the
   user does not see, and not only in an earlier message, which is no longer the one being answered.
   **Every gate renders its own draft, including the one straight after another gate.** The next
   decision worked out in reasoning after an answer is not rendered until it is copied into the
   reply — an MTPLX epics run blocked five gates in a row on exactly that. **A draft put up for
   approval is rendered as its items** — the stories, criteria or tags themselves, as a list or a
   table. A sentence about the draft is not the draft, and the host refuses a gate asking for approval
   whose message has neither a list nor a table.
2. **Then call `question`**, carrying only the decision — "Approve" / "Request changes" / "Stop",
   or "Choose A / B / C".

**Step 1 is the one that gets dropped**, and a gate with nothing above it asks the user to approve
something they have not been shown.

**An approved decision is carried out, not asked again.** Once a gate is approved, write what it
approved before the next gate. The host refuses a gate with the same `header` as one approved until
something is written, and says which answer it was.

**A gate that is only a selection still gets a sentence.** Offering the specs in the project, or
asking whether to sweep evenly or focus, puts every choice in the `options` already; there is no
separate artefact, and a message body repeating the option labels is noise. So the render shrinks to
one line of framing — what is being chosen, and why now — rather than disappearing. A gate whose own
message has no text is refused by the host, whichever kind it is.

**The shape it takes, because getting it wrong costs a round trip each time.** `questions` is an
array, and each entry requires `question` (the whole question), `header` (a very short label, 30
characters at most) and `options`, each option requiring both a `label` of a few words and a
`description` saying what choosing it means. `multiple: true` allows more than one answer and is
the only optional field. A "Type your own answer" option is added for you, so do not write an
"Other" — and where you recommend one, put it first and end its label with "(Recommended)".

**There is no `preview` field on an option.** A skill that wrote one would have it dropped in
silence, so a comparison the user needs to see — two wordings, two layouts — goes in the message
body with everything else, which is where the room is.

## Perspectives

Some sections invite agent personas to weigh in before the user decides.

1. **Load the roster** with `dpm_list_agent`, passing `include_body`. Its rows carry
   `display_name`, `icon`, `role`, `personality` and `communication_style` — **the last two are body
   columns**, so without that argument the list comes back with names and roles and the voices below
   are woven from nothing. A project that added a persona has it in that list; nothing is read from
   a file and nothing is invented beyond the row.
2. **Select two or three** whose `role` and `personality` bear on the decision at hand.
3. **Each gives one or two sentences in character**, formatted `{icon} **{display_name}**:
   {perspective}`. Let `communication_style` and `personality` drive tone and framing so the voices
   stay distinct.
4. **A perspective that only echoes what has been said is skipped.** The value is in surfacing a
   trade-off or challenging an assumption.
5. **Weave them into the facilitation** before the user decides, rather than presenting them as a
   section of their own.

If `dpm_list_agent` returns nothing, skip perspectives and carry on.

## Conversational Output

A skill's product is the rows it writes and the artefact rendered from them; the conversation around
it is scaffolding.

Between gates the useful shapes are: the content itself followed by the gate; one line recording
what was decided and where it went; the step and what it found rather than the process; and
anything unexpected said plainly with its evidence, at the moment it turns up rather than saved for
a summary.

The test is whether someone reading only the narration still knows where they are and what was
decided.

### Disposition

Every item a report mentions carries one of four dispositions, and the disposition names what the
**reader** has to do about it rather than what you did:

- **Fixed** — the repo is different now; read it and carry on.
- **Left alone** — it was seen and deliberately not acted on; nothing is waiting.
- **Unverified** — the check was impossible here, so the claim is still open; the reason names what
  would close it.
- **Needs you** — it is waiting on the reader, and nothing else in the report is.

The four are the `disposition` domain. Read them with `list_taxonomy` and render them in the
`position` order the domain carries, rather than transcribing the labels or the order into a skill.

**The label follows the reader's obligation, not your action.** Something fixed that is also worth a
glance is Fixed with the note attached, never Needs you. A Needs you that absorbs "and you may want
to look at this" stops meaning anything, and the one item that was genuinely waiting is then lost
among the ones that were not.

**An item that fits none of the four is not reported.** Work considered and rejected, the steps
taken to reach an answer, and a restatement of what the reader has just approved carry no
disposition, because there is nothing for the reader to do with any of them.

**A disposition with no items is not rendered at all** — no heading, no "nothing to report" line.
The same rule one level up: a block saying it is empty is a block the reader has to read to learn
there was nothing in it, and a report whose four headings are always present costs its reader four
readings to find the one or two that carry anything. A run that fixed everything it touched says so
in one block and stops. Absence is read from the absence of the heading, so the surviving blocks
still arrive in the order above and the reader may still stop once the actionable one has passed.

**In a report, the order is fixed** — Fixed, Left alone, Unverified, then Needs you last and
together, each one written as an imperative naming the action and where to take it. A reader who
stops after the third block has missed nothing that was waiting for them, which is what fixing the
order buys. This is the arrangement of a report; something unexpected found mid-work is still said
when it turns up, and carries its disposition there.

**Unverified means the check is impossible in this environment**, and the item says why. Two cases
qualify, both structural: a `target` criterion, whose environment nobody here has, and a must-NOT
with no control, where nothing available can make the check fail. A reason about how the run went —
the tests fail, it was not implemented, there was no time — is **Needs you** instead, however
genuinely it blocked you.

## Written Deliverable Length

Let a document's length match what the task needs. A spec covering three requirements is shorter
than one covering thirty, and that is the right outcome rather than an incomplete one.

Leave out padding that restates a point because a section looked thin, closing recaps of what the
reader has just read, and headings kept because a template offered them and then filled with "N/A".

This is calibration, not a budget. No artefact carries a fixed word or section count.

## Cross-References

A sentence in one artefact naming another — an epic's notes saying which epic holds the other half,
an observation citing the spec it came from — is written `{{ref:<id>}}`, carrying the target's id.
The renderer resolves the marker to that document's current human identifier.

**Never write the number.** It is correct on the day it is written and stops being correct the
moment anything renumbers its target, and by then nothing can find it to repair: a number inside a
sentence is indistinguishable from every other number in that sentence. The id is already in hand —
it is what the list or read tool that found the artefact returned — so the marker costs nothing that
the number does not.

**A structural reference is not this.** Where the relationship is a column — an epic's spec, a
coverage row's requirement, an artifact's document — write the foreign key and leave the prose
alone. A marker beside a foreign key is one fact recorded twice, and the two disagree the first time
either is edited.

**Something that is not a document gets no marker.** A commit, a ticket, a URL, a file in the
repository: none has an id, so each is named plainly in the prose as what it is. A marker naming
something that cannot be resolved is refused at render time, so inventing one to look consistent
turns a loose reference into a projection that will not build.

## Naming a Document

**Say the reference and the title** — `<reference>`, then the document's own title, taken from the
row you already hold. That pair is what a person can read back to you, name in a request, and find
in the rendered tree, and every list or read tool returns the reference on the row beside the columns
it was asked for — so the naming costs the run nothing it has not already paid for.

The reference goes in as the row gave it, never written out from memory. **The id keeps the two
places it works**: a tool argument and a foreign key.

**Where a reference is `null`, say the title and the kind and say the document has no reference
yet** — *the untitled scratch document, which has no reference yet*. A row numbered `none`, or one
with no root-numbered ancestor, legitimately has none.

**This governs what is said; Cross-References governs what is stored.** A document named inside
stored prose — a body, a plan, a decision, an observation — is written `{{ref:<id>}}`. It is the
same rule: both end at the identifier the projection computes.

## Artifact Publishing

A skill may publish an HTML artifact from its output **on request**. It is always separately
confirmed and never the default.

1. **Offer only when asked**, or when the skill's own text names an artifact worth offering.
2. **Confirm with a gate** before publishing. Publishing puts the content on a URL.
3. **Justify it in one line** — what the visual carries that the prose cannot. If that line cannot
   be written, the artifact has not earned its place.
4. **The artifact is a view, never a source.** Nothing reads it back; the rows remain the record.

## A Closing Note on Tone

Keep the tone plain and direct, warm enough to be good company across a long facilitation. State
confidence where the evidence supports it and uncertainty where it does not; neither needs padding.
