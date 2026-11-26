# GitHub 仓库整理 · 交接文档

整理日期：2026-11-23　·　账号：`callaumyan-design`（共 24 个仓库）

## 一句话结论

除了 `dsh`，其他仓库基本都还整齐。乱就乱在 `dsh`：它本来是 **DeepSeek Harness 便携版的发布页**，但云端会话一直默认选它做仓库，结果 `main` 上多了 3 个网页小工具，另外又冒出 20 个分支，其中 11 个是完全独立的项目。

整理方案是：**每个项目搬回自己的仓库（保留提交历史），`dsh` 只留发布页**。

> 以后开新项目：先在 GitHub 上建好空仓库，开云端会话时选中那个仓库，不要再选 `dsh`。

---

## 一、这次已经完成的

| 事项 | 结果 |
|---|---|
| 逐个盘点 24 个仓库、`dsh` 的 21 个分支 | 结论见下面第三节 |
| `dsh` 分支里的 Industry & Empire（Godot 4.7 版）放回自己的仓库 | 推到私有仓库 `industry-and-empire` 的 **`godot47-from-dsh`** 分支，3 个提交全保留，文件逐一核对和原分支一致。那边的 `main` 是另一套实现（V0.2，Godot 4.3），没有动 |
| 写好迁移脚本 [`migrate.sh`](migrate.sh) | 用 `git filter-repo` 把每个项目提出来，子目录变成新仓库的根目录，历史保留。**已在演练模式下对 11 个项目全部跑通**，每个新仓库的文件都和原分支逐一核对一致（只多了各自的 `.github/workflows`，去掉了 dsh 的 README） |

## 二、这次没做成的，以及原因

云端会话的 GitHub 权限**不允许新建仓库，也不允许删 `dsh` 的分支和推标签**（返回 403）。所以下面这些需要你在自己电脑上执行，命令都写好了。

---

## 三、全部仓库现状

### 不用动

| 仓库 | 是什么 |
|---|---|
| `antigravity-zh-cn` | Antigravity 桌面版简体中文汉化 |
| `xiaomi-privacy-cleanup` | 小米隐私组件清理（ADB） |
| `yanlu` | 砚录：离线文字识别 |
| `flywire-fx-compare`（私有） | 飞汇地区比价器，每周自动更新；callaum.com/flywire/ 读的就是它的 `main` |
| `industry-and-empire`（私有） | 工业与帝国 V0.2；现在多了 `godot47-from-dsh` 分支 |
| `gejie`（私有） | 本次没有读取权限，没看 |

### DSH 插件（17 个 `dshx-*`）

`ai-approval`、`image-clamp`、`language-mirror`、`loop-guard`、`message-edit`、`multi-ask`、`patch-board`、`plugin-hub`、`project`、`remote`、`session-delete`、`side-chat`、`skill-manager`、`subagent-model-sync`、`token-cost`、`usage-panel`，外加 Claude Code 移植版 `dshx-claude`。

命名和结构都统一，保持一个插件一个仓库即可。可选的两件小事：

- `dshx-usage-panel`（余额 + 今日用量）的功能基本被 `dshx-token-cost` 包含了，可以考虑归档其中一个（Settings → Archive）。
- 给这些仓库加上 topic `dsh-plugin`，在 GitHub 上筛选更方便。

### `dsh` 里寄住的项目 → 搬去哪里

| 项目 | 现在在 `dsh` 的 | 搬到（新仓库） | 线上 / 自动化 |
|---|---|---|---|
| OmniChat | `claude/omnichat-webapp`（+ `claude/optimistic-gauss-xyq4iu`） | `omnichat` | callaum.com 的 AI 聊天，Cloudflare Worker |
| callaum.com 起始页 | `feature/market-card` | `callaum-start` | Cloudflare Worker（`tools/deploy-cloudflare.mjs`） |
| 简汇（汇率） | `claude/zealous-pascal-ivvt6b` | `huilv` | huilv.callaum.com，Cloudflare Worker |
| iPhone Duo 适配追踪 | `claude/iphone-duo-adapter-tracker-no3gf5` | `duo-tracker` | ⚠ **每天有定时任务往这个分支提交数据**，callaum.com/duo/ 也从这里读 |
| SoulPet 桌面宠物 | `desktop-pet` | `soulpet` | Release 在 dsh 的 Releases 页（soulpet-v0.2.0 ~ v0.3.2） |
| aipet（安卓宠物） | `claude/wonderful-fermat-73o7dw` | `aipet` | — |
| 9eSIM Web Manager | `claude/9esim-web-manager-ble-j9nstg` | `esim-manager` | — |
| SMS Relay | `claude/admiring-carson-9i1ufu` | `sms-relay` | — |
| UQ 成绩通知 | `claude/uq-grade-notification-tool-usx05x` | `uq-grade-notifier` | — |
| DSH 模型指纹插件 | `claude/dsh-model-fingerprint-7ykw49` | `dshx-model-fingerprint` | — |
| 科技晨读 / 四象限 / 热榜周刊 / Pages 发布 | `dsh` 的 `main`：`news/ quadrant/ weekly/ pages/` | `callaum-web`（第二阶段） | Azure Functions、GitHub Pages（`gh-pages` 分支）、每周定时 |

