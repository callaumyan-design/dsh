# 反重力：Google Antigravity 网页版的中文界面

把 Google Antigravity 的网页版（[antigravity.google.com](https://antigravity.google.com)，远程控制和远程智能体的面板）的界面换成中文。三种用法，共用同一份翻译：

| 设备 | 用什么 |
| --- | --- |
| 安卓手机 | “反重力”应用（全屏打开网页版） |
| Windows / Mac / Linux | Chrome 或 Edge 扩展，可以再“安装为应用”当桌面软件用 |
| iPhone / iPad | Safari + 免费的 Userscripts 应用 |
| Firefox 等其他浏览器 | Tampermonkey / Violentmonkey 油猴脚本 |

非官方，与 Google 无关。

安装包都在本仓库的 [Releases](https://github.com/callaumyan-design/dsh/releases) 里，标签为 `antigravity-v…` 的版本。

## 安卓

1. 下载 `antigravity-zh-版本号.apk`。
2. 在手机上打开下载的文件。第一次安装时，系统会提示“允许安装未知应用”，允许即可。从旧版本升级直接覆盖安装，不用重新登录。
3. 桌面上会出现“反重力”图标。

需要 Android 8.0 或更高版本。

## Windows / Mac / Linux（Chrome、Edge）

1. 下载 `antigravity-zh-extension-版本号.zip`，解压到一个以后不会删掉的文件夹。
2. 打开扩展程序页面：Chrome 在地址栏输入 `chrome://extensions`，Edge 输入 `edge://extensions`。
3. 打开右上角（Edge 在左下角）的“开发者模式”，点“加载已解压的扩展程序”，选刚才解压出来的文件夹。
4. 打开 [antigravity.google.com](https://antigravity.google.com) 并登录，界面就是中文了。点浏览器工具栏里的扩展图标，可以开关中文、复制未翻译的词条。

想当桌面软件用：在 antigravity.google.com 上，Chrome 点 **⋮ → 投放、保存和分享 → 将网页作为应用安装**，Edge 点 **⋯ → 应用 → 将此站点作为应用安装**。装好的应用窗口里扩展照样生效，还能收到“智能体完成任务”的通知。

翻译词典每 12 小时自动从 GitHub 更新。扩展本身出新版本时，把新压缩包解压到同一个文件夹覆盖，再在扩展程序页面点一下刷新按钮。

## iPhone / iPad（Safari）

1. 在 App Store 安装免费的 **Userscripts** 应用（作者 Justin Wasack，开源）。
2. 打开 **设置 → App → Safari → 扩展**，启用 Userscripts，并允许它在 `antigravity.google.com` 和 `antigravity.static.usercontent.goog` 上运行（后一个是远程控制的对话界面）。
3. 在 Userscripts 应用里选一个存放脚本的文件夹，把 `antigravity-zh.user.js` 存进这个文件夹（可以用“文件”应用）。
4. 用 Safari 打开 [antigravity.google.com](https://antigravity.google.com) 并登录。

限制：Safari 扩展不在“添加到主屏幕”的网页应用里运行，所以要在 Safari 标签页里用才有中文；想收推送通知，需要另外把网站添加到主屏幕（那里是英文）。

## Firefox 等其他浏览器

先安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)，再打开下面的地址，点“安装”：

`https://raw.githubusercontent.com/callaumyan-design/dsh/main/antigravity/dist/antigravity-zh.user.js`

以后有新翻译会自动更新。Chrome 和 Edge 也可以用这个方法代替上面的扩展。

## 使用（以安卓应用为例，其他版本相同）

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
- 词典是从网页版自己的界面文案里整理出来的（包括登录后的远程控制、远程智能体工作区、设置等子页面），但新版本上线的新文字不会马上有中文。用“未翻译的词条”把它们复制出来，就能补上。

## 补充翻译

词典在 [`i18n/zh-CN.json`](i18n/zh-CN.json)：

- `strings`：英文原文 → 中文，整段对照。大小写不同、结尾多个冒号或省略号的写法会自动对上。
- `patterns`：带数字、时间这类变化部分的规则。`{1}` 表示把第 1 个括号里的内容也翻译，`$1` 表示原样保留。
- 改完把 `revision` 加 1，运行 `node web/build.mjs` 重新生成油猴脚本，一起推到 main。安卓应用和浏览器扩展会从 GitHub 下载新词典（不用重新安装），12 小时内自动生效，或手动点“检查翻译词典更新”立刻生效；油猴脚本会按新的版本号自动更新。

改完先跑测试：

```bash
cd antigravity
npm ci
npm test
node web/build.mjs
```

## 开发

```
antigravity/
├── i18n/
│   ├── translator.js   翻译脚本：监听页面变化，整段对照替换
│   ├── shell.js        辅助脚本：状态栏配色、网页生成的文件下载
│   └── zh-CN.json      词典
├── test/               翻译脚本、扩展和油猴脚本的测试（jsdom）
├── web/
│   ├── build.mjs       生成 dist/ 里的扩展和油猴脚本
│   ├── extension/      Chrome / Edge 扩展的源文件（后台更新词典、弹出面板）
│   └── icons/          扩展图标（make-icons.py 生成）
├── dist/
│   └── antigravity-zh.user.js   生成的油猴脚本（提交到仓库，脚本管理器从这里自动更新）
└── android/            安卓工程（Java，只依赖 androidx.webkit 和 androidx.core）
```

远程控制（连到你自己电脑）时，对话界面是嵌在页面里的 iframe，来自 `antigravity.static.usercontent.goog`。安卓应用、扩展和油猴脚本都同时在这两个网址上运行。

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

`.github/workflows/antigravity-android.yml`：每次改动 `antigravity/` 都会测试、检查并打包，APK、扩展压缩包和油猴脚本在这次运行的 Artifacts 里。推到 main 且 `app/build.gradle.kts` 里的 `versionName` 是新的（同时把 `versionCode` 加 1），就一起发布到 Releases。

## 隐私

- 安卓应用的登录信息只保存在手机上的这个应用里，不参与备份、不随换机迁移。扩展和油猴脚本不碰登录信息，登录由浏览器自己管理。
- 它们只在 Antigravity 网站上运行，另外只访问 GitHub 上的翻译词典（只是一份文字对照表）。安卓应用把其他链接都交给系统浏览器打开。
