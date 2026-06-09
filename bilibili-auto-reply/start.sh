#!/bin/bash
# B站自动回帖工具 - 启动脚本
cd "$(dirname "$0")"
echo "═══════════════════════════════════════"
echo "  B站自动回帖工具"
echo "═══════════════════════════════════════"
echo ""
echo "启动服务..."

# 检查Chrome
if [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "❌ 未找到 Google Chrome，请安装"
  exit 1
fi

# 检查Playwright
if [ ! -d "node_modules/playwright" ]; then
  echo "📦 安装依赖..."
  npm install
fi

# 启动
echo "✅ 服务地址: http://localhost:3456"
echo "✅ Canvas地址: http://127.0.0.1:18789/__openclaw__/canvas/bilibili-auto-reply.html"
echo ""
node server.js
