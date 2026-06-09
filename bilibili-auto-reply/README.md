# B站自动回帖工具

多平台评论自动化工具。

## 架构

```
bilibili-auto-reply/
├── server.js          # Express API 服务 (端口 3456)
├── browser.js         # Playwright 浏览器自动化
├── feishu.js          # 飞书多维表格 API
├── public/
│   └── index.html     # Web 控制台
├── chrome-profiles/   # Chrome 个人资料目录（自动创建）
├── screenshots/       # 截图保存目录（自动创建）
├── start.sh           # 启动脚本
└── package.json
```

## 工作流程

```
┌─────────────────────────┐
│  HTML 控制台 (Canvas)    │
│  - 平台/账号/关键词/评论  │
└──────────┬──────────────┘
           │ POST /api/start
           ▼
┌─────────────────────────┐
│  server.js               │
│  - 接收配置               │
│  - 调度执行               │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  browser.js (Playwright) │
│  - Chrome Profile 管理    │
│  - B站搜索 + 评论 + 截图  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  feishu.js               │
│  - 多维表格创建/记录       │
│  - 截图上传               │
└─────────────────────────┘
```

## 启动

```bash
cd ~/.openclaw/workspace/bilibili-auto-reply
./start.sh
```

## 访问地址

- **Express 控制台**: http://localhost:3456
- **Canvas 控制台**: http://127.0.0.1:18789/__openclaw__/canvas/bilibili-auto-reply.html

## 使用说明

1. 添加账号（每个账号对应独立Chrome个人资料）
2. 填写关键词（空格分隔多个）
3. 添加评论内容池
4. 设置间隔时间
5. 点击「开始执行」

首次使用需要在弹出的Chrome中手动登录B站账号。

## Chrome 个人资料位置

```
chrome-profiles/<账号名>/
```

删除目录即可重置某个账号。

## 飞书多维表格

自动创建《自媒体平台评论统计》多维表格，包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| 平台 | 文本 | bilibili / douyin / ... |
| 账号 | 文本 | 使用的账号名 |
| 关键词 | 文本 | 搜索关键词 |
| 评论内容 | 文本 | 发布的评论 |
| 截图 | 附件 | 评论截图 |
| 视频链接 | URL | 目标视频链接 |
| 时间 | 日期 | 操作时间 |

Bot 需要表格共享权限才能写入。
