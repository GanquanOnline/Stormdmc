import process from 'node:process';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, startRemoteMcp } from './index.js';

const options = parseArgs(process.argv.slice(2));

function launchEditor(): void {
  const executable = process.env.SNOWSTORM_DESKTOP_EXE;
  if (!executable) throw new Error('SNOWSTORM_DESKTOP_EXE is not configured');
  const args = ['--snowstorm-editor', '--port', String(options.port)];
  if (options.workspace) args.push('--workspace', path.resolve(options.workspace));
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(executable, args, {detached: true, stdio: 'ignore', windowsHide: true, env}).unref();
}

async function connect() {
  try {
    return await startRemoteMcp({...options, connectTimeout: 800});
  } catch {
    launchEditor();
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        return await startRemoteMcp({...options, connectTimeout: 800});
      } catch {}
    }
    throw new Error('Unable to connect to the Snowstorm desktop editor');
  }
}

const runtime = await connect();
const shutdown = async () => {
  await runtime.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
