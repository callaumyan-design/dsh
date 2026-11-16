# 起始页说明

网站首页（`index.html`）是一个个人导航起始页：时钟、搜索框（点左边的标记切换引擎）、页面底部的一排应用图标、右上角的设置面板。
纯静态网站，没有构建步骤，也没有任何第三方依赖——把仓库里的文件原样放到任何静态托管上就能用。

原首页（README）的内容在 `/about/`。

## 文件在哪

| 想改什么 | 改哪个文件 |
| --- | --- |
| 底部的应用图标（导航入口） | `config/nav.js` |
| 默认背景、AI（catgpt）地址 | `config/site.js` |
| 页面名称（浏览器标签、主屏幕图标下的名字） | `index.html` 里的 `<title>`，`manifest.webmanifest` 里的 `name` / `short_name` |
| 样式 | `assets/css/main.css` |
| 功能代码 | `assets/js/`（每个文件开头有一句话说明它管什么） |
| /about 页面 | `about/index.html`（README 改了要手动同步这里） |
| Duo 报告、UQ 校历的副本 | `duo/`、`uq/`（用 `tools/refresh-apps.sh` 更新，不要手改） |
| 发布到 Cloudflare | `tools/deploy-cloudflare.mjs`、`tools/worker/handler.js` |

## 新增一个导航入口

1. 打开 `config/nav.js`。
2. 在 `export default [` 和最后的 `];` 之间加一段（注意每行末尾的逗号）：

   ```js
   {
     name: "名称",
     icon: "globe",
     url: "https://example.com/",
     desc: "一句话描述",
     group: "分组名",
     newTab: true,
     color: "#5b5bd6",
   },
   ```

3. `icon` 可以填：本地图标库里的名字（`assets/js/icons.js` 里每一行开头引号里的词，如 `globe`、`download`、`cat`）、
   仓库里一张图片的路径（如 `./assets/img/logo.png`）、或者一个表情 / 一两个字。
4. `color` 是图标的底色（可不写）。`desc` 是鼠标停在图标上时显示的说明。
5. 保存、提交、上线。分组名相同的入口会排在一起；只有一个分组时不显示分组名。

入口在页面最下面显示成一排小应用图标；多了会自动换行。每个图标右上角的小点表示它现在能不能访问。

后台、管理面板这类**私密入口不要写进这个文件**（它是公开的）。在页面右上角点铅笔按钮进入编辑模式，
用“添加入口”来加——只保存在你自己这台设备的浏览器里。

一个入口都没有时，底部什么都不显示，首页只有时钟和搜索框。

## 换默认背景

打开 `config/site.js`：

- 换成另一套内置背景：把 `DEFAULT_BACKGROUND = "aurora"` 改成 `"dusk"`（暮色）或 `"mist"`（晨雾）。
- 用自己的图片：把图片放进仓库（比如 `assets/img/bg.jpg`），在 `BACKGROUND_PRESETS` 里把某一套的
  `css: "..."` 那一行换成 `image: "./assets/img/bg.jpg"`，再把 `color` 改成和图片主色接近的颜色
  （图片加载出来之前先显示它），`tone` 按图片偏暗 / 偏亮填 `"dark"` / `"light"`。

默认背景只影响“还没自己设置过背景”的访客；每个人在设置面板里选的背景只存在他自己的浏览器里。

## 在线壁纸

设置 → 背景 → “在线”。默认不联网，选了这一项才会从网上加载壁纸。

- **来源**（四选一）：
  - 随机摄影（Picsum）：免费的随机摄影图库，浏览器直接去取；
  - 必应每日一图：必应首页当天的那张，每天自动换；
  - 必应近期壁纸（随机）：从必应最近 8 天的图里随机挑；
  - 自定义接口：填一个“打开就返回一张图片”的地址，地址里可以用 `{w}`、`{h}` 代表需要的宽和高。
