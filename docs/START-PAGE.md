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
| 行情卡片 | 页面：`assets/js/market/`、`assets/css/market.css`；后台：`tools/worker/quotes.js`、`quote-sources.js`（见下面“行情卡片”） |

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
4. `color` 是图标的底色，可以不写：不写就是半透明的“毛玻璃”底（会透出壁纸的颜色），图形是白色的。
   `desc` 是鼠标停在图标上时显示的说明。
5. 保存、提交、上线。分组名相同的入口会排在一起；只有一个分组时不显示分组名。

入口在页面最下面显示成一排小应用图标，全部排成一行（放不下时可以左右滑动）。

现在的五个应用用的是专门画的图标，文件在 `assets/icons/apps/`（白色图形、透明底的 svg）。
想给新入口也画一个：照着那里的文件做一张 120×120 的 svg，图形用白色，再把 `icon` 写成它的路径。
**svg 里不要用 filter（投影、模糊）和 mask**：iPhone 的 Safari 会把带这些效果的 svg 图片按低分辨率画，图标会糊。
要挖空就用 `clip-path`，要半透明就用 `fill-opacity` / `stroke-opacity`。
线上的图标地址后面会自动带上 `?v=版本号`，换了图标重新发布，手机上就会拿到新图。

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
- **清晰度**：按设备屏幕的真实像素取图，不放大。随机摄影（Picsum）要多大给多大（竖屏长边最多 2800，横屏最多 2880）；
  必应在电脑上最高到 3840×2160，在手机竖屏上只有它专门为手机裁好的 1080×1920（必应自己的上限，高清手机上会被放大一点）。
- **壁纸出处**：主页最底下有一行小字，写着当前这张壁纸的标题、作者（必应）或摄影师（Picsum），点一下能打开原出处；设置里“在线”一栏也有同样的信息。自定义接口查不到出处，就不显示。
- 必应的图由网站自己的后台代取（`tools/worker/wallpaper.js`，地址是 `/api/wallpaper`），必应看不到访客的网络地址；
  其他来源由浏览器直接去取，提供图片的服务器能看到访客的网络地址。都看不到搜索内容。
- 后台只会去必应取图，不是“给个网址就代取”的通用中转。想加别的图库，照着 `wallpaper.js` 里 `bing` 的样子写。
- 网站如果搬到没有后台的地方（比如 GitHub Pages），把 `config/site.js` 里的 `WALLPAPER_API` 改成 `""`，必应两项就不会出现。

## 文字

设置 → 文字：字体（系统默认 / 宋体 / 楷体 / 圆体 / 等宽 / 自定义）、字号、粗细，以及时钟单独的大小和粗细。
字体只用访客设备上已经装好的，不从网上下载，所以同一个选项在不同设备上的字形可能不一样。
想增减字体选项，改 `assets/js/typography.js` 里的 `STACKS` 和 `FONT_CHOICES`。

## AI

### 最简单的用法：在设置里自己填接口

右上角齿轮 → **AI**，填三样东西，点“保存并测试”：

- **接口地址**：可以先在“选服务商”里选一个（DeepSeek、OpenAI、硅基流动、OpenRouter、Kimi、智谱、通义千问、本机的 Ollama），地址会自动填好。
  少写了结尾的 `/v1` 也没关系，测试时会自动补上。
- **API Key**：在服务商的网站上申请的那串密钥。
- **模型**：比如 `deepseek-chat`。不知道填什么，点“读取模型列表”再选。

之后在搜索框左边的标记里选“AI”，或者直接输入 `!ai 问题`，就会在页面里弹出对话面板，边生成边显示，可以追问。

要点：

- 支持的是“OpenAI 兼容”的对话接口（`POST …/chat/completions`），市面上大多数服务都是这种。
- **API Key 只保存在填它的那台设备的浏览器里**：不在这个仓库的任何文件里，“导出设置”不会带上它，“恢复默认”会把它删掉。
  提问时由浏览器直接发给填的接口地址，不经过本站的服务器。所以不要在公用电脑上填；换设备要重新填一次。
