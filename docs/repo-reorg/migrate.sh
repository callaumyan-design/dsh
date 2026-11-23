#!/usr/bin/env bash
# 把 dsh 仓库里"寄住"的独立项目迁到各自的仓库，并保留提交历史。
#
# 用法：
#   ./migrate.sh --dry-run            只在本地生成，推到 ./out/<项目>.git，不碰 GitHub
#   ./migrate.sh                      创建 GitHub 仓库（默认私有）并推送全部项目
#   ./migrate.sh omnichat huilv       只迁指定的项目
#
# 需要：git、git-filter-repo（pip install git-filter-repo）、已登录的 gh（gh auth login）
#
# 这个脚本只做"复制"：不会删除 dsh 里的任何分支，也不会改动线上部署。
# 每个新仓库建好后的收尾（改工作流、迁 Secrets、切换部署、删 dsh 旧分支）见同目录的 HANDOVER.md。
set -euo pipefail

OWNER="${OWNER:-callaumyan-design}"
SRC="${SRC:-https://github.com/$OWNER/dsh.git}"
VISIBILITY="${VISIBILITY:---private}"   # 想公开就设 VISIBILITY=--public
DRY_RUN=0
ONLY=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) ONLY+=("$a") ;;
  esac
done

command -v git-filter-repo >/dev/null || { echo "缺少 git-filter-repo：pip install git-filter-repo"; exit 1; }
[ "$DRY_RUN" = 1 ] || gh auth status >/dev/null 2>&1 || { echo "请先 gh auth login"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
OUT="${OUT:-$HERE/out}"
trap 'rm -rf "$WORK"' EXIT

echo "→ 镜像克隆 $SRC"
git clone -q --mirror "$SRC" "$WORK/dsh.git"

# project <新仓库名> <描述> <目标分支=源分支 ...> -- <git filter-repo 参数 ...>
project() {
  local name="$1" desc="$2"; shift 2
  local maps=()
  while [ "$1" != "--" ]; do maps+=("$1"); shift; done; shift
  local filter=("$@")

  if [ ${#ONLY[@]} -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $name " ]]; then return; fi
  echo; echo "=== $name"

  local dir="$WORK/$name"
  git clone -q --no-checkout "$WORK/dsh.git" "$dir"
  (
    cd "$dir"
    git update-ref --no-deref HEAD "$(git rev-parse HEAD)"   # 先分离 HEAD，才能重设 main
    for m in "${maps[@]}"; do git branch -q -f "${m%%=*}" "origin/${m#*=}"; done
    git checkout -q "${maps[0]%%=*}"
    # 只留下这个项目自己的分支，去掉 dsh 的其他分支和标签
    git for-each-ref --format='%(refname:short)' refs/heads | while read -r b; do
      keep=0; for m in "${maps[@]}"; do [ "$b" = "${m%%=*}" ] && keep=1; done
      [ $keep = 1 ] || git branch -q -D "$b"
    done
    git tag -l | xargs -r git tag -d >/dev/null
    git remote remove origin
    git filter-repo --force --quiet "${filter[@]}"
    echo "   提交数：$(git rev-list --count --all)；分支：$(git branch --format='%(refname:short)' | tr '\n' ' ')"
    echo "   根目录：$(git ls-tree --name-only HEAD | tr '\n' ' ')"

    if [ "$DRY_RUN" = 1 ]; then
      mkdir -p "$OUT"; rm -rf "$OUT/$name.git"; git init -q --bare "$OUT/$name.git"
      git push -q "$OUT/$name.git" --all
      echo "   已推到 $OUT/$name.git（演练）"
    else
      if gh repo view "$OWNER/$name" >/dev/null 2>&1; then
        if [ -n "$(gh api "repos/$OWNER/$name/branches" --jq '.[0].name' 2>/dev/null)" ]; then
          echo "   ⚠ $OWNER/$name 已存在且不是空仓库，跳过（不覆盖）"; exit 0
        fi
      else
        gh repo create "$OWNER/$name" $VISIBILITY --description "$desc" >/dev/null
      fi
      git push -q "https://github.com/$OWNER/$name.git" --all
      echo "   已推到 https://github.com/$OWNER/$name"
    fi
  )
}

# ---------------------------------------------------------------- 项目清单
project omnichat "OmniChat：自托管、多设备、多服务商的 AI 聊天网页（callaum.com）" \
  main=claude/omnichat-webapp \
  fix/callaum-500-hardening=claude/optimistic-gauss-xyq4iu \
  -- --path omnichat/ --path .github/workflows/omnichat.yml --path-rename omnichat/:

project callaum-start "callaum.com 起始页：壁纸时钟、行情、天气、应用栏（含 planner / flywire / uq / duo 子页）" \
  main=feature/market-card \
  -- --invert-paths --path README.md

project huilv "简汇 · 多币种汇率对比（huilv.callaum.com）" \
  main=claude/zealous-pascal-ivvt6b \
  -- --path huilv/ --path-rename huilv/:

project soulpet "SoulPet 灵宠：桌面电子宠物（Electron）" \
  main=desktop-pet \
  -- --path-glob '*'

project aipet "aipet：AI 桌面宠物安卓应用" \
  main=claude/wonderful-fermat-73o7dw \
  -- --path aipet/ --path .github/workflows/aipet-android.yml --path-rename aipet/:

project esim-manager "9eSIM Web Manager：通过 Web Bluetooth 管理 9eSIM 卡" \
  main=claude/9esim-web-manager-ble-j9nstg \
  -- --path esim-manager/ --path .github/workflows/esim-manager-ci.yml --path-rename esim-manager/:

project sms-relay "SMS Relay：安全的安卓短信转发 / 远程发短信" \
  main=claude/admiring-carson-9i1ufu \
  -- --path smsrelay/ --path-rename smsrelay/:

project duo-tracker "iPhone 双口转接头价格追踪（每日抓取）" \
  main=claude/iphone-duo-adapter-tracker-no3gf5 \
  -- --path duo-tracker/ --path CLAUDE.md --path-rename duo-tracker/:

project uq-grade-notifier "UQ 成绩通知：监控 Learn.UQ / my.UQ 成绩并通过 Bark 推送" \
  main=claude/uq-grade-notification-tool-usx05x \
  -- --path uq-grade-notifier/ --path-rename uq-grade-notifier/:

project dshx-model-fingerprint "DSH 插件：检验中转站实际提供的是哪个模型" \
  main=claude/dsh-model-fingerprint-7ykw49 \
  -- --path plugins/dsh-model-fingerprint/ --path-rename plugins/dsh-model-fingerprint/:

# 科技晨读 / 四象限 / 热榜周刊 / Pages 发布 —— 现在在 dsh 的 main 上并且正在自动部署，
# 搬家需要先迁 Azure 和 Pages 配置，所以默认不跑；确认要搬时执行：./migrate.sh callaum-web
if [[ " ${ONLY[*]:-} " =~ " callaum-web " ]]; then
project callaum-web "小工具合集：科技晨读、四象限任务计划、GitHub 热榜周刊（GitHub Pages 按子目录发布）" \
  main=main \
  -- --path news/ --path quadrant/ --path weekly/ --path pages/ --path .github/
fi

echo; echo "完成。下一步见 $HERE/HANDOVER.md"
