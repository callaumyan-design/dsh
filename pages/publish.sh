#!/usr/bin/env bash
# 把一个项目的构建结果放进站点目录（gh-pages 分支的工作区），并重新生成站点首页。
#
#   pages/publish.sh <项目路径名> <构建目录> <站点目录>
#
# 只会替换 <站点目录>/<项目路径名>/，其他项目的文件不动。
# 项目路径名留空时只重新生成首页。
set -euo pipefail

project="${1:-}"
build="${2:-}"
site="$3"
here="$(cd "$(dirname "$0")" && pwd)"

if [[ -n "$project" ]]; then
  if [[ ! "$project" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "项目路径名只能用小写字母、数字和连字符：$project" >&2
    exit 1
  fi
  if ! node -e 'const p=require(process.argv[1]); process.exit(p.some(x=>x.path===process.argv[2])?0:1)' "$here/projects.json" "$project"; then
    echo "pages/projects.json 里没有登记项目 $project" >&2
    exit 1
  fi
  if [[ ! -f "$build/index.html" ]]; then
    echo "构建目录 $build 里没有 index.html" >&2
    exit 1
  fi
  rm -rf "${site:?}/$project"
  mkdir -p "$site/$project"
  cp -R "$build/." "$site/$project/"
  echo "✓ 已更新 /$project/"
fi

node "$here/build-root.mjs" "$site"
