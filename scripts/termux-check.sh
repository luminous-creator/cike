#!/data/data/com.termux/files/usr/bin/bash
# 只读检查：看这台安卓手机能不能当「此刻」的服务端。不安装、不修改任何东西。
#   curl -fsSL https://raw.githubusercontent.com/luminous-creator/cike/ccr-2867821f-n0t9q5/scripts/termux-check.sh | bash
# 把输出整段复制给 Claude。
ok() { printf '  ✓ %s\n' "$*"; }
no() { printf '  ✗ %s\n' "$*"; }
val() { printf '  · %-14s %s\n' "$1" "${2:-（无）}"; }
has() { command -v "$1" >/dev/null 2>&1; }

echo "== 设备"
val "型号" "$(getprop ro.product.model 2>/dev/null)"
val "Android" "$(getprop ro.build.version.release 2>/dev/null)（SDK $(getprop ro.build.version.sdk 2>/dev/null)）"
val "One UI" "$(getprop ro.build.version.oneui 2>/dev/null)"
val "CPU 架构" "$(uname -m)"

echo "== Termux"
val "版本" "${TERMUX_VERSION:-未知}"
val "安装来源" "${TERMUX_APK_RELEASE:-未知}"
case "${TERMUX_APK_RELEASE:-}${TERMUX_VERSION:-}" in
  *GOOGLE_PLAY*|*googleplay*) no "这是 Google Play 版：Termux:Boot / Termux:API 必须和它同一来源才能用，开机自启装不上；建议卸载后从 F-Droid 装 Termux、Termux:Boot、Termux:API" ;;
esac

echo "== 工具"
for c in node npm git curl; do
  if has "$c"; then ok "$c $("$c" --version 2>/dev/null | head -1)"; else no "$c 没装"; fi
done
has termux-wake-lock && ok "termux-wake-lock 可用" || no "termux-wake-lock 没有（pkg install termux-api 后自带命令；保持唤醒还需要 Termux:API 应用）"
if has termux-battery-status; then
  out="$(timeout 5 termux-battery-status 2>/dev/null)"
  [ -n "$out" ] && ok "Termux:API 应用已装，电量 $(echo "$out" | grep -o '"percentage": [0-9]*' | grep -o '[0-9]*')%" || no "termux-api 命令在，但 Termux:API 应用没装或没授权"
fi
[ -d "$HOME/.termux/boot" ] && ok "开机自启目录存在：$(ls "$HOME/.termux/boot" 2>/dev/null | tr '\n' ' ')" || no "没有 ~/.termux/boot（装 Termux:Boot 并打开一次）"

echo "== 存储"
[ -d "$HOME/storage/shared" ] && ok "已授权共享存储" || no "没授权共享存储（运行 termux-setup-storage）"
val "Termux 可用空间" "$(df -h "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
[ -d "$HOME/storage/shared" ] && val "手机存储可用" "$(df -h "$HOME/storage/shared" 2>/dev/null | awk 'NR==2{print $4}')"
val "内存" "$(free -h 2>/dev/null | awk '/Mem:/{print $2" 总 / "$7" 可用"}')"

echo "== 网络"
IP="$(timeout 5 termux-wifi-connectioninfo 2>/dev/null | grep -o '"ip": "[0-9.]*"' | grep -o '[0-9.]*[0-9]' | head -1)"
[ -n "$IP" ] && [ "$IP" != "0.0.0.0" ] || IP="$(ifconfig 2>/dev/null | awk '/wlan0/{f=1} f&&/inet /{print $2; exit}')"
val "Wi-Fi IP" "${IP:-（没连 Wi-Fi，或拿不到）}"
curl -fsS -m 8 -o /dev/null https://registry.npmjs.org/ && ok "能连 npm" || no "连不上 npm（安装依赖会失败）"
curl -fsS -m 8 -o /dev/null https://github.com/ && ok "能连 GitHub" || no "连不上 GitHub"

P="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}"
val "代理变量" "${P:-（没设；开着 VPN 全局模式时不需要）}"

echo "== 此刻服务端"
if [ -d "$HOME/cike/.git" ]; then
  ok "代码在 ~/cike（$(git -C "$HOME/cike" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$HOME/cike" log -1 --format=%h 2>/dev/null)）"
  [ -f "$HOME/cike/dist/boot.js" ] && ok "已构建" || no "还没构建"
  [ -f "$HOME/cike/.env" ] && val "数据目录" "$(grep '^CIKE_DATA_DIR=' "$HOME/cike/.env" | cut -d= -f2)"
else
  no "还没装（~/cike 不存在）"
fi
pgrep -f "node dist/boot.js" >/dev/null && ok "服务端正在运行" || no "服务端没在运行"
PORT="$(grep '^PORT=' "$HOME/cike/.env" 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-3000}"
val "端口" "$PORT"
status="$(NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 curl -fsS -m 3 "http://localhost:$PORT/api/sync/status" 2>/dev/null)"
[ -n "$status" ] && val "同步状态" "$status"

echo "== 后台保活（三星需要手动设置，脚本读不到，请对照检查）"
echo "  1. 设置 → 应用 → Termux → 电池 → 选「不受限制」"
echo "  2. 设置 → 电池 → 后台使用限制 → 「永不休眠的应用」→ 加入 Termux（以及 Termux:Boot、Termux:API）"
echo "  3. 设置 → 开发者选项 → 打开「停用子进程限制」（Android 14+；不开的话系统会杀掉 Termux 里的 node）"
echo "  4. 最近任务里长按 Termux 图标 → 「锁定此应用」"
echo
echo "检查完毕，把上面全部输出复制给 Claude。"
