# B站自动回帖工具

多平台评论自动化工具 — 自动搜索视频、发表评论、截图存档到飞书多维表格。

## 功能

- 🔍 根据关键词搜索B站最新视频
- 💬 自动发表预设评论（评论池轮流使用）
- 📸 评论截图自动上传飞书
- 📊 飞书多维表格自动记录
- 🔔 飞书私信实时通知
- 👥 多账号轮换支持
- 🌐 Web 控制面板（`localhost:3456`）

## 前置要求

| 依赖 | 说明 |
|------|------|
| Node.js ≥ 16 | https://nodejs.org |
| Google Chrome | 用于浏览器自动化 |
| 飞书企业自建应用 | 多维表格 + 消息通知 |

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/Hankz123/auto-comment.git
cd auto-comment
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入飞书应用凭据：

```env
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_OWNER_OPEN_ID=ou_xxxxxxxxxxxxxxxx
```

> **获取飞书凭据：**
> 1. 打开 [飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用
> 2. 左侧「凭证与基础信息」→ 复制 App ID 和 App Secret
> 3. 左侧「权限管理」→ 搜索并开启：
>    - `bitable:app` — 多维表格
>    - `drive:drive` — 云文档（上传截图）
>    - `im:message` — 消息通知
> 4. 创建版本并发布应用
> 5. 获取你的 Open ID：[飞书用户 ID 查询](https://open.feishu.cn/api-explorer?apiName=user_id)

### 4. 启动

```bash
./start.sh
```

或者：

```bash
node server.js
```

打开浏览器访问 `http://localhost:3456`。

### 5. 使用

1. 添加账号 → 点击「登录」在人机验证窗口中手动登录B站
2. 填写搜索关键词（空格分隔多个）
3. 添加评论内容池
4. 设置评论间隔、切换间隔、任务总时长
5. 点击「开始执行」

## Windows 用户

```cmd
copy .env.example .env
:: 编辑 .env 填入凭据
:: 修改 .env 中的 CHROME_PATH 指向 Chrome 实际路径

npm install
node server.js
```

## 项目结构

```
bilibili-auto-reply/
├── server.js          # Express API 服务
├── browser.js         # Puppeteer 浏览器自动化
├── feishu.js          # 飞书多维表格 API
├── config.js          # 配置加载
├── .env.example       # 环境变量模板
├── public/
│   └── index.html     # Web 控制面板
├── chrome-profiles/   # Chrome 个人资料（自动生成）
├── screenshots/       # 截图保存（自动生成）
└── start.sh           # 启动脚本
```

## 飞书多维表格

自动创建「自媒体平台评论统计」多维表格，包含字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| 平台 | 文本 | bilibili / douyin / ... |
| 账号 | 文本 | 使用的账号名 |
| 关键词 | 文本 | 搜索关键词 |
| 评论内容 | 文本 | 发布的评论 |
| 截图 | 附件 | 评论截图 |
| 视频链接 | URL | 目标视频链接 |
| 时间 | 日期 | 操作时间 |

## License

MIT
