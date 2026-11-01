#!/data/data/com.termux/files/usr/bin/bash
# 把安卓手机变成「此刻」的服务端：在 Termux 里运行一次即可。
#   curl -fsSL https://raw.githubusercontent.com/luminous-creator/cike/main/scripts/termux-setup.sh | bash
# 可用环境变量：CIKE_BRANCH（默认 main）、CIKE_REPO、CIKE_PORT（默认 3000）
set -euo pipefail

REPO="${CIKE_REPO:-https://github.com/luminous-creator/cike.git}"
BRANCH="${CIKE_BRANCH:-main}"
PORT="${CIKE_PORT:-3000}"
DIR="$HOME/cike"

echo "== 1/5 安装 Node.js 和 git"
pkg update -y >/dev/null
pkg install -y nodejs-lts git termux-api >/dev/null

echo "== 2/5 申请存储权限（备份放到手机的 Documents 里，卸载 Termux 也不会丢）"
[ -d "$HOME/storage/shared" ] || termux-setup-storage || true
sleep 2

echo "== 3/5 下载代码（$BRANCH）"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

echo "== 4/5 安装依赖并构建（第一次要几分钟）"
npm install --no-audit --no-fund
npm run build

echo "== 5/5 写配置和开机自启"
if [ -d "$HOME/storage/shared/Documents" ]; then DATA="$HOME/storage/shared/Documents/cike-data"; else DATA="$HOME/cike-data"; fi
mkdir -p "$DATA"
[ -f .env ] || cp .env.example .env
if ! grep -q '^CIKE_DATA_DIR=.\+' .env; then sed -i '/^CIKE_DATA_DIR=/d' .env; echo "CIKE_DATA_DIR=$DATA" >> .env; fi
grep -q '^PORT=' .env || echo "PORT=$PORT" >> .env
if ! grep -q '^SYNC_TOKEN=.\+' .env; then
  sed -i '/^SYNC_TOKEN=/d' .env
  echo "SYNC_TOKEN=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
fi

cat > "$DIR/cike-start.sh" <<START
#!/data/data/com.termux/files/usr/bin/bash
# 保持唤醒；服务端意外退出 5 秒后自动重启
termux-wake-lock 2>/dev/null || true
cd "$DIR"
pgrep -f "node dist/boot.js" >/dev/null && exit 0
while true; do
  node dist/boot.js >> "$DATA/server.log" 2>&1
  sleep 5
done
START
chmod +x "$DIR/cike-start.sh"
mkdir -p "$HOME/.termux/boot"
cp "$DIR/cike-start.sh" "$HOME/.termux/boot/cike"

nohup "$DIR/cike-start.sh" >/dev/null 2>&1 &
sleep 3
IP="$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)"
TOKEN="$(grep '^SYNC_TOKEN=' .env | cut -d= -f2)"
cat <<DONE

好了。
  · 在这台手机的浏览器打开  http://localhost:$PORT  → 设置 → 同步与自动备份 → 开启
    （再用浏览器菜单「添加到主屏幕」装成应用）
  · 数据和快照在：$DATA
  · 同一 Wi-Fi 的电脑打开  http://${IP:-手机IP}:$PORT  ，口令：$TOKEN
  · 模型密钥：编辑 $DIR/.env 里的 DEEPSEEK_API_KEY（不用重启）
  · 想开机自动运行：装 Termux:Boot（F-Droid）并打开一次；
    再到系统设置里把 Termux 的电池优化关掉，后台才不会被杀。
DONE
