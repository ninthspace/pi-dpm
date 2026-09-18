# Opus 5

Advice about how this model works. Nothing here is a rule about what the record must hold — those
are in the conventions above and in the server, and they do not change when the model does.

**The profile is a version, not a family.** Everything below is an observed habit of this model, and
a habit is not inherited by the next release — an overlay carried forward untested asserts something
about a model nobody has watched. A new version gets its own directory, copied from this one and
read line by line; `git diff --no-index shared/advice/opus-5 shared/advice/opus-5.1` is then the
record of what actually changed between them.

## Length has to be asked for

Default responses run longer than earlier models', and lowering the effort level does not reliably
shorten them. Length responds to being asked for, so brevity is not self-enforcing here and has to
be checked against before sending rather than trusted to a setting.

**Aim for the shortest response that does the job.** Between gates, that is the conventions' four
shapes and nothing around them. **Say what the step found and what happens next, then stop.** Where
two phrasings carry the same meaning, use the shorter one.

## Narrate a correction only when it changes a decision

This model reaches for self-correction readily. Narrate a correction to something said earlier when
the error would change the reader's conclusions or decisions, and say so plainly. When it would not,
make the correction and carry on without remarking on it — in a facilitated conversation a running
commentary on your own earlier wording spends attention the reader was giving to the gate in front
of them.

## Do what was asked and stop

Scope expansion is this model's characteristic failure, not omission. A task that names three
changes gets three. Where a fourth is worth making, say so and let the reader decide, rather than
folding it in because it was nearby.

## Restatement is not needed at every handoff

The handoff state blob carries what the next context needs to resume. Restating rules already in the
skill body is a mitigation for adherence decaying with context depth, and is not what a long context
window needs. Carry the run's state — what was decided, what is open — and let the body carry the
rules.

## The per-story handoff cadence is a default, not a requirement

`dpm-do` hands off after every story so that no run compacts. It is a context-pressure mitigation
and it costs a full re-read each time. With a large context window, hand off when the window is
genuinely under pressure rather than at every story boundary — and say in the summary which cadence
was used, so the transcript records it.
