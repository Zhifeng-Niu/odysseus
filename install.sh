#!/bin/bash
# Odysseus 一句话部署：
#   curl -fsSL https://raw.githubusercontent.com/Zhifeng-Niu/odysseus/main/install.sh | bash
#
# 做四件事：检查 Node ≥ 22 与 git → clone 仓库 → npm pack → 全局安装 tarball
# （确定性路径：不依赖 npm 的 git-dep——它在部分 npm 版本会把包软链进
# _cacache 临时目录，缓存一清链接即断）→ odysseus init（引导配置 GLM key、
# live 验证、种子 ~/.odysseus）。
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 Node.js。请先安装 Node ≥ 22：https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "✗ 需要 Node.js ≥ 22（当前 $(node -v)）。升级：https://nodejs.org"
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "✗ 未找到 git。请先安装：https://git-scm.com"
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "▶ 拉取 Odysseus…"
git clone --depth 1 https://github.com/Zhifeng-Niu/odysseus "$TMP_DIR/repo" >/dev/null

echo "▶ 打包…"
(cd "$TMP_DIR/repo" && npm pack --pack-destination "$TMP_DIR" >/dev/null)

echo "▶ 全局安装…"
npm install -g "$TMP_DIR"/odysseus-*.tgz

# npm prefix 的 bin 目录不一定在 PATH 里（如 prefix=~/.npm-global 时）——
# 脚本内一律用绝对路径调用；curl|bash 下脚本 stdin 被管道占用，init 的
# 交互提示用 </dev/tty 接回真实终端（无 TTY 时自动走非交互兜底）。
ODYSSEUS_BIN="$(npm prefix -g)/bin/odysseus"

echo ""
echo "▶ 初始化：配置 GLM key → live 验证 → 种子个人层目录"
if ! "$ODYSSEUS_BIN" init < /dev/tty; then
  echo ""
  echo "init 未完成验证——随时重跑：$ODYSSEUS_BIN init"
fi

echo ""
echo "Odysseus 已部署。若命令找不到，把 npm 全局 bin 加进 PATH："
echo "  export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
echo ""
echo "试一下（用上面导出的 PATH 或绝对路径）："
echo "  $ODYSSEUS_BIN \"创建 hello.ts 并通过类型检查\""
echo "  $ODYSSEUS_BIN /ithaca add tasks <你的任务>   # 个人任务栈（保护核）"