### `dsh` 里可以直接删的分支（内容在别处都有）

| 分支 | 为什么能删 |
|---|---|
| `claude/stoic-thompson-30i2ab` | 已合并进 `main` |
| `claude/loving-faraday-23ng6n` | 已合并进 `main`（今天还有会话在用，等那边结束再删） |
| `claude/personal-start-page-bhhp62` | 和 `feature/start-page` 是同一个提交 |
| `feature/start-page` | 完全包含在 `feature/market-card` 里 |
| `claude/ecstatic-bohr-8ea2tr` | 完全包含在 `claude/omnichat-webapp` 里 |
| `claude/uq-chinese-academic-calendar-ekjjiq` | 文件和起始页里的 `uq/index.html` 一字不差 |
| `claude/tech-news-app-deploy-0b81we` | 没合并，但 `main` 后来换了部署方式（工作流里用 OIDC 登录 Azure，删掉了 `azure-setup.sh`），这个分支已经过时 |
| `claude/wizardly-babbage-j95vvb` | 已放进 `industry-and-empire` 的 `godot47-from-dsh` 分支 |

---

## 四、你要做的（按顺序）

### 第 1 步：删掉冗余分支（随时可以做，不影响任何线上服务）

先给没合并的分支打归档标签（以后想找回随时能找回），再删除：

```bash
git clone https://github.com/callaumyan-design/dsh && cd dsh
for b in tech-news-app-deploy-0b81we uq-chinese-academic-calendar-ekjjiq wizardly-babbage-j95vvb; do git tag "archive/$b" "origin/claude/$b"; done
git push origin 'refs/tags/archive/*'
git push origin --delete claude/stoic-thompson-30i2ab claude/personal-start-page-bhhp62 feature/start-page claude/ecstatic-bohr-8ea2tr claude/tech-news-app-deploy-0b81we claude/uq-chinese-academic-calendar-ekjjiq claude/wizardly-babbage-j95vvb
```

### 第 2 步：跑迁移脚本，建好新仓库（只复制，不删除、不影响线上）

```bash
pip install git-filter-repo
cd docs/repo-reorg
./migrate.sh --dry-run     # 先演练：在 ./out 下生成，可以先看看
./migrate.sh               # 正式：创建私有仓库并推送
```

- 默认建**私有**仓库。想公开的话，用 `VISIBILITY=--public ./migrate.sh 项目名`，或者事后在 Settings 里改。
- 只迁某几个：`./migrate.sh omnichat huilv`。
- 同名仓库已经存在且不是空的，脚本会跳过，不会覆盖。

### 第 3 步：逐个项目收尾

迁过去的工作流文件里，路径还带着原来的子目录前缀（比如 `omnichat/**`、`working-directory: omnichat`），需要去掉前缀。下面按项目列出：

**OmniChat（`omnichat`）**
1. ⚠ **先处理这个修复**：新仓库的 `fix/callaum-500-hardening` 分支（原 `claude/optimistic-gauss-xyq4iu`）里有一个提交 `2cb0991`，修的是 callaum.com 上的 500 错误：API Key 的加密密钥改由 `APP_SECRET + APP_KDF_SALT` 派生，另外有登录限流和密码强度要求。**`main` 上没有这个修复**，直接用 `main` 重新部署，callaum.com 会再次 500。这个提交和 `main` 在 `server/app.ts`、`server/db.ts` 上有冲突，要手动合并、测试后再部署。
2. `.github/workflows/omnichat.yml`：去掉 `omnichat/` 前缀。
3. `deploy/azure/setup.sh`、`deploy/gcp/startup.sh` 和几份 README 里写死了 `https://github.com/callaumyan-design/dsh.git`，改成新仓库地址。
4. 关掉 `dsh` 里的 PR #1，在新仓库重新开。

