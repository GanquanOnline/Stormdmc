import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function waitForMessage(socket: WebSocket, predicate: (message: any) => boolean = () => true, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeout);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

async function connectPage(port: number): Promise<{socket: WebSocket; sessionId: string; hello: any}> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/snowstorm`, {origin: 'http://127.0.0.1:4174'});
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
      socket.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: 0}));
      const hello = await waitForMessage(socket, message => message.type === 'hello_ack');
      return {socket, sessionId: hello.sessionId, hello};
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Unable to connect to bridge on port ${port}`);
}

test('real stdio MCP server controls a mock Snowstorm page and saves approval', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-mcp-e2e-'));
  const port = 43131;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js', '--workspace', workspace, '--port', String(port)],
    cwd: path.resolve(process.cwd())
  });
  const client = new Client({name: 'snowstorm-e2e', version: '1.0.0'});
  let page: WebSocket | undefined;
  try {
    await client.connect(transport);
    const connected = await connectPage(port);
    page = connected.socket;
    const snapshot = {
      sessionId: connected.sessionId,
      revision: 0,
      connected: true,
      document: {path: null, identifier: null, dirty: false},
      particle: {format_version: '1.10.0', particle_effect: {description: {identifier: ''}}},
      texture: {path: null, dirty: false, width: 16, height: 16, hasData: false},
      preview: {paused: false, particleCount: 0},
      capabilities: ['set_input'],
      inputSchema: [{id: 'identifier', type: 'text'}]
    };
    page.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'command_request') return;
      const command = message.payload?.command;
      if (command === 'get_state') {
        page!.send(JSON.stringify({protocolVersion: 1, sessionId: connected.sessionId, requestId: message.requestId, revision: 0, type: 'command_result', payload: {ok: true, result: snapshot}}));
        return;
      }
      if (command === 'apply_actions') {
        const pending = {
          id: 'pending-e2e',
          sessionId: connected.sessionId,
          baseRevision: 0,
          revision: 1,
          status: 'pending_confirmation',
          documentPath: 'particles/e2e.particle.json',
          diff: [{path: 'particle_effect.description.identifier', before: '', after: 'demo:e2e'}],
          warnings: [],
          before: {particle: snapshot.particle, texture: {path: null, dataUrl: null, width: 16, height: 16, hasData: false}},
          after: {particle: {format_version: '1.10.0', particle_effect: {description: {identifier: 'demo:e2e'}}}, texture: {path: 'textures/particle/e2e', dataUrl: onePixelPng, width: 1, height: 1, hasData: true}}
        };
        snapshot.revision = 1;
        snapshot.document = {path: pending.documentPath, identifier: 'demo:e2e', dirty: true};
        page!.send(JSON.stringify({protocolVersion: 1, sessionId: connected.sessionId, requestId: message.requestId, revision: 1, type: 'command_result', payload: {ok: true, result: pending}}));
        page!.send(JSON.stringify({protocolVersion: 1, sessionId: connected.sessionId, revision: 1, type: 'approval_required', payload: {pending}}));
        return;
      }
      page!.send(JSON.stringify({protocolVersion: 1, sessionId: connected.sessionId, requestId: message.requestId, revision: snapshot.revision, type: 'command_result', payload: {ok: true, result: snapshot.preview}}));
    });

    const state = await client.callTool({name: 'snowstorm.get_state', arguments: {}});
    assert.equal(state.structuredContent.ok, true);
    assert.equal(state.structuredContent.state.inputSchema[0].id, 'identifier');

    const changed = await client.callTool({name: 'snowstorm.apply_actions', arguments: {actions: [{type: 'set_input', id: 'identifier', value: 'demo:e2e'}]}});
    assert.equal(changed.structuredContent.result.status, 'pending_confirmation');

    const pending = await client.callTool({name: 'snowstorm.get_pending_change', arguments: {}});
    assert.equal(pending.structuredContent.pending[0].id, 'pending-e2e');

    page.send(JSON.stringify({
      protocolVersion: 1,
      sessionId: connected.sessionId,
      revision: 1,
      type: 'approval_result',
      payload: {pendingId: 'pending-e2e', status: 'approved'}
    }));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspace, 'particles/e2e.particle.json'), 'utf8')).particle_effect.description.identifier, 'demo:e2e');
    assert.ok((await fs.stat(path.join(workspace, 'textures/particle/e2e.png'))).size > 0);
    const afterSave = await client.callTool({name: 'snowstorm.get_pending_change', arguments: {}});
    assert.deepEqual(afterSave.structuredContent.pending, []);

    const stale = await client.callTool({name: 'snowstorm.apply_actions', arguments: {expectedRevision: 99, actions: [{type: 'set_input', id: 'identifier', value: 'stale'}]}});
    assert.equal(stale.structuredContent.error.code, 'STALE_REVISION');
  } finally {
    page?.close();
    await client.close();
  }
});

test('bridge rejects a second active page session', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-mcp-busy-'));
  const port = 43132;
  const transport = new StdioClientTransport({command: process.execPath, args: ['dist/index.js', '--workspace', workspace, '--port', String(port)], cwd: path.resolve(process.cwd())});
  const client = new Client({name: 'snowstorm-busy', version: '1.0.0'});
  let first: WebSocket | undefined;
  let second: WebSocket | undefined;
  try {
    await client.connect(transport);
    first = (await connectPage(port)).socket;
    second = new WebSocket(`ws://127.0.0.1:${port}/snowstorm`, {origin: 'http://127.0.0.1:4174'});
    await new Promise<void>((resolve, reject) => {
      second!.once('open', resolve);
      second!.once('error', reject);
    });
    second.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: 0}));
    const response = await waitForMessage(second, message => message.type === 'error');
    assert.equal(response.payload.code, 'SESSION_BUSY');
  } finally {
    first?.close();
    second?.close();
    await client.close();
  }
});

test('stdio MCP server supports browser export mode without a workspace', async () => {
  const port = 43133;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js', '--port', String(port)],
    cwd: path.resolve(process.cwd())
  });
  const client = new Client({name: 'snowstorm-export-mode', version: '1.0.0'});
  let page: WebSocket | undefined;
  try {
    await client.connect(transport);
    const connected = await connectPage(port);
    page = connected.socket;
    let state = {
      revision: 0,
      connected: true,
      document: {path: null, identifier: null, dirty: false},
      particle: {format_version: '1.10.0', particle_effect: {description: {identifier: ''}}},
      texture: {path: null, dirty: false, width: 16, height: 16, hasData: false},
      preview: {},
      capabilities: []
    };
    page.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'command_request') return;
      page!.send(JSON.stringify({
        protocolVersion: 1,
        sessionId: connected.sessionId,
        requestId: message.requestId,
        revision: state.revision,
        type: 'command_result',
        payload: {ok: true, result: state}
      }));
    });
    const result = await client.callTool({name: 'snowstorm.get_state', arguments: {}});
    assert.equal(result.structuredContent.ok, true);
    assert.equal(connected.hello.payload.exportOnly, true);
    assert.equal(connected.hello.payload.workspace, null);
  } finally {
    page?.close();
    await client.close();
  }
});
