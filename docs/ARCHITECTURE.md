# 架构说明

## 进程与目录

```
┌────────────────────────── Electron 主进程 (src/main) ──────────────────────────┐
│ index.ts   生命周期、托盘、右键菜单、全局快捷键、IPC 注册                        │
│ core.ts    AppCore：所有状态 + 后台服务（聊天、记忆整理、向量、日记、主动搭话、游戏时钟）│
│ motion.ts  宠物窗口移动：闲逛 / 拖拽 / 抛出后重力下落 / 多显示器                  │
│ packs.ts   扫描形象包，通过 soulpet-asset:// 协议提供素材（防目录穿越）             │
│ secrets.ts API Key 用 safeStorage（DPAPI / Keychain / libsecret）加密              │
│ storage.ts JSON 原子写入 + 按天的 JSONL 聊天记录                                   │
└─────────────▲──────────────────────────────────────────────▲─────────────────────┘
              │ contextBridge (src/preload) — 渲染进程拿不到 Key │
┌─────────────┴──────────────┐                 ┌─────────────┴────────────────────┐
│ 宠物窗口 (renderer/pet)     │                 │ 面板窗口 (renderer/panel)          │
│ 透明 · 无边框 · 置顶        │                 │ 聊天 / 状态 / 商店 / 记忆 / 日记 /  │
│ 动画状态机、气泡、快速输入   │                 │ 形象 / 人设 / 设置                  │
└────────────────────────────┘                 └──────────────────────────────────┘

src/core   纯 TypeScript，不依赖 Electron，全部有单元测试
├── game/      养成引擎（tick / applyAction 都是纯函数）、物品表
├── ai/        OpenAI 兼容客户端（fetch + SSE）、Anthropic 客户端（官方 SDK）、
│              情绪标签流式解析、系统提示词构建
├── memory/    分词 + BM25、记忆库（混合检索）、记忆抽取（ADD/UPDATE/DELETE）、日记
├── pets/      形象包规范化（Codex / 逐状态）、状态回退
├── persona/   人设、SillyTavern 角色卡导入（JSON / PNG tEXt）
├── proactive.ts  主动搭话决策（纯函数）
└── settings.ts   设置默认值与迁移
```

## 一次聊天的流程

1. 用户在宠物气泡或面板里输入 → `chat:send`。
2. `AppCore.sendChat`
   - 写入聊天记录，养成引擎记一次“聊天”（好感 +1，有每日上限）。
   - 如果是“记住……”，立即写一条重要度 8 的记忆（不依赖模型）。
   - **检索记忆**：`query = 用户这句话 + 上一句回复的开头`，可选地先算 query 向量；`MemoryStore.search` 打分：

     ```
     relevance  = 有向量 ? 0.65·cos + 0.35·BM25归一化 : BM25归一化
     recency    = 0.5 ^ (距上次被想起的天数 / 14)
     importance = 重要度 / 10
     score      = 1.0·relevance + 0.25·recency + 0.35·importance   （relevance < 0.12 的丢弃）
     ```
     命中的记忆会被 `touch`（遗忘曲线重置）。置顶记忆作为“核心记忆”每次都带上。
   - **构建提示词**：人设 + 当前时间 + 宠物状态（饿/困/生病会影响语气）+ 核心记忆 + 相关记忆 + 回复规则（以情绪标签开头、简短口语）。
   - 历史消息按字符预算从新到旧截取。
   - 流式调用模型；`EmotionStreamParser` 边收边剥掉 `[happy]` 标签（跨 chunk 也能识别），把情绪推给宠物窗口切换动画。
3. 回复完成后，后台队列里执行**记忆抽取**：把最近几轮对话 + 最相关的 8 条已有记忆交给“记忆模型”，让它输出 `ADD / UPDATE / DELETE`。UPDATE/DELETE 只允许作用于展示给它的那几条，手动置顶的核心记忆不允许模型修改。新记忆会去重（规范化文本相同或字符二元组 Jaccard ≥ 0.8 视为同一条）。
4. 开启向量记忆时，为新增/修改的记忆补算向量。

## 养成引擎

- `tick(state, now)`：按 15 分钟一步积分，避免“饿到一定程度才掉健康”这类阈值效果不稳定。
- 离线结算：启动时 `tick(..., { offline: true })`，速率 ×0.6、最多 12 小时、每项有保底值。
- 动作有冷却（打工/学习 20 分钟），摸摸有防连点和每日好感上限。
- 用户离开电脑 30 分钟以上且精力 < 70 时，宠物会自己睡着；回来后精力够了会醒并打招呼。

## 数据文件（数据目录）

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 设置（不含 Key） |
| `secrets.json` | 加密后的 API Key |
| `game.json` | 养成存档 |
| `persona.json` | 人设 |
| `memory.json` | 记忆库（含可选向量） |
| `diary.json` | 日记 |
| `chat/YYYY-MM-DD.jsonl` | 聊天记录 |
| `activity.json` | 最近 300 条互动记录（写日记用） |
| `usage.json` | 每日 token 统计 |
| `runtime.json` | 主动搭话计数等 |
| `pets/` | 用户形象包 |

数据目录：Windows `%APPDATA%/SoulPet/data`，macOS `~/Library/Application Support/SoulPet/data`，Linux `~/.config/SoulPet/data`。在程序旁边建一个 `SoulPetData` 文件夹即进入便携模式。环境变量 `SOULPET_DATA_DIR` 可覆盖。

## 安全

- 渲染进程开启 `sandbox` + `contextIsolation`，只能通过白名单 IPC 调用；页面 CSP 禁止外部脚本和网络请求。
- 模型请求都在主进程发出（用 Electron `net.fetch`，自动走系统代理），Key 不进入渲染进程。
- 形象包协议只允许访问已登记目录内的文件。

## 测试

- `npm test`：核心逻辑单元测试（养成、记忆检索/抽取、SSE、OpenAI/Anthropic 客户端、情绪解析、形象包、角色卡、主动搭话、设置迁移）。
- `npm run test:e2e`：启动真实 Electron + 本地假模型服务器，验证流式聊天、情绪动画、记忆写入与召回、去重、养成动作、日记、Codex 形象渲染、重启后持久化。需要 Linux 下 `xvfb-run` 和全局安装的 `playwright`。
