const {contextBridge, ipcRenderer} = require('electron');

const portArgument = process.argv.find(argument => argument.startsWith('--snowstorm-port='));
const bridgePort = Number(portArgument?.split('=')[1]) || 43123;

contextBridge.exposeInMainWorld('SNOWSTORM_MCP_PORT', bridgePort);

contextBridge.exposeInMainWorld('snowstormDesktop', {
  isDesktop: true,
  saveFile: payload => ipcRenderer.invoke('snowstorm:save-file', payload),
  getInfo: () => ipcRenderer.invoke('snowstorm:info'),
  copyMcpConfig: () => ipcRenderer.invoke('snowstorm:copy-mcp-config')
});
