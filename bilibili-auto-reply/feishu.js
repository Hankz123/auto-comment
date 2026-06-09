const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const path = require("path");
const os = require("os");
const configPath = path.resolve(os.homedir(), ".openclaw/openclaw.json");
const gwConfig = require(configPath);
const feishuCfg = gwConfig.channels?.feishu || {};
const APP_ID = feishuCfg.appId;
const APP_SECRET = feishuCfg.appSecret;

// 洋葱大人的飞书 open_id
const OWNER_OPEN_ID = "ou_a48329c140a2fb276fbe040a9ee69b60";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) return cachedToken;
  const res = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: APP_ID, app_secret: APP_SECRET }
  );
  cachedToken = res.data.tenant_access_token;
  tokenExpiresAt = Date.now() + (res.data.expire || 7200) * 1000;
  return cachedToken;
}

async function apiGet(p, params = {}) {
  const token = await getToken();
  return axios.get(`https://open.feishu.cn/open-apis${p}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
}

async function apiPost(p, data = {}) {
  const token = await getToken();
  return axios.post(`https://open.feishu.cn/open-apis${p}`, data, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

async function apiPostForm(p, form) {
  const token = await getToken();
  return axios.post(`https://open.feishu.cn/open-apis${p}`, form, {
    headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
  });
}

// ─────────── 消息通知 ───────────

/** 发送飞书私信给洋葱大人 */
async function sendDM(text) {
  try {
    await apiPost("/im/v1/messages?receive_id_type=open_id", {
      receive_id: OWNER_OPEN_ID,
      msg_type: "text",
      content: JSON.stringify({ text }),
    });
    console.log("  📨 飞书通知已发送");
  } catch (e) {
    console.error("  ⚠️  飞书通知失败:", e.response?.data?.msg || e.message);
  }
}

/** 发送富文本卡片通知 */
async function sendCard(title, fields) {
  try {
    const fieldList = fields
      .map((f) => `**${f.label}**：${f.value}`)
      .join("\n");
    const content = `**${title}**\n\n${fieldList}`;

    await apiPost("/im/v1/messages?receive_id_type=open_id", {
      receive_id: OWNER_OPEN_ID,
      msg_type: "interactive",
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        header: {
          title: { tag: "plain_text", content: title },
          template: "blue",
        },
        elements: fields.map((f) => ({
          tag: "div",
          text: { tag: "lark_md", content: `**${f.label}**：${f.value}` },
        })),
      }),
    });
    console.log("  📨 飞书卡片已发送");
  } catch (e) {
    // 卡片发送失败，回退到文本
    console.log("  ⚠️  卡片发送失败，回退文本:", e.response?.data?.msg || e.message);
    await sendDM(`${title}\n\n${fields.map(f => `${f.label}：${f.value}`).join("\n")}`);
  }
}

// ─────────── 多维表格 ───────────

async function getOrCreateBitable() {
  // 搜索已存在的多维表格
  try {
    const listRes = await apiGet("/bitable/v1/apps", { page_size: 50 });
    const apps = listRes.data?.data?.items || [];
    const existing = apps.find((a) => a.name === "自媒体平台评论统计");
    if (existing) {
      console.log(`  📋 找到已有表格: ${existing.app_token}`);
      return existing;
    }
  } catch (e) {
    const code = e.response?.data?.code;
    console.error(`  ⚠️  列出表格失败: ${code || e.message}`);
    if (code === 99991663 || code === 230001) {
      throw new Error("BOT_MISSING_PERMISSION");
    }
  }

  // 尝试创建
  try {
    const createRes = await apiPost("/bitable/v1/apps", {
      name: "自媒体平台评论统计",
    });
    console.log("  📋 表格已创建");
    return createRes.data?.data?.app;
  } catch (e) {
    const code = e.response?.data?.code;
    console.error(`  ⚠️  创建表格失败: ${code} ${e.response?.data?.msg}`);
    throw new Error("BOT_MISSING_PERMISSION");
  }
}

async function getOrCreateTable(bitableToken) {
  try {
    const listRes = await apiGet(`/bitable/v1/apps/${bitableToken}/tables`, { page_size: 50 });
    const data = listRes.data?.data || listRes.data;
    const tables = data?.items || data?.tables || [];
    const existing = tables.find((t) => t.name === "评论记录");
    if (existing) return existing;
  } catch (e) {
    const code = e.response?.data?.code;
    console.error(`  ⚠️  列出数据表失败: ${code || e.message}`);
    // 新表格可能还没有默认表，忽略列表失败
  }

  try {
    const createRes = await apiPost(`/bitable/v1/apps/${bitableToken}/tables`, {
      table: {
        name: "评论记录",
        fields: [
          { field_name: "平台", type: 1 },
          { field_name: "账号", type: 1 },
          { field_name: "关键词", type: 1 },
          { field_name: "评论内容", type: 1 },
          { field_name: "截图", type: 17 },
          { field_name: "视频链接", type: 15 },
          { field_name: "时间", type: 5 },
        ],
      },
    });
    // 兼容多种返回结构
    const respData = createRes.data?.data || createRes.data;
    const table = respData?.table || respData;
    if (table?.table_id || table?.name) return table;
    throw new Error("返回结构异常: " + JSON.stringify(respData).substring(0, 200));
  } catch (e) {
    console.error(`  ⚠️  创建数据表失败:`, e.message);
    throw e;
  }
}

async function uploadImage(filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("file_name", filePath.split("/").pop());
  form.append("parent_type", "bitable_file");
  form.append("parent_node", "bitable_file");
  form.append("size", String(fs.statSync(filePath).size));
  const res = await apiPostForm("/drive/v1/medias/upload_all", form);
  return res.data?.data?.file_token;
}

async function addRecord(bitableToken, tableId, record) {
  const fields = {};
  if (record.platform) fields["平台"] = record.platform;
  if (record.account) fields["账号"] = record.account;
  if (record.keyword) fields["关键词"] = record.keyword;
  if (record.comment) fields["评论内容"] = record.comment;
  if (record.videoUrl) {
    fields["视频链接"] = {
      link: record.videoUrl,
      text: record.videoTitle || record.videoUrl,
    };
  }
  fields["时间"] = new Date().getTime();

  if (record.screenshotPath && fs.existsSync(record.screenshotPath)) {
    try {
      const ft = await uploadImage(record.screenshotPath);
      fields["截图"] = [{ file_token: ft }];
    } catch (e) {
      console.error("  ⚠️  上传截图失败:", e.message);
    }
  }

  await apiPost(`/bitable/v1/apps/${bitableToken}/tables/${tableId}/records`, { fields });
}

module.exports = {
  getOrCreateBitable,
  getOrCreateTable,
  addRecord,
  sendDM,
  sendCard,
  OWNER_OPEN_ID,
};
