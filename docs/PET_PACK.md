# 自定义形象：形象包格式

形象包就是一个文件夹。把它放进**形象包目录**（面板 → 形象 → 打开形象包目录，默认在数据目录下的 `pets/`），点“重新扫描”，就能在列表里切换。

支持两种格式。

---

## 格式一：Codex Pet（推荐，可直接用社区宠物）

与 OpenAI Codex 桌宠 / [Petdex](https://github.com/crafter-station/petdex) 社区通用的格式。下载别人做好的宠物，解压后放进来即可。

```
my-cat/
├── pet.json
└── spritesheet.webp      # 或 spritesheet.png
```

`pet.json`：

```json
{
  "id": "my-cat",
  "displayName": "我的猫",
  "description": "可选",
  "spritesheetPath": "spritesheet.webp",
  "spriteVersionNumber": 1,
  "fps": 8
}
```

精灵图：**8 列 × 9 行，每格 192×208 像素，透明背景**（整张 1536×1872）。v2 版本为 8×11，多出的两行目前不使用。

| 行 | Codex 动作 | 帧数 | SoulPet 中用于 |
| --- | --- | --- | --- |
| 0 | idle | 6 | 待机 |
| 1 | running-right | 8 | 向右走 |
| 2 | running-left | 8 | 向左走 |
| 3 | waving | 4 | 打招呼 |
| 4 | jumping | 5 | 开心、跳、玩耍、吃东西 |
| 5 | failed | 8 | 难过、生病 |
| 6 | waiting | 6 | 思考（等 AI 回复时）、睡觉 |
| 7 | running | 6 | 打工 / 学习 |
| 8 | review | 6 | 说话 |

`fps` 和下面的 `soulpet` 字段是 SoulPet 的扩展，Codex 会忽略它们：

```json
{
  "soulpet": {
    "fps": 10,
    "rows": { "sleep": "review", "eat": "waving" }
  }
}
```

`rows` 可以把任何 SoulPet 状态（见下表）改成映射到另一行。

> 仓库自带的 `resources/pets/xiaoling/` 就是一个 Codex 格式示例，可以照着改。它由 `scripts/gen-assets.mjs` 用代码画出来。

---

## 格式二：逐状态素材（自己画 / AI 视频生成）

每个状态一个文件或一组帧，适合 GIF、APNG、WebP 动图、PNG 序列帧或透明 WebM 视频。

```
my-pet/
├── manifest.json
├── idle.gif
├── talk.webm
├── walk/
│   ├── 001.png
│   ├── 002.png
│   └── ...
└── sleep.webp
```

`manifest.json`：

```json
{
  "format": "soulpet-frames",
  "id": "my-pet",
  "name": "我的宠物",
  "author": "你",
  "license": "CC-BY-4.0",
  "size": [200, 200],
  "facing": "right",
  "fps": 8,
  "states": {
    "idle": "idle.gif",
    "walk": { "dir": "walk", "fps": 12 },
    "talk": "talk.webm",
    "sleep": "sleep.webp",
    "happy": ["happy/1.png", "happy/2.png", "happy/3.png"]
  },
  "stages": {
    "baby": { "idle": "baby/idle.gif" }
  }
}
```

- `size`：显示尺寸（缩放 100% 时的像素），图片会等比缩放进这个框。
- `facing`：素材朝向。向另一个方向走时会自动水平翻转。
- 状态的值可以是：
  - 一个文件名（`.gif/.png/.apng/.webp/.jpg/.svg` 为图片，`.webm/.mp4/.mov` 为视频）
  - 一个帧文件数组
  - `{ "dir": "文件夹" }`：按文件名自然排序（1, 2, …, 10）读取文件夹里所有图片
  - `{ "src": "...", "frames": [...], "dir": "...", "fps": 10, "loop": true }`
- `stages`（可选）：给幼年 `baby`、少年 `child`、成年 `adult` 单独指定素材，没写的状态用 `states` 里的。

---

## 最简单的方式：一张图片

面板 → 形象 → **用一张图片做宠物**，选一张图（最好是透明背景的 PNG）就行。SoulPet 会自动给它加上呼吸、走路蹦跳、开心弹跳、难过垂头、睡觉、冒爱心和 Zzz 等动作。

手写 manifest 也可以，只要加上 `"animate": true`：

```json
{ "name": "我的猫", "size": [180, 160], "animate": true, "states": { "idle": "cat.png", "sleep": "cat-sleep.png" } }
```

`animate: true` 也可以和多状态素材一起用：有图的状态用你的图，再叠加上动作和特效。

## 状态名与回退规则

缺少的状态会按下表依次尝试，最后回退到 `idle`。所以**最少只需要一个 `idle`**。

| 状态 | 何时出现 | 缺少时依次尝试 |
| --- | --- | --- |
| `idle` | 待机 | — |
| `walk` / `walk_left` | 在桌面上走 | `walk_left` → `walk`（翻转）→ `idle` |
| `drag` | 被鼠标拎起来 | `jump` → `surprised` → `wave` |
| `fall` | 松手后下落 | `jump` → `drag` |
| `sleep` | 睡觉 | `think` → `talk` |
| `eat` | 吃东西 | `happy` → `talk` |
| `happy` | 开心、被摸 | `wave` → `jump` |
| `sad` | 难过、饿坏了 | `sick` |
| `angry` | 生气 | `sad` |
| `surprised` | 惊讶 | `jump` → `happy` |
| `shy` | 害羞 | `happy` → `wave` |
| `think` | 等 AI 回复 | `talk` |
| `talk` | 正在说话 | `wave` → `happy` |
| `work` | 打工 / 学习 | `think` → `talk` |
| `sick` | 生病 | `sad` → `sleep` |
| `play` | 玩耍 | `jump` → `happy` |
| `bath` | 洗澡 | `happy` |
| `wave` | 打招呼 | `happy` → `jump` |
| `jump` | 跳 | `happy` → `wave` |

AI 回复开头的情绪标签会映射成状态：`[happy]`/`[love]` → happy，`[excited]` → jump，`[sad]` → sad，`[angry]` → angry，`[surprised]` → surprised，`[shy]` → shy，`[sleepy]` → sleep，`[thinking]` → think，`[neutral]` → talk。

---

## 用 AI 做一只自己的宠物

1. 用图像模型生成角色**正面、侧面**的设定图，固定画风和配色。
2. 逐个动作生成：
   - **AI 视频**：生成“绿幕背景 + 角色在做某个动作”的短视频，用 ffmpeg 去掉绿幕后导出透明 WebM：
     ```bash
     ffmpeg -i idle.mp4 -vf "chromakey=0x00ff00:0.15:0.05,scale=200:-1" -c:v libvpx-vp9 -pix_fmt yuva420p -an idle.webm
     ```
   - **序列帧**：用图像模型逐帧生成，再用抠图工具去掉背景，放进同一个文件夹。
3. 写 `manifest.json`，放进形象包目录，重新扫描。
4. 想要 Codex 格式？把每个动作的帧排进 8×9 的网格（每格 192×208），导出 `spritesheet.webp`。

## 版权提醒

只使用你有权使用的素材。网上下载的形象包，请遵守作者声明的许可证（很多同人素材**禁止商用**）。SoulPet 不会自带任何第三方版权素材。
