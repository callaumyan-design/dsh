# SoulPet 灵宠

一只住在你桌面上的电子宠物：**长相可以换**，**需要你照顾**，**能用大模型和你聊天**，还**记得你们之间发生过的事**。

<p>
  <img src="docs/screenshots/pet-reply.png" height="200" alt="内置宠物团子在桌面上说话">
  <img src="docs/screenshots/pet-focus.png" height="200" alt="番茄钟专注中的团子">
  <img src="docs/screenshots/pet-codex.png" height="200" alt="Codex 格式示例宠物小灵">
</p>

| 状态与养成 | 记忆库 |
| --- | --- |
| ![状态面板](docs/screenshots/panel-status.png) | ![记忆面板](docs/screenshots/panel-memory.png) |
| **聊天** | **形象** |
| ![聊天面板](docs/screenshots/panel-chat.png) | ![形象面板](docs/screenshots/panel-appearance.png) |

> 需求整理见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)，开源项目调研和选型理由见 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 功能

**🎨 自定义形象**
- 内置原创矢量史莱姆「团子」，有 20 种状态和表情，可以换颜色、加饰品（蝴蝶结、猫耳、王冠……）
- **兼容 Codex Pet 格式**（`pet.json` + 8×9 精灵图）：[Petdex](https://github.com/crafter-station/petdex) 等社区的数千只宠物可以直接用
- 也支持逐状态素材：GIF / APNG / WebP / PNG 序列帧 / 透明 WebM 视频，可以分幼年、少年、成年阶段设置不同素材
- 缺少的动作自动用相近的动作代替，最少只要一个 `idle` → [形象包格式](docs/PET_PACK.md)

**🍙 养成系统**
- 饱食、心情、精力、清洁、健康五项数值，会随时间变化；另有好感（亲密度称号）、经验等级、成长阶段、金币
- 喂食、洗澡、玩耍、睡觉、打工赚钱、学习、每日签到；12 种物品和商店
- 关掉程序期间也会温和地结算（最多 12 小时，有保底）。宠物不会死，但被冷落了会饿、会生病、会难过
- 休闲 / 标准 / 硬核三档难度

**🤖 接入 AI**
- DeepSeek、Claude、OpenAI、Kimi、通义千问、智谱、硅基流动、OpenRouter、Ollama 本地模型等，任何 OpenAI 兼容接口都能用
- 流式回复，宠物头顶气泡逐字显示；模型输出的情绪标签（如 `[happy]`）驱动表情和动画
- 自定义人设，可导入 SillyTavern 角色卡（PNG / JSON）
- 宠物的饥饿、困倦、生病状态会影响它说话的语气
- 主动搭话：早安晚安、你回到电脑前、它饿了困了、太久没理它……有频率档位、每日上限和安静时段
- API Key 用系统钥匙串加密保存；可设每日 token 上限

**🧠 自己的记忆库**
- 每轮对话后，后台让模型判断要**新增 / 更新 / 删除**哪些记忆（mem0 式），自动去重，新信息会覆盖旧的
- 你说“记住……”会立刻记下，并设为高重要度
- 混合检索：关键词 BM25（中文可用）+ 可选向量（Embedding）+ 时间新近度 + 重要度。没有 Embedding 接口（比如只用 DeepSeek）也能用
- 置顶的“核心记忆”每次都带上；长期没被想起的记忆权重会慢慢下降（遗忘曲线）
- 每天写日记，并从中提炼对你的新认识
- 记忆面板可以搜索、编辑、置顶、删除，也可以导入导出。所有数据只保存在本机

**🖥 桌宠基本功**：透明置顶窗口，会在屏幕底部闲逛，可以拖拽和抛出（有重力），支持多显示器；单击摸摸、双击聊天、右键菜单、悬停显示状态；系统托盘、免打扰、开机自启、全局快捷键（默认 `Ctrl+Shift+Space`）；你离开电脑太久它会睡着。

## 使用

### 下载

在 [Actions](../../actions) 的构建产物或 Releases 里下载：

- Windows：`SoulPet-x.y.z-win-x64.exe`（安装版）或 `.zip`（解压即用）。在 `SoulPet.exe` 旁边新建一个 `SoulPetData` 文件夹，就会把数据存到这里（便携模式）
- macOS：`.dmg`；Linux：`.AppImage`

> 安装包没有代码签名，Windows SmartScreen / macOS Gatekeeper 可能会提示，选择“仍要运行”即可。

### 第一次使用

1. 启动后宠物会出现在屏幕右下角。**右键宠物 → 设置**
2. 选一个模型服务商（默认 DeepSeek），填入 API Key，点“测试连接”
3. **双击宠物**开始聊天。试试说“记住我喜欢吃草莓”，过一会儿再问“我喜欢吃什么？”
4. 想用向量记忆：设置 → 记忆 → 打开“向量记忆”，选硅基流动的 bge-m3（免费）并填 Key

### 从源码运行

```bash
npm install          # 已附带 .npmrc（legacy-peer-deps）
npm run dev          # 开发模式（热重载）
npm test             # 单元测试
npm run build && npm run test:e2e   # 端到端测试（Linux 需 xvfb-run 与全局 playwright）
npm run dist:win     # 打包 Windows（也可以用 dist:mac / dist:linux）
```

推送到 GitHub 后，CI 会跑测试，并分别在 Windows、macOS、Linux 上打包；推送 `v*` 标签会生成 Release 草稿。

## 项目结构

```
src/core/       纯 TS 核心逻辑（养成、AI 客户端、记忆、形象包、人设、主动搭话）——全部有单元测试
src/main/       Electron 主进程（窗口移动、托盘、IPC、加密存储、后台服务）
src/preload/    安全桥接（渲染进程拿不到 API Key）
src/renderer/   宠物窗口 + 控制面板（React）
resources/      图标、示例形象包（小灵，Codex 格式）
docs/           需求、调研、架构、形象包格式
tests/          单元测试 + Electron 端到端测试
```

更多细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 路线图

- **v0.2**：番茄钟 / 提醒 / 待办，工具调用（让宠物帮你设提醒），对话压缩与记忆整理（“做梦”），成就系统，全屏时自动隐藏，自动更新
- **v0.3**：语音（TTS / 语音输入），Live2D，本地 Embedding（完全离线），多只宠物同屏互动，插件 / MOD

## 致谢与许可

设计参考了 VPet、DyberPet、dsh-pet、AIRI、yoji、Desk-Pet、mem0、Generative Agents 等项目和论文（见 [调研报告](docs/RESEARCH.md)）。本项目没有复制其中任何 GPL/AGPL 代码，也没有使用受限的美术素材。

- 代码：MIT
- 内置形象「团子」（代码绘制）：MIT；示例形象「小灵」：CC0
- 你导入的第三方形象包遵循各自的许可证