- 有的服务不允许网页直接调用（浏览器会拦下来），这时测试会提示“连不上”。换一家服务商，或者用下面的 CatGPT 方式。
- 相关代码：`assets/js/ai/api.js`（保存）、`assets/js/ai/api-tools.js`（服务商列表、测试、读取模型）、`assets/js/ai/client.js`（收发对话）。
  想增减“选服务商”里的选项，改 `api-tools.js` 最上面的 `AI_PRESETS`。

### 另一种：接到 CatGPT（站点配置）

没有在设置里填接口时，才会用到这一种。由 `config/site.js` 里的 `AI` 决定：

| 填法 | 效果 |
| --- | --- |
| 两个地址都空着（现在的状态） | AI 模式提示“还没有接入”，并提供“改用搜索引擎搜” |
| 只填 `pageUrl` | 提问后带着 `?q=问题` 跳转到 CatGPT 页面 |
| 填了 `apiUrl` | 在起始页里弹出对话面板，直接调用后端接口，流式显示 |

**`config/site.js` 里只能填地址。API Key 绝不能写进这个仓库的任何文件**（这个文件是公开的）。

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

## 行情卡片（隐藏的）

主界面上没有入口：**轻点页面空白处**（背景本身；按钮、输入框、时钟、搜索框、导航那一排都不算），
或者在电脑上焦点不在输入框时**按 M**，壁纸雾化、卡片出现在屏幕中间。点卡片外面、按 Esc 或点 × 收起。

- 规则：引擎菜单、搜索历史开着时，第一下只关掉它们；手机键盘弹着时，第一下只收起键盘；导航编辑模式下不响应；
  设置 → 行情 里关掉“启用行情卡片”后完全不响应。
- 内容：按 A 股、港股、美股、汇率分组，每组标题是市场状态（按交易所时区算，夏令时自动处理；
  交易时段里最新成交不是今天就显示“休市”，不写死节假日）。底部是更新时间、“延时”标记、刷新和编辑按钮。
- 关注列表：卡片里点铅笔编辑（添加、删除、上下移动），只存在浏览器里，“导出设置”会带上它。
  代码统一写成 `SH:600519`、`SZ:000001`、`BJ:920118`、`HK:00700`、`HK:HSI`、`US:NVDA`、`US:.IXIC`、`FX:AUDCNY`（CNY 在岸，CNH 离岸）。
- 刷新：打开时先显示上次的数据，同时去拿新的；卡片开着、页面在前台时按设置每 1 / 5 / 15 分钟刷新，
  关注的市场都不在交易时最多 30 分钟一次；收起或切到后台就停。
- 演示：网址后面加 `?demo=quotes`（如 `https://callaum.com/?demo=quotes`），不连后台，卡片上标“演示数据”。

### 后台接口 `/api/quotes`

代码在 `tools/worker/quotes.js`（接口、缓存、自检）和 `tools/worker/quote-sources.js`（各数据源的解析）。
代码格式和交易时间的规则在 `assets/js/market/ids.js`、`hours.js`，页面和后台共用（发布时会打进后台的包里）。

| 市场 | 主数据源 | 备用 |
| --- | --- | --- |
| A 股、港股、各种指数 | 腾讯（不用 Key） | 新浪（必须带 Referer，只能在后台调） |
| 美股个股 | Finnhub（要 `FINNHUB_KEY`，免费档每分钟 60 次） | 腾讯 → 新浪 |
| 汇率 | Twelve Data（要 `TWELVEDATA_KEY`，免费档每分钟 8 次、每天 800 次，按代码计） | 新浪外汇（实时，有离岸 CNH）→ 欧洲央行参考价 Frankfurter（每天一次，没有 CNH） |

- 腾讯、新浪是非官方接口，格式随时可能变。解析时会核对代码、核对“涨跌额 / 涨跌幅”和“现价 − 昨收”对不对得上，
  对不上就当作取不到（那一行变灰、写明暂时取不到），绝不显示可能错位的数字。
