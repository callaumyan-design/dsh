# 起始页说明

网站首页（`index.html`）是一个个人导航起始页：时钟（后面跟着天气）、搜索框（点左边的标记切换引擎，右边可以语音输入）、搜索框下面的行情、页面底部的应用图标、右上角的设置面板。
纯静态网站，没有构建步骤，也没有任何第三方依赖——把仓库里的文件原样放到任何静态托管上就能用。

原首页（README）的内容在 `/about/`。

## 文件在哪

| 想改什么 | 改哪个文件 |
| --- | --- |
| 底部的应用图标（导航入口） | `config/nav.js` |
| 默认背景、天气的默认城市（定位不了时用）、AI（catgpt）地址 | `config/site.js` |
| 页面名称（浏览器标签、主屏幕图标下的名字） | `index.html` 里的 `<title>`，`manifest.webmanifest` 里的 `name` / `short_name` |
| 样式 | `assets/css/main.css` |
| 功能代码 | `assets/js/`（每个文件开头有一句话说明它管什么） |
| /about 页面 | `about/index.html`（README 改了要手动同步这里） |
| UQ 校历的副本、Duo 报告的备用副本 | `uq/`、`duo/`（用 `tools/refresh-apps.sh` 更新，不要手改） |
| 发布到 Cloudflare | `tools/deploy-cloudflare.mjs`、`tools/worker/handler.js` |
| 不让搜索引擎和爬虫抓取 | `robots.txt`（整站都不让抓；这个文件谁都能看，不要在里面写私密地址） |
| Duo 适配（/duo/） | `tools/worker/duo.js`；备用副本 `duo/index.html`（见下面“Duo 适配”） |
| 飞汇地区比价（/flywire/） | `tools/worker/flywire.js`；备用副本 `flywire/index.html`（见下面“飞汇地区比价”） |
| 首页的行情 | 页面：`assets/js/market/`、`assets/css/market.css`；后台：`tools/worker/quotes.js`、`quote-sources.js`（见下面“行情”） |

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
- 打开页面时不会先灰一下：每张壁纸（在线、上传的都算）第一次显示时，会记下一张几百字节的模糊小图
  （存在浏览器的 `sp:bg-thumbs`，最多 6 张），并记下这张图的地址。下次打开时，页面一开始绘制就直接把这张图画上去
  （浏览器缓存里有，几乎马上就是清晰的），模糊小图只在图还没下载好时垫在下面；脚本加载好以后原地接手，不再淡入一遍。
  “每次打开换一张”时，记下的是已经提前下载好的那张。别的网站不让读取图片内容的（自定义接口、图片链接）做不了小图，
  还是先显示纯色。
- **清晰度**：按设备屏幕的真实像素取图，不放大。随机摄影（Picsum）要多大给多大（竖屏长边最多 2800，横屏最多 2880）；
  必应在电脑上最高到 3840×2160，在手机竖屏上只有它专门为手机裁好的 1080×1920（必应自己的上限，高清手机上会被放大一点）。
- **壁纸出处**：主页最底下有一行小字，写着当前这张壁纸的标题、作者（必应）或摄影师（Picsum），点一下能打开原出处；设置里“在线”一栏也有同样的信息。自定义接口查不到出处，就不显示。
- 必应的图由网站自己的后台代取（`tools/worker/wallpaper.js`，地址是 `/api/wallpaper`），必应看不到访客的网络地址；
  其他来源由浏览器直接去取，提供图片的服务器能看到访客的网络地址。都看不到搜索内容。
- 后台只会去必应取图，不是“给个网址就代取”的通用中转。想加别的图库，照着 `wallpaper.js` 里 `bing` 的样子写。
- 网站如果搬到没有后台的地方（比如 GitHub Pages），把 `config/site.js` 里的 `WALLPAPER_API` 改成 `""`，必应两项就不会出现。

## iPhone 上 Safari 工具栏下面那一块

新版 Safari（iOS 26）的地址栏、侧边栏是半透明“玻璃”，压在网页上面。普通的长网页会从工具栏下面透出来；
但起始页的壁纸是固定铺满屏幕的，Safari 不会把这种固定的图片画到工具栏下面，而是用**网页的底色**把那一块填满。

