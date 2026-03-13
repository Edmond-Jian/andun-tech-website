# 安盾科技官网

专业 AI 安全解决方案网站

## 公司信息

- **公司名称**: 安盾科技 (Andun Technology)
- **定位**: AI 安全解决方案专家
- **核心服务**: OpenClaw 安全审计、AI 配置审查、安全咨询

## 文件结构

```
website/
├── index.html    # 主页（含 AI 助手聊天组件）
├── style.css      # 样式文件
└── README.md      # 部署说明
```

## 功能特性

### 1. 响应式设计
- 支持桌面、平板、手机
- 现代化 UI 设计
- 流畅的动画效果

### 2. AI 助手聊天组件
- 右下角悬浮按钮
- 预设问答库（本地响应）
- **会话长度限制**: 每次对话最多 10 条消息
- 可扩展为真实 AI 后端 API

### 3. 联系表单
- 客户信息收集
- 本地存储（演示模式）
- 可接入后端 API

### 4. 品牌更新
- 专业名称: 安盾科技
- 盾牌图标 🛡️
- 主题色: 安全橙

## AI 助手配置

### 本地模式（默认）
网站使用预设问答库响应常见问题：
- OpenClaw 安全审计内容
- 数据安全保护方法
- 服务价格咨询

### 接入真实 AI 后端
修改 `index.html` 中的 `CONFIG` 对象：

```javascript
const CONFIG = {
    maxMessages: 10, // 会话长度限制
    apiEndpoint: '/api/chat', // AI API 端点
    contactFormEndpoint: '/api/contact' // 表单提交端点
};
```

### API 接口规范

**聊天 API**:
```
POST /api/chat
Content-Type: application/json

{
    "message": "用户消息",
    "context": "website_chat"
}

Response:
{
    "response": "AI 回复内容（HTML 格式）"
}
```

**表单提交 API**:
```
POST /api/contact
Content-Type: application/json

{
    "name": "客户姓名",
    "email": "邮箱",
    "phone": "电话（可选）",
    "service": "服务类型",
    "message": "留言内容",
    "timestamp": "ISO 时间戳"
}
```

## 部署方式

### 方式一：Netlify（推荐）

1. 访问 https://app.netlify.com
2. 拖拽 `website` 文件夹到页面
3. 等待部署完成，获取免费域名
4. 绑定自定义域名（如 andun.ai）

### 方式二：Vercel

```bash
# 安装 CLI
npm i -g vercel

# 在 website 目录运行
vercel
```

### 方式三：Cloudflare Pages

1. 访问 https://pages.cloudflare.com
2. 上传 `website` 目录
3. 配置自定义域名

### 方式四：自有服务器

```nginx
# Nginx 配置
server {
    listen 80;
    server_name andun.ai www.andun.ai;
    root /var/www/website;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    # API 代理（如需要）
    location /api/ {
        proxy_pass http://localhost:3000/api/;
    }
}
```

## 后续集成

### 1. 客户联系方式收集

当前使用 localStorage 存储联系表单数据。部署后需要：

1. 创建后端 API 接收表单数据
2. 发送邮件通知市场部门
3. 存储到数据库

示例 Node.js 代码：
```javascript
app.post('/api/contact', async (req, res) => {
    const { name, email, phone, service, message } = req.body;
    
    // 发送邮件给市场部门
    await sendEmail({
        to: 'marketing@andun.ai',
        subject: `新客户咨询: ${name}`,
        body: `
            姓名: ${name}
            邮箱: ${email}
            电话: ${phone}
            服务: ${service}
            留言: ${message}
        `
    });
    
    res.json({ success: true });
});
```

### 2. 真实 AI 后端

将 AI 助手连接到 OpenClaw Gateway：

```javascript
// 替换 CONFIG.apiEndpoint
const CONFIG = {
    maxMessages: 10,
    apiEndpoint: 'https://your-openclaw-gateway.com/api/chat',
    contactFormEndpoint: '/api/contact'
};

// 修改 getAIResponse 函数
async function getAIResponse(userMessage) {
    const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer YOUR_TOKEN'
        },
        body: JSON.stringify({
            message: userMessage,
            context: 'website_chat',
            max_tokens: 500 // 限制回复长度
        })
    });
    
    const data = await response.json();
    return data.response;
}
```

## 浏览器支持

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## 版本历史

- v1.0 - 初始版本，基础页面
- v1.1 - 添加 AI 助手聊天组件
- v1.2 - 公司更名（小龙虾工作室 → 安盾科技）
- v1.2 - 添加会话长度限制（10 条）
- v1.2 - 添加联系方式收集功能

---

© 2026 安盾科技 Andun Technology