- 哪些行情算“延时”写在 `quote-sources.js` 的 `DELAYED` 里（港股、腾讯和新浪的美股先按延时标）。用自检核对后可以改。
- 美股盘前盘后价：只有新浪给，而且要和常规价核对得上才显示；拿不到就不显示。
- 缓存：同一个代码交易时 1 分钟、休市收盘时 15 分钟、参考价 1 小时内不重复去取。先看服务器内存，
  再看 Cloudflare 的缓存（只在 callaum.com 这类自己的域名上起作用，workers.dev 上自动跳过）。**请用 callaum.com 打开起始页。**
- 一次最多 40 个代码；每个代码先按格式核对才会拼进上游地址；不开跨域，浏览器标明“来自别的网站”的请求直接拒绝；每次请求上游 5 秒超时。
- **访问口令是可选的**：Cloudflare 后台没设 `QUOTES_TOKEN` 时不用口令（现在就是这样）；
  哪天发现被别人用掉额度，在后台加上这个密钥，卡片就会自动请你输入口令，不用改代码。

### 第一次启用要做的事

1. 申请两个免费 Key（可选，不填也能用，只是美股改走腾讯、汇率改走新浪 / 参考价）：
   - Finnhub：在 finnhub.io 注册，Dashboard 里能看到 API Key；
   - Twelve Data：在 twelvedata.com 注册，Dashboard → API Keys。
2. （可选）在 Cloudflare 后台：Workers & Pages → `start-page` → Settings → Variables and Secrets → Add，类型选 **Secret**，添加：
   - `FINNHUB_KEY`、`TWELVEDATA_KEY`：上面的两个 Key；
   - `QUOTES_TOKEN`：访问口令（可选，不设就谁都能用；要设的话用 24 位以上随机字符）。
   最后点 Deploy。之后用 `node tools/deploy-cloudflare.mjs` 发布新版本时，这些密钥会保留（发布脚本带了 `keep_bindings`）。
3. 手机打开 `https://callaum.com/api/quotes/selftest`，点“开始检查”（设了口令就先填上），看各数据源是不是“正常”，可以展开看原始返回。
4. 轻点起始页空白处就能用。设了口令的话，第一次会请你输入，之后在这台设备上记住（天数同 `config/site.js` 里的 `passwordDays`）；
   口令不会被“导出设置”带走，“恢复默认”会把它和关注列表一起清掉。

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

**版本号（防止手机上看到旧内容）**：每次发布，脚本会根据所有文件的内容算出一个版本号，写进首页，
并让首页用 `v/版本号/assets/…`、`v/版本号/config/…` 这样的地址引用样式、脚本和配置。
内容一变地址就变，浏览器不可能再用到上一版留下的旧文件（以前出过“样式是新的、图标还是旧的”）。
页面打开后、以及从后台切回来时，会问一下服务器现在是哪一版（`/api/build`），发现自己是旧的就自动刷新一次；
正在输入或开着设置、对话面板时不会打断。仓库里的 `index.html` 写的是 `content="dev"` 和不带版本号的地址，
本机预览或放到别的静态托管上照常能用，只是没有这层保护。

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

起始页的离线缓存（`sw.js`）只管它自己的文件（首页、`about/`、`assets/`、`config/`，以及带版本号的 `v/…/`），不会拦截或缓存同域名下其他应用的页面和接口。
页面本身每次都向服务器确认是不是最新的；带版本号的文件存过就直接用。改了 `sw.js` 要把里面的 `CACHE` 名字加一号。

### 其他静态托管

也可以用 GitHub Pages：仓库 Settings → Pages → Source 选 “Deploy from a branch”，选分支和 `/ (root)`。

## 检查

- 逻辑检查：在仓库根目录运行 `node --test`（需要 Node.js 20 以上，不用安装任何东西）。
- 本地预览：在仓库根目录运行 `python3 -m http.server 8080`，浏览器打开 `http://localhost:8080/`。

## 图标来源

`assets/js/icons.js` 里的图标取自 [Lucide](https://lucide.dev)（ISC 许可，见 `assets/icons/LICENSE-lucide.txt`）。
`assets/icons/apps/` 里的五个应用图标是为这个网站单独画的。