所以网页底色（`html` 的背景）取的是**壁纸最下面一条的颜色**（再按暗度遮罩压暗），由 `background.js` 的 `paintEdge()` 算好；
手机上壁纸最下面还有一小段从透明渐变到这个颜色的过渡（`#bg-edge`），让壁纸自然地融进工具栏。
`body` 不能设底色：`html` 有底色以后，`body` 的底色会盖在壁纸上面。

## 天气

问候语后面的一句，如“布里斯班 28° 多云”，**按你所在的位置显示，不用设置城市**。代码在 `assets/js/weather.js`（定位和查地名在 `weather-where.js`，打开页面后稍后才加载）。

- **位置**：浏览器定位。第一次打开会问“是否允许使用位置”，点允许即可。
  - 允许以后：每次更新天气前顺便看一下位置，换了地方（超过约 3 公里）天气和地名跟着变。
  - 浏览器设成“每次都问”的（iPhone Safari 默认如此）：最多 12 小时问一次，中间用上次定到的位置。
    想不再被问：Safari 地址栏点网站设置按钮 → 网站设置 → 位置 → 允许（或 iPhone 设置 → App → Safari → 位置 → 允许）。
  - 不允许或定位不了：显示默认城市（`config/site.js` 的 `WEATHER_PLACE`），存着的位置会删掉。
  - 设置 → 小组件 里能看到现在按哪里显示，可以点“重新定位”，也可以关掉天气。
