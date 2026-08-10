const {app, BrowserWindow, clipboard, dialog, ipcMain, shell} = require('electron');
const {execFile, spawn} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {promisify} = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 43123;
let mainWindow;
let bridgeRuntime;
let pendingDocumentPath;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getPort() {
  const value = Number(valueAfter('--port') || process.env.SNOWSTORM_MCP_PORT || DEFAULT_PORT);
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : DEFAULT_PORT;
}

function getWorkspace() {
  const workspace = valueAfter('--workspace') || process.env.SNOWSTORM_WORKSPACE;
  return workspace ? path.resolve(workspace) : undefined;
}

function findParticleArgument(commandLine = process.argv) {
  return commandLine.find(argument => /\.particle\.json$/i.test(argument) && fs.existsSync(argument));
}

function bundledPath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', ...parts);
}

async function loadMcpModule() {
  return await import(pathToFileURL(bundledPath('mcp_server', 'dist', 'index.js')).href);
}

function runMcpProcess() {
  const args = [bundledPath('mcp_server', 'dist', 'desktop.js'), '--port', String(getPort())];
  const workspace = getWorkspace();
  if (workspace) args.push('--workspace', workspace);
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1', SNOWSTORM_DESKTOP_EXE: process.execPath}
  });
  child.once('error', error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
  child.once('exit', code => process.exit(code ?? 0));
}

async function startBridge() {
  const port = getPort();
  try {
    await assertPortAvailable(port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    await resolvePortConflict(port);
  }
  const {createBridge} = await loadMcpModule();
  bridgeRuntime = createBridge({workspace: getWorkspace(), port});
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', error => {
      if (error?.code === 'EADDRINUSE') {
        const conflict = new Error(`MCP Bridge 端口 ${port} 已被占用。`);
        conflict.code = 'EADDRINUSE';
        conflict.cause = error;
        reject(conflict);
      } else {
        reject(error);
      }
    });
    server.listen({host: '127.0.0.1', port}, () => server.close(resolve));
  });
}

async function findPortOccupants(port) {
  if (process.platform !== 'win32') return [];
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue;`,
    'if (-not $connections) { exit 0 };',
    '$connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {',
    '  $processId = [int]$_;',
    '  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId";',
    '  [pscustomobject]@{ pid = $processId; name = $process.Name; path = $process.ExecutablePath; commandLine = $process.CommandLine }',
    '} | ConvertTo-Json -Compress'
  ].join(' ');
  try {
    const {stdout} = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], {windowsHide: true, maxBuffer: 1024 * 1024});
    const output = String(stdout || '').trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map(entry => ({
        pid: Number(entry?.pid),
        name: String(entry?.name || '').trim(),
        path: String(entry?.path || '').trim(),
        commandLine: String(entry?.commandLine || '').trim()
      }))
      .filter(entry => Number.isInteger(entry.pid) && entry.pid > 0);
  } catch {
    return [];
  }
}

function formatPortOccupants(occupants) {
  return occupants.map(({pid, name, path: executablePath}) => {
    const processName = name || '未知进程';
    const location = executablePath || '路径不可用';
    return `进程：${processName}\nPID：${pid}\n路径：${location}`;
  }).join('\n\n');
}

async function terminatePortOccupant(occupant) {
  const pid = Number(occupant?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    throw new Error('无法安全结束端口占用进程。');
  }
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim();
    throw new Error(`无法结束端口占用进程（PID ${pid}）。${detail ? `\n\n${detail}` : ''}`);
  }
}

async function waitForPortRelease(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await assertPortAvailable(port);
      return;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`端口 ${port} 仍未释放，请稍后重试。`);
}

async function resolvePortConflict(port) {
  const occupants = (await findPortOccupants(port))
    .filter(occupant => occupant.pid !== process.pid);
  if (!occupants.length) {
    try {
      await assertPortAvailable(port);
      return;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
    throw new Error(`MCP Bridge 端口 ${port} 已被占用，但无法识别占用进程。请关闭占用该端口的程序后重试。`);
  }

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'MCP Bridge 端口被占用',
    message: `端口 ${port} 已被占用，是否解除占用并继续？`,
    detail: `${formatPortOccupants(occupants)}\n\n结束上述进程可能导致其未保存的数据丢失。`,
    buttons: ['解除占用并继续', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) {
    const cancelled = new Error('用户取消了端口占用处理。');
    cancelled.code = 'PORT_RELEASE_CANCELLED';
    throw cancelled;
  }

  for (const occupant of occupants) {
    await terminatePortOccupant(occupant);
  }
  await waitForPortRelease(port);
}

async function openParticleDocument(filePath) {
  if (!filePath || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const particle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    await mainWindow.webContents.executeJavaScript(`window.loadFileFromParentEffect(${JSON.stringify(JSON.stringify(particle))}, null)`);
  } catch (error) {
    dialog.showErrorBox('无法打开粒子文件', error?.message || String(error));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#29323a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--snowstorm-port=${getPort()}`]
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingDocumentPath) {
      const filePath = pendingDocumentPath;
      pendingDocumentPath = undefined;
      void openParticleDocument(filePath);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

ipcMain.handle('snowstorm:info', () => ({
  version: app.getVersion(),
  workspace: getWorkspace() || null,
  port: getPort()
}));

ipcMain.handle('snowstorm:copy-mcp-config', () => {
  const args = app.isPackaged ? ['--mcp'] : [app.getAppPath(), '--mcp'];
  args.push('--port', String(getPort()));
  const workspace = getWorkspace();
  if (workspace) args.push('--workspace', workspace);
  const config = {
    mcpServers: {
      snowstorm: {
        command: process.execPath,
        args
      }
    }
  };
  clipboard.writeText(JSON.stringify(config, null, 2));
  return config;
});

ipcMain.handle('snowstorm:save-file', async (_event, payload = {}) => {
  const name = String(payload.name || 'snowstorm-export');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 Snowstorm 文件',
    defaultPath: path.join(app.getPath('downloads'), name),
    filters: [{name: payload.binary ? 'PNG 图片' : '粒子 JSON', extensions: [payload.binary ? 'png' : 'json']}]
  });
  if (result.canceled || !result.filePath) return {canceled: true};
  let data = String(payload.content || '');
  if (payload.binary) {
    const match = /^data:[^;]+;base64,(.+)$/s.exec(data);
    if (!match) throw new Error('无效的图片数据');
    data = Buffer.from(match[1], 'base64');
  }
  require('node:fs').writeFileSync(result.filePath, data);
  return {canceled: false, path: result.filePath};
});

const isMcp = process.argv.includes('--mcp');
const usesExternalBridge = process.argv.includes('--bridge-client');
if (isMcp) {
  runMcpProcess();
} else {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
  } else {
    pendingDocumentPath = findParticleArgument();
    app.on('second-instance', (_event, commandLine) => {
      const filePath = findParticleArgument(commandLine);
      if (filePath) void openParticleDocument(filePath);
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    app.whenReady().then(async () => {
      try {
        if (!usesExternalBridge) await startBridge();
        createWindow();
      } catch (error) {
        if (error?.code === 'PORT_RELEASE_CANCELLED') {
          app.quit();
          return;
        }
        dialog.showErrorBox('Snowstorm 启动失败', error?.message || String(error));
        app.quit();
      }
    });
    app.on('window-all-closed', () => app.quit());
  }
}