- **多久换一张**：每次打开页面 / 每小时 / 每天 / 只在点“换一张”时（“必应每日一图”没有这一项）。
- 下一张会提前下载好，所以换图时不用等；连不上时自动显示内置背景。
- 必应的两个来源下面会显示当前这张图的标题和出处。
- 必应的图由网站自己的后台代取（`tools/worker/wallpaper.js`，地址是 `/api/wallpaper`），必应看不到访客的网络地址；
  其他来源由浏览器直接去取，提供图片的服务器能看到访客的网络地址。都看不到搜索内容。
- 后台只会去必应取图，不是“给个网址就代取”的通用中转。想加别的图库，照着 `wallpaper.js` 里 `bing` 的样子写。
- 网站如果搬到没有后台的地方（比如 GitHub Pages），把 `config/site.js` 里的 `WALLPAPER_API` 改成 `""`，必应两项就不会出现。

## 文字

设置 → 文字：字体（系统默认 / 宋体 / 楷体 / 圆体 / 等宽 / 自定义）、字号、粗细，以及时钟单独的大小和粗细。
字体只用访客设备上已经装好的，不从网上下载，所以同一个选项在不同设备上的字形可能不一样。
想增减字体选项，改 `assets/js/typography.js` 里的 `STACKS` 和 `FONT_CHOICES`。

## 接入 AI（CatGPT）

起始页这边已经做好三种工作方式，由 `config/site.js` 里的 `AI` 决定用哪一种：

| 填法 | 效果 |
| --- | --- |
| 两个地址都空着（现在的状态） | AI 模式提示“还没有接入”，并提供“改用搜索引擎搜” |
| 只填 `pageUrl` | 提问后带着 `?q=问题` 跳转到 CatGPT 页面 |
| 填了 `apiUrl` | 在起始页里弹出对话面板，直接调用后端接口，流式显示 |

**这里只能填地址。API Key 绝不能写进这个仓库的任何文件**，它只存在于 CatGPT 的服务端。

### CatGPT 目前的情况（代码在本仓库的 `claude/omnichat-webapp` 分支，目录 `omnichat/`）

- 前端是 React 单页应用，后端是 Hono（可以跑在 Docker / Node 上，也可以跑在 Cloudflare Workers 上）。
- 用**账号登录**（用户名 + 密码），登录后拿到令牌，所有接口都要带令牌；登录失败有按 IP 的限速。
- 对话走 `/api/proxy/<服务商编号>/…`，由服务器代为调用各家模型接口，支持流式输出。
- API Key 加密后保存在服务器的数据库里，浏览器拿不到明文。
- **没有跨域白名单**，所以别的网站（包括起始页）不能直接调用它的接口。
- 网页**不认 `?q=` 参数**。

### 所以现在该怎么接

推荐用“跳转”方式（登录、模型选择、历史记录都沿用 CatGPT 自己的，不重复造一套）：

1. 在 `config/site.js` 里把 `pageUrl` 填成 CatGPT 的网址。
2. 给 CatGPT 的网页加一个小功能：打开时如果网址带 `?q=问题`，就自动填入并发送
   （没登录就先登录，登录后再发）。不带 `?q=` 时一切照旧，不影响它单独使用。

如果以后想用“弹出对话面板”，CatGPT 还需要再加两样东西（接口格式不同的话，只改 `assets/js/ai/client.js` 这一个文件）：

1. 一个简单的对话接口：`POST`，请求体 `{ "messages": [{ "role": "user", "content": "..." }], "stream": true }`，
   用账号默认的模型回答，按 SSE（OpenAI 兼容格式）流式返回；没带凭证返回 `401`，太频繁返回 `429`。
2. 跨域白名单：`Access-Control-Allow-Origin: <起始页域名>`，`Access-Control-Allow-Headers: Content-Type, Authorization`，
   并正确回应 `OPTIONS` 预检请求。如果起始页和 CatGPT 部署在同一个域名下，就不需要这一条。

## 五个应用在哪

