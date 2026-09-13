---
name: dpm-consult
description: A focused consultation with one agent persona, or a small panel. You control who is in the room and who is driving; the conversation is saved as a discussion when it ends. Run with /dpm-consult.
thinking: medium
---

# Consult Mode

A one-to-one conversation with an expert persona, which becomes a panel only when you invite one.
You lead by default and can hand the lead to an agent when you want them to drive.

Follow the shared conventions — call `dpm_read_shared_document` with `name: "skill-conventions"`
at startup and read what it returns.
This skill uses **Session Startup**, **Library Check**, **Conversational Output**,
**Gate Presentation** and **Cross-References** from it.

## Startup

1. **Session** — follow the shared **Session Startup** procedure with skill `dpm:consult`. A
   consultation is the one thing here worth resuming: the session's `state` carries the topic, the
   active agents in order, who holds the lead, and the discussion highlights, and without it a
   resumed conversation is a different one with the same participants.
2. **Roster** — `dpm_list_agent`, then `dpm_read_agent` with `include_body` for each
   agent brought into the room. **The traits are body columns**, so the list gives you names and
   roles and the read gives you the voice; rendering a persona off the list alone is rendering it
   off nothing. **The roster is rows, so a persona this project added and the plugin never shipped
   is consultable by name** with no file edit anywhere.
3. **Library** — follow the shared **Library Check** procedure with scope keyword `consult`.

## Input

The request selects who and about what:

- **An agent name or role** — match it against `dpm_list_agent`, case-insensitively, against
  `display_name` and `role`. Start there and ask what they would like to discuss.
- **A topic with no agent** — infer the most relevant agent from the roster's `role` values,
  **confirm the choice before starting** — *"I'd suggest {icon} **{display_name}** ({role}) for this
  — start with them?"* — and take a different one where the user names one. An inferred agent is a
  guess about expertise, and starting on it unasked spends the first exchange correcting it.
- **A phrase naming something in the corpus** — `dpm_search` with it, and a `limit` above what
  the project plausibly holds. Hits come back as an `entity` and an `entity_id`; read each through
  the tool for its entity, passing `include_body` — `dpm_read_document_section`,
  `dpm_read_requirement`, `dpm_read_acceptance_criterion`,
  `dpm_read_story_criterion`, `dpm_read_finding`, `dpm_read_observation` or
  `dpm_read_task` — and use what they say as context. **The index covers requirement,
  criterion, finding, observation and task text as well as section bodies**, so a term used once
  inside a criterion is reachable, which is most of what a consultation is actually looking for.
- **A URL** — fetch it and use the content as context. External, so it is read rather than queried.
- **Nothing** — present the roster and ask who and what about.

## The conversation loop

For each message: check for a command first, then respond.

### Commands

- **Invite** — *"bring in the architect"*. Resolve against the roster by `display_name` or `role`,
  `dpm_read_agent` with `include_body` for their traits — `personality` and
  `communication_style` are withheld by default, and they are the traits — append them to the active
  list, and have them introduce themselves and respond. Already present is a no-op, said once.
- **Dismiss** — *"thanks Priya, you can go"*. Remove them. If they held the lead it returns to the
  user, said aloud. **Dismissing the last agent does not end the consultation** — ask who to bring
  in instead.
- **Lead transfer** — *"Margot, take the lead"*. Invite them first if they are not in the room, then
  mark their turns *(leading)*. A leading agent asks probing questions, proposes structure and
  challenges assumptions; the others defer and speak only when genuinely additive.
- **Exit** — *"wrap up"*, *"done"*, *"end consultation"*.

Distinguish a command from conversation. *"I'd like to dismiss that idea"* is not a dismissal. Where
it is ambiguous, treat it as conversation.

**Use "wrap up" as the exit word.** `exit` and `quit` are the CLI's and end the session outright,
which would leave the consultation unsaved.

### Responses

```
{icon} **{display_name}**: {response in character}
```

Render each voice from that agent's stored `personality` and `communication_style`, and **from
nothing else** — a trait not on the row is a trait invented for them. One agent means a dialogue, not
a panel: no multi-voice formatting, no roster header. Several means each responds in roster
`position` order, the first-invited agent first, and each shorter than they would be alone. Agents
answer the user rather than each other, and disagree where they genuinely differ — that tension is
most of why a second agent was invited.

**Research before asking.** A question about the corpus is answered with `dpm_search` and the
read tools; a question about code is answered by reading it. Ask the user about intent, priorities
and decisions — the things only they hold.

After each round, offer the exit quietly: *"Type **wrap up** to end the consultation, or carry on."*

## Saving the discussion

On exit, acknowledge in one sentence and write it down:

1. `dpm_create_discussion` with a `title` and a `slug` from the topic. The number is
   allocated; do not supply one.
2. One `dpm_create_document_section` per part of the record — the key points, the decisions
   with their reasoning, and the thread that was open when it ended — at the positions they should
   read in.
3. `dpm_create_document_agent` per agent who took part, with `document_kind` set to
   `discussion` and the `agent` name — everyone who was in the room, including any dismissed
   before the end.
4. `dpm_update_session` to close the run.

**Write the substance, not a summary of it.** The session state has been carrying decisions with
their reasoning; a discussion record that compresses them to bullets throws away the thing it exists
to keep. Length is the wrong economy here.

**Who was in the room is a row, and naming them in the prose is not the same fact.** A reader can
see the names either way; nothing else can. A run asking which discussions an agent took part in
reads rows, and a persona mentioned in a paragraph is invisible to it — which is also why a
dismissal is not a deletion here. The prose still reads however it needs to; it is not the record.

Then **offer, and do not run**: `dpm-discover`, `dpm-spec` or `dpm-epics` with this discussion as
their starting context, or nothing.

## Degradation

| Missing | Behaviour |
|---|---|
| The name or role matches no agent | Say so and show the roster. Do not consult the nearest match — a persona is the whole of what was asked for. |
| The roster is empty | Say so and stop. There is no consultation without an agent, and inventing one is the failure this skill is defined against. |
| The search returns nothing | Say the corpus holds nothing on the term and consult on what the user brings. An empty result is an answer. |
| The user exits without a topic ever forming | Save nothing. A discussion with no substance is a numbered file nobody will open. |

## Output

A `discussion` document, its sections and one `document_agent` row per participant, plus the session
row. **Nothing else is written**, and no file is composed by hand.

## Next Action

Offer the pipeline handoff above. A consultation earns itself by what someone does next with it.
