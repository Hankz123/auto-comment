const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const CHROME_PATH = config.chromePath;
const PROFILES_DIR = path.join(__dirname, "chrome-profiles");
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

function getProfilePath(accountName) {
  const dir = path.join(PROFILES_DIR, accountName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 启动浏览器（Chrome --user-data-dir 持久化，登录态永不丢）
 * 返回 { browser }
 */
async function launchBrowser(accountName) {
  // 检查 Chrome 是否存在
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(
      `Chrome 未找到: ${CHROME_PATH}\n` +
      `请设置 .env 中的 CHROME_PATH 指向正确的 Chrome 可执行文件`
    );
  }

  const userDataDir = getProfilePath(accountName);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    userDataDir,
    headless: false,
    defaultViewport: null,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  console.log(`  🖥  Chrome 已启动 (Profile: ${accountName})`);
  return { browser, accountName };
}

/**
 * 关闭浏览器
 */
async function closeBrowser({ browser, accountName }) {
  console.log(`  💾 ${accountName} 登录态已由 Chrome 自动保存`);
  await browser.close();
}

/**
 * 轮询等待用户手动登录（B站专用）
 */
async function waitForLogin(page, maxWaitMs = 120000) {
  console.log("  🔐 检测 B站 登录状态...");
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const loggedIn = await page.evaluate(() => {
      const cookie = document.cookie.includes("DedeUserID");
      const hasAvatar =
        !!document.querySelector("[class*='header-avatar']") ||
        !!document.querySelector(".bili-avatar") ||
        !!document.querySelector("[class*='bili-avatar']");
      const hasLoginBtn =
        !!document.querySelector(".header-login-entry") ||
        !!document.querySelector("[class*='unlogin']");
      return cookie || (hasAvatar && !hasLoginBtn);
    });

    if (loggedIn) {
      console.log("  ✅ 已登录 B站");
      return true;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed % 15 === 0) console.log(`  ⏳ 等待登录... (${elapsed}s)`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("  ⚠️  登录超时");
  return false;
}

/**
 * 搜索B站视频（按最新发布排序）
 */
async function searchBilibili(page, keyword) {
  const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}&order=pubdate`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  if (page.url().includes("passport.bilibili.com")) {
    console.log("  ⚠️  需登录，请先登录后再试");
    return [];
  }

  const videos = await page.evaluate(() => {
    const results = [];
    const selectors = [
      ".video-list .bili-video-card",
      ".video-list .video-list-item",
      ".search-content .video-item",
      ".search-video-list > div",
      ".col_3 .bili-video-card",
    ];

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length === 0) continue;
      items.forEach((item) => {
        const link = item.querySelector("a[href*='BV'], a[href*='av']");
        const title =
          item.querySelector(".bili-video-card__info--tit") ||
          item.querySelector(".title") ||
          item.querySelector("a[title]");
        if (link) {
          let href = link.href;
          if (!href.startsWith("http")) href = "https:" + href;
          results.push({
            url: href,
            title: title
              ? (title.getAttribute("title") || title.textContent || href).trim()
              : href,
          });
        }
      });
      break;
    }
    return results;
  });

  console.log(`  找到 ${videos.length} 个视频`);
  return videos.slice(0, 10);
}

/**
 * 发表评论
 */
async function postComment(page, text) {
  try {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 2000));

    const debug = await page.evaluate(() => {
      const tas = document.querySelectorAll("textarea");
      return {
        textareas: Array.from(tas).map((t) => ({
          placeholder: t.placeholder,
          className: t.className,
          visible: t.offsetParent !== null,
        })),
        url: location.href,
      };
    });
    console.log("  🔍 页面 textarea:", JSON.stringify(debug));

    let ta = await page.$("textarea:not([hidden])").catch(() => null);

    if (!ta) {
      const selectors = [
        ".bb-comment textarea",
        "#comment textarea",
        ".reply-box textarea",
        "textarea.reply-box-textarea",
        ".comment-container textarea",
        "[class*='reply'] textarea",
        "textarea[placeholder*='发一条']",
        "textarea[placeholder*='评论']",
      ];
      for (const sel of selectors) {
        ta = await page.$(sel).catch(() => null);
        if (ta) break;
      }
    }

    if (!ta) {
      ta = await page.$("[contenteditable='true']").catch(() => null);
    }

    if (!ta) {
      console.log("  ⚠️  找不到评论输入框");
      return false;
    }

    console.log("  📝 找到输入框:", await ta.evaluate((el) => el.className || el.tagName));

    await ta.click();
    await new Promise((r) => setTimeout(r, 500));
    await ta.click({ clickCount: 3 });
    await ta.type(text, { delay: 50 });
    await new Promise((r) => setTimeout(r, 1000));

    let sent = false;
    const btnSelectors = [
      ".reply-box button.bl-button--primary",
      ".bb-comment button.bl-button--primary",
      ".comment-container button[class*='submit']",
      "button.publish-btn",
      "button[class*='release']",
      "button:has-text('发布')",
      "button:has-text('发送')",
    ];
    for (const sel of btnSelectors) {
      const btn = await page.$(sel).catch(() => null);
      if (btn) {
        await btn.click();
        sent = true;
        console.log("  ✅ 评论发布");
        break;
      }
    }
    if (!sent) {
      await page.keyboard.down("Control");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
      console.log("  ✅ 评论发布 (Ctrl+Enter)");
    }

    await new Promise((r) => setTimeout(r, 3000));
    return true;
  } catch (e) {
    console.error("  ❌ 评论失败:", e.message);
    return false;
  }
}

/**
 * 截图
 */
async function screenshotPage(page, accountName, index) {
  try {
    let clipTarget = null;
    try {
      clipTarget = await page.$(".bb-comment, #comment, .reply-list, .comment-container");
    } catch (_) {}

    const dir = path.join(__dirname, "screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${accountName}_${Date.now()}_${index}.png`);

    if (clipTarget) {
      await clipTarget.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file });
    }
    console.log(`  📸 ${path.basename(file)}`);
    return file;
  } catch (e) {
    console.error("  ❌ 截图失败:", e.message);
    return null;
  }
}