| 应用 | 地址 | 说明 |
| --- | --- | --- |
| Duo 适配 | `./duo/`（本网站的子目录） | 仓库里的 `duo/index.html`，是用 Duo 追踪器分支里的数据生成的报告 |
| UQ 校历 | `./uq/`（本网站的子目录） | 仓库里的 `uq/index.html`，是 UQ 校历分支上那个网页文件的副本 |
| CatGPT | `https://chat.callaum.com/` | 另外部署在微软（Azure）的服务器上 |
| WiFi Drop | `https://chat.callaum.com/drop/` | 和 CatGPT 在同一台服务器上 |
| 砚录 | `https://ocr.callaum.com/` | 另外部署在 Cloudflare 上 |

`duo/` 和 `uq/` 是副本，不会自动跟着原项目更新。原项目更新后，在仓库根目录运行：

```bash
bash tools/refresh-apps.sh
```

它会从那两个分支取最新内容，重新生成这两个文件。检查改动后提交，再重新发布。

## 部署

网站没有构建步骤，所有路径都是相对路径，放在域名根目录或子目录下都能用。

### 发布到 Cloudflare（现在用的方式）

```bash
node tools/deploy-cloudflare.mjs
```

它把网站文件（首页、`about/`、`assets/`、`config/`、`uq/`、`duo/` 等）打成一个 Cloudflare Worker 上传，
发布到 `https://start-page.<账户名>.workers.dev/`（`callaum.com` 绑的就是它，发布后两个地址同时更新）。需要一个有“Workers Scripts 编辑”权限的 Cloudflare API 令牌
（环境变量 `CLOUDFLARE_API_TOKEN`；在 Claude 的云端会话里如果令牌已经保存在环境里就不用设）。
加 `--dry-run` 只打包不上传。每次改了网站内容，重新运行一次就是更新。

### callaum.com 和 CatGPT 的地址

`callaum.com` 原来是 CatGPT 的地址。起始页接管这个域名时，CatGPT（以及同一台服务器上的 WiFi Drop）
搬到了 `https://chat.callaum.com/`。

- `callaum.com` 和 `www.callaum.com` 绑在 Cloudflare 的 `start-page` 项目上（Workers & Pages → `start-page` → Settings → Domains & Routes）。
- `chat.callaum.com` 是 Cloudflare DNS 里的一条 A 记录，直接指向那台微软服务器（不开代理）。
- 旧的 `callaum.com/drop/…` 会自动跳到 `chat.callaum.com/drop/…`，规则写在 `tools/worker/redirects.json` 里。
- 那台服务器按虚拟机的 `domain` 标签决定自己接受哪些地址（多个地址用逗号隔开）。
  它同时还接受微软自带的网址 `omnichat-28701.japaneast.cloudapp.azure.com`，作为备用。

注意：那台服务器上的网关配置文件里有一段手工加的 WiFi Drop 设置，不在 CatGPT 的代码仓库里。
服务器重启或运行它的更新脚本时，这个文件会被仓库里的版本覆盖，WiFi Drop 会因此打不开——
想避免的话，需要把那段设置提交进 CatGPT 的仓库。

起始页的离线缓存（`sw.js`）只管它自己的文件（首页、`about/`、`assets/`、`config/`），不会拦截或缓存同域名下其他应用的页面和接口。

### 其他静态托管

也可以用 GitHub Pages：仓库 Settings → Pages → Source 选 “Deploy from a branch”，选分支和 `/ (root)`。

## 检查

- 逻辑检查：在仓库根目录运行 `node --test`（需要 Node.js 20 以上，不用安装任何东西）。
- 本地预览：在仓库根目录运行 `python3 -m http.server 8080`，浏览器打开 `http://localhost:8080/`。

## 图标来源

`assets/js/icons.js` 里的图标取自 [Lucide](https://lucide.dev)（ISC 许可，见 `assets/icons/LICENSE-lucide.txt`）。
