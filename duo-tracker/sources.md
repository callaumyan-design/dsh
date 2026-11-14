# 数据源调研与接入记录

调研日期：2026-11-14／15。抓取方式统一为：先读 robots.txt（RFC 9309 最长匹配），同一站点请求间隔 ≥ 1 秒，
User-Agent `Mozilla/5.0 (compatible; DuoTracker/1.0)`（不含任何个人信息），失败指数退避重试，
原始响应缓存在 `raw/<source>/<date>/`。

统一状态：`perfect`（完美适配）/ `full`（已适配）/ `partial`（部分适配）/ `none`（未适配）/ `unknown`（未知）；
综合判定另有 `disputed`（有争议）。**Compatible、能运行、未宣布这类说法 ≠ 适配，一律映射为 `none` 或 `unknown`。**
映射表的代码版本在 `tracker/model.py` 的 `STATUS_MAP`。

## 每日请求量（全部来源）

| 来源 | 每次运行的请求数 |
|---|---|
| App Store 网页榜单 | 2 个地区 × 2 页（总榜、游戏榜）= 4 |
| iTunes Lookup | 每区约 800 个 id，每批 100 个 → 约 16 |
| 官方合集 | 2 |
| 每个第三方站点 | 1–4（另加 robots.txt 1 个） |

一次完整运行约 1 分钟，约 45 个请求。

---

## 苹果数据源

### 1. 榜单：App Store 网页榜单 ✅ 主来源
- 地址：`https://apps.apple.com/<cn|us>/iphone/charts/36`（App 总榜，**不含游戏**）、`/charts/6014`（游戏）。robots.txt 允许。
- 解析：SSR 页面里的 `<script id="serialized-server-data">`。`segments[]` 各有一个 `chart`（`top-free` / `top-paid`），
  其中 `shelves[].items[]` 是前 25 个 `Lockup`（含 `adamId`、`bundleId`），`nextPage.remainingContent[]`
  **按名次列出其余 175 个 id**。所以**一页就有完整的 Top 200**，免费榜和付费榜都有。名次顺序和 RSS 一致（已核对）。
- 坑：偶尔返回 HTTP 200 的 1 KB 错误页，用“页面里有没有 serialized-server-data”来校验，没有就重试。
- 能拿到 App Store id：能。更新时间：无（以抓取日期为准）。

### 1b. 新版 Marketing Tools RSS（仅兜底）
- `rss.applemarketingtools.com` 会 301 到 `rss.marketingtools.apple.com/api/v2/<cc>/apps/<top-free|top-paid>/<n>/apps.json`。
- 只有 `apps/top-free` 和 `apps/top-paid`，最多 100 条（请求 200 条返回 500），偶发 502/504 或超时；
  **没有畅销榜**（`top-grossing` 返回 404），没有游戏分类，结果里 `genres` 是空的。只在网页榜单失败时使用。

### 1c. 旧版 iTunes RSS ❌ robots.txt 禁止
- `itunes.apple.com/<cc>/rss/topgrossingapplications/limit=200/genre=6014/json` 这类地址能用，也有畅销榜，但最多 100 条，
  而且 **`itunes.apple.com/robots.txt` 写了 `Disallow: /*/rss/*`**。默认不用。（`config.yaml` 里设 `charts.legacy_rss: true`
  并在 `robots_exceptions` 里放行，才会请求。）

**畅销榜：没有 robots.txt 允许的公开来源，按规格要求记录下来并跳过。**

### 2. 自定义名单 `watchlist.yaml`
可以写 id，也可以只写名称。iTunes Search API 被 `itunes.apple.com/robots.txt` 的 `Disallow: /search*` 禁止，
所以名称改用“榜单 + 带 App Store id 的追踪站目录”做 名称 → id 解析，只接受同一地区里唯一的结果；
解析不出来的进 `unmatched.csv`。

### 3. iTunes Lookup ✅
- `https://itunes.apple.com/lookup?id=<最多100个,逗号分隔>&country=<cc>`。robots.txt 的规则是 `Disallow: /*/lookup?`，
  只匹配 `/<某段路径>/lookup?…`；`/lookup?id=…` 按 RFC 9309 不在禁止范围内。
