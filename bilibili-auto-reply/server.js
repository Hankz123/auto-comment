const express = require("express");
const path = require("path");
const { runTask } = require("./browser");
const { getOrCreateBitable, getOrCreateTable, addRecord, sendDM, sendCard, OWNER_OPEN_ID } = require("./feishu");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 状态管理
let taskState = {
  running: false,
  accounts: [],
  currentAccountIndex: 0,
  endTime: 0,  // 任务截止时间戳
};

// 健康检查
app.get("/api/status", (req, res) => {
  res.json(taskState);
});

// 接收HTML页面提交的配置，启动任务
app.post("/api/start", async (req, res) => {
  if (taskState.running) {
    return res.status(409).json({ error: "已有任务正在执行中" });
  }

  const config = req.body;
  // 验证必填字段
  if (!config.keywords?.trim()) {
    return res.status(400).json({ error: "关键词不能为空" });
  }
  if (!config.comments?.length) {
    return res.status(400).json({ error: "评论内容池不能为空" });
  }
  if (!config.intervalMinutes || config.intervalMinutes < 1) {
    return res.status(400).json({ error: "间隔时间必须填写且≥1分钟" });
  }
  if (!config.accounts?.length) {
    return res.status(400).json({ error: "账号池不能为空" });
  }
  if (!config.taskDurationMinutes || config.taskDurationMinutes < 1) {
    return res.status(400).json({ error: "任务总时长必须填写且≥1分钟" });
  }

  taskState.running = true;
  res.json({ status: "started", config });

  // 异步执行任务（不阻塞HTTP响应）
  executeTasks(config).catch((err) => {
    console.error("任务执行异常:", err);
  }).finally(() => {
    taskState.running = false;
  });
});

// 停止任务
app.post("/api/stop", (req, res) => {
  taskState.running = false;
  res.json({ status: "stopping" });
});

// ── 账号管理 API ──

/** 打开浏览器登录账号 */
app.post("/api/account/login", async (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ error: "账号名不能为空" });

  res.json({ status: "opening", account });

  // 异步执行，不阻塞响应
  try {
    const { launchBrowser, closeBrowser, waitForLogin } = require("./browser");
    const { browser } = await launchBrowser(account);
    const page = await browser.newPage();

    await page.goto("https://www.bilibili.com", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    console.log(`  🔐 账号「${account}」: 请在浏览器中登录B站`);
    await waitForLogin(page, 300000);

    await closeBrowser({ browser, account });
    console.log(`  ✅ 账号「${account}」: 登录态已保存`);
  } catch (e) {
    console.error(`  ❌ 账号「${account}」登录失败:`, e.message);
  }
});

