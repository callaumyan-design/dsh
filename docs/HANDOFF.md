# 交接文档（给接手的人 / AI）

> 最后更新：2026-11-03（随每次提交更新）。先读这份，再读 `README.md` → `docs/ARCHITECTURE.md`。

## 项目是什么

SoulPet 灵宠：Electron + TypeScript + React 的桌面电子宠物，有四大块功能：自定义形象、养成、接入大模型、长期记忆。用户（中文母语，Windows 用户，也是 DeepSeek Harness 爱好者）的原始需求和细化见 `docs/REQUIREMENTS.md`，选型理由见 `docs/RESEARCH.md`。

## 发布

- **v0.3.1（最新）**：右键菜单改版（见 CHANGELOG）。用户试用 v0.3.0 后反馈：右键弹出的原生长菜单太繁琐，希望像 ChatGPT 的桌宠那样只出一个很小的菜单，左边语音、右边打字。现在右键弹出的是渲染进程里画的两键胶囊（`PetApp.tsx` 里的 `mini` 状态，样式 `.mini`），原来那些养成操作挪到了托盘的「🐾 照顾它」子菜单（`careMenu()`）。**以后不要往右键菜单里加东西**，新入口放托盘或面板。
- **v0.3.0**：Release 草稿「SoulPet soulpet-v0.3.0」（workflow run 41740299870，提交 51cff8a），包含三轮审查修复。四个安装包都已上传：`SoulPet-0.3.0-win-x64.exe`、`SoulPet-0.3.0-win-x64.zip`（免安装）、`SoulPet-0.3.0-mac-arm64.dmg`、`SoulPet-0.3.0-linux-x86_64.AppImage`。草稿里还混进了约 20 张 e2e 截图（png），发布前可以在编辑页删掉，也可以留着当预览。那次 run 显示失败，就是因为 Linux 和 Windows 的截图同名，上传时冲突；之后的 workflow 已改为只下载 `SoulPet-*` 安装包 artifact。
- v0.2.0：较早的草稿，**有已知 bug**（gpt-5 调用失败、宠物被打断后不再走路）。可以删掉，或者只发布 v0.3.0。
- 草稿只有仓库成员能看到，用户确认后在 GitHub Releases 页面点 Publish。发布方式见下文“沙箱推不了 tag”。

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

## 功能清单（全部已完成，带测试）

**基础（v0.1）**
- 养成引擎（纯函数，离线结算有封顶和保底）、物品与商店、签到、等级与成长阶段 — `src/core/game/`
- OpenAI 兼容流式客户端（fetch + SSE；推理模型自动用 `max_completion_tokens`；JSON 模式不支持时自动回退）— `src/core/ai/openai.ts`
- Anthropic 客户端（官方 SDK `@anthropic-ai/sdk`，默认 `claude-opus-5-5`、effort low、`fallbacks: "default"`，beta 头 `server-side-fallback-2026-07-01`；SDK 1.4 发送 `anthropic-version: 2026-10-21`，这个版本不能发 temperature）— `src/core/ai/anthropic.ts`
- 情绪标签和动作标签的流式解析（`[happy]`、`[[remind|…]]`、`[[todo|…]]`）— `src/core/ai/emotion.ts`、`src/core/tasks.ts`
- 记忆：BM25（中文单字 + 双字）+ 向量 + 新近度 + 重要度混合检索；mem0 式抽取；“记住……”即时写入；去重；置顶核心记忆 — `src/core/memory/`
- 主动搭话（每日预算、安静时段、免打扰、离开检测）— `src/core/proactive.ts`
- 形象包：Codex 格式、逐状态素材、回退表；内置矢量史莱姆“团子”；示例 Codex 宠物“小灵”（`scripts/gen-assets.mjs` 生成）
- SillyTavern 角色卡导入（JSON / PNG tEXt `chara`/`ccv3`）
- 宠物窗口（透明置顶、闲逛、拖拽、抛出、重力）+ 面板 + 托盘 + 快捷键 + 开机自启 + safeStorage 加密 Key

**v0.2**
- 首次启动引导（`WelcomeTab`，`settings.setupDone`）
- 提醒 / 待办 / 番茄钟（`src/core/tasks.ts`，每 15 秒检查；系统通知；专注时静音主动搭话）
- 记忆整理“做梦”（`src/core/memory/consolidate.ts`，在记忆队列里串行执行）、每日日记 + 情节摘要
- 成就（18 个）+ 随机事件（`src/core/game/achievements.ts`）
- TTS 朗读（`src/renderer/shared/speech.ts`）、鼠标穿透、透明度
- 从 zip / 文件夹导入形象包（防 zip-slip，`src/main/packImport.ts` + `src/core/pets/importPlan.ts`）
- 日志（`<数据目录>/logs/main.log`，Key 会打码）、代理、诊断信息、更新检查

