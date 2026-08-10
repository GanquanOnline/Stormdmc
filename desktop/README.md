# Snowstorm Windows Desktop

## 开发运行

```powershell
npm run desktop:dev
```

## 生成安装包

```powershell
npm run desktop:build
```

安装包输出到 `release/`。普通用户双击 Snowstorm 即可打开编辑器；导出 JSON 或 PNG 时会出现 Windows 原生保存对话框。

安装程序会注册 `.particle.json` 文件关联；双击粒子文件会复用已打开的 Snowstorm 窗口，或启动新窗口后载入文件。若 MCP 端口被占用，启动时会显示明确的端口提示。

## MCP 配置

MCP 客户端只需要启动同一个 EXE 的 `--mcp` 模式。该模式会连接已打开的 Snowstorm；如果尚未打开，会自动启动编辑器窗口。

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

在桌面版“帮助”菜单点击“复制 MCP 配置”，会将当前 EXE 路径、端口和工作区参数直接复制到剪贴板；这是最可靠的客户端配置方式。
