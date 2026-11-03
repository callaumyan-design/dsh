# 开源项目调研：有没有现成的可以借鉴？

> 调研时间：2026-11-03。星标数、许可证、最近提交时间来自 GitHub 搜索 API，之后可能变化。
> 评价维度对应四个核心需求：**形象**（可自定义）、**养成**、**AI**（接大模型）、**记忆**；外加**许可证**是否允许我们改造后分发、**平台**是否覆盖 Windows。

## 1. 结论先行

**没有一个项目能直接满足全部需求。** 每个候选都至少卡在一项上：

- 养成做得最好的 **VPet** 只支持 Windows，用 C#/WPF，内置美术素材有版权限制；
- AI 和记忆做得最好的 **AIRI**、**yoji**、**Desk-Pet** 都没有养成；AIRI 是 5 万星的大型 monorepo，二次开发成本很高；
- **DyberPet** 有养成，但它的 AI 模块不开源，而且是 GPL-3.0；
- 纯桌宠外壳 **WindowPet**（MIT）形象系统不错，但 2025 年 4 月后就没有更新。

所以我们的做法是：**用和 dsh-pet / yoji / AIRI 桌面版相同的技术栈（Electron + TypeScript + React）自己搭骨架**，并从这些项目"借鉴"三类东西：

1. **格式兼容**：直接读取 **Codex Pet 格式**（Petdex 等社区已有数千只宠物），以及逐状态 GIF/WebM 素材（dsh-pet、DyberPet 的思路）、**SillyTavern 角色卡**。别人做好的形象和人设可以直接拿来用。
2. **算法和设计**：记忆写入参考 **mem0**（ADD/UPDATE/DELETE），检索打分和日记反思参考 **Generative Agents**，主动搭话的"预算 + 安静时段"参考 **Desk-Pet**，养成数值参考 **VPet / DyberPet**。
3. **不复制 GPL/AGPL 代码，也不打包限制商用的美术素材**。所有代码自己重写（clean-room），默认宠物是原创矢量形象。这样项目可以用 MIT 开源，你以后想怎么改、怎么发都没有负担。

---

## 2. 候选项目一览

图例：●完整 ◐部分 ○没有

### 2.1 桌宠外壳 / 养成类

