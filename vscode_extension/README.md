# Snowstorm VS Code 扩展

为 Minecraft 基岩版粒子文件提供自定义编辑器。文件名必须匹配
`*.particle.json` 才会由 Snowstorm 打开。

项目仓库：[GanquanOnline/Stormdmc](https://github.com/GanquanOnline/Stormdmc)

## 使用方法

1. 在 VS Code 中安装 Snowstorm 扩展。
2. 打开任意 `*.particle.json` 文件。
3. 在编辑器中调整粒子参数并实时查看预览。

## 本地开发

在仓库根目录安装依赖后，运行 `npm run build-extension` 打包扩展；调试时在
VS Code 中按 `F5` 启动扩展开发主机。

![Snowstorm 界面截图](https://snowstorm.app/content/interface.png)
