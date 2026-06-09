/**
 * 统一配置层 — 从 .env 环境变量读取
 * 复制 .env.example 为 .env 并填入实际值
 */

const path = require("path");

// 尝试加载 .env 文件（如果安装了 dotenv）
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (_) {
  // dotenv 未安装时静默忽略
}

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`\n❌ 缺少环境变量: ${key}`);
    console.error(`   请复制 .env.example 为 .env 并填入实际值\n`);
    process.exit(1);
  }
  return val;
}

module.exports = {
  // 飞书
  feishuAppId: required("FEISHU_APP_ID"),
  feishuAppSecret: required("FEISHU_APP_SECRET"),
  ownerOpenId: required("FEISHU_OWNER_OPEN_ID"),

  // Chrome
  chromePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",

  // 服务端口
  port: parseInt(process.env.PORT, 10) || 3456,
};
