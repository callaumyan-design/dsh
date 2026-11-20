#!/usr/bin/env bash
# 把另外几个项目的最新成果同步进本网站：
#   uq/index.html       ← UQ 中文校历（它自己的分支上的 uq-chinese-calendar.html）
#   duo/index.html      ← Duo 适配报告的备用副本（它分支上最新的 duo-tracker/site/index.html；线上平时直接读 GitHub，见 tools/worker/duo.js）
#   planner/            ← 四象限任务计划（编译 main 分支 quadrant/ 里的源码；要 Node.js，会从 npm 装依赖）
#   flywire/index.html  ← 飞汇地区比价的备用副本（给了 FLYWIRE_REPO 时才更新，见最后）
#
# 用法（在仓库根目录）：  bash tools/refresh-apps.sh
# 跑完后检查一下改动，再提交、重新发布（node tools/deploy-cloudflare.mjs）。
#
# 两个来源分支的名字写在下面；分支改名了就改这里。
set -euo pipefail

UQ_BRANCH="${UQ_BRANCH:-claude/uq-chinese-academic-calendar-ekjjiq}"
DUO_BRANCH="${DUO_BRANCH:-claude/iphone-duo-adapter-tracker-no3gf5}"
QUADRANT_BRANCH="${QUADRANT_BRANCH:-main}"

cd "$(git rev-parse --show-toplevel)"

echo "→ 取最新的分支内容"
git fetch -q origin "$UQ_BRANCH:refs/remotes/origin/$UQ_BRANCH" "$DUO_BRANCH:refs/remotes/origin/$DUO_BRANCH" "$QUADRANT_BRANCH:refs/remotes/origin/$QUADRANT_BRANCH"

echo "→ UQ 校历"
mkdir -p uq
git show "origin/$UQ_BRANCH:uq-chinese-calendar.html" > uq/index.html

echo "→ Duo 适配报告（备用副本：追踪器每天推送的最新网页，不用重新生成）"
mkdir -p duo
git show "origin/$DUO_BRANCH:duo-tracker/site/index.html" > duo/index.html
day="$(grep -o 'name="duo-tracker:date" content="[0-9-]*"' duo/index.html | grep -o '[0-9][0-9-]*' || echo '?')"

echo "→ 四象限任务计划（先跑它自己的测试，通过了才编译）"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git archive "origin/$QUADRANT_BRANCH" quadrant | tar -x -C "$work"
( cd "$work/quadrant" && npm ci --no-audit --no-fund >/dev/null && npm test >/dev/null && npm run build >/dev/null )
rm -rf planner
cp -R "$work/quadrant/dist" planner

# 飞汇地区比价：线上页面平时直接从 GitHub 读仓库里最新的报告（见 tools/worker/flywire.js），
# 这里的 flywire/index.html 只是读不到时用的备用副本。仓库是私有的，这里不放令牌：
# 先把 flywire-fx-compare 克隆到本机，再用 FLYWIRE_REPO=<克隆的目录> bash tools/refresh-apps.sh 一起更新。
if [ -n "${FLYWIRE_REPO:-}" ]; then
  echo "→ 飞汇地区比价（备用副本，来自 $FLYWIRE_REPO）"
  git -C "$FLYWIRE_REPO" pull -q --ff-only || echo "（没能更新 $FLYWIRE_REPO，用它现有的版本）"
  mkdir -p flywire
  cp "$FLYWIRE_REPO/index.html" flywire/index.html
fi

echo "完成：uq/index.html、duo/index.html 和 planner/ 已更新（Duo 数据日期 $day）。"
git status --short uq duo planner flywire
