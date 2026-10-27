#!/usr/bin/env bash
# 发布手机版到 GitHub Pages：构建静态页面 → 推到 gh-pages 分支。需要先 gh auth login。
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build
out="$(mktemp -d)"
cp -r dist/public/. "$out/"
touch "$out/.nojekyll"
remote="$(git remote get-url origin)"
cd "$out"
git init -q -b gh-pages
git add -A
git -c user.name="cike" -c user.email="cike@users.noreply.github.com" commit -q -m "deploy $(date +%F_%T)"
git push -q -f "$remote" gh-pages
echo "已发布。"
