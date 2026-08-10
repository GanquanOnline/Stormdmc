import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BridgeServer } from './bridge.js';
import { createMcpServer } from './mcp.js';
import { Workspace } from './workspace.js';
import { RemoteBridge } from './remote_bridge.js';

export type ServerOptions = { workspace?: string; port?: number; connectTimeout?: number };

export function parseArgs(argv: string[]): { workspace?: string; port: number } {
  let workspace = '';
  let port = Number(process.env.SNOWSTORM_MCP_PORT || 43123);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') workspace = argv[++i] || '';
    else if (argv[i] === '--port') port = Number(argv[++i] || port);
  }
  if (workspace && !path.isAbsolute(workspace)) throw new Error('--workspace must be an absolute path');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Bridge port must be between 1024 and 65535');
  return { workspace: workspace ? path.resolve(workspace) : undefined, port };
}

export function createBridge(options: ServerOptions = {}): { bridge: BridgeServer; workspace?: Workspace } {
  const parsed = parseArgs([
    ...(options.workspace ? ['--workspace', options.workspace] : []),
    '--port', String(options.port || process.env.SNOWSTORM_MCP_PORT || 43123)
  ]);
  const workspace = parsed.workspace ? new Workspace(parsed.workspace) : undefined;
  const bridge = new BridgeServer(workspace, parsed.port);
  bridge.start();
  return { bridge, workspace };
}

export function startMcp(options: ServerOptions = {}, existingBridge?: BridgeServer) {
  const parsed = parseArgs([
    ...(options.workspace ? ['--workspace', options.workspace] : []),
    '--port', String(options.port || process.env.SNOWSTORM_MCP_PORT || 43123)
  ]);
  const workspace = parsed.workspace ? new Workspace(parsed.workspace) : undefined;
  const bridge = existingBridge || new BridgeServer(workspace, parsed.port);
  if (!existingBridge) bridge.start();

  const handle = serveStdio(() => createMcpServer(bridge, workspace));
  return {
    bridge,
    workspace,
    async close() {
      await handle.close();
      if (!existingBridge) await bridge.stop();
    }
  };
}

export async function startRemoteMcp(options: ServerOptions = {}) {
  const parsed = parseArgs([
    ...(options.workspace ? ['--workspace', options.workspace] : []),
    '--port', String(options.port || process.env.SNOWSTORM_MCP_PORT || 43123)
  ]);
  const workspace = parsed.workspace ? new Workspace(parsed.workspace) : undefined;
  const bridge = new RemoteBridge(parsed.port);
  await bridge.connect(options.connectTimeout || 15_000);
  const handle = serveStdio(() => createMcpServer(bridge, workspace));
  return {
    bridge,
    workspace,
    async close() {
      await handle.close();
      await bridge.stop();
    }
  };
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  const runtime = startMcp(parseArgs(process.argv.slice(2)));
  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
