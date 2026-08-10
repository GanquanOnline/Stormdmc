# Snowstorm Android 3.2.8

Android 客户端使用 Capacitor 8，将 `dist/` 中的 Vue 编辑器打包进原生 WebView。

## 本地开发

先安装 Android Studio 和 Android SDK，并设置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，再运行：

```powershell
npm install
npm run android:open
```

## 构建

```powershell
npm run android:build:apk  # 可直接安装的 Debug APK
npm run android:build:aab  # Release AAB，商店发布前需要签名
```

导出的粒子 JSON 和纹理 PNG 会写入应用缓存，并通过 Android 系统分享面板交给文件管理器、云盘或其他应用保存。Android 版当前不启动 MCP 服务，也不连接远程 Bridge；需要 AI/MCP 控制时请使用 Windows、Linux、macOS 桌面客户端，或在电脑上运行网页版与 MCP 服务。Release 中会同时提供可直接安装的 Debug APK 和用于商店签名流程的 Release AAB。