- 使用字段：`version`、`currentVersionReleaseDate`、`releaseNotes`、`bundleId`、`trackId`、`trackName`、`artistName`、
  `primaryGenreName`、`genreIds`（含 `6014` 即游戏）。
- **`supportedDevices` 不用**（所有 App 都含 `iPhoneDuo-iPhoneDuo`），**截图也不用**。
- 首跑成功率：cn 796/800，us 798/802（99.5%）。查不到的是已下架或该区不提供的 App。

### 4. 更新说明关键词
有新版本的 App 会扫描 releaseNotes，首次建档的基线版本也会扫描。历史上任何一个版本命中强关键词，都会生成一条
`release_notes` 观测（「官方疑似适配」），证据指向命中的那个版本。
- **强关键词**（权重 60）：`iPhone Duo`、`Duo` 紧挨着适配类词语（适配/支持/优化 Duo、Duo 布局/界面/半折叠、Duo layout/support/form factor…）、
  折叠屏、内屏、外屏、foldable、inner display、cover screen / outer display。
- **弱关键词**（只作提示，**不参与判定**）：单独出现的 `Duo`、折叠、展开、大屏、双屏、分屏、fold/unfold。
  实测弱关键词误报很多，比如游戏活动文案里的“剧情即将展开”，以及多邻国吉祥物 “Duo”。

### 5. 苹果官方信号
- **App Store 产品页上的 “Made for iPhone Duo” 标识：经验证不可靠，已放弃。** 检查了 Netflix（发布会合作伙伴）、微信、
  抖音、绝区零的产品页 HTML 和 serialized-server-data，`informationRibbon` 徽章、`Compatibility` 注释、`capabilities`
  货架里都**没有任何 Duo 相关字段**，已适配和未适配的 App 看不出区别。
- **官方合集 ✅**：`https://apps.apple.com/<us|cn>/iphone/story/id6820639500`（“Great Apps and Games on iPhone Duo”），
  解析 serialized-server-data 里所有 `$kind == "Lockup"` 的 `adamId`。美区 25 个，国区页也能打开。
  注意：同一款 App 在不同区的 trackId 可能不同（绝区零：国服 1606359076，国际服 1606356401），按 id 精确匹配，**不跨区套用**。
  状态映射：收录 → `perfect`（官方，权重 100，直接定性）。

---

## 第三方追踪站

| 站点 | 接入 | 数据入口 | 分页 | App Store id | 时间字段 | 地区 |
|---|---|---|---|---|---|---|
| shipeiduo.com | ⚠️ 已实现，默认不请求 | `/api/v1/apps`、`/api/v1/submissions` | `page`/`limit=50`，`hasMore` | `storeId`（已收录 App 有，投稿没有） | `adaptedAt`、`createdAt` | cn 为主 |
| duo.xiaoxinnote.com | ✅ | 首页 `<script id="catalogue-urls">` → `/data/catalogue.<cc>.<hash>.json` | 无（整份 JSON） | 有 | `verification.checkedAt`、目录 `updatedAt` | cn（Top 200）+ us |
| www.duotoday.com | ✅ | `GET /api/feed`（返回全部事件） | 无 | `appId` | `eventDate` | us |
| foldhunt.com | ✅ | `/iphone-duo/compatibility/` 单页 HTML 表格 | 无（1151 行都在一页） | 部分（来源列是 App Store 链接时才有） | `<time datetime>`（Checked） | 无（按链接推断） |
| duoappcheck.com | ✅ | 首页内联 RSC 流里的 `initialCatalog` | 无 | 多数有（`appStoreUrl`） | `checkedAt`/`sourceDate` | 按链接推断 |
| duoappsupport.com | ✅ | 首页内联脚本 `var NAMES` / `var STATUS` | 无 | 无 → 名称匹配 | 无 | us |
| duoregistry.com | ✅ | `/duo-support` SSR HTML（按标签分节） | 无 | 无 → 名称匹配 | `<time datetime>` | us |
| duodiscover.com | ✅ | `/apps` SSR HTML（`a.row` 卡片） | 无 | 无 → 名称匹配 | 无 | us |
| iphoneapplicationlist.com | ✅ | `/iphone-duo-apps/?duo_download=csv`（站点自带的 CSV 下载） | 无 | 有 | `checked`、`updated` | us |

