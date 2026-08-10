const {app, BrowserWindow, dialog, ipcMain, shell} = require('electron');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const DEFAULT_PORT = 43123;
let mainWindow;
let bridgeRuntime;

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

function bundledPath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', ...parts);
}

async function loadMcpModule() {
  return await import(pathToFileURL(bundledPath('mcp_server', 'dist', 'index.js')).href);
}

async function runRemoteMcp() {
  try {
    const {startRemoteMcp} = await loadMcpModule();
    let runtime;
    for (let attempt = 0; attempt < 2 && !runtime; attempt++) {
      try {
        runtime = await startRemoteMcp({workspace: getWorkspace(), port: getPort(), connectTimeout: 800});
      } catch (error) {
        if (attempt > 0) throw error;
        launchDesktopEditor();
        for (let wait = 0; wait < 30 && !runtime; wait++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            runtime = await startRemoteMcp({workspace: getWorkspace(), port: getPort(), connectTimeout: 800});
          } catch {}
        }
      }
    }
    const shutdown = async () => {
      await runtime.close();
      app.quit();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
}

function launchDesktopEditor() {
  const args = ['--snowstorm-editor'];
  const workspace = getWorkspace();
  if (workspace) args.push('--workspace', workspace);
  if (app.isPackaged) {
    spawn(process.execPath, args, {detached: true, stdio: 'ignore'}).unref();
  } else {
    spawn(process.execPath, [app.getAppPath(), ...args], {detached: true, stdio: 'ignore'}).unref();
  }
}

async function startBridge() {
  const {createBridge} = await loadMcpModule();
  bridgeRuntime = createBridge({workspace: getWorkspace(), port: getPort()});
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
      sandbox: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
if (isMcp) {
  app.whenReady().then(runRemoteMcp);
} else {
  app.whenReady().then(async () => {
    try {
      await startBridge();
      createWindow();
    } catch (error) {
      dialog.showErrorBox('Snowstorm 启动失败', error?.message || String(error));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