/**
 * 主任务
 */
async function runTask(config) {
  const { platform, account, keywords, comments, intervalMinutes } = config;
  const kwList = keywords.split(/\s+/).filter(Boolean);
  const cmtList = Array.isArray(comments) ? comments : [];

  if (!kwList.length) throw new Error("关键词为空");
  if (!cmtList.length) throw new Error("评论池为空");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`🚀 平台=${platform} 账号=${account}`);
  console.log(`   关键词: ${kwList.join(", ")}`);
  console.log(`   评论: ${cmtList.length}条`);

  const { browser } = await launchBrowser(account);
  const page = await browser.newPage();
  const results = [];

  try {
    console.log("\n📡 B站首页...");
    await page.goto("https://www.bilibili.com", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    await waitForLogin(page);

    for (let ki = 0; ki < kwList.length; ki++) {
      const kw = kwList[ki];
      console.log(`\n🔍 关键词 [${ki + 1}/${kwList.length}]: "${kw}"`);

      const videos = await searchBilibili(page, kw);
      if (!videos.length) continue;

      for (let vi = 0; vi < videos.length; vi++) {
        const v = videos[vi];
        console.log(`  📹 [${vi + 1}] ${v.title.substring(0, 60)}`);

        try {
          await page.goto(v.url, {
            waitUntil: "domcontentloaded", timeout: 30000,
          });
          await new Promise((r) => setTimeout(r, 3000));

          const ci = (ki * videos.length + vi) % cmtList.length;
          const success = await postComment(page, cmtList[ci]);
          const shot = await screenshotPage(page, account, vi);

          results.push({
            platform, account, keyword: kw,
            comment: cmtList[ci],
            videoUrl: v.url, videoTitle: v.title,
            screenshotPath: shot, success,
          });

          const waitMs = intervalMinutes * 60 * 1000;
          console.log(`  ⏳ 等待 ${intervalMinutes} 分钟...`);
          await new Promise((r) => setTimeout(r, waitMs));
        } catch (e) {
          console.error(`  ❌ ${e.message}`);
          results.push({
            platform, account, keyword: kw,
            comment: cmtList[0],
            videoUrl: v.url, videoTitle: v.title,
            screenshotPath: null, success: false,
            error: e.message,
          });
        }
      }
    }
  } finally {
    console.log("\n🔒 关闭浏览器...");
    await closeBrowser({ browser, account });
  }

  console.log(`\n📊 ${results.filter((r) => r.success).length}/${results.length} 成功`);
  return results;
}

module.exports = { runTask, launchBrowser, closeBrowser, waitForLogin };
