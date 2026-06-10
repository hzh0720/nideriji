# 你的日记 Lite

一个个人自用的 Android 客户端。界面不再加载官方网页版，而是使用本地自绘 UI；数据仍通过官方接口读写。

## 已实现

- 底部三栏：写、时间线、个人。
- 写日记页：所见即所得编辑器、标题、格式按钮、本地图片预览、草稿本机保存。
- 时间线页：自己和对方的日记混排显示，不同颜色区分，点击可查看详情。
- 个人页：登录/token、同步、双方颜色切换、本地缓存清理、原版个人页部分入口预留。
- 官方数据接口桥：Android 原生层代本地 UI 请求 `nideriji.cn`，避免依赖官方网页版。

## 目前限制

- 文本保存先接入了 `/api/write/`，但官方写入字段未完全公开。如果保存失败，App 会显示接口错误。
- 图片可以在编辑器中所见即所得预览，但图片上传字段还没对齐；含本地图片的草稿会阻止保存，避免图片静默丢失。
- 签名、主题图等个人页功能已保留入口，等确认接口字段后再接。

## 构建 APK

这台电脑之前没有检测到 `java` / `gradle`。建议用 Android Studio：

1. 用 Android Studio 打开 `C:\Users\Administrator\Desktop\nideriji`。
2. 等待 Gradle Sync，安装提示的 Android SDK。
3. 菜单选择 `Build` -> `Build Bundle(s) / APK(s)` -> `Build APK(s)`。
4. APK 生成在 `app/build/outputs/apk/debug/app-debug.apk`。

命令行环境齐全时：

```powershell
gradle :app:assembleDebug
```

## 关键文件

- Android 容器和官方接口桥：`app/src/main/java/cn/nideriji/lite/MainActivity.java`
- 本地 App 页面：`app/src/main/assets/app.html`
- 本地 App 样式：`app/src/main/assets/app.css`
- 本地 App 逻辑：`app/src/main/assets/app.js`

