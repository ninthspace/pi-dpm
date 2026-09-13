/**
 * Driving the installed pi CLI against a scripted model — shared by the pi port's tests.
 *
 * **pi is spawned as a command and never imported**, which is how this suite reaches every
 * development dependency: `tsc` is run from `node_modules/typescript/bin`, and nothing imports it.
 * `reference-environment.test.js` holds the rule — a test imports `node:` builtins and relative
 * paths, and nothing else.
 *
 * **What is real, and what is scripted.** The installed pi CLI loads `extensions/dpm` through its own
 * loader and calls the model through the same `openai-completions` provider a local MTPLX endpoint
 * uses. The one stand-in is the endpoint itself: an HTTP server on loopback that streams the replies a
 * model would, and records every request, so assertions read what pi actually sent.
 *
 * **Why not MTPLX.** A local model run is slow, and it competes with whoever is using `:8000`. The
 * port specification says to ask before each measurement run. What these tests prove does not
 * depend on which model reads the result.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { ownedDirectory } from './scratch.js';

export const ROOT = join(import.meta.dirname, '..', '..');

/** The CLI `npm ci` installs — the package's own `bin` entry. */
export const PI = join(ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');

export const EXTENSION = join(ROOT, 'extensions', 'dpm');

export const SKILLS = join(ROOT, 'skills');

/** How long one pi run may take before a test gives up on it. */
export const RUN_LIMIT_MS = 90_000;

/** A `node:test` timeout for a test that makes `runs` pi runs. */
export const limitFor = (runs = 1) => ({ timeout: RUN_LIMIT_MS * runs + 10_000 });

/**
 * Discovery off — no other extensions, skills, prompts, themes or context files — and the built-in
 * tools off, so dpm's are the only tools in the request. A test that wants dpm's skills adds
 * `--skill`, which loads even under `--no-skills`.
 */
export const ISOLATED = [
  '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
  '--no-context-files', '--no-builtin-tools', '-e', EXTENSION, '--provider', 'scripted', '--model', 'scripted',
];

// --- The scripted model ----------------------------------------------------------------------------

/** One streamed chunk in OpenAI's chat-completions shape. */
export const chunk = (delta, finish = null) => ({
  id: 'scripted',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** A turn that calls one tool, saying `text` first in the same message when it is given. */
export const callsTool = (name, args, text) => [
  chunk({
    role: 'assistant',
    ...(text === undefined ? {} : { content: text }),
    tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }),
  chunk({}, 'tool_calls'),
];

/** A turn that answers in text and stops. */
export const answers = (text) => [chunk({ role: 'assistant', content: text }), chunk({}, 'stop')];

/**
 * An endpoint that replies with `turns` in order and records each request body.
 *
 * @param {import('node:test').TestContext} t Owns the server's shutdown.
 * @param {object[][]} turns
 * @returns {Promise<{baseUrl: string, requests: any[]}>}
 */
export async function scriptedModel(t, turns) {
  const requests = [];

  const server = createServer((request, response) => {
    let body = '';

    request.on('data', (part) => {
      body += part;
    });
    request.on('end', () => {
      requests.push(JSON.parse(body));

      // A request beyond the script is a failure the test should see, not a hang.
      const turn = turns[requests.length - 1] ?? answers(`unscripted request ${requests.length}`);

      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const part of turn) response.write(`data: ${JSON.stringify(part)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

// --- The project ------------------------------------------------------------------------------------

/**
 * A scratch project holding only the committed dump, and a pi home pointed at the scripted model.
 *
 * The first tool call restores `.dpm/dpm.db` from the dump — the MCP server's first-call bring-up,
 * running unchanged inside pi. `PI_CODING_AGENT_DIR` points at `home`, so the user's `~/.pi` is out
 * of the run entirely.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} baseUrl
 * @param {{settings?: object}} [options] Written to the project's `.pi/settings.json` when given.
 */
export function scratchProject(t, baseUrl, { settings } = {}) {
  const project = ownedDirectory(t, 'dpm-pi-');
  const home = join(project, 'pi-home');

  mkdirSync(join(project, '.dpm'));
  mkdirSync(home);
  copyFileSync(join(ROOT, '.dpm', 'dpm.sql'), join(project, '.dpm', 'dpm.sql'));

  if (settings !== undefined) {
    mkdirSync(join(project, '.pi'));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify(settings));
  }

  writeFileSync(join(home, 'models.json'), JSON.stringify({
    providers: {
      scripted: {
        baseUrl,
        api: 'openai-completions',
        apiKey: 'scripted',
        models: [{
          id: 'scripted',
          name: 'Scripted',
          reasoning: false,
          input: ['text'],
          contextWindow: 32768,
          maxTokens: 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }));

  return { project, home };
}

/** The environment a run sees, with `DPM_DATABASE` removed rather than blanked — `location.ts` reads it with `??`. */
function withoutDatabaseOverride() {
  const { DPM_DATABASE: _ignored, ...rest } = process.env;

  return rest;
}

/**
 * Spawn pi and hand each JSON line it prints to `onRecord`.
 *
 * Framing is LF-delimited JSON. `readline` also splits on U+2028, which is valid inside JSON, so the
 * split is done here.
 *
 * @returns {{child: import('node:child_process').ChildProcess, send: (command: object) => void, done: Promise<{code: number | null, stderr: string}>}}
 */
function spawnPi({ project, home }, argv, onRecord) {
  const child = spawn(process.execPath, [PI, ...argv], {
    cwd: project,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...withoutDatabaseOverride(), PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1' },
  });

  let stdout = '';
  let stderr = '';

  child.stderr.on('data', (part) => {
    stderr += part;
  });
  child.stdout.on('data', (part) => {
    stdout += part;

    let newline = stdout.indexOf('\n');

    while (newline !== -1) {
      const line = stdout.slice(0, newline).replace(/\r$/, '');

      stdout = stdout.slice(newline + 1);
      newline = stdout.indexOf('\n');

      if (line.trim() !== '' && line.startsWith('{')) onRecord(JSON.parse(line));
    }
  });

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`pi did not finish within ${RUN_LIMIT_MS}ms\n--- stderr ---\n${stderr}`));
    }, RUN_LIMIT_MS);

    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

  return { child, send: (command) => child.stdin.write(`${JSON.stringify(command)}\n`), done };
}

/**
 * Run one prompt through pi in RPC mode, then read back its state and the messages it recorded.
 *
 * **The run ends at the first of three things**: the agent settling, an extension error, or pi
 * refusing the prompt. The last two are outcomes some tests expect, so they are collected rather
 * than thrown.
 *
 * **Dialogs are answered by `answer`**, which is handed each `extension_ui_request` and returns the
 * response fields — `{ value }`, `{ confirmed }` — or `undefined` to cancel. Fire-and-forget
 * requests such as `notify` are only recorded.
 *
 * @param {{project: string, home: string}} scratch
 * @param {string} message
 * @param {{args?: string[], answer?: (request: any) => object | undefined}} [options]
 */
export async function runPrompt(scratch, message, { args = [], answer = () => undefined } = {}) {
  const outcome = { messages: null, state: null, dialogs: [], notices: [], errors: [], refusals: [] };
  let finishing = false;

  const finish = () => {
    if (finishing) return;
    finishing = true;
    pi.send({ id: 'state', type: 'get_state' });
    pi.send({ id: 'messages', type: 'get_messages' });
  };

  const pi = spawnPi(scratch, ['--mode', 'rpc', ...ISOLATED, ...args], (record) => {
    if (record.type === 'response' && record.success === false) {
      outcome.refusals.push(record);
      finish();
    } else if (record.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(record.method)) {
        outcome.dialogs.push(record);
        pi.send({ type: 'extension_ui_response', id: record.id, ...(answer(record) ?? { cancelled: true }) });
      } else {
        outcome.notices.push(record);
      }
    } else if (record.type === 'extension_error') {
      outcome.errors.push(record);
      finish();
    } else if (record.type === 'agent_settled') {
      finish();
    } else if (record.type === 'response' && record.command === 'get_state') {
      outcome.state = record.data;
    } else if (record.type === 'response' && record.command === 'get_messages') {
      outcome.messages = record.data.messages;
      pi.child.stdin.end();
    }
  });

  pi.send({ id: 'prompt', type: 'prompt', message });

  const { code, stderr } = await pi.done;

  if (outcome.messages === null) throw new Error(`pi exited ${code} before reporting its messages\n--- stderr ---\n${stderr}`);

  return { ...outcome, stderr };
}

/**
 * The commands pi reports over RPC — extension commands, prompt templates and skills.
 *
 * This is the pi counterpart of `opencode debug skill`: `get_commands` lists every loaded skill as
 * `skill:<name>` with the path it came from.
 *
 * @param {{project: string, home: string}} scratch
 * @param {string[]} argv Everything after `--mode rpc`.
 * @returns {Promise<any[]>}
 */
export async function listCommands(scratch, argv) {
  let commands = null;

  const pi = spawnPi(scratch, ['--mode', 'rpc', ...argv], (record) => {
    if (record.type === 'response' && record.command === 'get_commands') {
      commands = record.data.commands;
      pi.child.stdin.end();
    }
  });

  pi.send({ id: 'commands', type: 'get_commands' });

  const { code, stderr } = await pi.done;

  if (commands === null) throw new Error(`pi exited ${code} before listing its commands\n--- stderr ---\n${stderr}`);

  return commands;
}

/**
 * Run one prompt in JSON mode, where pi has no UI, and return every event it printed.
 *
 * @param {{project: string, home: string}} scratch
 * @param {string} message
 * @returns {Promise<{records: any[], code: number | null, stderr: string}>}
 */
export async function runJson(scratch, message) {
  const records = [];
  const pi = spawnPi(scratch, ['--mode', 'json', ...ISOLATED, message], (record) => records.push(record));

  pi.child.stdin.end();

  return { records, ...(await pi.done) };
}

// --- Reading what came back -------------------------------------------------------------------------

/** Every tool result pi recorded. */
export const toolResults = (messages) => messages.filter((message) => message.role === 'toolResult');

/** A message's text, whether it arrived as a string or as content blocks. */
export const textOf = (content) => (typeof content === 'string'
  ? content
  : content.map((block) => block.text ?? '').join('\n'));

/** The tool names on one recorded request, sorted. */
export const toolsSent = (request) => (request.tools ?? []).map((tool) => tool.function.name).sort();
