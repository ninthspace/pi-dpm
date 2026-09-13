/**
 * The pi extension — dpm's tools, registered in-process.
 *
 * Phase 0 of the pi port: tools only. No gate tool, no per-skill activation, no commands and no
 * session announcement yet, so every one of the 184 tools is active and nothing narrows them.
 *
 * **The database opens on the first tool call and never at load**, as it does under the MCP server.
 * pi runs extension factories in invocations that start no session at all, and a factory that
 * opened `.dpm/dpm.db` would create a planning database in every directory pi was run in.
 *
 * **The location is `DATABASE`, relative to the process's working directory** — the server's
 * behaviour, kept exactly. pi's `ctx.cwd` can differ from it, and whether it should win is a Phase 1
 * question rather than one to settle inside a spike.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Tool } from '../../src/server/mcp.ts';

import { DATABASE } from '../../src/db/location.ts';
import { advertisedTools, open } from '../../src/server/index.ts';
import { register } from './adapter.ts';

export default function dpm(pi: ExtensionAPI): void {
  let live: readonly Tool[] | null = null;

  register(pi, advertisedTools(), () => {
    live ??= open(DATABASE);

    return live;
  });
}
