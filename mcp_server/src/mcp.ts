import { McpServer } from '@modelcontextprotocol/server';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, BridgeServer } from './bridge.js';
import { Workspace } from './workspace.js';

export interface McpBridge {
  request(command: string, args?: any, expectedRevision?: number): Promise<any>;
  getPending(id?: string): any;
  getSession(): any;
}

const anyObject = z.record(z.string(), z.any());

function textResult(value: unknown, isError = false): any {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

function errorResult(error: unknown): any {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : 'INVALID_ACTION';
  const message = error instanceof Error ? error.message : String(error);
  return textResult({ ok: false, error: { code, message } }, true);
}

async function call(bridge: McpBridge, command: string, args: any = {}, revision?: number): Promise<any> {
  return await bridge.request(command, args, revision);
}

function requireWorkspace(workspace: Workspace | undefined): Workspace {
  if (!workspace) throw new BridgeError('WORKSPACE_UNAVAILABLE', 'No workspace configured; use Snowstorm page export instead');
  return workspace;
}

function validateRelativePath(relativePath: string, label: string): void {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..') || relativePath.includes('\0')) {
    throw new BridgeError('WORKSPACE_VIOLATION', `${label} must be a safe relative path`);
  }
}

function validateParticleTarget(workspace: Workspace | undefined, targetPath?: string): void {
  if (!targetPath) return;
  if (!/\.particle\.json$/i.test(targetPath)) throw new BridgeError('INVALID_ACTION', 'targetPath must end with .particle.json');
  validateRelativePath(targetPath, 'targetPath');
  workspace?.resolve(targetPath);
}

function validateTextureTarget(workspace: Workspace | undefined, texturePath?: string): void {
  if (!texturePath) return;
  const pngPath = texturePath.replace(/\.(png|tga)$/i, '') + '.png';
  validateRelativePath(pngPath, 'particleTexturePath');
  workspace?.resolve(pngPath);
}

