# 交接文档（给接手的人 / AI）

> 最后更新：2026-11-03（随每次提交更新）。先读这份，再读 `README.md` → `docs/ARCHITECTURE.md`。

## 项目是什么

SoulPet 灵宠：Electron + TypeScript + React 的桌面电子宠物，有四大块功能：自定义形象、养成、接入大模型、长期记忆。用户（中文母语，Windows 用户，也是 DeepSeek Harness 爱好者）的原始需求和细化见 `docs/REQUIREMENTS.md`，选型理由见 `docs/RESEARCH.md`。

## 代码在哪

- 仓库 `callaumyan-design/dsh`，分支 **`desktop-pet`**。这是一个 orphan 分支，和 `main` 没有共同历史（`main` 是用户的 DeepSeek Harness 便携版分发仓库，不要动它）。
- 之所以没建新仓库：会话没有创建仓库的权限。用户如果新建了仓库，直接 `git push <新仓库> desktop-pet:main`。
- **不要往 main 合并，也不要开到 main 的 PR。**

## 怎么跑

```bash
npm ci                     # .npmrc 里有 legacy-peer-deps=true（npm 10 的 arborist 不加会报 edgesOut 错）
npx install-electron       # Electron 45 不再在 postinstall 里自动下载二进制
npm run dev                # 开发
npm run typecheck && npm test
npm run build && xvfb-run -a npm run test:e2e   # 端到端：需要全局 playwright（NODE_PATH 指向全局 node_modules）
npm run dist:win           # 打包
```

### 云端沙箱里的坑（Claude Code 远程环境）

- Electron 二进制经代理下载会触发 undici 的 `assert(!this.paused)` 崩溃。解决：用 curl 下载 zip，核对 `node_modules/electron/checksums.json` 里的 sha256，然后解压到 `node_modules/electron/dist`，并写入 `path.txt`（内容为 `electron`）。electron-builder 需要的 zip 放到 `~/.cache/electron/electron-v45.2.1-linux-x64.zip`。
- 在 root 下运行 Electron 必须加 `--no-sandbox`。
- Playwright 是全局安装的，项目里**不要**把它加进依赖（版本不一致会找不到预装的 Chromium）。`scripts/gen-assets.mjs` 和 `tests/e2e/smoke.mjs` 都用 `createRequire` 加载它。
- Linux 下 `setIgnoreMouseEvents(..., {forward})` 不支持，所以代码在 Linux 上跳过鼠标穿透。
- `git push` 偶尔会卡住，用 `timeout 90 git push origin desktop-pet`，失败了重试。要杀卡住的进程请用 `pkill -f "^/usr/lib/git-core/git-remote-https"`（`pkill -f git-remote-https` 会把当前 shell 自己也杀掉）。
- CI 里有 `e2e-windows` 任务，会在真实的 Windows runner 上跑同一个 e2e 测试，截图在 artifact `e2e-screenshots-windows` 里。

## 已完成（v0.1，提交 a0f5570 起）

- [x] 需求文档、调研报告、架构文档、形象包格式文档
- [x] 养成引擎（纯函数，带离线结算和保底）、物品与商店、签到、等级与成长阶段
- [x] OpenAI 兼容流式客户端（fetch + SSE）；Anthropic 客户端（官方 SDK `@anthropic-ai/sdk`，默认 `claude-opus-5-5`、effort low、开启 `fallbacks: "default"`，beta 头 `server-side-fallback-2026-07-01`；SDK 1.4 发送 `authorization: Bearer` 和 `anthropic-version: 2026-10-21`，这个版本不能发 temperature）
- [x] 情绪标签流式解析 → 动画
- [x] 记忆：BM25（中文 uni+bigram）+ 向量 + 新近度 + 重要度；mem0 式抽取；“记住……”即时写入；去重；置顶核心记忆；日记 + 感悟
- [x] 主动搭话（预算、安静时段、免打扰、离开检测）
- [x] 形象包：Codex 格式（8×9，192×208）和逐状态素材；回退表；内置矢量史莱姆“团子”（可换色、换饰品）；示例 Codex 宠物“小灵”（`scripts/gen-assets.mjs` 生成）
- [x] SillyTavern 角色卡导入（JSON / PNG tEXt `chara`/`ccv3`）
- [x] 宠物窗口：透明置顶、闲逛、拖拽、抛出后重力下落、悬停显示状态、单击摸摸、双击聊天、右键菜单
- [x] 面板：聊天 / 状态 / 商店 / 记忆 / 日记 / 形象 / 人设 / 设置
- [x] 托盘、全局快捷键、开机自启、API Key 用 safeStorage 加密、每日 token 上限
- [x] 52 个单元测试 + Electron e2e（假 LLM 服务器）；打包后的 Linux 程序已验证能启动
- [x] CI：typecheck、单元测试、e2e、三平台打包；推送 `v*` 标签生成 Release 草稿

## 进行中 / 待办（按优先级）