### shipeiduo.com（适配Duo）
- 纯 SPA（首页只有 4.7 KB 外壳），数据**只**在 `/api/v1` 下。接口字段与任务说明一致。
- **robots.txt：`Disallow: /api/`。** 默认配置严格遵守，这个来源每天记为“robots 禁止”并跳过，其它来源不受影响。
  确认可以使用后（例如取得站长许可），在 `config.yaml` 里加上 `robots_exceptions: {shipeiduo.com: ["/api/v1/"]}`
  即可启用。每天约 18 个请求。解析器已用调研时抓到的样本验证过。
- 枚举映射：`perfect→perfect`，`full→full`，`partial→partial`，`none→none`，`unverified→unknown`。
- 投稿（`shipeiduo_submission`）权重 = 5 + min(净票, 10)，始终低于站点级证据。
  **净票 = 支持该投稿结论的票 − 反对票**：结论为适配时就是规格里的 `fitVotes − unfitVotes`；结论为 `none` 时取 `unfitVotes − fitVotes`
  （否则 30 张“不适配”票反而会把一条“未适配”投稿判成有争议）。**净票 ≤ 0 视为有争议**，不计权重。
- 不保存投稿人地区等与适配无关的字段。

### duo.xiaoxinnote.com（Duo Tracker · 中国 Top 200）
- 首页 SSR，内嵌 `catalogue-urls`（目录文件名带哈希，每天会变，所以每次都先读首页）、`page-data`、`home-updates`。
- 目录：`apps[]`，字段有 `id`、`name`、`aliases`（例如绝区零的 “Zenless Zone Zero”）、`storefronts.<cc>.{version, verification{status, testedVersion, checkedAt}, sources[{chart, rank}]}`。
- 映射：`adapted→full`，`partial→partial`，`unsupported→none`，`inProgress→unknown`，没有 verification（待核实）→ `unknown`。
- robots.txt：全部允许。

### www.duotoday.com
- SvelteKit。robots.txt 不存在（返回 404 页面）= 全部允许。前端分页用的就是 `GET /api/feed`，它一次返回全部事件
  （1037 条、882 个 App）。只收录“已支持”的 App，**没被收录 ≠ 未适配**，所以没有 `none`。
- 映射：`tier=made_for→perfect`，`tier=optimized→full`。同一 App 有多条事件时取级别更高、时间更新的那条。`confidence=low` 权重减半。
  `evidenceType` 有 release_notes / apple / press / reader 几种，会写进证据文本。

### foldhunt.com
- Astro 静态站。robots.txt：`Disallow: /api/` → 只解析 HTML。
- 每行 `<tr class="ct__row" data-status data-display data-name>`；`data-name` 里有中英繁多个名字（取其中含汉字的词作别名）。
- 映射：`official`（Partner，苹果点名）→`perfect`；`verified`（模拟器或真机实测）→`full`；`store`（App Store 页面写明支持）→`full`；
  `claimed`（开发者声称，未见运行）→`full`，**权重 ×0.5**；`unconfirmed`（Not announced，带黑边原样运行）→`none`。
- 注意：很多 “Not announced” 是 10 月初检查的，已经过时。见下面的“过时否定”规则。

### duoappcheck.com
- vinext/RSC。robots.txt：`Disallow: /api/`，所以**不用** `/api/catalog`，改为解析首页内联的
  `self[Symbol.for("vinext.navigationRuntime")].bootstrap.rsc.push("…")` 片段，拼起来后取 `"initialCatalog":` 后面的 JSON
  （`apps[]` + `history[]`）。
- 映射：`ready→full`，`not-ready→none`，`unknown`（Awaiting evidence）→`unknown`。

### duoappsupport.com
- 单个静态页，数据写在内联脚本里：`var NAMES="A|B|…"`（650 个热门 App）和 `var STATUS={"App":"full"|"lim"|"no"}`，
  不在 STATUS 里的都是 Unverified。