export function createMcpServer(bridge: McpBridge, workspace?: Workspace): McpServer {
  const server = new McpServer(
    { name: 'snowstorm-mcp', version: '0.1.2' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  server.registerTool('snowstorm.get_state', {
    title: 'Get Snowstorm State',
    description: 'Inspect the currently connected Snowstorm browser session, particle document, texture and preview state.',
    inputSchema: z.object({})
  }, async () => {
    try {
      return textResult({ ok: true, state: await call(bridge, 'get_state') });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.open_document', {
    title: 'Open Particle Document',
    description: 'Open a workspace-relative .particle.json document in the connected Snowstorm browser.',
    inputSchema: z.object({ path: z.string().min(1) })
  }, async ({ path }) => {
    try {
      requireWorkspace(workspace);
      if (!/\.particle\.json$/i.test(path)) throw new BridgeError('INVALID_ACTION', 'Only .particle.json documents can be opened');
      const particle = await requireWorkspace(workspace).readParticle(path);
      return textResult({ ok: true, state: await call(bridge, 'open_document', { path, particle }) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.design_particle', {
    title: 'Design Particle',
    description: 'Apply a structured particle design brief to the live Snowstorm page. The result remains in memory until the page approval dialog is confirmed and saved or exported by the user.',
    inputSchema: z.object({
      brief: z.string().optional(),
      identifier: z.string().min(1),
      base: z.string().optional().default('current'),
      targetPath: z.string().optional(),
      emitter: anyObject.optional(),
      particle: anyObject.optional(),
      appearance: anyObject.optional(),
      texture: anyObject.optional(),
      expectedRevision: z.number().int().nonnegative().optional()
    })
  }, async args => {
    try {
      validateParticleTarget(workspace, args.targetPath);
      const texture = args.texture ? {...args.texture} : undefined;
      if (texture?.path) validateTextureTarget(workspace, texture.path);
      if (texture?.particleTexturePath) validateTextureTarget(workspace, texture.particleTexturePath);
      if (texture?.source === 'existing' && texture.path && !texture.dataUrl) texture.dataUrl = await requireWorkspace(workspace).readTexture(texture.path);
      return textResult({ ok: true, result: await call(bridge, 'design_particle', {...args, ...(texture ? {texture} : {})}, args.expectedRevision) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.apply_actions', {
    title: 'Apply Snowstorm Actions',
    description: 'Execute a batch of whitelisted semantic editor actions against the live Snowstorm page.',
    inputSchema: z.object({
      actions: z.array(anyObject).min(1).max(200),
      expectedRevision: z.number().int().nonnegative().optional()
    })
  }, async ({ actions, expectedRevision }) => {
    try {
      return textResult({ ok: true, result: await call(bridge, 'apply_actions', { actions }, expectedRevision) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.get_pending_change', {
    title: 'Get Pending Change',
    description: 'Inspect the latest uncommitted change, its diff, warnings and page approval status.',
    inputSchema: z.object({ id: z.string().optional() })
  }, async ({ id }) => {
    return textResult({ ok: true, pending: bridge.getPending(id) });
  });

  server.registerTool('snowstorm.discard_pending_change', {
    title: 'Discard Pending Change',
    description: 'Restore the live Snowstorm page to the snapshot taken before a pending AI edit.',
    inputSchema: z.object({ id: z.string().min(1) })
  }, async ({ id }) => {
    try {
      return textResult({ ok: true, result: await call(bridge, 'discard_pending_change', { id }) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.preview', {
    title: 'Control Snowstorm Preview',
    description: 'Play, pause, reset or configure the live Snowstorm particle preview.',
    inputSchema: z.object({
      action: z.enum(['play', 'pause', 'reset', 'set_loop_mode', 'set_parent_mode', 'set_collision', 'set_camera']),
      value: z.any().optional()
    })
  }, async ({ action, value }) => {
    try {
      return textResult({ ok: true, result: await call(bridge, 'preview', { action, value }) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.capture_preview', {
    title: 'Capture Snowstorm Preview',
    description: 'Capture the current live Three.js preview as a PNG resource.',
    inputSchema: z.object({})
  }, async () => {
    try {
      const result = await call(bridge, 'capture_preview');
      const match = /^data:image\/png;base64,(.+)$/s.exec(result?.dataUrl || '');
      if (!match) throw new BridgeError('PREVIEW_UNAVAILABLE', 'Snowstorm did not return a PNG preview');
      return {
        content: [
          { type: 'image', data: match[1], mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify({ ok: true, width: result.width, height: result.height }) }
        ],
        structuredContent: { ok: true, width: result.width, height: result.height }
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.list_assets', {
    title: 'List Particle Assets',
    description: 'List workspace PNG and TGA textures available to the Snowstorm page.',
    inputSchema: z.object({ directory: z.string().optional().default('textures') })
  }, async ({ directory }) => {
    try {
      return textResult({ ok: true, assets: await requireWorkspace(workspace).listTextures(directory) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.import_texture', {
    title: 'Import Texture',
    description: 'Load an existing workspace PNG or TGA texture into the live Snowstorm page.',
    inputSchema: z.object({ path: z.string().min(1), particleTexturePath: z.string().optional() })
  }, async ({ path, particleTexturePath }) => {
    try {
      requireWorkspace(workspace);
      if (!/\.(png|tga)$/i.test(path)) throw new BridgeError('INVALID_ACTION', 'Only PNG and TGA textures can be imported');
      validateTextureTarget(workspace, particleTexturePath || path);
      const dataUrl = await requireWorkspace(workspace).readTexture(path);
      return textResult({ ok: true, result: await call(bridge, 'import_texture', { path, dataUrl, particleTexturePath }) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.generate_texture', {
    title: 'Generate Procedural Texture',
    description: 'Generate a deterministic Canvas texture such as flame, smoke, spark, ring, gradient or noise.',
    inputSchema: z.object({
      recipe: z.enum(['gradient', 'radial_glow', 'spark', 'smoke', 'flame', 'ring', 'noise']),
      width: z.number().int().min(8).max(256).optional().default(16),
      height: z.number().int().min(8).max(256).optional().default(16),
      colors: z.array(z.string()).optional(),
      seed: z.number().int().optional().default(1),
      particleTexturePath: z.string().optional()
    })
  }, async args => {
    try {
      validateTextureTarget(workspace, args.particleTexturePath);
      return textResult({ ok: true, result: await call(bridge, 'generate_texture', args) });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('snowstorm.validate_particle', {
    title: 'Validate Particle',
    description: 'Run Snowstorm compatibility checks against the live particle configuration.',
    inputSchema: z.object({})
  }, async () => {
    try {
      return textResult({ ok: true, result: await call(bridge, 'validate_particle') });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerResource('snowstorm-state', 'snowstorm://state/current', {
    title: 'Current Snowstorm State',
    description: 'Current document, particle configuration and preview state.',
    mimeType: 'application/json'
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(bridge.getSession()?.snapshot || { connected: false }, null, 2) }] }));

  server.registerResource('snowstorm-actions', 'snowstorm://schema/actions', {
    title: 'Snowstorm Action Schema',
    description: 'Supported semantic actions for controlling Snowstorm.',
    mimeType: 'application/json'
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
    actions: ['set_input', 'load_preset', 'add_curve', 'update_curve', 'remove_curve', 'set_gradient', 'add_event', 'update_event', 'remove_event', 'import_texture', 'generate_texture', 'set_uv', 'preview_control', 'set_active_tab'],
    fields: bridge.getSession()?.snapshot?.inputSchema || []
  }, null, 2) }] }));

  server.registerPrompt('snowstorm-design-particle', {
    title: 'Design a Snowstorm Particle',
    description: 'Guide an AI through inspecting, designing, previewing and requesting approval for a particle effect.',
    argsSchema: z.object({ brief: z.string() })
  }, ({ brief }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Design a Minecraft Bedrock particle in Snowstorm for this brief: ${brief}\n\nFirst inspect the current state and available assets. Use snowstorm.design_particle or snowstorm.apply_actions, validate the result, control the preview, and wait for the Snowstorm page approval before saving.` } }] }));

  return server;
}