**v0.3.1**
- 右键两键小菜单：🎤（按住说话 / 点一下开始、■ 发送）和 ⌨（打开输入框）；点别处、Esc、5 秒没操作会收起；失焦时丢弃没说完的录音。IPC `pet:menu`（暂停闲逛并抢焦点，用来接收 blur）
- 托盘菜单：聊天、🐾 照顾它（随养成状态重建）、面板、设置、免打扰、鼠标穿透

**v0.3**
- 语音输入（MediaRecorder → OpenAI 兼容 `/audio/transcriptions`；媒体权限只给自己的页面）
- 节日 / 纪念日（`src/core/calendar.ts`，**农历表只到 2030 年**）、天气（wttr.in，可选）
- Windows 全屏自动躲起来（常驻 PowerShell 探针，`src/core/fullscreen.ts` + `src/main/fullscreenWatch.ts`；Windows e2e 会检查探针有输出）
- 一张图做宠物（manifest 写 `animate: true` → `.proc` CSS + `Extras` 特效）、AI 生成形象（`src/core/pets/imagegen.ts`，flood fill 抠图）
- **Live2D（实验性，没有用真实模型验证过渲染）**：`src/renderer/shared/Live2DView.tsx`（懒加载 pixi.js 6 + pixi-live2d-display 0.4 + `@pixi/unsafe-eval`）。Cubism Core 由用户手动安装到 `<数据目录>/live2d/`，**包里自带的 Core 一律不执行**（安全），CSP 只允许 `soulpet-asset://pack/core/` 下的脚本。在沙箱里用 npm 的 `live2dcubismcore` 包测试被安全策略拦下了，请用 `tests/e2e/live2d-local.mjs` 配真实素材验证
- 设置改为深层局部更新（`DeepPartial<Settings>`）；面板输入框用 `CommitInput`，失焦时提交

**测试**：110 个单元测试（`npm test`）；Electron e2e（`tests/e2e/smoke.mjs`，覆盖引导、聊天、记忆、提醒、专注、语音、养成、日记、记忆整理、AI 头像、一张图宠物、Live2D 占位、Codex 渲染、重启持久化、空闲资源占用）。CI 会在 Linux 和真实 Windows 上都跑一遍，再打三平台安装包。

**发布**：推送 `soulpet-v*` 标签，或者（沙箱里推不了 tag）手动触发 workflow_dispatch，参数 `release=soulpet-vX.Y.Z`，由 workflow 创建 Release 草稿。

## 代码审查记录

- 第 1 轮（Live2D）：修复了“下载的包自带的 Cubism Core 会被执行”的安全问题，以及 manifest 和导入的健壮性问题。
- 第 2 轮（核心流程）：修复了 10 个问题。重要的几个：
  - 宠物走路时一被暂停，就再也不走了（`motion.setPaused` 没有重新安排决策）
  - OpenAI gpt-5 / o 系列模型要用 `max_completion_tokens`，并且要给推理留出 token 余量
  - 回复流式输出时，成就或提醒的气泡会把回复冲掉（现在会排队）
  - 托盘开关会写回过期的设置
  - 记忆整理改为在记忆队列里串行执行，不再和抽取同时改记忆
  - 日记失败每天最多重试 3 次
  - 手动置顶的记忆不会被自动去重改写
  - touch 和向量更新不再广播 UI 刷新
  - 宠物位置静默保存

- 第 3 轮（面板 UI）：修复了 10 个问题，包括输入框丢字（新增 `CommitInput`，失焦时提交）、服务商编辑被覆盖、空 Key 覆盖已保存的 Key、录音竞态、搜索结果乱序、按钮卡在加载中、渐变 id 冲突（改用 `useId`）、重复拉取快照。

## 资源占用（e2e 末尾会打印）

Xvfb + 软件渲染下，只开宠物窗口、空闲 8 秒：约 1.1% CPU（修掉频繁的设置广播之后）；内存（working set，会重复计算共享页）主进程约 160MB、GPU 约 126MB、网络服务约 74MB、宠物渲染进程约 113MB。真实 GPU 上 GPU 进程会小一些。想再降：关掉宠物闲逛（`walkEnabled`）、降低精灵图 fps。

## 接下来可以做什么（建议顺序）

1. **用真实 API Key 走一遍**（DeepSeek / Claude / gpt-5-mini），检查：情绪标签、`[[remind]]` 标签、记忆抽取 JSON、日记 JSON 在真实模型上是否稳定。如果不稳定，调整 `src/core/ai/prompt.ts` 和 `src/core/memory/extract.ts` 里的提示词。
2. **在 Windows 实机上手动检查**：拖拽和抛出的手感、透明区域点击穿透、托盘、系统通知、全屏自动隐藏（用浏览器视频按 F11 试）、开机自启。
3. **Live2D 用真实模型验证**（`tests/e2e/live2d-local.mjs`）。
4. ~~设置项改用深层局部更新~~（已完成：`settingsUpdate(DeepPartial<Settings>)`，面板只发送改动的字段）
5. 新功能候选：多只宠物、本地 Embedding（transformers.js）、自动更新（electron-updater，需要单独的发布仓库）、插件 / MOD。

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
