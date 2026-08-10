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

## MCP 配置

MCP 客户端只需要启动同一个 EXE 的 `--mcp` 模式。该模式会连接已打开的 Snowstorm；如果尚未打开，会自动启动编辑器窗口。

```json
{
  "mcpServers": {
    "snowstorm": {
      "command": "C:/Program Files/Snowstorm/Snowstorm.exe",
      "args": ["--mcp"]
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
      "args": ["--mcp", "--workspace", "D:/Minecraft/resource_packs/MyPack"]
    }
  }
}
```