/** 检测账号登录状态 */
app.get("/api/account/check", async (req, res) => {
  const { account } = req.query;
  if (!account) return res.status(400).json({ error: "缺少账号名" });

  const userDataDir = require("path").join(__dirname, "chrome-profiles", account);
  const fs = require("fs");

  if (!fs.existsSync(userDataDir)) {
    return res.json({ account, loggedIn: false, reason: "未找到 Profile 目录" });
  }

  // 用 headless Chrome 检查 Cookie
  let browser;
  try {
    browser = await require("puppeteer-core").launch({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir,
      headless: true,
      args: ["--no-first-run", "--no-default-browser-check"],
    });

    const page = await browser.newPage();
    await page.goto("https://www.bilibili.com", {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    const cookies = await page.cookies();
    const hasB站Cookie = cookies.some(
      (c) => c.name === "DedeUserID" || c.name === "SESSDATA"
    );

    await browser.close();

    res.json({
      account,
      loggedIn: hasB站Cookie,
      cookieCount: cookies.filter((c) => c.domain.includes("bilibili")).length,
      reason: hasB站Cookie ? "已登录" : "未登录（需要先在浏览器中登录B站）",
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    res.json({ account, loggedIn: false, reason: "检测失败: " + e.message });
  }
});

/** 删除账号及其所有数据 */
app.delete("/api/account", async (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ error: "缺少账号名" });

  const fs = require("fs");
  const path = require("path");

  // 删除 Chrome Profile 目录
  const profileDir = path.join(__dirname, "chrome-profiles", account);
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }

  // 删除截图
  const ssDir = path.join(__dirname, "screenshots");
  if (fs.existsSync(ssDir)) {
    const files = fs.readdirSync(ssDir).filter((f) => f.startsWith(`${account}_`));
    files.forEach((f) => fs.unlinkSync(path.join(ssDir, f)));
  }

  console.log(`  🗑 已删除账号「${account}」的所有数据`);
  res.json({ status: "deleted", account });
});

async function executeTasks(config) {
  const {
    platform = "bilibili",
    accounts,
    keywords,
    comments,
    intervalMinutes,
    switchAccountMinutes = 0,
    taskDurationMinutes,
  } = config;

  const taskStartTime = Date.now();
  const taskEndTime = taskStartTime + taskDurationMinutes * 60 * 1000;
  taskState.endTime = taskEndTime;

  console.log("\n" + "=".repeat(60));
  console.log("B站自动回帖任务开始");
  console.log(`  任务时长: ${taskDurationMinutes} 分钟`);
  console.log(`  预计结束: ${new Date(taskEndTime).toLocaleTimeString()}`);
  console.log("=".repeat(60));

  // ── 初始化飞书多维表格 ──
  let bitableToken, tableId, bitableUrl;
  let bitableOK = false;
  try {
    console.log("\n📋 初始化飞书多维表格...");
    const bitable = await getOrCreateBitable();
    bitableToken = bitable.app_token;
    bitableUrl = bitable.url;
    console.log(`  多维表格: ${bitableUrl}`);

    const table = await getOrCreateTable(bitableToken);
    tableId = table.table_id;
    console.log(`  数据表: ${table.name}`);
    bitableOK = true;
  } catch (e) {
    console.error("飞书表格初始化失败:", e.message);

    // 发送权限缺失通知
    if (e.message === "BOT_MISSING_PERMISSION") {
      console.log("\n⚠️  Bot 缺少多维表格权限，请按以下步骤授权：");
      console.log("  1. 打开飞书开放平台 → 应用 → 权限管理");
      console.log("  2. 搜索并开启权限:");
      console.log("     - bitable:app (多维表格)");
      console.log("     - drive:drive (云文档)");
      console.log("     - im:message (消息通知)");
      console.log("  3. 重新发布应用 → 版本管理与发布 → 创建版本");
      console.log("  4. 重新运行本工具");

      try {
        await sendDM(
          "⚠️ B站自动回帖工具：飞书多维表格权限缺失\n\n" +
          "请按以下步骤授权：\n" +
          "1. 打开飞书开放平台 → 应用 → 权限管理\n" +
          "2. 搜索并开启：bitable:app、drive:drive、im:message\n" +
          "3. 重新发布应用 → 创建版本并发布\n" +
          "4. 重新运行任务"
        );
      } catch (_) {}
    }
  }

  // ── 发送开始通知 ──
  try {
    await sendDM(
      `🚀 B站自动回帖任务已启动\n` +
      `平台: ${platform}\n` +
      `账号: ${accounts.join(", ")}\n` +
      `关键词: ${keywords}\n` +
      `评论: ${comments.length}条\n` +
      `评论间隔: ${intervalMinutes}分钟\n` +
      `${switchAccountMinutes > 0 ? `切换账号间隔: ${switchAccountMinutes}分钟\n` : ""}` +
      `任务总时长: ${taskDurationMinutes}分钟\n` +
      `预计停止: ${new Date(taskEndTime).toLocaleTimeString()}` +
      (bitableUrl ? `\n表格: ${bitableUrl}` : "")
    );
  } catch (_) {}

  let accountIndex = 0;
  let totalProcessed = 0;
  let totalSuccess = 0;

  while (taskState.running) {
    // 检查总时长是否已到
    if (Date.now() >= taskState.endTime) {
      console.log(`\n⏰ 任务总时长 (${taskDurationMinutes}分钟) 已到，自动停止`);
      await sendDM(`⏰ 任务总时长 (${taskDurationMinutes}分钟) 已到，自动停止`).catch(() => {});
      taskState.running = false;
      break;
    }
    const account = accounts[accountIndex % accounts.length];
    console.log(`\n👤 使用账号: ${account}`);

    try {
      const results = await runTask({
        platform,
        account,
        keywords,
        comments,
        intervalMinutes,
        switchAccountMinutes,
      });

      const successCount = results.filter((r) => r.success).length;
      totalProcessed += results.length;
      totalSuccess += successCount;

      console.log(`\n📊 本轮: ${successCount}/${results.length} 成功`);

      // 记录到飞书多维表格
      if (bitableOK && bitableToken && tableId) {
        console.log("\n📝 记录到飞书多维表格...");
        for (const result of results) {
          try {
            await addRecord(bitableToken, tableId, result);
          } catch (e) {
            console.error(`  ❌ 记录失败: ${e.message}`);
          }
        }
      }

      // ── 发送本轮完成通知 ──
      try {
        const videoList = results
          .filter((r) => r.success)
          .map((r) => `• ${r.videoTitle?.substring(0, 50)}`)
          .join("\n");

        await sendDM(
          `✅ 回帖完成 [${account}]\n` +
          `成功: ${successCount}/${results.length}\n` +
          `累计: ${totalSuccess}/${totalProcessed}\n\n` +
          `已评论视频:\n${videoList || "（无）"}` +
          (bitableUrl ? `\n\n📊 查看表格: ${bitableUrl}` : "")
        );
      } catch (_) {}
    } catch (e) {
      console.error(`账号 ${account} 任务失败:`, e.message);
      try {
        await sendDM(`❌ 任务异常 [${account}]: ${e.message}`);
      } catch (_) {}
    }

    // 账号/轮次间隔
    if (switchAccountMinutes && switchAccountMinutes > 0) {
      accountIndex++;
      console.log(`\n⏳ 切换账号，等待 ${switchAccountMinutes} 分钟...`);
      await sleepMinutes(switchAccountMinutes);
    } else {
      console.log(`\n⏳ 等待 ${intervalMinutes} 分钟后开始下一轮...`);
      await sleepMinutes(intervalMinutes);
    }
  }

  // ── 任务停止通知 ──
  try {
    await sendDM(
      `⏹ 任务已停止\n` +
      `总计处理: ${totalProcessed} 条\n` +
      `成功: ${totalSuccess} 条` +
      (bitableUrl ? `\n📊 查看表格: ${bitableUrl}` : "")
    );
  } catch (_) {}

  console.log("\n任务已停止");
}

/** 等待指定分钟（可被打断，距离任务结束不足时提前返回） */
async function sleepMinutes(minutes) {
  const totalMs = minutes * 60 * 1000;
  const checkInterval = 5000;
  let elapsed = 0;
  while (elapsed < totalMs && taskState.running) {
    const remainingTaskMs = taskState.endTime - Date.now();
    const waitMs = Math.min(checkInterval, totalMs - elapsed, remainingTaskMs > 0 ? remainingTaskMs : checkInterval);
    if (remainingTaskMs <= 0) break;
    await new Promise((r) => setTimeout(r, waitMs));
    elapsed += checkInterval;
  }
}

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`B站自动回帖工具已启动: http://localhost:${PORT}`);
  console.log(`API端点: http://localhost:${PORT}/api/start`);
});