- 映射：`full`（Fully supported：用 iOS 27.1 SDK 构建，填满内屏）→`full`；`lim`（Limited：填满大部分但有留白）→`partial`；
  `no`（Not optimized，有黑边）→`none`；`unv`→`unknown`。
- robots.txt 只有 Content-Signal 注释，没有禁止规则。

### duoregistry.com
- TanStack Start SSR。robots.txt：`Disallow: /api/`、`/go/`、`/newsletter/`。
- `/duo-support`：用 `<h2 id="label-…">` 分节，每个 `<li>` 是一个 App（名称、依据说明、Checked 日期）。
- 映射：`Duo-native`（苹果或开发者确认有双屏布局）→`full`；`Scaled up`→`partial`（站内没有定义；从字面和
  “Scaled up → Duo-native” 这样的升级记录推断为“放大填满但没有专门布局”）；`Unverified`→`unknown`。

### duodiscover.com
- Next.js。`/apps` SSR 渲染全部卡片，`<span class="badge b-built|b-adapted|b-compat">`。
- 映射（依据站内 /about 的定义）：`Built for Duo`（= Made for iPhone Duo，用到折叠、分屏、外屏）→`perfect`；
  `Adapted`（用 iOS 27+ SDK 重新构建，填满内屏）→`full`；**`Compatible`（原样运行，展开时有黑边）→`none`**。

### iphoneapplicationlist.com
- WordPress。页面上有站点自带的 CSV 下载（`?duo_download=csv`），一次请求拿到全部（rank, name, developer, version, updated,
  evidence_type, evidence, evidence_label, source_url, url, checked）。robots.txt 全部允许。
- 只收录已就绪的 App。映射：`Published update→full`；`Developer-confirmed→full`，**权重 ×0.5**。

---

## 综合判定规则（`tracker/verdict.py`）

1. 只看非 `unknown` 的观测。每个来源对每个 App 只算一条（投稿逐条计）。
2. **有官方合集收录 → 直接采用**（置信度 official）。
3. **过时否定**：如果一条 `none` 结论的日期早于 App 当前版本的发布日期，它就说明不了当前版本，权重 ×0.25，
   低于争议阈值，报告里标「早于当前版本」。适配类结论不衰减。
4. 弱关键词只作提示：如果只有弱关键词命中，判为 `unknown`（疑似）。
5. 适配方和未适配方**都有**站点级证据（单条权重 ≥ 20）→ `disputed`，日报里列出各方说法，不做裁决。
   只有投稿且投稿之间互相矛盾，或者投稿净票都 ≤ 0 → `disputed`。
6. 其余情况：权重高的一方胜出。已适配内部按权重选级别，权重相同时取更保守的级别。
   置信度：official > release_notes（强关键词）> multi_source（≥2 个站）> single_source > submission。
7. **维持规则**：每条判定都记录“当前状态确立时的版本”（`status_version`）。如果此后 App 没有新版本，
   状态就不能在 适配 ↔ 未适配 之间切换，记为“维持”（held），并在日报里列出新证据的说法。例外：从 unknown 或 disputed
   出发（首次定性）、有官方证据、已适配内部的级别调整。来源当天抓取失败导致没有证据时，也不会冲掉已有结论。

## 名称匹配（`tracker/matching.py`）
匹配顺序：trackId → bundleId → 名称（NFKC 全角/半角统一、去空格和符号、去掉「-」「:」等后面的副标题，中英文名和别名都参与）。
- 来源有地区时，只在该地区的 App 里找。候选不止一个 → `ambiguous`，找不到 → `no_candidate`，都写进 `unmatched.csv`，**不强行合并**。
- 来源条目带了 App Store id 但不在跟踪名单里 → 视为“未跟踪”，不再用名称兜底（不同区的 id 是不同的 App）。
- 来源没有地区，且候选恰好是不同地区各一个（例如同一款游戏的国区和美区版本）→ 这条说法分别记到每个地区的 App 上。
- 人工确认的结果写进 `manual_matches.yaml`。
