#!/usr/bin/env bash
# 把另外几个项目的最新成果同步进本网站：
#   uq/index.html       ← UQ 中文校历（它自己的分支上的 uq-chinese-calendar.html）
#   duo/index.html      ← Duo 适配追踪的报告（用它分支里已有的数据重新生成，不联网抓取）
#   flywire/index.html  ← 飞汇地区比价的备用副本（给了 FLYWIRE_REPO 时才更新，见最后）
#
# 用法（在仓库根目录）：  bash tools/refresh-apps.sh
# 跑完后检查一下改动，再提交、重新发布（node tools/deploy-cloudflare.mjs）。
#
# 两个来源分支的名字写在下面；分支改名了就改这里。
set -euo pipefail

UQ_BRANCH="${UQ_BRANCH:-claude/uq-chinese-academic-calendar-ekjjiq}"
DUO_BRANCH="${DUO_BRANCH:-claude/iphone-duo-adapter-tracker-no3gf5}"

cd "$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "→ 取最新的分支内容"
git fetch -q origin "$UQ_BRANCH:refs/remotes/origin/$UQ_BRANCH" "$DUO_BRANCH:refs/remotes/origin/$DUO_BRANCH"

echo "→ UQ 校历"
mkdir -p uq
git show "origin/$UQ_BRANCH:uq-chinese-calendar.html" > uq/index.html

echo "→ Duo 适配报告（只用仓库里已有的数据，不发任何网络请求）"
git archive "origin/$DUO_BRANCH" duo-tracker | tar -x -C "$work"
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install -q -r "$work/duo-tracker/requirements.txt"
# 数据最后更新到哪一天，就生成哪一天的报告
day="$(git log -1 --format=%cs "origin/$DUO_BRANCH")"
( cd "$work/duo-tracker" && "$work/venv/bin/python" run.py --date "$day" --report-only >/dev/null )
mkdir -p duo
cp "$work/duo-tracker/reports/$day/index.html" duo/index.html

# 飞汇地区比价：线上页面平时直接从 GitHub 读仓库里最新的报告（见 tools/worker/flywire.js），
# 这里的 flywire/index.html 只是读不到时用的备用副本。仓库是私有的，这里不放令牌：
# 先把 flywire-fx-compare 克隆到本机，再用 FLYWIRE_REPO=<克隆的目录> bash tools/refresh-apps.sh 一起更新。
if [ -n "${FLYWIRE_REPO:-}" ]; then
  echo "→ 飞汇地区比价（备用副本，来自 $FLYWIRE_REPO）"
  git -C "$FLYWIRE_REPO" pull -q --ff-only || echo "（没能更新 $FLYWIRE_REPO，用它现有的版本）"
  mkdir -p flywire
  cp "$FLYWIRE_REPO/index.html" flywire/index.html
fi

echo "完成：uq/index.html 和 duo/index.html 已更新（Duo 数据日期 $day）。"
git status --short uq duo flywire
