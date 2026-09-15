/**
 * The pi extension — dpm's tools, its gate, its commands, per-skill activation and the session id.
 *
 * Phase 1 of the pi port. Each file named below carries its own argument; this one only wires them,
 * and wires them in an order that matters in one place: the announcement's switch is created before
 * activation, which is what arms it.
 *
 * - `adapter.ts` — the registry's tools under `dpm_` names.
 * - `gate.ts` — `question`, the tool every skill decides through.
 * - `commands.ts` — `/dpm-*`, each a route to `/skill:dpm-*`.
 * - `activation.ts` — a skill's own tools, and no other dpm tools, from the turn it opens.
 * - `session.ts` — the harness session id, told to the model on that same turn.
 * - `handoff.ts` — `handoff` and `/dpm-continue`, a run continued in a fresh context.
 *
 * **The database opens on the first tool call and never at load**, as it does under the MCP server.
 * pi runs extension factories in invocations that start no session at all, and a factory that
 * opened `.dpm/dpm.db` would create a planning database in every directory pi was run in.
 *
 * **The location is `DATABASE`, relative to the process's working directory**, which is the server's
 * behaviour kept exactly. pi's `ctx.cwd` can differ from it. Whether it should win is still open,
 * and it is recorded here rather than decided silently.
 *
 * **Skills are not contributed from here.** pi takes them from a `skills` setting now, and from the
 * package manifest in Phase 3. An extension that also returned them from `resources_discover` would
 * register each skill twice once the manifest exists. `commands.ts` refuses loudly when they are
 * missing.
 */

import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Tool } from '../../src/server/mcp.ts';

import { DATABASE } from '../../src/db/location.ts';
import { allowances } from '../../src/plugin/allowlist.ts';
import { packageRoot, SKILLS_DIRECTORY } from '../../src/plugin/root.ts';
import { discoverSkills } from '../../src/plugin/skills.ts';
import { advertisedTools, open } from '../../src/server/index.ts';
import { activateSkills } from './activation.ts';
import { register } from './adapter.ts';
import { registerCommands } from './commands.ts';
import { registerGate } from './gate.ts';
import { registerHandoff } from './handoff.ts';
import { plans, registerPhases } from './phases.ts';
import { announceSession } from './session.ts';

export default function dpm(pi: ExtensionAPI): void {
  // `packageRoot` climbs two directories from where it is given, which from here is the checkout.
  const root = packageRoot(import.meta.dirname);
  let live: readonly Tool[] | null = null;

  register(pi, advertisedTools(), () => {
    live ??= open(DATABASE);

    return live;
  });
  registerGate(pi);

  const skills = discoverSkills(root);

  registerCommands(pi, skills, join(root, SKILLS_DIRECTORY));

  const announcement = announceSession(pi);
  const phases = registerPhases(pi, plans(skills));

  activateSkills(pi, allowances(root), (skill) => announcement.arm(phases.activate(skill)));
  registerHandoff(pi, new Set(skills.map((skill) => skill.name)));
}
