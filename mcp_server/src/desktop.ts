import process from 'node:process';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBridge, parseArgs, startMcp, startRemoteMcp } from './index.js';

const options = parseArgs(process.argv.slice(2));

function launchEditor(): void {
  const executable = process.env.SNOWSTORM_DESKTOP_EXE;
  if (!executable) throw new Error('SNOWSTORM_DESKTOP_EXE is not configured');
  const args = ['--snowstorm-editor', '--bridge-client', '--port', String(options.port)];
  if (options.workspace) args.push('--workspace', path.resolve(options.workspace));
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(executable, args, {detached: true, stdio: 'ignore', windowsHide: true, env}).unref();
}

async function waitForEditor(bridge: any, timeout = 15_000): Promise<void> {
  if (bridge.getSession()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.off('connected', onConnected);
      reject(new Error('Unable to connect to the Snowstorm desktop editor'));
    }, timeout);
    const onConnected = () => {
      clearTimeout(timer);
      bridge.off('connected', onConnected);
      resolve();
    };
    bridge.on('connected', onConnected);
  });
}

async function connect() {
  try {
    return await startRemoteMcp({...options, connectTimeout: 800});
  } catch {
    const {bridge} = createBridge(options);
    launchEditor();
    await waitForEditor(bridge);
    return startMcp(options, bridge);
  }
}

const runtime = await connect();
const shutdown = async () => {
  await runtime.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
