# Snowstorm MCP 使用指南

Snowstorm MCP 由两部分组成：

1. 本地 stdio MCP 服务，负责向 AI 客户端注册工具、资源和提示。
2. Snowstorm 浏览器页面中的 WebSocket 桥接，负责把操作转发到实时编辑器。

AI 的修改只会先应用到浏览器内存中的当前文档。页面弹出“确认 MCP 修改”对话框后，
用户可以查看差异、警告和纹理预览，确认后才会下载文件或写入工作区。

## 环境要求

- Node.js 20 或更高版本。
- 一个通过 HTTP 提供 Snowstorm 网页的本地静态服务器。
- 兼容 MCP 的客户端，例如支持 stdio MCP 配置的桌面 AI 工具。

如果使用 Windows 桌面版 Snowstorm，则不需要单独安装 Node.js。安装 `Snowstorm-3.2.5-Setup.exe` 后，在“帮助”菜单选择“复制 MCP 配置”，把剪贴板中的 JSON 粘贴到 MCP 客户端即可。桌面版会自动启动本地桥接和编辑器；若编辑器尚未打开，`--mcp` 模式会自动拉起它。

## 安装与启动

在仓库根目录执行：

```powershell
npm run mcp:install
npm run mcp:build
npm run mcp:start
```

也可以直接运行子目录脚本：

```powershell
npm install --prefix mcp_server
npm --prefix mcp_server run build
npm --prefix mcp_server run start
```

启动后，用 HTTP 服务器打开 Snowstorm 页面。页面右上角的 MCP 指示器连接成功后会变为
绿色。默认桥接地址为 `ws://127.0.0.1:43123/snowstorm`，可用环境变量或参数修改端口：

```powershell
$env:SNOWSTORM_MCP_PORT = "43124"
npm run mcp:start

# 或
npm run mcp:start -- --port 43124
```

## 工作区模式

不传 `--workspace` 时，服务运行在浏览器导出模式：可以创建和预览效果，批准后由浏览器
下载粒子 JSON 与 PNG。若要打开现有文件、列出纹理或原子写入文件，必须传入绝对路径：

```powershell
npm run mcp:start -- --workspace D:\\MyBedrockPack
```

所有路径都必须是工作区内的相对路径，禁止绝对路径、`..` 路径和空字节。粒子目标必须以
`.particle.json` 结尾，纹理只允许 PNG 或 TGA；服务会再次解析并校验路径，避免越界写入。
批准保存时会使用临时文件加替换的方式，避免半写入文件。

## 客户端配置

构建完成后，将下面配置加入 MCP 客户端的服务器配置文件。请把路径改为本机仓库的绝对路径：

```json
{
  "mcpServers": {
    "snowstorm": {
      "command": "node",
      "args": [
        "D:/ProjectCode/snowstorm/mcp_server/dist/index.js",
        "--workspace",
        "D:/MyBedrockPack"
      ]
    }
  }
}
```

如果只需要浏览器导出，不需要工作区，可删除 `--workspace` 及其后面的参数。

桌面版配置示例：

```json
{
  "mcpServers": {
    "snowstorm": {
      "command": "C:/Program Files/Snowstorm/Snowstorm.exe",
      "args": ["--mcp", "--port", "43123", "--workspace", "D:/MyBedrockPack"]
    }
  }
}
```

## 工具说明

### 状态与文档

- `snowstorm.get_state`：读取当前连接状态、文档、粒子配置、纹理和预览信息。
- `snowstorm.open_document`：从工作区打开一个 `.particle.json` 文件。
- `snowstorm.get_pending_change`：查看最新待确认修改、差异、警告和审批状态。
- `snowstorm.discard_pending_change`：撤销待确认修改，恢复到修改前快照。

### 设计与编辑

- `snowstorm.design_particle`：根据结构化设计说明创建或更新粒子效果。
- `snowstorm.apply_actions`：批量执行白名单中的语义编辑操作，最多 200 个动作。
- `snowstorm.import_texture`：从工作区导入 PNG/TGA 纹理。
- `snowstorm.generate_texture`：生成渐变、辉光、火花、烟雾、火焰、圆环或噪声纹理。

### 预览与校验

- `snowstorm.preview`：播放、暂停、重置预览，或设置循环、父级、碰撞和相机。
- `snowstorm.capture_preview`：将当前 Three.js 预览截图为 PNG 资源。
- `snowstorm.validate_particle`：执行 Snowstorm 兼容性检查并返回警告。
- `snowstorm.list_assets`：列出工作区中的 PNG/TGA 纹理。

## 推荐调用流程

1. 调用 `snowstorm.get_state` 了解当前页面和修订号。
2. 如需编辑已有文件，先调用 `snowstorm.open_document`。
3. 使用 `snowstorm.design_particle` 或 `snowstorm.apply_actions` 修改效果，并传入上一步的
   `expectedRevision` 防止覆盖其他修改。
4. 调用 `snowstorm.get_pending_change` 查看差异和警告。
5. 调用 `snowstorm.validate_particle`，确认没有不接受的兼容性问题。
6. 让用户在 Snowstorm 页面中确认对话框；拒绝时调用 `snowstorm.discard_pending_change`。
7. 确认后，工作区模式会原子写入目标文件；浏览器模式会下载 JSON 和 PNG。

## MCP 资源

- `snowstorm://state/current`：当前 Snowstorm 状态 JSON。
- `snowstorm://schema/actions`：语义编辑动作的参数约束和示例。

## 常见问题

**页面没有连接 MCP？**

确认 MCP 服务正在运行、网页是通过 HTTP 服务打开的，并检查端口是否被占用。页面和服务
必须使用相同端口；修改端口后请同时设置 `SNOWSTORM_MCP_PORT` 或 `--port`。

Windows 桌面版检测到端口占用时，会显示占用进程、PID 和程序路径。确认后 Snowstorm 才会
结束占用进程并继续启动；不确定进程用途时请选择取消，并改用 `--port <其他端口>`。

**为什么工具返回 `WORKSPACE_UNAVAILABLE`？**

需要文件读写的工具必须使用 `--workspace <绝对路径>` 启动服务。未配置工作区时只能使用
浏览器预览和导出功能。

**为什么保存被拒绝？**

请检查目标路径是否为工作区内的安全相对路径、粒子文件是否以 `.particle.json` 结尾，
并确认页面中的 MCP 审批对话框已由用户确认。

**如何停止服务？**

在运行服务的终端按 `Ctrl+C`。服务会关闭 stdio 会话和 WebSocket 桥接。
