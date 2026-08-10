import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Workspace, WorkspaceError } from '../src/workspace.js';

test('workspace accepts relative files and rejects traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-mcp-'));
  const workspace = new Workspace(root);
  assert.equal(workspace.resolve('particles/fire.particle.json'), path.join(root, 'particles', 'fire.particle.json'));
  assert.throws(() => workspace.resolve('../outside.json'), WorkspaceError);
  assert.throws(() => workspace.resolve(path.join(root, 'absolute.json')), WorkspaceError);
});

test('workspace writes and reads particle JSON atomically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-mcp-'));
  const workspace = new Workspace(root);
  const particle = {format_version: '1.10.0', particle_effect: {description: {identifier: 'test:fire'}}};
  await workspace.writeParticle('particles/fire.particle.json', particle);
  assert.deepEqual(await workspace.readParticle('particles/fire.particle.json'), particle);
});

test('workspace lists supported textures recursively', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snowstorm-mcp-'));
  await fs.mkdir(path.join(root, 'textures', 'particle'), {recursive: true});
  await fs.writeFile(path.join(root, 'textures', 'particle', 'fire.png'), Buffer.from([1]));
  await fs.writeFile(path.join(root, 'textures', 'particle', 'ignore.txt'), 'x');
  const workspace = new Workspace(root);
  assert.deepEqual(await workspace.listTextures(), ['textures/particle/fire.png']);
});
