# Qwen3.8 27B

Advice about how this model works, observed across five driven runs of the dpm skills — one spec,
one epics and three do — served by MTPLX as `mtplx-qwen38-27b-optimized-speed-fp16`. Nothing here is
a rule about what the record must hold; those are in the conventions above and in the server, and
they do not change when the model does.

**There are no relaxations here, and that is not an omission.** The conventions are written
conservatively — they assume a short effective context, no memory between turns and an expensive
turn — and every one of those assumptions holds for this model. There is nothing in them to lift.
What follows is the other kind: things this model does that the conventions do not anticipate.

## Habits

### Step 1 of a gate is the one that gets dropped

The conventions say a gate is two steps: render what is being decided in the message body, then call
the question tool. This model reliably works the decision out in reasoning and calls the tool without
copying anything into the reply — which is a gate asking the user to approve something they cannot
see. The reasoning is not the message.

Before every gate, check the reply itself for the draft, not the thinking that produced it. A gate
that follows another gate is the likeliest to lose it, because the decision was reached while
answering the previous one.

*An epics run blocked five gates in a row on exactly this.*

### A plausible value is not a read value

Asked for a value it does not hold, this model supplies one that looks right rather than reading it
or refusing. The failure has no error in it and nothing downstream can tell the invented value from a
real one — which is what makes it the most dangerous habit here.

Every id comes from the call that returned it. Every timestamp comes from the clock, which means from
the server, which means you do not write one. If a value is needed and not in hand, the answer is
another read or a refusal, never a guess that fits the shape.

*A spec run invented an ADR option id that no row carried. A do run supplied
`verified_at: "2026-09-15T19:17:00Z"` — a plausible time it had never read off a clock.*

### An empty result is not a failed write

An empty page means the scope held nothing. This model reads it as the previous write having failed,
and writes again — so one lost read becomes a duplicate row, and the duplicate is a miscount at the
only place that counts.

When a list comes back empty, check the scope id before concluding anything about the write. A write
that succeeded and a scope that was wrong look identical from an empty page, and only one of them is
fixed by writing again.

*An epics run read an empty page as "the write never happened" and re-wrote ten tags.*

### The run's own account of itself is optimistic

Asked whether anything in the run warrants a retro, this model says no. It said no in all three do
runs — "every gate met on first assessment, first runs green, no unfinished story" — across runs that
between them logged eight tool errors, eleven handoffs, skipped phases and tasks closed with no
evidence of work.

Answer that question from the rows and the transcript rather than from recollection: tool errors that
were recovered, phases recorded out of order, a criterion met only on the second pass. If the answer
is still no, it is now a reading rather than an impression.
