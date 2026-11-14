# iPhone Duo App 适配进度追踪器

每天汇总中国区和美区 App Store 主流 App 与游戏在 iPhone Duo（折叠屏）上的适配状态。苹果官方数据和多个第三方追踪站交叉比对后，产出：

1. **每日日报** `reports/<date>/daily.html`：① 今日新版本（标出更新说明命中的关键词）② 状态变化及证据 ③ 各追踪站新增条目和投稿 ④ 有争议列表 ⑤ Top 200 适配占比（App / 游戏分开）和趋势折线
2. **全量总表** `reports/<date>/all.html`：可按状态、类型、地区、榜单筛选，点击一行展开各来源证据；另有 `status.csv`
3. **历史时间线** `reports/timeline.html`：每天的状态变化记录
4. **SQLite**（`data/tracker.db`）：`apps`、`versions`、`observations`、`verdicts` 四张核心表，保留完整历史
5. **`unmatched.csv`**：名称匹配不上或候选不唯一的条目，供人工确认，确认结果写进 `manual_matches.yaml`

## 用法

```bash
pip install -r requirements.txt
python run.py --date today              # 抓取 + 判定 + 报告（约 1 分钟，约 45 个请求）
python run.py --date 2026-11-15 --offline   # 只用 raw/ 缓存重新解析，不发请求
python run.py --date today --report-only    # 只重新生成报告
python run.py --schedule                # 常驻进程，每天在 config.yaml 的 schedule.time 运行
python -m unittest discover -s tests    # 单元测试
```

也可以用 cron 定时运行，例如每天北京时间 09:30：
`30 9 * * * cd /path/to/duo-tracker && /usr/bin/python3 run.py --date today >> data/cron.log 2>&1`（服务器时区需为 Asia/Shanghai）。

## 目录结构

```
run.py                    入口
config.yaml               地区、定时、限速和重试、robots 例外、各来源开关
watchlist.yaml            自定义跟踪名单（写 id 或名称）
manual_matches.yaml       人工确认的名称匹配
sources.md                各数据源的调研记录：接口、分页、状态枚举及映射、能否拿到 id、时间字段
tracker/
  http.py                 文明抓取：robots.txt（RFC 9309）、每站间隔 ≥1s、重试退避、原始响应缓存
  model.py                统一状态、各来源映射表、权重、名称归一化
  matching.py             trackId → bundleId → 名称匹配
  verdict.py              更新说明关键词扫描、综合判定、无新版本维持规则
  engine.py               一次完整运行的编排（每个来源单独容错）
  report.py + templates/  HTML 报告
  adapters/               每个数据源一个 adapter
    apple.py              榜单（网页榜单 Top 200 / RSS 兜底）、Lookup、官方合集
    shipeiduo.py xiaoxinnote.py duotoday.py foldhunt.py duoappcheck.py
    duoappsupport.py duoregistry.py duodiscover.py iphoneapplicationlist.py
raw/<source>/<date>/      原始响应缓存（运行产物，不入库）
reports/                  报告（运行产物，不入库）
```

## 关键设计

- **跟踪名单**：两个地区（cn、us）× 两个榜单（免费、付费）× 两个类型（App、游戏）的 Top 200，加上 watchlist。数据来自 App Store 网页榜单页，一页里就有完整的 200 个名次。苹果没有 robots.txt 允许抓取的畅销榜来源，这一项已跳过，详见 sources.md。
- **适配信号不用** `supportedDevices` 和截图（两者对所有 App 都一样）。
- **证据权重**：官方合集 100 > 更新说明强关键词 60 > 追踪站 30（多站累加）> 网友投稿 6–15。
- **争议**：适配和未适配两边都有站点级证据时标 `disputed`，只列出各方说法，不做裁决。
- **无新版本 → 维持原判定**：以当前判定确立时的版本为准，详见 sources.md 的“综合判定规则”。
- **过时否定**：日期早于 App 当前版本发布日期的「未适配」结论会降权（例如 FoldHunt 在 10 月初标记的 “Not announced”）。
- **文明抓取**：默认严格遵守 robots.txt。User-Agent 是通用名，不含个人信息。单个来源出错只记录在日报的“数据源运行情况”里，不影响整体运行。
