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

- [ ] CI 跑绿，拿到 Windows 安装包（第一次 CI 因为 Electron 二进制没下载而失败，已修复，等验证）
- [ ] 首次启动引导（选服务商、填 Key、测试、给宠物起名）
- [ ] 提醒 / 待办 / 番茄钟；AI 可以用 `[[remind|时间|内容]]` 这类标签创建提醒
- [ ] 记忆整理（合并相似记忆）+ 旧对话摘要成情节记忆
- [ ] 成就、随机事件、TTS 朗读（speechSynthesis）、鼠标穿透模式、zip 导入形象包
- [ ] （以后）Live2D、语音输入、本地 Embedding、多宠物、MOD、自动更新、全屏检测

## 设计约定

- `src/core` 必须保持纯 TS（不 import electron / node:fs），所有逻辑都要有单元测试。
- 主进程状态都在 `AppCore`（`src/main/core.ts`）；IPC 白名单在 `src/main/index.ts` 和 `src/preload/index.ts`，类型在 `src/core/ipc.ts`，三处要同步改。
- 存档 JSON 有 `normalize*` 函数做向后兼容；新字段必须在 normalize 里给默认值。
- UI 文案是中文；代码注释用英文。
- 不要提交第三方受限素材。

## 已知问题 / 没有验证过的

- 没有在真正的 Windows 桌面上手动测过：拖拽和抛出的手感、透明区域的鼠标穿透、托盘图标。
- 没有用真实 API Key 测过模型调用（只测过假服务器和带 mock fetch 的 SDK）。
- 宠物窗口高度固定留了 150px 的气泡区，透明区域会挡住下方点击（Windows/macOS 上靠 `setIgnoreMouseEvents` 的 forward 解决，Linux 上会挡）。