- **地名**：用 OpenStreetMap 的 [Nominatim](https://nominatim.org/) 把经纬度换成城市名（只在换了地方时查一次，存在本机 `sp:where`）。
  北京、上海、天津、重庆、东京这几处它给的是区名，代码里换成城市名；多种写法时取第一种；一律转成简体（`assets/js/zh-hans.js`，
  由 `tools/make-zh-table.mjs` 根据 OpenCC 的字表生成，文件开头写了怎么重新生成）。按 Nominatim 的规定，请求里带上网站地址（只有域名），设置里写明了数据来源。
- **天气**：[Open-Meteo](https://open-meteo.com/)，免费，不用 API Key，不用在 Cloudflare 后台设置任何东西。
- 都由**浏览器直接去取**，不经过本站后台（Open-Meteo 按来访的网络地址限制次数，而 Cloudflare 后台的出口地址是很多网站共用的，代取容易被限流）。
  发出去的只有大致位置（经纬度两位小数，约 1 公里），不带 Cookie。
- 取到的天气存在本机（`sp:weather`）：打开页面先显示存着的，再去更新；页面在前台时每 30 分钟更新一次，在后台时不取。
  取不到就不显示，不弹提示（3 小时以内存着的照常显示）。“恢复默认”会清掉存着的位置和天气。
- 这一行放不下时（比如手机竖屏），天气整句换到下一行。
- 天气文字（WMO 天气代码 → 中文）在 `weather.js` 的 `WEATHER_TEXT` 里改。

## 语音输入

搜索框里的麦克风按钮（框里没字时显示，有字时换成清空按钮）。点一下开始听，说的话边说边显示在框里，说完直接搜；
听的时候再点一下就按已经听到的搜，按 Esc 取消。代码在 `assets/js/voice.js`（点麦克风时才加载）。

- 用的是浏览器自带的语音识别（Web Speech API）：声音由浏览器交给它自己的语音服务（Safari 是苹果，Chrome 是谷歌），不经过本站，本站也不保存。
- 识别语言在 设置 → 搜索 里选：普通话（默认）或 English。
- 浏览器不支持语音识别（比如火狐）时不显示麦克风。iPhone 上要允许 Safari 使用麦克风，并在 设置 → Siri 里打开“听写”。

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

## 行情（首页搜索框下面）

首页搜索框正下方的一小块：**透明底，白字加阴影直接压在壁纸上**（和时钟、应用名称一样）。左边一列股票和指数（A 股、港股、美股的顺序），右边一列汇率，各自从上往下排；每个一行：名称、现价、涨跌幅，整块只有内容那么宽；两列并排放不下（很窄的手机）时排成一列，股票在上、汇率在下；
最下面一行小字是更新时间（和“延时”等标记），右边是刷新和编辑按钮。代码、币种、涨跌额、市场分组和状态、盘前盘后价在首页都省掉了，编辑时才显示代码和分组状态。
代码在 `assets/js/market/panel.js`，样式在 `assets/css/market.css`，页面出来时一起加载；设置 → 行情 里关掉“在首页显示行情”后不显示、不加载、不联网。
（以前是“轻点空白处 / 按 M 才出现的隐藏卡片”，后来放到首页，那两种唤出方式都去掉了。）

- 数据：按 A 股、港股、美股、汇率的顺序排，市场状态按交易所时区算（夏令时自动处理；交易时段里最新成交不是今天就算“休市”，不写死节假日），
  用来决定多久刷新一次，编辑时显示在每组标题上。首页上用短名字：纳斯达克综合指数写“纳斯达克”（道琼斯、标普500、恒生科技、国企指数同理，见 `panel.js` 的 `SHORT`），对人民币的汇率只写外币（“澳元”“美元”，离岸的写“美元 离岸”）；用的是每日参考价时名称后面标“参考价”。
- 编辑、添加时垫一块毛玻璃（按钮、输入框多，要看得清），文字跟着主题。
- 关注列表：点右下角的铅笔，在这一块里直接编辑（删除、上下移动），最下面“添加关注”进入搜索页（Esc 一层一层退回）。
  只存在浏览器里，“导出设置”会带上它。导航编辑模式时行情先收起。
- 添加关注只有一个搜索框，不用先选市场：名称（茅台、腾讯、英伟达、apple）、拼音首字母（txkg）、代码（600519、700、NVDA）、
  常用指数（纳斯达克、恒生科技、标普）、汇率（澳元、美元离岸、AUDCNY）都能搜，A 股、港股、美股、汇率一起列出来，
  每条带现价，点一下加入；查不到行情的不列。000001 这种撞号的会把平安银行和上证指数都列出来。
  代码统一写成 `SH:600519`、`SZ:000001`、`BJ:920118`、`HK:00700`、`HK:HSI`、`US:NVDA`、`US:.IXIC`、`FX:AUDCNY`（CNY 在岸，CNH 离岸）。
- 刷新：打开页面时先显示上次的数据；一分钟内刚拿过的不重复拿（后台的缓存也是一分钟），关注的市场都休市时按刷新间隔。
  页面在前台时按设置每 1 / 5 / 15 分钟刷新，关注的市场都不在交易时最多 30 分钟一次；切到后台就停，切回来过期就马上刷新。
- 要口令时（后台设了 `QUOTES_TOKEN`）：这一块里出现口令输入框；打开页面时不抢搜索框的光标。
- 演示：网址后面加 `?demo=quotes`（如 `https://callaum.com/?demo=quotes`），不连后台，标出“演示数据”。

### 后台接口 `/api/quotes`

代码在 `tools/worker/quotes.js`（接口、缓存、自检）、`tools/worker/quote-sources.js`（各数据源的解析）
和 `tools/worker/quote-search.js`（按名称搜：腾讯 smartbox 为主、新浪 suggest 备用，英文名再问 Finnhub）。
`/api/quotes/search?q=茅台` 返回带现价的候选；常用指数和汇率的叫法写在 `assets/js/market/words.js`。
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
4. 打开起始页，搜索框下面就是行情。设了口令的话，第一次会请你输入，之后在这台设备上记住（天数同 `config/site.js` 里的 `passwordDays`）；
   口令不会被“导出设置”带走，“恢复默认”会把它和关注列表一起清掉。

## 应用栏里的应用

一行放得下就排成一行；放不下就平均分成几行（手机上 10 个排成 5 + 5），由 `nav.js` 的 `fitRows()` 按宽度算。

| 应用 | 地址 | 说明 |
| --- | --- | --- |
| Duo 适配 | `./duo/`（本网站的子页面） | Duo 追踪器每天自动更新的报告（Claude 云端定时任务），见下面“Duo 适配” |
| CatGPT | `https://chat.callaum.com/` | 另外部署在微软（Azure）的服务器上 |
| UQ 校历 | `./uq/`（本网站的子目录） | 仓库里的 `uq/index.html`，是 UQ 校历分支上那个网页文件的副本 |
| my.UQ | `https://portal.my.uq.edu.au/#/dashboard` | UQ 学生门户，图标是一顶学士帽 |
| 飞汇地区比价 | `./flywire/`（本网站的子页面） | 另一个仓库每周自动更新的报告（Claude 云端定时任务），见下面“飞汇地区比价” |
| 砚录 | `https://ocr.callaum.com/` | 另外部署在 Cloudflare 上 |
| WiFi Drop | `https://chat.callaum.com/drop/` | 和 CatGPT 在同一台服务器上 |
| Claude | `https://claude.ai/` | Anthropic 的 AI 助手（网页版） |
| ChatGPT | `https://chatgpt.com/` | OpenAI 的 AI 助手（网页版） |
| Muse | `https://muse.ai/` | Meta 的个人 AI 助手（网页版）；图标是一把里拉琴（缪斯女神的琴），不是官方标志 |

图标都在 `assets/icons/apps/`（白色图形、透明底，由页面垫一块毛玻璃）；Claude、ChatGPT 的图标是照着它们的标志简化画的。

`uq/` 是副本，不会自动跟着原项目更新；`duo/index.html` 是 /duo/ 的备用副本（线上平时直接读 GitHub 上最新的，见下面“Duo 适配”）。
需要更新这两个文件时，在仓库根目录运行：

```bash
bash tools/refresh-apps.sh
```

它会从那两个分支取最新内容，重新生成这两个文件。检查改动后提交，再重新发布。

## Duo 适配（/duo/）

网址 `https://callaum.com/duo/`，首页应用栏里“Duo 适配”点进去就是。内容是中美 App Store 免费榜、付费榜 Top 200 的 App 和游戏在 iPhone Duo 上的适配状况，
由本仓库（dsh）的 Duo 追踪器分支 `claude/iphone-duo-adapter-tracker-no3gf5` 生成：
**Claude 云端的定时任务「iPhone Duo 适配追踪 · 每日更新」**每天北京时间 09:13 左右，在会话「Duo 适配追踪 · 每日运行器」里运行追踪器，
把数据库 `duo-tracker/data/tracker.db` 和最新网页 `duo-tracker/site/index.html` 一起提交推送。

这边（`tools/worker/duo.js`）怎么拿到最新的网页：

- 去 GitHub 读那个分支上的 `duo-tracker/site/index.html`（仓库是公开的，不用令牌），检查通过的存 10 分钟——每天推送后 **10 分钟内** 页面就跟上，不用重新发布。
- GitHub 取不到、取到的不是报告时，用本仓库 `duo/index.html` 这份备用副本（发布时打包进去，用 `tools/refresh-apps.sh` 更新）。两份都有时用数据日期新的那份。
- 响应头 `X-Duo-Source: github` / `bundled` 写明这次用的是哪一份，`X-Duo-Date` 是数据日期。
- 追踪器分支改名了：在 Cloudflare 后台加一个变量 `DUO_REPORT_URL`，填新的 raw.githubusercontent.com 地址（或者改 `duo.js` 里的 `REPORT_URL`）。

转交前加的东西（网页原来的样式、布局和脚本都不动）：顶栏最左边“← 起始页”；不再从 Google 下载字体；
**数据日期比今天（北京时间）早 2 天及以上**时，顶部加一条红色提示“数据已经 N 天没有更新，可能已过期”——说明每天的定时任务没跑成，去那个会话里看看。

隔离：和飞汇比价一样，响应头 `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`。
这份网页每天自动更新、里面有从各个网站抓来的文字，没人逐行检查；隔离后它的脚本读不到起始页存在浏览器里的东西（设置、AI 接口 Key 等）。
代价是网页记不住上次用的筛选条件。

手动刷新：在 Claude App 或 claude.ai/code 里打开会话「Duo 适配追踪 · 每日运行器」，直接说“跑一次今天的”。
不要用定时任务列表里的“立即运行”：手动触发时系统会新开一个没有仓库权限的会话，跑不起来。

## 飞汇地区比价（/flywire/）

网址 `https://callaum.com/flywire/`，首页应用栏里“飞汇地区比价”点进去就是。对比在飞汇（Flywire）付澳洲学费时，
选不同付款地区、用 Visa / 万事达 / 运通 / 银联，飞汇在汇率里分别加了多少，按加点从低到高排名。
参考汇率默认用这张卡所属卡组织公布的汇率（Visa、万事达按换成美元记账算，银联按换成人民币记账算；运通不公布汇率，按独立中间价），
也就是“通过飞汇付这个币种，比直接用这张卡付澳元、让卡组织换汇多付多少”，不含发卡行手续费。
Visa、万事达的官网不让程序读取汇率，所以这两家的汇率取自第三方网站“一站式汇率”（kylc.com，转载各卡组织每天公布的汇率）；银联取自银联国际官网。

报告本身由另一个私有仓库 [flywire-fx-compare](https://github.com/callaumyan-design/flywire-fx-compare) 生成：
**Claude 云端的定时任务「每周更新飞汇比价」**每周一北京时间 10:07 左右开一个会话，克隆那个仓库，运行 `update.py`
（抓取各地区报价、取卡组织汇率、检查、生成新的 `index.html`、`data/` 只留最近 8 次），然后提交推送到 main。
抓取结果不合格时不提交，仓库保留上一次的版本。

手动刷新：在 Claude App 或 claude.ai/code 里打开会话「飞汇比价 · 每周更新」（每周的定时任务就在这个会话里跑），
直接说“按 23456.78 刷新一次”（不说金额就按 25000）。不要用定时任务列表里的“立即运行”：手动触发时系统会新开一个没有仓库权限的会话，跑不起来。
大约 15 分钟跑完，详细步骤见那个仓库的 README。

> 为什么不用 GitHub Actions：2026-11-17 在 GitHub 的服务器上实跑了两次，都是查到二十几个地区以后，飞汇对每个请求都回 429（请求太多），
> 检查不合格、没有提交（失败保护按设计生效）。同样的脚本在 Claude 云端跑是正常的。GitHub 上的工作流只留作手动备用。

这边（`tools/worker/flywire.js`）怎么拿到最新的报告：

- Cloudflare 后台设了密钥 `FLYWIRE_GITHUB_TOKEN` 时，去 GitHub 读那个仓库 main 分支上的 `index.html`，
  检查通过的存 10 分钟——仓库更新后 **10 分钟内** 页面就跟上，不用重新发布。
- 没设令牌、令牌过期、GitHub 取不到、取到的不是报告时，用本仓库 `flywire/index.html` 这份备用副本（发布时打包进去）。
  两份都有时用抓取时间更新的那份。备用副本的更新方法见 `tools/refresh-apps.sh`（`FLYWIRE_REPO=<克隆目录>`）。
- 响应头 `X-Flywire-Source: github` / `bundled` 写明这次用的是哪一份。
- 只读 GitHub 上已经生成好的静态页面，**从不调用飞汇的接口**；页面里不含任何飞汇订单链接或 token。

转交前加的东西（报告原来的样式、布局和计算脚本都不动）：页头“← 起始页”、页脚、和起始页一样的系统字体（不再从 Google 下载字体）、
手机用的 viewport；页面上方一条提示：抓取时间、报价金额，和“报价随汇率变化，付款前请在飞汇页面再确认金额”；
**抓取时间超过 14 天**时再加一条红色提示“数据已超过两周未更新，可能已过期”。

隔离：响应头 `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`。
报告页在浏览器眼里是一个“没有来历”的页面，它的脚本读不到起始页存在浏览器里的东西（设置、AI 接口 Key 等）——
报告的数据来自飞汇和卡组织的接口、每周自动更新、没人逐行检查，万一混进恶意内容也碰不到起始页。代价是报告记不住上次选的金额和卡种。

### 第一次启用：建一个只读令牌，填到 Cloudflare

1. 打开 GitHub → 右上角头像 → **Settings** → 左下 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. Token name 随便填（例如 `callaum-flywire-read`）；**Expiration** 选最长（最多 1 年，到期前 GitHub 会发邮件，到时重新建一个换上）。
3. **Repository access** 选 **Only select repositories**，只勾 `callaumyan-design/flywire-fx-compare`。
4. **Permissions → Repository permissions → Contents** 选 **Read-only**（其余都不用开），点 **Generate token**，复制它（只显示这一次）。
5. 打开 Cloudflare 后台 → **Workers 和 Pages** → `start-page` → **设置** → **变量和机密** → **添加**：类型选 **密钥**，
   名称 `FLYWIRE_GITHUB_TOKEN`，值粘贴刚才复制的令牌 → **部署**。
6. 过一两分钟打开 `https://callaum.com/flywire/`，页面上的抓取时间是仓库里最新的那次就对了。

令牌不要发到任何聊天里，也不要写进任何文件。之后用 `node tools/deploy-cloudflare.mjs` 发布新版本时，这个密钥会保留。

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
