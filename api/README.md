# 安盾科技官网后端 API

这是安盾科技官网的后端 API 服务，用于处理客户联系表单、预约管理和邮件通知。

## 功能

1. **联系表单处理** - 接收客户提交的联系表单
2. **邮件通知** - 发送欢迎邮件给客户，通知销售团队
3. **预约管理** - 创建和管理客户预约
4. **Agent 通知** - 通过 OpenClaw Gateway 通知 AI Agent
5. **数据存储** - 使用 JSON 文件存储客户数据（无需数据库依赖）

## 快速开始

### 1. 安装依赖

```bash
cd api
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务端口
PORT=3001

# SMTP 邮件配置
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_FROM=noreply@andun.io

# 销售团队邮箱
SALES_EMAIL=sales@andun.io

# OpenClaw Gateway（Agent 通知）
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=ollama
```

### 3. 启动服务

```bash
npm start
```

开发模式（自动重载）：

```bash
npm run dev
```

### 4. 访问服务

- **API**: http://localhost:3001/api
- **管理后台**: http://localhost:3001/admin
- **健康检查**: http://localhost:3001/api/health

## API 接口

### 联系表单

```http
POST /api/contact
Content-Type: application/json

{
  "name": "张三",
  "email": "zhangsan@example.com",
  "phone": "13800138000",
  "service": "audit",
  "message": "我想了解 OpenClaw 安全审计服务"
}
```

响应：

```json
{
  "success": true,
  "contactId": 1,
  "message": "感谢您的咨询！我们已收到您的信息，工作人员将在24小时内与您联系。"
}
```

### 获取联系人列表

```http
GET /api/contacts?status=new&limit=50&offset=0
```

### 获取单个联系人

```http
GET /api/contacts/:id
```

### 更新联系人状态

```http
PATCH /api/contacts/:id
Content-Type: application/json

{
  "status": "contacted",
  "notes": "已电话联系，客户有意向"
}
```

### 创建预约

```http
POST /api/contacts/:id/appointments
Content-Type: application/json

{
  "scheduled_time": "2026-03-15T10:00:00",
  "duration_minutes": 60
}
```

### 获取统计

```http
GET /api/stats
```

## 数据流程

```
客户提交表单
    ↓
API 接收并保存
    ↓
├── 发送欢迎邮件给客户
├── 通知销售团队
└── 通知 AI Agent（通过 OpenClaw Gateway）
    ↓
Agent 收到通知
    ↓
Agent 处理：
├── 发送预约邮件
├── 添加到日程
└── 提醒销售跟进
```

## 工作流程

### 1. 新客户提交咨询

1. 客户在网站填写联系表单
2. API 保存客户信息到 `data/contacts.json`
3. 发送欢迎邮件给客户
4. 发送通知邮件给销售团队
5. 通过 OpenClaw Gateway 通知 AI Agent

### 2. Agent 收到通知

Agent 会收到类似以下消息：

```
🔔 新客户咨询 #1

姓名: 张三
邮箱: zhangsan@example.com
电话: 13800138000
服务: OpenClaw 安全审计
留言: 我想了解 OpenClaw 安全审计服务

请及时处理！
```

### 3. Agent 处理流程

Agent 可以：

1. **发送预约邮件** - 调用 `/api/contacts/:id/appointments` 创建预约
2. **添加日程** - 通过 OpenClaw 的日程管理功能
3. **更新状态** - 调用 `/api/contacts/:id` 更新处理状态

## 部署

### Vercel

1. 安装 Vercel CLI：

```bash
npm i -g vercel
```

2. 在 `api/` 目录运行：

```bash
vercel
```

### 自有服务器

使用 PM2 管理进程：

```bash
npm install -g pm2
pm2 start server-simple.js --name andun-api
```

### 配置 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name api.andun.io;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| PORT | 否 | 服务端口，默认 3001 |
| SMTP_HOST | 是* | SMTP 服务器地址 |
| SMTP_PORT | 否 | SMTP 端口，默认 587 |
| SMTP_USER | 是* | SMTP 用户名 |
| SMTP_PASS | 是* | SMTP 密码 |
| SMTP_FROM | 否 | 发件人邮箱 |
| SALES_EMAIL | 否 | 销售团队邮箱 |
| OPENCLAW_GATEWAY_URL | 否 | OpenClaw Gateway 地址 |
| OPENCLAW_GATEWAY_TOKEN | 否 | OpenClaw Gateway Token |

*邮件功能需要配置 SMTP

## 文件结构

```
api/
├── server-simple.js    # 主服务文件
├── package.json        # 依赖配置
├── .env.example        # 环境变量示例
├── README.md           # 本文档
├── admin/
│   └── index.html      # 管理后台
└── data/
    ├── contacts.json   # 联系人数据
    └── appointments.json # 预约数据
```

## 测试

### 测试联系表单

```bash
curl -X POST http://localhost:3001/api/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试用户",
    "email": "test@example.com",
    "phone": "13800138000",
    "service": "audit",
    "message": "这是一条测试消息"
  }'
```

### 测试健康检查

```bash
curl http://localhost:3001/api/health
```

## 许可证

© 2026 安盾科技 Andun Technology