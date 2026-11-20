# GitHub 热榜周刊

每周一整理 [GitHub Trending 周榜](https://github.com/trending?since=weekly)前十名，由 Claude 写中文标题、导语和每个项目的点评，发布成一份静态网页周刊（含往期目录和 RSS）。

网址：`https://<用户名>.github.io/<仓库名>/weekly/`。和本仓库其他项目一样，独立构建、独立发布，互不影响（见 [pages/README.md](../pages/README.md)）。

## 每期包含什么

- **本期标题和导语**：概括这十个项目放在一起说明了什么
- **每个项目**：名次、本周新增 star（按本期最高值等比例画条）、一句话定位、2–3 句点评、适合谁看、项目原始简介、语言 / 总 star / Fork / 许可证 / 话题
- 页脚注明数据来源、出刊时间，以及点评由 AI 生成

## 数据从哪来

| 内容 | 来源 |
| --- | --- |
| 前十名、排名、star、本周新增 star | 抓取 `github.com/trending?since=weekly` 页面（GitHub 没有官方 Trending API） |
| 话题、主页、许可证、创建时间、README | GitHub REST API（Actions 里用 `GITHUB_TOKEN`） |
| 标题、导语、点评 | Claude（`claude-opus-5-5`），依据上面两项资料生成 |

Trending 周榜统计的是**过去 7 天**。每期覆盖出刊前 7 天，期号取这段时间最后一天所在的 ISO 周（如 `2026-W47`）。周一出刊时正好是上周一到周日。

如果 Trending 页面改版、解析不出 10 个项目，出刊会**直接失败**（Actions 会发邮件提醒），不会悄悄换成别的口径。仓库信息或 README 读取失败只会少掉这部分资料，不影响出刊。

## 启用步骤

1. **添加 API key**：仓库 Settings → Secrets and variables → Actions → New repository secret，名称 `ANTHROPIC_API_KEY`。不配置也能出刊，只是没有中文点评（页面会显示项目原始简介）。
2. **开启 Pages**：Settings → Pages → Source 选 **GitHub Actions**（四象限已经在用，无需改动）。
3. **出第一期**：Actions → “热榜周刊出刊” → Run workflow。之后每周一 09:17（北京时间）自动运行。

工作流会把新一期的数据提交到 `weekly/data/issues/`，再触发 “GitHub 热榜周刊” 工作流，只重新发布 `/weekly/`。

> 平时手动运行会提前出“本周”这一期，到周一定时任务时这个期号已存在，会自动跳过。想重做某一期，手动运行时勾选“重新生成”。

## 费用

每期一次 Claude 调用：十个项目的简介加 README 摘录（每个最多 8000 字符）作为输入，输出约两三千字。按 `claude-opus-5-5` 的价格（输入 $4 / 输出 $20 每百万 token），每期约 0.2–0.4 美元，具体以账单为准。

## 本地开发

```bash
cd weekly
npm install
npm test                                    # 单元测试
npm run preview                             # 用样例数据生成网站并在 http://localhost:4173/ 预览
node scripts/new-issue.mjs --dry-run        # 抓取真实数据并打印，不写文件（需要 ANTHROPIC_API_KEY 才有点评）
node scripts/new-issue.mjs --no-ai          # 只保存榜单，不生成点评
npm run build                               # 用 data/issues/ 里的真实期刊生成 dist/
```

## 文件结构

```
weekly/
  lib/trending.mjs      解析 Trending 页面
  lib/github.mjs        通过 REST API 补充仓库信息、截取 README
  lib/commentary.mjs    调用 Claude 生成点评（结构化 JSON 输出）
  lib/render.mjs        生成 HTML 页面和 RSS
  lib/week.mjs          期号与统计区间
  scripts/new-issue.mjs 出一期：抓取 → 补充 → 点评 → 写入 data/issues/
  scripts/build-site.mjs 生成网站
  site/style.css        样式（跟随系统深浅色）
  data/issues/*.json    每期的数据，一期一个文件
  test/                 测试与样例数据
```