**起始页（`callaum-start`）**
1. 部署方式不变（`tools/deploy-cloudflare.mjs`）。
2. `tools/worker/duo.js` 第 22 行写死了 `dsh` 仓库里 duo-tracker 分支的地址，**等 duo-tracker 迁好以后**改成 `https://raw.githubusercontent.com/callaumyan-design/duo-tracker/refs/heads/main/site/index.html`，再重新部署。注意：`duo-tracker` 如果是私有仓库，这个 raw 地址读不到，要么设成公开，要么改用 API 加 token。
3. 关掉 `dsh` 里的 PR #2。

**iPhone Duo 适配追踪（`duo-tracker`）**
1. 把每天运行的定时任务的仓库改成 `duo-tracker`，分支 `main`。
2. 确认新仓库里出现了新的一天的数据，再按上面第 2 条改起始页的 Worker。
3. 这两件事都做完以后，才能删 `dsh` 的 `claude/iphone-duo-adapter-tracker-no3gf5`，否则 callaum.com/duo/ 会断。

**简汇（`huilv`）**：部署用 `npm run deploy`（wrangler），不依赖 dsh 的工作流。`dsh` 那个分支顺手改过的 `quadrant-pages.yml` 不用带过去。

**SoulPet（`soulpet`）**：`.github/workflows/ci.yml` 本来就在根目录，可以直接用。旧的 Release 留在 dsh 的 Releases 页里，以后在新仓库发。

**aipet / esim-manager**：工作流去掉子目录前缀。esim 分支当时为了"同一个 Pages 站点放两个前端"改过 dsh 的 `quadrant-pages.yml` 和 `quadrant/vite.config.ts`，独立成仓库以后不需要了，Pages 直接从根目录发布即可。

**sms-relay / uq-grade-notifier / dshx-model-fingerprint**：没有工作流，迁过去就能用。

### 第 4 步：确认新仓库都正常以后，删 `dsh` 里对应的旧分支

```bash
git push origin --delete claude/omnichat-webapp claude/optimistic-gauss-xyq4iu feature/market-card claude/zealous-pascal-ivvt6b desktop-pet claude/wonderful-fermat-73o7dw claude/9esim-web-manager-ble-j9nstg claude/admiring-carson-9i1ufu claude/uq-grade-notification-tool-usx05x claude/dsh-model-fingerprint-7ykw49
# 等 duo-tracker 的定时任务和起始页的 Worker 都切换好以后再删：
git push origin --delete claude/iphone-duo-adapter-tracker-no3gf5
```

### 第 5 步（第二阶段，不急）：把 `main` 上的网页小工具搬到 `callaum-web`

`news/`（科技晨读）、`quadrant/`（四象限）、`weekly/`（热榜周刊）、`pages/`，加上 `.github/workflows/` 里的 9 个工作流（`news-*`、`quadrant`、`weekly*`、`site-index`、`publish-pages`）。这几个现在**正在自动部署，而且今天还在开发**，所以脚本默认不迁它们。

1. `./migrate.sh callaum-web`
2. 在 Azure 的联合凭据（federated credential）里，把 `callaumyan-design/callaum-web` 加为可信主体。工作流里的 `AZURE_CLIENT_ID` 等不是密钥，可以原样保留。仓库 Secrets 里如果有 AI 的 Key、推送密钥等，要在新仓库重新填。
3. 在新仓库开启 GitHub Pages（来源选 `gh-pages` 分支，第一次部署后会自动生成）。网址会从 `…github.io/dsh/` 变成 `…github.io/callaum-web/`。科技晨读应用、起始页里如果有指向旧地址的链接，都要跟着改。
4. 确认都正常以后，在 `dsh` 的 `main` 上删掉 `news/ quadrant/ weekly/ pages/` 和这些工作流，再删掉 `gh-pages` 分支。

### 最后

`dsh` 只剩 `main`（README 加 Releases：便携版 v1.0.0、插件1、netwatch）。这个 `docs/repo-reorg/` 目录也可以删掉。

---

## 附：核对方法（给之后接手的会话）

- 迁出来的仓库和原分支是否一致：比较 `git ls-tree -r main`（新仓库）和 `git ls-tree -r origin/<分支>:<子目录>`（dsh），除了 `.github/` 之外应该完全相同。
- 分支是否已合并：`git merge-base --is-ancestor origin/<分支> origin/main`。
