/**
 * dpm's tool registry, handed to pi as pi's own tools.
 *
 * **Nothing here speaks MCP, and that is the point of the port.** `src/server/mcp.ts` is a thin
 * adapter from the same `Tool` list onto JSON-RPC; this is the same adapter onto `pi.registerTool`,
 * with no subprocess, no transport and no handshake between the model and the handlers. The
 * handlers run in pi's own process against the same `DatabaseSync` the server would have opened.
 *
 * **The advertised list and the dispatched list are still two lists, for the MCP server's reason
 * (AD12).** What is registered is built from an in-memory template, so loading the extension creates
 * no `.dpm/` in a project that never calls a tool. What a call runs against is resolved on the first
 * call, against the real file. The two carry identical names and schemas by construction — see
 * `advertisedTools` in `src/server/index.ts`.
 */

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Tool } from '../../src/server/mcp.ts';

/**
 * What a dpm tool is called by, in every skill body and in the OpenCode allow-list (R18, R19).
 *
 * It was the MCP server's registered name, which OpenCode prefixed onto each tool. There is no
 * server here to supply it, so it is supplied explicitly — and it stays, because the 23 skill bodies
 * name `dpm_*` and a bare `list_spec` would be a tool none of them can find.
 */
export const PREFIX = 'dpm_';

/** `list_spec` → `List Spec`. TUI-only, so derived rather than kept beside 184 names (R4). */
export const labelFor = (name: string): string => name
  .split('_')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

/**
 * Register every advertised tool, dispatching each call to its live counterpart.
 *
 * **A handler's `ToolError` is left to throw (R2).** pi marks a result `isError` only when `execute`
 * throws; a returned object is a success whatever it contains. So catching the error to format it
 * would hand the model a refusal that reads as an answer.
 *
 * **No `promptSnippet` and no `promptGuidelines` (R3).** Either one rebuilds the system prompt when a
 * tool is activated, which is the cost per-step activation exists to avoid.
 *
 * @param advertised What is registered — names, descriptions and schemas.
 * @param resolve The live registry a call runs against, memoised by the caller.
 */
export function register(
  pi: ExtensionAPI,
  advertised: readonly Tool[],
  resolve: () => readonly Tool[],
): void {
  for (const tool of advertised) {
    pi.registerTool({
      name: `${PREFIX}${tool.name}`,
      label: labelFor(tool.name),
      description: tool.description,
      // A typebox schema is plain JSON Schema with no symbols attached, and pi validates a raw one
      // correctly — verified against pi 0.85.1's typebox 1.3.7. The cast is the type system's only.
      parameters: tool.inputSchema as unknown as ToolDefinition['parameters'],
      async execute(_toolCallId, params) {
        const live = resolve().find((candidate) => candidate.name === tool.name);

        // Unreachable while both lists come from the same registry, and loud if they ever do not: a
        // call answered by nothing would otherwise look like a tool that ran and returned `undefined`.
        if (!live) throw new Error(`${tool.name}: advertised but absent from the live registry`);

        const value = live.handler(params as object);

        return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value };
      },
    });
  }
}