- [x] 节日 / 纪念日（`src/core/calendar.ts`，农历节日用 2026–2030 的查表，**过了 2030 要补表**；写进系统提示词，每天主动问候一次）
- [x] 全屏自动躲起来（Windows：常驻一个 PowerShell 进程，每 3 秒通过 user32 查一次前台窗口，`src/core/fullscreen.ts` + `src/main/fullscreenWatch.ts`；窗口铺满整个显示器（物理像素）就隐藏，并静音主动搭话）。Windows e2e 会检查探针确实有输出
- [x] 诊断信息（设置 → 关于 → 诊断信息；IPC `app:diagnostics`）
- [x] 天气（可选，wttr.in，只发送城市名；`src/core/weather.ts`；写进提示词，早安问候在雨雪 / 极端温度时会提醒）
- [x] 用户使用说明 / 常见问题：`docs/USER_GUIDE.md`
- [x] AI 生成形象（`src/core/pets/imagegen.ts`：OpenAI 兼容 `/images/generations`，预设硅基流动 Kolors / OpenAI gpt-image-1 透明背景 / 通义万相；渲染进程里从边缘做 flood fill 去背景，再按不透明区域裁切，存成一张图的宠物）
- [x] “用一张图片做宠物”：manifest 里写 `animate: true`，静态图会自动套上呼吸 / 蹦跳 / 特效（`.proc` CSS + `Extras` SVG 叠加层）；`createFromImage` 会解析 PNG/GIF/WebP/JPEG 的尺寸
- [x] 更新检查（GitHub Releases 里的 `soulpet-v*`，只提示不下载）、隐藏 / 显示快捷键 `Ctrl+Alt+H`，聊天快捷键默认改为 `Ctrl+Alt+P`

- [x] 语音输入（按住 🎤 说话 → MediaRecorder → 主进程 → OpenAI 兼容 `/audio/transcriptions`；默认用硅基流动 SenseVoice；e2e 用 Chromium 的假麦克风测试）。媒体权限只开放给自己的页面（`setPermissionRequestHandler`）

- [x] CI 跑绿：单元测试 + Linux e2e + **真实 Windows e2e** + 三平台打包（Windows artifact 约 275MB：NSIS 安装包 + zip）
- [x] 日志文件（`<数据目录>/logs/main.log`，API Key 会被打码）、代理设置（`settings.app.proxy`，`session.setProxy`）、后台 JSON 调用用 `response_format: json_object`（不支持就自动重试不带它）
- [x] v0.2.0：版本号已更新，发布标签改为 `soulpet-v*`（避免和 DSH 的标签冲突）。**这个沙箱推不了 tag**（git 代理只放行分支），所以要手动触发 CI 的 workflow_dispatch，参数 `release=soulpet-vX.Y.Z`，由 workflow 用 GITHUB_TOKEN 创建 tag 和 Release 草稿（MCP 工具 `actions_run_trigger`）
- [x] 首次启动引导（`WelcomeTab`：起名、选服务商、填 Key 并测试、选形象；`settings.setupDone`）
- [x] 提醒 / 待办 / 番茄钟（`src/core/tasks.ts`，`tasks.json`，每 15 秒检查一次；到点时冒泡并弹系统通知；专注期间宠物显示 work 动画和倒计时，主动搭话静音，完成后有奖励）
- [x] AI 动作标签：`[[remind|时间|内容]]`、`[[todo|内容]]`，流式输出时就隐藏；时间格式见 `parseWhen`
- [x] 记忆整理“做梦”（`src/core/memory/consolidate.ts`：并查集聚类相似记忆 → LLM 合并；忘掉 90 天没想起的重要度 ≤ 2 的记忆；每天最多一次，在记忆页可以手动触发）
- [x] 每日日记同时生成一条 episode（情节）记忆，用来回忆“那天聊了什么”
- [x] 成就（18 个，`src/core/game/achievements.ts`，在 `AppCore.setGame` 里检查）和随机事件（捡金币、说梦话……，至少间隔 40 分钟，用户不在电脑前时不触发）
- [x] TTS 朗读（渲染进程 `speechSynthesis`，`src/renderer/shared/speech.ts`；设置里选声音、语速、音调）
- [x] 鼠标穿透模式（托盘和设置里都能切换）、宠物透明度
- [x] 从 .zip 或文件夹导入形象包（`src/main/packImport.ts` + 纯函数 `core/pets/importPlan.ts`，防 zip-slip，300MB 上限）
- [ ] （以后）Live2D、语音输入、本地 Embedding、多宠物、MOD、自动更新、全屏检测

## 设计约定

- `src/core` 必须保持纯 TS（不 import electron / node:fs），所有逻辑都要有单元测试。
- 主进程状态都在 `AppCore`（`src/main/core.ts`）；IPC 白名单在 `src/main/index.ts` 和 `src/preload/index.ts`，类型在 `src/core/ipc.ts`，三处要同步改。
- 存档 JSON 有 `normalize*` 函数做向后兼容；新字段必须在 normalize 里给默认值。
- UI 文案是中文；代码注释用英文。
- 不要提交第三方受限素材。

## 已知问题 / 没有验证过的

- Windows e2e 在 GitHub 的 Windows runner 上通过，但还没有人手动试过：拖拽和抛出的手感、透明区域的鼠标穿透、托盘图标、系统通知。
- 沙箱网络访问不了 GitHub artifact 的存储域名（blob.core.windows.net），所以没法直接看 Windows 上的截图。
- 没有用真实 API Key 测过模型调用（只测过假服务器和带 mock fetch 的 SDK）。
- 宠物窗口高度固定留了 150px 的气泡区，透明区域会挡住下方点击（Windows/macOS 上靠 `setIgnoreMouseEvents` 的 forward 解决，Linux 上会挡）。
