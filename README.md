# StormDMC Snowstorm

StormDMC Snowstorm 是面向 Minecraft 基岩版的粒子效果编辑器，支持网页端、VS Code
自定义编辑器，以及可供 AI 客户端调用的 MCP 控制服务。项目仓库为
[Dbackolds/stormdmc](https://github.com/Dbackolds/stormdmc)。

## 功能

- 可视化编辑发射器、粒子生命周期、曲线、颜色渐变、材质和 Molang 表达式。
- Three.js 实时预览，并可导出 `.particle.json` 和纹理 PNG。
- VS Code 中直接打开 `*.particle.json` 文件。
- MCP 本地服务：让兼容 MCP 的 AI 客户端读取、设计、预览、校验和保存粒子效果。
- 所有 AI 修改先在 Snowstorm 页面中预览，用户确认后才会导出或写入工作区。

## 快速开始

```powershell
npm install
npm run production
```

构建结果位于 `dist/`。可使用任意静态 HTTP 服务器托管项目根目录，例如：

```powershell
npx serve .
```

浏览器打开服务器地址即可使用网页端。

## VS Code 扩展

```powershell
npm install
npm run build-extension
```

生成的扩展包可在 VS Code 中通过“从 VSIX 安装”加载。调试扩展时，在 VS Code 中按
`F5` 启动扩展开发主机。

## MCP 服务

MCP 服务需要 Node.js 20 或更高版本：

```powershell
npm run mcp:install
npm run mcp:build
npm run mcp:start
```

默认通过 `ws://127.0.0.1:43123/snowstorm` 与浏览器页面桥接。需要直接读写粒子文件时，
为服务传入绝对路径工作区：

```powershell
npm run mcp:start -- --workspace D:\\MyBedrockPack
```

完整的 MCP 工具、客户端配置、审批机制和安全限制请阅读
[`mcp_server/README.md`](mcp_server/README.md)，也可查看 GitHub Wiki。

## 开发与测试

```powershell
npm run watch       # 开发构建
npm run mcp:test    # MCP 单元测试
npm run mcp:e2e     # MCP 端到端测试
```

提交 `v*` 格式的标签后，GitHub Actions 会自动执行构建与测试，并创建带中文更新说明
的 GitHub Release。版本号遵循语义化版本；本次版本为 `3.2.3`，MCP 子包为 `0.1.1`。

## 许可证

本项目使用 GNU GPL v3 或更高版本，详见 [`LICENSE`](LICENSE)。
