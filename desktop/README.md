# Snowstorm Desktop（跨平台客户端）

## 开发运行

```powershell
npm run desktop:dev
```

## 生成当前平台客户端

```powershell
npm run desktop:build
```

该命令根据当前构建机平台生成客户端：Windows 生成 NSIS 安装程序，Linux 生成 AppImage 和 deb，macOS 生成 dmg 和 zip。产物输出到 `release/`。

也可以显式选择目标平台（跨平台构建仍建议在对应的官方 runner 上执行）：

```powershell
npm run desktop:build:win
npm run desktop:build:linux
npm run desktop:build:mac
```

普通用户双击 Snowstorm 即可打开编辑器；导出 JSON 或 PNG 时会出现系统原生保存对话框。

安装程序会注册 `.particle.json` 文件关联；双击粒子文件会复用已打开的 Snowstorm 窗口，或启动新窗口后载入文件。若 MCP 端口被占用，启动时会列出占用进程、PID 和程序路径，由用户确认是否结束该进程并继续；选择取消时不会强制关闭其他程序。Linux/macOS 使用系统 `lsof` 和 `ps` 查询占用进程。

## MCP 配置

MCP 客户端只需要启动同一个桌面客户端的 `--mcp` 模式。该模式会连接已打开的 Snowstorm；如果尚未打开，会自动启动编辑器窗口。

```json
{
  "mcpServers": {
    "snowstorm": {
      "command": "C:/Program Files/Snowstorm/Snowstorm.exe",
      "args": ["--mcp", "--port", "43123"]
    }
  }
}
```

需要让 AI 直接打开和保存资源包时，再增加工作区参数：

```json
{
  "mcpServers": {
    "snowstorm": {
      "command": "C:/Program Files/Snowstorm/Snowstorm.exe",
      "args": ["--mcp", "--port", "43123", "--workspace", "D:/Minecraft/resource_packs/MyPack"]
    }
  }
}
```

在桌面版“帮助”菜单点击“复制 MCP 配置”，会将当前客户端路径、端口和工作区参数直接复制到剪贴板；这是最可靠的客户端配置方式。macOS/Linux 用户可直接把复制出的 `command` 路径用于 MCP 客户端，AppImage 会自动使用其真实文件路径而不是临时挂载路径。