| 项目 | ⭐ | 许可证 | 技术栈 / 平台 | 形象 | 养成 | AI | 记忆 | 评价 |
| --- | --- | --- | --- | :-: | :-: | :-: | :-: | --- |
| [VPet 虚拟桌宠模拟器](https://github.com/LorisYounger/VPet) | 7.2k | Apache-2.0（代码）；内置动画、图片**版权归作者，禁止售卖** | C# WPF，仅 Windows | ● MOD/创意工坊 | ● 最完整 | ◐ ChatGPT 设置/插件 | ○ | 养成和 MOD 生态最好。跨平台难、素材有限制，不适合当底座，适合当**数值设计参考** |
| [DyberPet](https://github.com/ChaozhongLiu/DyberPet) | 1.0k | **GPL-3.0** | Python PySide6 | ● `pet_conf.json` + 序列帧 | ● 饱食/好感、物品、背包、商店、番茄钟 | ○ LLM 模块未开源 | ○ | 养成玩法很完整，GPL 有传染性，借鉴设计，不拷代码 |
| [WindowPet](https://github.com/SeakMengs/WindowPet) | 673 | MIT | Tauri + React + Phaser，全平台 | ● 45+ 宠物、自定义精灵图 | ○ | ○ | ○ | 外壳干净，但 2025-04 后停更，AI、养成、记忆都要从零写 |
| [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 5.5k | MIT（代码）；**素材禁商用，角色 CC BY-NC-SA** | Electron，DSH 插件 + 独立版 | ● 透明 WebM 视频、权重动画链 | ○ | ◐ 依托 DSH 会话 | ◐ 聊天持久化 | 物理交互（拖拽/弹弓/碰撞）和 AI 视频造宠流程值得学。和 DSH 绑定较深 |
| [dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop) | 3.0k | MIT | Python | ● | ○ | ◐ | ○ | dsh-pet 的跨平台移植 |
| [Petdex](https://github.com/crafter-station/petdex) / Codex Pet 格式 | 4.3k | MIT（代码）；素材归投稿者 | 格式规范 + 画廊 | ● 8×9 精灵图标准 | ○ | ○ | ○ | **事实标准的宠物素材格式**，兼容后可直接用社区宠物 |
| [BongoCat](https://github.com/ayangweb/BongoCat) | 24k | Apache-2.0 | Tauri | ◐ | ○ | ○ | ○ | 键盘猫，不是养成宠物；Tauri 透明窗口实现可参考 |
| [eSheep](https://github.com/Adrianotiger/desktopPet) | 1.2k | MIT | C# | ◐ | ○ | ○ | ○ | 经典"走在窗口上"的行为脚本 |
| [Ark-Pets](https://github.com/isHarryh/Ark-Pets) | 1.2k | GPL-3.0 | Java | ● Spine | ○ | ○ | ○ | 同人素材，不可用 |

### 2.2 AI 伴侣类

| 项目 | ⭐ | 许可证 | 技术栈 / 平台 | 形象 | 养成 | AI | 记忆 | 评价 |
| --- | --- | --- | --- | :-: | :-: | :-: | :-: | --- |
| [AIRI](https://github.com/moeru-ai/airi) | 51k | MIT | TS monorepo；Electron 桌宠版 `stage-tamagotchi` | ● Live2D / VRM | ○ | ● | ◐ Memory Alaya 仍在开发 | 最强的开源 AI 伴侣，但体量巨大，改造成本高；Live2D/VRM 渲染日后可参考 |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 14.6k | 自定义许可（非标准开源） | Python + Electron 前端 | ● Live2D | ○ | ● 语音打断 | ◐ | 语音链路成熟，许可证需仔细看 |
| [my-neuro](https://github.com/morettt/my-neuro) | 1.4k | MIT | JS + Python | ● Live2D | ○ | ● 语音 | ● | 中文社区活跃，偏 VTuber 风格 |
| [yoji](https://github.com/wangxijie001/yoji) | 666 | MIT | Electron + React + TS，SQLite + sqlite-vec | ● Live2D | ○ | ● MCP | ● 三层记忆 | 和我们技术栈一致。"用户画像 / 会话快照 / 语义记忆"三层结构值得参考。项目较新（约 19 个提交） |
| [Desk-Pet (V1rtual-Klavte)](https://github.com/V1rtual-Klavte/Desk-Pet) | 7 | MIT | Rust 原生宿主 + Node/TS | ● 人设卡 + 分层立绘 | ○ | ● MCP/Skills | ● 有来源、可纠错、定时整理 | 设计很细（记忆带来源、主动搭话有预算），但几乎没人用。**主动陪伴和记忆治理的设计重点参考** |
| [Agentic-Desktop-Pet](https://github.com/jihe520/Agentic-Desktop-Pet) | 342 | **未声明许可证**（不能复用代码） | Python + Godot | ◐ | ◐ RPG 元素 | ● | ● 知识图谱 | 思路有趣，没有许可证等于保留所有权利 |
| [MiniCPM-Desk-Pet](https://github.com/OpenBMB/MiniCPM-Desk-Pet) | 497 | AGPL-3.0 | JS，本地 MiniCPM 模型 | ◐ | ○ | ● 本地 | ◐ | 完全离线，AGPL |
| [Soul-of-Waifu](https://github.com/jofizcd/Soul-of-Waifu) | 1.4k | GPL-3.0 | Python，Windows | ● Live2D/VRM | ○ | ● | ● 四层记忆 | GPL |
| [LingChat](https://github.com/SlimeBoyOwO/LingChat) | 2.4k | AGPL-3.0 | Galgame 风格 | ● | ○ | ● | ◐ | AGPL |
| [Mate-Engine](https://github.com/shinyflvre/Mate-Engine) | 3.8k | 自定义许可 | Unity VRM | ● | ○ | ◐ | ○ | 3D 桌宠，非标准许可 |
| [amica](https://github.com/semperai/amica) | 1.6k | MIT | TS，3D VRM | ● | ○ | ● | ◐ | 偏网页 3D 角色 |
| [yuns-desktop-pet](https://github.com/JianguSheng/yuns-desktop-pet) | 142 | MIT | Electron | ◐ | ○ | ● 多模型 + MCP + 视觉 | ○ | 小而全的 AI 桌宠示例 |

### 2.3 记忆系统（只借鉴算法）

| 项目 | ⭐ | 许可证 | 借鉴点 |
| --- | --- | --- | --- |
| [mem0](https://github.com/mem0ai/mem0) | 68k | Apache-2.0 | 每轮对话后让 LLM 对照已有记忆输出 **ADD / UPDATE / DELETE / NONE**，避免重复和矛盾 |
| [Letta（原 MemGPT）](https://github.com/letta-ai/letta) | 25k | Apache-2.0 | "核心记忆块常驻上下文 + 归档记忆按需检索"的分层 → 我们的"置顶记忆" |
| Generative Agents（Park et al., 2023） | — | 论文 | 检索分 = **相关度 + 新近度 + 重要度**；定期**反思**生成高层记忆 → 我们的打分公式和日记 |
| [Hindsight](https://github.com/vectorize-io/hindsight) | 58k | MIT | 事实抽取 + 多路召回 |
| [Ombre-Brain](https://github.com/P0luz/Ombre-Brain) | 1.5k | MIT | 向量 + BM25 混合召回、情绪标注 |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | 8.2k | Apache-2.0 | 记忆量大到上万条时可换成 SQLite 向量索引（v0.3） |

更多候选见 [awesome-ai-companion](https://github.com/DasterProkio/awesome-ai-companion)。

---

## 3. 为什么不直接 fork 一个改？

| 路线 | 优点 | 问题 |
| --- | --- | --- |
| fork **VPet** + 写插件 | 养成、动画、创意工坊开箱即用 | 只能 Windows；WPF 我们改不动 UI 框架；内置素材不能随意分发；记忆要作为 C# 插件从零写 |
| fork **AIRI** | AI、Live2D、语音都有 | 代码量巨大、迭代极快，改了以后很难跟上游合并；没有养成 |
| fork **WindowPet** | MIT、外壳干净、跨平台 | 停更；Rust + Tauri 双栈；AI、养成、记忆都要从零写，等于只复用一个窗口 |
| fork **DyberPet** | 养成完整 | GPL-3.0；Python 打包体积大；AI 部分不开源 |
| **自建 + 兼容生态（本项目选择）** | 许可证干净（MIT），四个需求按同一套架构设计；能直接用 Codex 宠物、SillyTavern 角色卡 | 外壳和动画要自己写（工作量可控） |

**备选建议**：如果你只用 Windows，并且最看重"马上能玩、养成内容多"，可以直接用 VPet，再搭配它的 ChatGPT 插件。如果你最看重 Live2D 和语音，可以直接用 AIRI 或 my-neuro。本项目的定位是：**四个需求都要，而且完全由你掌控。**

---

## 4. 我们具体借鉴了什么（对应到代码）

| 借鉴来源 | 内容 | 本项目位置 |
| --- | --- | --- |
| Codex Pet / Petdex | 8×9 精灵图，行 = idle, running-right, running-left, waving, jumping, failed, waiting, running, review；每行帧数 6/8/8/4/5/8/6/6/6 | `src/core/pets/codex.ts` |
| dsh-pet、DyberPet | 逐状态素材（GIF/WebM/序列帧）、动作权重随机链、拖拽/抛掷 | `src/core/pets/pack.ts`、`src/renderer/pet/` |
| VPet、DyberPet | 数值维度、互动动作、物品商店、打工赚钱、好感等级 | `src/core/game/` |
| mem0 | 抽取 → ADD/UPDATE/DELETE | `src/core/memory/extract.ts` |
| Generative Agents | 相关度 + 新近度 + 重要度打分；每日反思 / 日记 | `src/core/memory/retrieve.ts`、`diary.ts` |
| Letta / yoji | 核心记忆常驻（置顶）+ 语义检索 | `src/core/ai/prompt.ts` |
| Desk-Pet | 主动搭话分档 + 每日预算 + 安静时段 | `src/core/proactive.ts` |
| SillyTavern Card V2 | 角色卡字段映射 | `src/core/persona/card.ts` |

## 5. 参考链接

- VPet: https://github.com/LorisYounger/VPet
- DyberPet: https://github.com/ChaozhongLiu/DyberPet
- WindowPet: https://github.com/SeakMengs/WindowPet
- dsh-pet: https://github.com/PC2005-cloud/dsh-pet
- Petdex: https://github.com/crafter-station/petdex
- Codex Pet 格式说明（第三方）：https://spin.atomicobject.com/?p=3674392 、https://zenn.dev/galirage/articles/codex-custom-pets
- AIRI: https://github.com/moeru-ai/airi
- yoji: https://github.com/wangxijie001/yoji
- Desk-Pet: https://github.com/V1rtual-Klavte/Desk-Pet
- mem0: https://github.com/mem0ai/mem0
- Letta: https://github.com/letta-ai/letta
- awesome-ai-companion: https://github.com/DasterProkio/awesome-ai-companion
