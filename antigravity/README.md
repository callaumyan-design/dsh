# 反重力：Google Antigravity 网页版的中文安卓应用

把 Google Antigravity 的网页版（[antigravity.google.com](https://antigravity.google.com)，远程控制和远程智能体的面板）装成一个安卓应用：全屏打开，界面上的英文按钮、菜单、提示换成中文。

非官方应用，与 Google 无关。

## 安装

1. 下载 `antigravity-zh-版本号.apk`：在本仓库的 [Releases](https://github.com/callaumyan-design/dsh/releases) 里找标签为 `antigravity-v…` 的版本。
2. 在手机上打开下载的文件。第一次安装时，系统会提示“允许安装未知应用”，允许即可。
3. 桌面上会出现“反重力”图标。

需要 Android 8.0 或更高版本。

## 使用

1. 在电脑上打开远程控制：Antigravity 桌面应用里 **设置 → Application → Enable Remote Control**；命令行版运行 `agy remote-control start`（一直开着）或在会话里输入 `/remote-control`（只管这一次会话）。
2. 打开“反重力”，用**和电脑上相同的 Google 账号**登录。
3. 在顶部的实例切换里选你的电脑，就能看对话、发新任务、审核实施计划和制品。

Antigravity 的远程功能要求 Google AI Pro 或 Ultra 订阅，并且是个人 Google 账号（官方说明：[远程控制](https://antigravity.google/docs/remote-control)、[远程智能体](https://antigravity.google/docs/remote-agents)）。

### 右侧的“中”字小按钮

点一下打开菜单，按住可以拖到别的位置：

| 菜单 | 作用 |
| --- | --- |
| 刷新页面 | 重新加载 |
| 显示英文原文 / 显示中文翻译 | 翻译不准时切回英文对照 |
| 未翻译的词条 | 列出还没有中文的界面文字，可以一键复制，发给开发者补进词典 |
| 检查翻译词典更新 | 立刻下载最新词典（平时每 12 小时自动检查一次） |
| 在浏览器中打开 | 用系统浏览器打开当前页面 |
| 暂时隐藏这个按钮 | 重新打开应用后会回来 |
| 退出登录并清除数据 | 清掉本应用保存的登录信息和网页数据 |

### 翻译了什么，没翻译什么

- 翻译：按钮、菜单、标签、状态、提示、错误信息、时间（“5 分钟前”“工作了 2 分 31 秒”）。
- 不翻译：对话内容、智能体的回复、代码、终端输出、文件名、你自己输入的文字。只有整段文字和词典完全对得上才替换，避免改坏内容。
- Google 登录页本身是中文的（应用向 Google 声明优先中文）。

### 已知限制

- **没有推送通知。** 网页版的推送依赖浏览器的推送功能，安卓应用内置的网页组件不支持。需要“智能体完成任务时提醒我”的话，另外在 Chrome 里打开 antigravity.google.com 并“添加到主屏幕”，那个版本能收推送（但没有中文）。
- **登录。** Google 会拦截一些应用里内嵌的登录页面。本应用以普通手机浏览器的身份打开登录页，一般能正常登录；如果看到“此浏览器或应用可能不安全”，请告诉开发者。通行密钥（Passkey）在这里用不了，选“尝试其他方式”用密码和两步验证登录。
- 界面文字是按官方文档和网页版的文案整理的，登录后才看到的部分界面可能还有英文。用“未翻译的词条”把它们复制出来，就能补上。

## 补充翻译

词典在 [`i18n/zh-CN.json`](i18n/zh-CN.json)：

- `strings`：英文原文 → 中文，整段对照。大小写不同、结尾多个冒号或省略号的写法会自动对上。
- `patterns`：带数字、时间这类变化部分的规则。`{1}` 表示把第 1 个括号里的内容也翻译，`$1` 表示原样保留。
- 改完把 `revision` 加 1，推到 main。应用会从 GitHub 下载新词典（不用重新安装），12 小时内自动生效，或在菜单里点“检查翻译词典更新”立刻生效。

改完先跑测试：

```bash
cd antigravity
npm ci
npm test
```

## 开发

```
antigravity/
├── i18n/
│   ├── translator.js   翻译脚本：监听页面变化，整段对照替换
│   ├── shell.js        辅助脚本：状态栏配色、网页生成的文件下载
│   └── zh-CN.json      词典
├── test/               翻译脚本的测试（jsdom）
└── android/            安卓工程（Java，只依赖 androidx.webkit 和 androidx.core）
```

构建安装包需要 JDK 17 以上和 Android SDK（compileSdk 36）：

```bash
cd antigravity/android
./gradlew lint assembleRelease
# 安装包：app/build/outputs/apk/release/app-release.apk
```

### 签名

正式签名的密钥是 `android/release.p12`，用强密码加了密，放在仓库里是安全的；没有密码就用不了它。

- 本机构建：在 `android/keystore.properties`（不提交）里写一行 `password=密码`。
- GitHub Actions：在仓库 **Settings → Secrets and variables → Actions** 里新建 `AG_KEYSTORE_PASSWORD`。

没有密码时会用调试签名打包：能安装，但不能覆盖安装正式签名的版本（要先卸载，会退出登录）。

### 自动构建和发布

`.github/workflows/antigravity-android.yml`：每次改动 `antigravity/` 都会测试、检查并打包，APK 在这次运行的 Artifacts 里。推到 main 且 `app/build.gradle.kts` 里的 `versionName` 是新的（同时把 `versionCode` 加 1），就发布到 Releases。

## 隐私

- 登录信息只保存在手机上的这个应用里，不参与备份、不随换机迁移。
- 应用只访问 Antigravity 网站、Google 登录页，以及 GitHub 上的翻译词典（只是一份文字对照表）。其他链接都交给系统浏览器打开。
