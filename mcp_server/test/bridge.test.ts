import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { BridgeServer } from '../src/bridge.js';
import { RemoteBridge } from '../src/remote_bridge.js';
import { Workspace } from '../src/workspace.js';

async function waitMessage(socket: WebSocket): Promise<any> {
  return await new Promise((resolve, reject) => {
    socket.once('message', raw => resolve(JSON.parse(raw.toString())));
    socket.once('error', reject);
  });
}

test('bridge performs hello and command round trip', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-bridge-'));
  const bridge = new BridgeServer(new Workspace(root), 43129);
  bridge.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  const socket = new WebSocket('ws://127.0.0.1:43129/snowstorm', {origin: 'http://localhost:3000'});
  await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
  socket.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: 0}));
  const hello = await waitMessage(socket);
  assert.equal(hello.type, 'hello_ack');

  const responsePromise = bridge.request('get_state');
  const request = await waitMessage(socket);
  assert.equal(request.payload.command, 'get_state');
  socket.send(JSON.stringify({protocolVersion: 1, sessionId: hello.sessionId, requestId: request.requestId, revision: 0, type: 'command_result', payload: {ok: true, result: {revision: 0}}}));
  assert.deepEqual(await responsePromise, {revision: 0});
  socket.close();
  await bridge.stop();
});

test('controller can share the bridge with the single editor page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-controller-'));
  const bridge = new BridgeServer(new Workspace(root), 43130);
  bridge.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  const page = new WebSocket('ws://127.0.0.1:43130/snowstorm', {origin: 'file://'});
  await new Promise<void>((resolve, reject) => { page.once('open', () => resolve()); page.once('error', reject); });
  page.send(JSON.stringify({protocolVersion: 1, type: 'hello', revision: 0}));
  const hello = await waitMessage(page);
  const remote = new RemoteBridge(43130);
  await remote.connect();
  const command = new Promise<any>(resolve => page.once('message', raw => resolve(JSON.parse(raw.toString()))));
  const result = remote.request('get_state');
  const request = await command;
  assert.equal(request.payload.command, 'get_state');
  page.send(JSON.stringify({protocolVersion: 1, sessionId: hello.sessionId, requestId: request.requestId, revision: 0, type: 'command_result', payload: {ok: true, result: {revision: 0}}}));
  assert.deepEqual(await result, {revision: 0});
  page.close();
  await remote.stop();
  await bridge.stop();
});
