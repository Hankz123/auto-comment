#!/bin/bash
# B站自动回帖工具 - 启动脚本
set -e
cd "$(dirname "$0")"

echo "═══════════════════════════════════════"
echo "  B站自动回帖工具"
echo "═══════════════════════════════════════"
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
  echo "⚠️  未找到 .env 配置文件"
  echo ""
  echo "请先配置环境变量："
  echo "  cp .env.example .env"
  echo "  编辑 .env 填入你的飞书应用凭据"
  echo ""
  echo "详细说明请阅读 README.md"
  exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo "📦 安装依赖..."
  npm install
fi

echo "✅ 服务地址: http://localhost:${PORT:-3456}"
echo ""
node server.js
