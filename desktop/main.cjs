const {app, BrowserWindow, clipboard, dialog, ipcMain, shell} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

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
  await assertPortAvailable(getPort());
  const {createBridge} = await loadMcpModule();
  bridgeRuntime = createBridge({workspace: getWorkspace(), port: getPort()});
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', error => reject(new Error(`MCP Bridge 端口 ${port} 已被占用，请关闭其他 Snowstorm 或 MCP 服务后重试。\n\n${error.message}`)));
    server.listen({host: '127.0.0.1', port}, () => server.close(resolve));
  });
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
        dialog.showErrorBox('Snowstorm 启动失败', error?.message || String(error));
        app.quit();
      }
    });
    app.on('window-all-closed', () => app.quit());
  }
}
