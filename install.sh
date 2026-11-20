#!/bin/bash
# Odysseus 一句话部署：
#   curl -fsSL https://raw.githubusercontent.com/Zhifeng-Niu/odysseus/main/install.sh | bash
#
# 做三件事：检查 Node ≥ 22 → npm 全局安装（从 GitHub 拉取并构建）→ odysseus init
# （引导配置 GLM key、live 验证、种子 ~/.odysseus）。
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

echo "▶ 安装 odysseus（npm 全局，从 GitHub 拉取并构建）…"
npm install -g github:Zhifeng-Niu/odysseus

echo ""
echo "▶ 初始化：配置 GLM key → live 验证 → 种子个人层目录"
odysseus init

echo ""
echo "Odysseus 已部署。试一下："
echo "  odysseus \"创建 hello.ts 并通过类型检查\""
echo "  /ithaca add tasks <你的任务>   # 个人任务栈（保护核）"
