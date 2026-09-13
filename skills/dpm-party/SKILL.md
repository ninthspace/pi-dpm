---
name: dpm-party
description: A multi-persona discussion. The whole roster is in the room; two or three of them answer each turn, build on each other and disagree where they genuinely differ. Saved as a discussion when it ends. Run with /dpm-party.
thinking: medium
---

# Party Mode

Several specialists in one conversation, chosen per turn from what was just said. Where `consult` is
a room you staff, this is a room that staffs itself.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Session Startup**, **Library Check**, **Conversational Output** and
**Cross-References** from it.

## Startup

1. **Session** — follow the shared **Session Startup** procedure with skill `dpm:party`. The
   session's `state` carries the topic, the key points, the live thread and who has spoken recently;
   without it a resumed discussion loses the rotation and repeats the same two voices.
2. **Roster** — `dpm_list_agent` with `include_body` and a `limit` above what the project
   plausibly holds. **One call, and it must carry the body**: `display_name`, `icon` and `role` come
   back either way, but `personality` and `communication_style` are body columns, and they are the
   whole of what makes a voice a voice. **A persona this project added and the plugin never shipped
   is in that list**, so it takes part with no file edit anywhere. Present the roster compactly —
   icon, name, role — and ask what to discuss.
3. **Library** — follow the shared **Library Check** procedure with scope keyword `party`.

## Input

The request is the opening topic.

- **A description** — use it as the topic and go straight into the first round.
- **A phrase naming something in the corpus** — `dpm_search` with it, and a `limit` above what
  the project plausibly holds. Hits come back as an `entity` and an `entity_id`; read each through
  the tool for its entity, passing `include_body` — `dpm_read_document_section`,
  `dpm_read_requirement`, `dpm_read_acceptance_criterion`,
  `dpm_read_story_criterion`, `dpm_read_finding`, `dpm_read_observation` or
  `dpm_read_task`. To put a whole document in front of the room rather than one hit, take the
  `document_id` the read gave back and call `dpm_list_document_section` with it,
  `include_body` and a raised `limit`. **The artifact under discussion is read through those tools
  and through nothing else** — there is no path here that opens a file.
- **A URL** — fetch it and use the content as context. External, so it is read rather than queried.
- **Nothing** — ask what to discuss.

## The orchestration loop

For each message: pick who speaks, have them speak, then read the room.

### Selecting agents

Two or three, chosen from the topic:

- **Primary** — the closest `role` and `personality` match for what was just said.
- **Secondary** — a complementary or contrasting view.
- **Third, only when the topic earns it.** Three voices that agree are worth less than two that
  differ.

**An agent addressed by name responds**, plus one or two others. **Rotate**: an agent who has not
spoken for several turns and is even tangentially relevant is favoured, so the roster gets airtime
over a discussion rather than the same two carrying it. A retired agent is not offered — that is what
retirement means — and is still readable, so a record naming them still resolves.

### Responses

```
{icon} **{display_name}**: {response in character}
```

Render each voice from that agent's stored `personality` and `communication_style`, and **from
nothing else** — a trait not on the row is a trait invented for them, and the roster is the only
thing keeping these voices apart.

- **Reference each other.** Build on, extend, or push back on what another agent said, this turn or
  earlier.
- **Disagree where you genuinely differ.** An architect and a developer will not agree about
  abstraction; a PM and a designer will not agree about priority. That tension is why more than one
  agent is in the room, so let it stand rather than resolving it politely.
- **Be opinionated.** Every agent says what they would do, not only what they observe. Analysis with
  no recommendation is half an answer.
- **Stay short.** A few sentences each. The value is the spread of views, not the volume.
- **Research before asking.** A question about the corpus is answered with `dpm_search` and the
  read tools; a question about code is answered by reading it. Ask the user about intent, priorities
  and decisions — the things only they hold.

### Direction of travel

After the responses, name the phase the discussion is actually in:

- **Exploring** — still opening up. Say nothing; let it run.
- **Converging** — themes are forming, or a fork is crystallising:
  `🧭 **Emerging direction**: {one or two sentences}`
- **Ready to recommend** — it has landed:
  `💡 **The team recommends**: {one or two sentences}`, or, where the room is split but the options
  are clear, `💡 **Two paths forward**:` with each option and who backs it.

**Let convergence be earned.** Most discussions need several rounds of exploring first, and one can
move backwards when a new consideration reopens a settled question. Signal the phase the
conversation is in, not the one that would let it end.

Then offer the exit quietly: *"Type **wrap up** to end the discussion, or carry on."*

**Use "wrap up" as the exit word.** `exit` and `quit` are the CLI's and end the session outright,
which would leave the discussion unsaved.

## Saving the discussion

On exit, acknowledge in one sentence and write it down:

1. `dpm_create_discussion` with a `title` and a `slug` from the topic. The number is
   allocated; do not supply one.
2. One `dpm_create_document_section` per part of the record — the key points, the decisions
   with their reasoning, the direction the room arrived at, and anything still open — at the
   positions they should read in.
3. `dpm_create_document_agent` per agent who spoke, with `document_kind` set to `discussion`
   and the `agent` name — the whole room, not the ones quoted in the record.
4. `dpm_update_session` to close the run.

**Write the substance, not a summary of it.** A discussion is worth keeping for the reasoning behind
the direction, and a record compressed to bullets keeps the direction and throws away the reasoning.

**Who was in the room is a row, and naming them in the prose is not the same fact.** A reader can
see the names either way; nothing else can. A run asking which discussions an agent took part in
reads rows, and a persona mentioned in a paragraph is invisible to it — which is why the row goes in
for an agent whose contribution did not survive the edit. The prose still reads however it needs to;
it is not the record.

Then **offer, and do not run**: `dpm-discover`, `dpm-spec` or `dpm-epics` with this discussion as
their starting context, or nothing.

## Degradation

| Missing | Behaviour |
|---|---|
| The roster is empty | Say so and stop. There is no discussion without agents, and inventing one is the failure this skill is defined against. |
| A named agent matches nobody | Say so and show the roster. Do not substitute the nearest role — the user asked for a person. |
| The search returns nothing | Say the corpus holds nothing on the term and discuss what the user brings. An empty result is an answer. |
| The user exits before a topic forms | Save nothing. A discussion with no substance is a numbered record nobody will open. |

## Output

A `discussion` document, its sections and one `document_agent` row per participant, plus the session
row. **Nothing else is written**, and no file is composed by hand.

## Next Action

Offer the pipeline handoff above. A discussion earns itself by what someone does next with it.
