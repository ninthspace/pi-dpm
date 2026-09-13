/**
 * Phase 0 of the pi port — dpm's tools, called through the pi CLI against a real database.
 *
 * **pi is spawned as a command and never imported**, which is how this suite reaches every
 * development dependency: `tsc` is run from `node_modules/typescript/bin`, and nothing imports it.
 * `reference-environment.test.js` holds the rule — a test imports `node:` builtins and relative
 * paths, and nothing else.
 *
 * **What is real, and what is scripted.** The installed pi CLI runs in RPC mode and loads
 * `extensions/dpm` through its own loader. It calls the model through the same `openai-completions`
 * provider a local MTPLX endpoint uses. The one stand-in is the endpoint itself: an HTTP server
 * inside this test that streams the replies a model would. It also records every request, so the
 * assertions read what pi actually sent the model — the tool list on the first request, and the
 * tool result on the next.
 *
 * **Why not MTPLX.** A local model run is slow, and it competes with whoever is using `:8000`. The
 * port specification says to ask before each measurement run. What this file proves does not depend
 * on which model reads the result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { PREFIX } from '../extensions/dpm/adapter.ts';
import { advertisedTools } from '../src/server/index.ts';
import { ownedDirectory } from './support/scratch.js';

const ROOT = join(import.meta.dirname, '..');

/** The CLI `npm ci` installs — the package's own `bin` entry. */
const PI = join(ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');

const EXTENSION = join(ROOT, 'extensions', 'dpm');

/** A spec the committed dump is known to hold. */
const KNOWN_SPEC = 'opencode-dpm: port DPM to OpenCode v2';

/** How long one pi run may take before the test gives up on it. */
const RUN_LIMIT_MS = 90_000;

// --- The scripted model ----------------------------------------------------------------------------

/** One streamed chunk in OpenAI's chat-completions shape. */
const chunk = (delta, finish = null) => ({
  id: 'scripted',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** A turn that calls one tool. */
const callsTool = (name, args) => [
  chunk({
    role: 'assistant',
    tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }),
  chunk({}, 'tool_calls'),
];

/** A turn that answers in text and stops. */
const answers = (text) => [chunk({ role: 'assistant', content: text }), chunk({}, 'stop')];

/**
 * An endpoint that replies with `turns` in order and records each request body.
 *
 * @param {import('node:test').TestContext} t Owns the server's shutdown.
 * @param {object[][]} turns
 * @returns {Promise<{baseUrl: string, requests: any[]}>}
 */
async function scriptedModel(t, turns) {
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

// --- The pi run ------------------------------------------------------------------------------------

/**
 * A scratch project holding only the committed dump, and a pi home pointed at the scripted model.
 *
 * The first tool call restores `.dpm/dpm.db` from the dump — the MCP server's first-call bring-up,
 * running unchanged inside pi.
 */
function scratchProject(t, baseUrl) {
  const project = ownedDirectory(t, 'dpm-pi-');
  const home = join(project, 'pi-home');

  mkdirSync(join(project, '.dpm'));
  mkdirSync(home);
  copyFileSync(join(ROOT, '.dpm', 'dpm.sql'), join(project, '.dpm', 'dpm.sql'));

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

/**
 * Run one prompt through pi in RPC mode, then read back the messages pi recorded.
 *
 * Discovery is off — no other extensions, skills, prompts, themes or context files — and the
 * built-in tools are off, so dpm's are the only tools in the request. `PI_CODING_AGENT_DIR` keeps
 * the user's `~/.pi` out of the run entirely.
 *
 * @returns {Promise<{messages: any[], stderr: string}>}
 */
function runPrompt({ project, home }, message) {
  const child = spawn(process.execPath, [
    PI, '--mode', 'rpc', '--no-session',
    '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
    '--no-builtin-tools',
    '-e', EXTENSION,
    '--provider', 'scripted', '--model', 'scripted',
  ], {
    cwd: project,
    stdio: ['pipe', 'pipe', 'pipe'],
    // `DPM_DATABASE` inherited from the parent would move the database out of the project this test
    // watches, and blanking it is not enough: `location.ts` reads it with `??`, so an empty string
    // would itself become the path. It is removed.
    env: { ...withoutDatabaseOverride(), PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1' },
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let messages = null;

    const fail = (reason) => {
      child.kill();
      reject(new Error(`${reason}\n--- stderr ---\n${stderr}`));
    };
    const timer = setTimeout(() => fail(`pi did not finish within ${RUN_LIMIT_MS}ms`), RUN_LIMIT_MS);

    const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);

    child.stderr.on('data', (part) => {
      stderr += part;
    });

    // RPC framing is LF-delimited JSON. `readline` also splits on U+2028, which is valid inside JSON.
    child.stdout.on('data', (part) => {
      stdout += part;

      let newline = stdout.indexOf('\n');

      while (newline !== -1) {
        const line = stdout.slice(0, newline).replace(/\r$/, '');

        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf('\n');

        if (line.trim() === '') continue;

        const record = JSON.parse(line);

        if (record.type === 'response' && record.success === false) {
          fail(`pi refused ${record.command}: ${record.error}`);
        } else if (record.type === 'agent_settled') {
          send({ id: 'messages', type: 'get_messages' });
        } else if (record.type === 'response' && record.command === 'get_messages') {
          messages = record.data.messages;
          child.stdin.end();
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);

      if (messages === null) {
        reject(new Error(`pi exited ${code} before reporting its messages\n--- stderr ---\n${stderr}`));
      } else {
        resolve({ messages, stderr });
      }
    });

    send({ id: 'prompt', type: 'prompt', message });
  });
}

/** The environment a run sees, with `DPM_DATABASE` removed rather than blanked. */
function withoutDatabaseOverride() {
  const { DPM_DATABASE: _ignored, ...rest } = process.env;

  return rest;
}

/** The one tool result pi recorded. */
function toolResult(messages) {
  const results = messages.filter((message) => message.role === 'toolResult');

  assert.equal(results.length, 1, `pi recorded ${results.length} tool results`);

  return results[0];
}

/** A message's text, whether it arrived as a string or as content blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : content.map((block) => block.text ?? '').join('\n'));

// --- The tests -------------------------------------------------------------------------------------

test('pi sends the model every registry tool under its dpm_ name, and a turn with no call creates no database [integration]', { timeout: RUN_LIMIT_MS + 10_000 }, async (t) => {
  assert.ok(existsSync(PI), 'pi is installed from devDependencies rather than fetched');

  const model = await scriptedModel(t, [answers('Nothing to do.')]);
  const scratch = scratchProject(t, model.baseUrl);

  await runPrompt(scratch, 'Say hello.');

  assert.equal(model.requests.length, 1, `the scripted model was asked ${model.requests.length} times`);

  const sent = model.requests[0].tools.map((tool) => tool.function.name);
  const expected = advertisedTools().map((tool) => `${PREFIX}${tool.name}`);

  // Derived from the registry, never a restated 184 (T1).
  assert.ok(expected.length > 100, `the registry built ${expected.length} tools, which is not dpm's`);
  assert.deepEqual([...sent].sort(), [...expected].sort(),
    'the tools pi put in front of the model are not the registry');

  // The schema reaches the model as the registry wrote it: no typebox wrapping, nothing dropped.
  const listSpec = model.requests[0].tools.find((tool) => tool.function.name === `${PREFIX}list_spec`);
  const { inputSchema } = advertisedTools().find((tool) => tool.name === 'list_spec');

  assert.deepEqual(listSpec.function.parameters, inputSchema);

  // The deferral the MCP server has, kept: a session that calls nothing creates nothing.
  assert.equal(existsSync(join(scratch.project, '.dpm', 'dpm.db')), false,
    'loading the extension created the database before any tool was called');
});

test('dpm_list_spec round-trips through pi against a database restored from the dump [integration]', { timeout: RUN_LIMIT_MS + 10_000 }, async (t) => {
  const model = await scriptedModel(t, [callsTool(`${PREFIX}list_spec`, {}), answers('done')]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages } = await runPrompt(scratch, 'Which specifications are there?');
  const result = toolResult(messages);

  assert.equal(result.toolName, `${PREFIX}list_spec`);
  assert.equal(result.isError, false, `the call failed: ${textOf(result.content)}`);
  assert.equal(existsSync(join(scratch.project, '.dpm', 'dpm.db')), true,
    'the call answered without the database it should have restored');

  // And the far end of the round trip: what went back to the model on its next request.
  assert.equal(model.requests.length, 2, `the scripted model was asked ${model.requests.length} times`);

  const returned = model.requests[1].messages.filter((entry) => entry.role === 'tool');

  assert.equal(returned.length, 1, 'the second request carries no tool result');

  const { items } = JSON.parse(textOf(returned[0].content));

  assert.ok(items.map((item) => item.title).includes(KNOWN_SPEC),
    `the specs the model was sent do not include the one the dump holds: ${items.map((item) => item.title)}`);
});

test('a handler refusal is recorded as an error rather than an answer [integration]', { timeout: RUN_LIMIT_MS + 10_000 }, async (t) => {
  // Well-formed for the schema, so pi's own validation passes it and the refusal is dpm's (R2).
  const model = await scriptedModel(t, [
    callsTool(`${PREFIX}read_spec`, { id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }),
    answers('done'),
  ]);
  const scratch = scratchProject(t, model.baseUrl);

  const { messages } = await runPrompt(scratch, 'Read that specification.');
  const result = toolResult(messages);

  // The list_spec test above is the control: there, the same path recorded `isError: false`.
  assert.equal(result.isError, true, `a refusal was recorded as a success: ${textOf(result.content)}`);
  assert.match(textOf(result.content), /read_spec/, 'the error does not name the tool that refused');
});
