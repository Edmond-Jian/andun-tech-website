/**
 * 安盾科技官网后端 API
 * 
 * 功能：
 * 1. 接收客户联系方式
 * 2. 发送邮件通知
 * 3. 存储到数据库
 * 4. 通知 Agent 系统
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 数据库初始化
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'contacts.db');
const db = new Database(dbPath);

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT,
    message TEXT,
    status TEXT DEFAULT 'new',
    assigned_to TEXT,
    appointment_time TEXT,
    appointment_confirmed INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    scheduled_time TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    status TEXT DEFAULT 'pending',
    calendar_event_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
  );

  CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,
    email_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
  );
`);

// 邮件配置
let emailTransporter = null;

function initEmailTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('📧 Email transporter initialized');
  } else {
    console.log('⚠️  Email transporter not configured (missing SMTP settings)');
  }
}

initEmailTransporter();

// OpenClaw Gateway 配置
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'ollama';

// Paperclip 配置
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY;
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;

// ==================== API 路由 ====================

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      email: emailTransporter ? 'configured' : 'not_configured',
      database: 'connected',
      paperclip: PAPERCLIP_API_KEY ? 'configured' : 'not_configured'
    }
  });
});

/**
 * 接收联系表单
 * POST /api/contact
 */
app.post('/api/contact', async (req, res) => {
  const { name, email, phone, service, message } = req.body;

  // 验证必填字段
  if (!name || !email) {
    return res.status(400).json({
      success: false,
      error: '姓名和邮箱为必填项'
    });
  }

  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: '请提供有效的邮箱地址'
    });
  }

  try {
    // 保存到数据库
    const stmt = db.prepare(`
      INSERT INTO contacts (name, email, phone, service, message, status)
      VALUES (?, ?, ?, ?, ?, 'new')
    `);
    const result = stmt.run(name, email, phone || null, service || 'other', message || null);
    const contactId = result.lastInsertRowid;

    console.log(`📥 New contact: ${name} <${email}> [ID: ${contactId}]`);

    // 异步处理后续操作（不阻塞响应）
    processNewContact(contactId, { name, email, phone, service, message }).catch(err => {
      console.error('Error processing new contact:', err);
    });

    // 立即返回成功响应
    res.json({
      success: true,
      contactId,
      message: '感谢您的咨询！我们已收到您的信息，工作人员将在24小时内与您联系。'
    });

  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({
      success: false,
      error: '保存信息时出错，请稍后重试'
    });
  }
});

/**
 * 获取联系人列表
 * GET /api/contacts
 */
app.get('/api/contacts', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  let sql = 'SELECT * FROM contacts';
  const params = [];

  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const contacts = db.prepare(sql).all(...params);
  res.json({ success: true, contacts });
});

/**
 * 获取单个联系人
 * GET /api/contacts/:id
 */
app.get('/api/contacts/:id', (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);

  if (!contact) {
    return res.status(404).json({ success: false, error: '联系人不存在' });
  }

  // 获取相关的预约记录
  const appointments = db.prepare('SELECT * FROM appointments WHERE contact_id = ?').all(req.params.id);

  res.json({ success: true, contact, appointments });
});

/**
 * 更新联系人状态
 * PATCH /api/contacts/:id
 */
app.patch('/api/contacts/:id', (req, res) => {
  const { status, assigned_to, notes } = req.body;
  const id = req.params.id;

  const updates = [];
  const params = [];

  if (status) {
    updates.push('status = ?');
    params.push(status);
  }
  if (assigned_to) {
    updates.push('assigned_to = ?');
    params.push(assigned_to);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    params.push(notes);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, error: '没有要更新的字段' });
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  const sql = `UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  res.json({ success: true, contact });
});

/**
 * 创建预约
 * POST /api/contacts/:id/appointments
 */
app.post('/api/contacts/:id/appointments', async (req, res) => {
  const contactId = req.params.id;
  const { scheduled_time, duration_minutes = 60 } = req.body;

  if (!scheduled_time) {
    return res.status(400).json({ success: false, error: '请提供预约时间' });
  }

  // 检查联系人是否存在
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (!contact) {
    return res.status(404).json({ success: false, error: '联系人不存在' });
  }

  // 创建预约记录
  const stmt = db.prepare(`
    INSERT INTO appointments (contact_id, scheduled_time, duration_minutes, status)
    VALUES (?, ?, ?, 'pending')
  `);
  const result = stmt.run(contactId, scheduled_time, duration_minutes);
  const appointmentId = result.lastInsertRowid;

  // 更新联系人状态
  db.prepare("UPDATE contacts SET status = 'scheduled', updated_at = datetime('now') WHERE id = ?").run(contactId);

  console.log(`📅 Appointment created: Contact ${contactId} at ${scheduled_time}`);

  res.json({
    success: true,
    appointmentId,
    message: '预约创建成功'
  });
});

/**
 * 发送预约确认邮件
 * POST /api/contacts/:id/send-confirmation
 */
app.post('/api/contacts/:id/send-confirmation', async (req, res) => {
  const contactId = req.params.id;
  const { scheduled_time } = req.body;

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (!contact) {
    return res.status(404).json({ success: false, error: '联系人不存在' });
  }

  try {
    await sendAppointmentEmail(contact, scheduled_time);
    res.json({ success: true, message: '确认邮件已发送' });
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    res.status(500).json({ success: false, error: '发送邮件失败' });
  }
});

// ==================== 内部函数 ====================

/**
 * 处理新的联系表单提交
 */
async function processNewContact(contactId, contactData) {
  const { name, email, phone, service, message } = contactData;

  // 1. 发送确认邮件给客户
  if (emailTransporter) {
    try {
      await sendWelcomeEmail(contactData);
      console.log(`✅ Welcome email sent to ${email}`);

      // 记录邮件发送
      db.prepare(`
        INSERT INTO email_logs (contact_id, email_type, recipient, subject, status, sent_at)
        VALUES (?, 'welcome', ?, '感谢您的咨询 - 安盾科技', 'sent', datetime('now'))
      `).run(contactId, email);
    } catch (error) {
      console.error(`❌ Failed to send welcome email: ${error.message}`);

      // 记录失败
      db.prepare(`
        INSERT INTO email_logs (contact_id, email_type, recipient, subject, status, error_message)
        VALUES (?, 'welcome', ?, '感谢您的咨询 - 安盾科技', 'failed', ?)
      `).run(contactId, email, error.message);
    }
  }

  // 2. 在 Paperclip 中创建工单
  await createPaperclipTicket(contactId, contactData);

  // 3. 通知 Agent 系统（通过 OpenClaw Gateway）
  await notifyAgentSystem(contactId, contactData);

  // 4. 发送通知给销售团队
  await notifySalesTeam(contactId, contactData);
}

/**
 * 发送欢迎邮件给客户
 */
async function sendWelcomeEmail(contactData) {
  const { name, email, phone, service, message } = contactData;

  const serviceNames = {
    'audit': 'OpenClaw 安全审计',
    'review': 'AI 配置审查',
    'consulting': '安全咨询',
    'other': '其他咨询'
  };

  const serviceName = serviceNames[service] || '咨询服务';

  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@andun.io',
    to: email,
    subject: '感谢您的咨询 - 安盾科技',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛡️ 安盾科技</h1>
            <p>AI 安全解决方案专家</p>
          </div>
          <div class="content">
            <p>尊敬的 <strong>${name}</strong> 您好！</p>
            <p>感谢您选择安盾科技。我们已收到您的咨询请求，我们的工作人员将在 24 小时内与您联系。</p>
            
            <div class="info-box">
              <h3>您的咨询信息</h3>
              <p><strong>服务类型：</strong>${serviceName}</p>
              ${phone ? `<p><strong>联系电话：</strong>${phone}</p>` : ''}
              ${message ? `<p><strong>留言内容：</strong>${message}</p>` : ''}
            </div>

            <p>如有紧急需求，您可以直接联系我们：</p>
            <ul>
              <li>📧 邮箱：contact@andun.io</li>
              <li>💬 Discord：https://discord.com/invite/clawd</li>
            </ul>

            <p>期待为您提供专业的 AI 安全服务！</p>
            
            <div class="footer">
              <p>© 2026 安盾科技 Andun Technology</p>
              <p>专业 · 可靠 · 创新</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  return emailTransporter.sendMail(mailOptions);
}

/**
 * 发送预约确认邮件
 */
async function sendAppointmentEmail(contact, scheduledTime) {
  const formattedTime = new Date(scheduledTime).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@andun.io',
    to: contact.email,
    subject: '预约确认 - 安盾科技',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .appointment-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
          .footer { text-align: center; color: #666; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛡️ 预约确认</h1>
          </div>
          <div class="content">
            <p>尊敬的 <strong>${contact.name}</strong> 您好！</p>
            <p>您的预约已确认，我们期待与您的沟通！</p>
            
            <div class="appointment-box">
              <h3>📅 预约详情</h3>
              <p><strong>时间：</strong>${formattedTime}</p>
              <p><strong>服务：</strong>${getServiceName(contact.service)}</p>
              <p><strong>方式：</strong>在线会议（会议链接将在预约前发送）</p>
            </div>

            <p>如需更改预约时间，请回复此邮件或联系我们的客服。</p>
            
            <div class="footer">
              <p>© 2026 安盾科技 Andun Technology</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  };

  return emailTransporter.sendMail(mailOptions);
}

function getServiceName(service) {
  const names = {
    'audit': 'OpenClaw 安全审计',
    'review': 'AI 配置审查',
    'consulting': '安全咨询',
    'other': '咨询服务'
  };
  return names[service] || '咨询服务';
}

/**
 * 通知 Agent 系统
 */
async function notifyAgentSystem(contactId, contactData) {
  try {
    // 使用 fetch 通知 OpenClaw Gateway
    const response = await fetch(`${OPENCLAW_GATEWAY_URL}/api/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`
      },
      body: JSON.stringify({
        channel: 'webchat',
        message: `🔔 新客户咨询\n\n姓名: ${contactData.name}\n邮箱: ${contactData.email}\n${contactData.phone ? '电话: ' + contactData.phone + '\n' : ''}服务: ${getServiceName(contactData.service)}\n${contactData.message ? '留言: ' + contactData.message : ''}\n\n请及时处理！`
      })
    });

    if (response.ok) {
      console.log(`✅ Agent notified for contact ${contactId}`);
    } else {
      console.log(`⚠️  Agent notification failed: ${response.status}`);
    }
  } catch (error) {
    // 如果 OpenClaw Gateway 不可用，记录但继续处理
    console.log(`⚠️  Agent notification skipped: ${error.message}`);
  }
}

/**
 * 在 Paperclip 中创建工单
 */
async function createPaperclipTicket(contactId, contactData) {
  // 检查 Paperclip 配置
  if (!PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
    console.log('⚠️  Paperclip ticket creation skipped (not configured)');
    return null;
  }

  const { name, email, phone, service, message } = contactData;
  const serviceName = getServiceName(service);

  try {
    const response = await fetch(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAPERCLIP_API_KEY}`
      },
      body: JSON.stringify({
        title: `新客户咨询 - ${name}`,
        description: `## 客户信息\n\n- **姓名**: ${name}\n- **邮箱**: ${email}\n${phone ? `- **电话**: ${phone}\n` : ''}- **服务类型**: ${serviceName}\n${message ? `\n**留言**: ${message}\n` : ''}\n---\n\n**来源**: 官网联系表单\n**Contact ID**: #${contactId}`,
        priority: 'medium',
        status: 'todo'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Paperclip ticket creation failed: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    console.log(`✅ Paperclip ticket created: ${result.identifier || result.id} for contact ${contactId}`);
    return result;
  } catch (error) {
    console.error(`❌ Paperclip ticket creation error: ${error.message}`);
    return null;
  }
}

/**
 * 通知销售团队
 */
async function notifySalesTeam(contactId, contactData) {
  if (!emailTransporter) {
    console.log('⚠️  Sales notification skipped (email not configured)');
    return;
  }

  const salesEmail = process.env.SALES_EMAIL || 'sales@andun.io';

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@andun.io',
      to: salesEmail,
      subject: `🔔 新客户咨询 #${contactId} - ${contactData.name}`,
      html: `
        <h2>新客户咨询</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>ID</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contactId}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>姓名</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contactData.name}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>邮箱</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contactData.email}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>电话</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contactData.phone || '未提供'}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>服务</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${getServiceName(contactData.service)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>留言</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contactData.message || '无'}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>时间</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${new Date().toLocaleString('zh-CN')}</td></tr>
        </table>
        <p style="margin-top: 20px;">
          <a href="${process.env.ADMIN_URL || 'http://localhost:3001'}/admin/contacts/${contactId}" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">查看详情</a>
        </p>
      `
    });
    console.log(`✅ Sales team notified: ${salesEmail}`);
  } catch (error) {
    console.error(`❌ Sales notification failed: ${error.message}`);
  }
}

// ==================== 管理接口 ====================

/**
 * 获取统计数据
 */
app.get('/api/stats', (req, res) => {
  const totalContacts = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
  const newContacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'new'").get().count;
  const scheduledContacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'scheduled'").get().count;
  const completedContacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'completed'").get().count;

  res.json({
    success: true,
    stats: {
      total: totalContacts,
      new: newContacts,
      scheduled: scheduledContacts,
      completed: completedContacts
    }
  });
});

// ==================== AI 聊天 API ====================

/**
 * 产品知识库
 */
const PRODUCT_KNOWLEDGE = {
  services: [
    {
      id: 'token-optimization',
      name: 'Token 成本优化',
      price: '¥3,000 起',
      description: '分析 AI 系统 Token 消耗模式，识别成本黑洞，提供针对性优化方案',
      features: ['Token 消耗分析报告', '成本优化建议', '配置调优方案', '持续监控指导'],
      benefits: ['节省高达 50% 的 AI 成本', '优化后成本降幅 < 20% 全额退款'],
      targetCustomers: 'AI Token 消耗大的企业、使用 AI 助手的团队',
      commonQuestions: {
        '效果': '平均客户节省 30-60% Token 成本',
        '时间': '1-2 周完成分析和优化方案',
        '退款': '优化后成本降幅 < 20% 全额退款'
      }
    },
    {
      id: 'openclaw-audit',
      name: 'OpenClaw 安全审计',
      price: '¥5,000 - ¥8,000',
      description: '深度检测 OpenClaw 配置漏洞，识别潜在安全风险，提供详细修复建议',
      features: ['配置文件安全审查', '工具权限最小化检查', '敏感信息泄露检测', '详细修复报告'],
      benefits: ['识别配置漏洞', '防止数据泄露', '满足合规要求'],
      targetCustomers: '使用 OpenClaw 的企业、需要 AI 安全审计的公司',
      commonQuestions: {
        '时间': '3-5 个工作日完成审计报告',
        '内容': '包括配置审查、权限检查、漏洞检测和修复建议',
        '后续': '提供 30 天免费咨询服务'
      }
    },
    {
      id: 'ai-config-review',
      name: 'AI 配置审查',
      price: '¥3,000 - ¥5,000',
      description: '全面审查 AI 系统配置，确保工具权限、数据访问、敏感信息处理符合安全标准',
      features: ['AI工具权限审计', '数据流安全分析', '合规性检查', '优化建议报告'],
      benefits: ['最小权限配置', '数据安全保护', '性能优化'],
      targetCustomers: '使用各种 AI 工具的企业、需要配置优化的团队',
      commonQuestions: {
        '范围': '支持 OpenClaw、Cursor、Copilot 等主流 AI 工具',
        '时间': '2-3 个工作日完成审查报告',
        '价值': '帮助发现潜在安全风险和性能问题'
      }
    },
    {
      id: 'security-consulting',
      name: '安全咨询',
      price: '¥500/小时',
      description: '一对一安全咨询，解答 AI 安全相关问题，提供定制化解决方案',
      features: ['实时在线解答', '安全架构建议', '风险评估', '定制解决方案'],
      benefits: ['快速获得专业建议', '定制化解决方案', '灵活的时间安排'],
      targetCustomers: '有特定安全问题的企业、需要快速咨询的团队',
      commonQuestions: {
        '方式': '在线会议或电话咨询',
        '时间': '按需预约，最快当天响应',
        '范围': 'AI 安全、数据隐私、配置优化等'
      }
    }
  ],
  packages: [
    {
      id: 'startup',
      name: '创业套餐',
      price: '¥15,000',
      description: '适合个人创业者和初创企业',
      includes: ['OpenClaw 安全审计 x2次', 'AI 配置审查 x2次', '安全咨询 x2小时', '季度安全报告', '邮件支持']
    },
    {
      id: 'growth',
      name: '成长套餐',
      price: '¥35,000',
      description: '适合小型企业，提供全面安全服务',
      includes: ['OpenClaw 安全审计 x5次', 'AI 配置审查 x5次', '安全咨询 x10小时', '月度安全报告', '专属技术支持', '紧急响应服务']
    }
  ],
  company: {
    name: '安盾科技',
    description: '专注于 AI 安全领域，致力于为企业提供专业、可靠的 AI 安全解决方案',
    contact: {
      email: 'contact@andun.io',
      discord: 'https://discord.com/invite/clawd',
      hours: '周一至周五 9:00 - 18:00'
    }
  }
};

/**
 * 会话状态管理（内存存储，生产环境应使用数据库）
 */
const chatSessions = new Map();

/**
 * 生成 AI 回复
 */
function generateAIResponse(userMessage, sessionContext) {
  const lowerMessage = userMessage.toLowerCase();
  
  // 1. 检测联系方式
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phonePattern = /1[3-9]\d{9}/;
  const wechatPattern = /微信|wechat|wx/i;
  
  const email = userMessage.match(emailPattern);
  const phone = userMessage.match(phonePattern);
  
  if (email || phone || wechatPattern.test(userMessage)) {
    let contactInfo = '';
    if (email) contactInfo += `邮箱：${email[0]}\n`;
    if (phone) contactInfo += `电话：${phone[0]}\n`;
    
    return {
      response: `感谢您留下联系方式！\n\n${contactInfo}\n我们的安全专家将在 24 小时内与您联系，为您提供专业的咨询服务。\n\n如有其他问题，欢迎随时咨询！`,
      hasContact: true,
      contactInfo: { email: email?.[0], phone: phone?.[0] }
    };
  }
  
  // 2. 产品相关问答
  if (lowerMessage.includes('价格') || lowerMessage.includes('多少钱') || lowerMessage.includes('收费')) {
    return {
      response: `📋 **服务价格一览**\n\n**单项服务：**\n• 🔐 OpenClaw 安全审计：¥5,000 - ¥8,000\n• ⚙️ AI 配置审查：¥3,000 - ¥5,000\n• 💰 Token 成本优化：¥3,000 起\n• 💡 安全咨询：¥500/小时\n\n**套餐方案：**\n• 🚀 创业套餐：¥15,000（含审计+审查+咨询）\n• 🏢 成长套餐：¥35,000（全面安全服务）\n\n首次咨询可享受 8 折优惠！您对哪个服务感兴趣？`
    };
  }
  
  if (lowerMessage.includes('openclaw') || lowerMessage.includes('安全审计')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'openclaw-audit');
    return {
      response: `🔐 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**适合客户：**${service.targetCustomers}\n\n**常见问题：**\n• 审计周期：${service.commonQuestions['时间']}\n• 报告内容：${service.commonQuestions['内容']}\n\n需要预约咨询吗？留下您的联系方式，我们会有专人与您沟通。`
    };
  }
  
  if (lowerMessage.includes('配置审查') || lowerMessage.includes('配置优化')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'ai-config-review');
    return {
      response: `⚙️ **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**支持的 AI 工具：**\n• OpenClaw\n• Cursor\n• GitHub Copilot\n• 其他主流 AI 助手\n\n**交付时间：**${service.commonQuestions['时间']}\n\n需要了解更多吗？留下您的联系方式，我们会为您详细解答。`
    };
  }
  
  if (lowerMessage.includes('token') || lowerMessage.includes('成本') || lowerMessage.includes('节省')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'token-optimization');
    return {
      response: `💰 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**为什么选择我们：**\n${service.benefits.map(b => '• ' + b).join('\n')}\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**效果保障：**${service.commonQuestions['退款']}\n\n很多客户发现 AI 助手一天 Token 消耗数百美元，经我们优化后成本平均降低 30-60%。需要预约分析吗？`
    };
  }
  
  if (lowerMessage.includes('咨询') || lowerMessage.includes('问答') || lowerMessage.includes('建议')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'security-consulting');
    return {
      response: `💡 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**咨询范围：**\n${service.commonQuestions['范围']}\n\n**咨询方式：**${service.commonQuestions['方式']}\n**响应时间：**${service.commonQuestions['时间']}\n\n您有什么具体问题需要咨询？可以直接描述，或者留下联系方式预约咨询时间。`
    };
  }
  
  if (lowerMessage.includes('套餐') || lowerMessage.includes('创业') || lowerMessage.includes('成长') || lowerMessage.includes('小企业')) {
    return {
      response: `📦 **套餐方案**\n\n**🚀 创业套餐 - ¥15,000**\n适合：个人创业者、初创企业\n包含：\n• OpenClaw 安全审计 x2次\n• AI 配置审查 x2次\n• 安全咨询 x2小时\n• 季度安全报告\n• 邮件支持\n\n**🏢 成长套餐 - ¥35,000**\n适合：小型企业\n包含：\n• OpenClaw 安全审计 x5次\n• AI 配置审查 x5次\n• 安全咨询 x10小时\n• 月度安全报告\n• 专属技术支持\n• 紧急响应服务\n\n您是企业还是个人使用？我可以帮您推荐最合适的方案。`
    };
  }
  
  // 3. 数据安全问题
  if (lowerMessage.includes('数据') && (lowerMessage.includes('安全') || lowerMessage.includes('保护'))) {
    return {
      response: `🔒 **AI 系统数据安全保障**\n\n保护 AI 系统数据安全的关键措施：\n\n**1. 最小权限原则**\n只授予 AI 工具必要的权限，避免过度授权\n\n**2. 敏感信息过滤**\n自动识别和标记敏感内容，防止泄露\n\n**3. 数据访问控制**\n限制 AI 访问敏感文件和目录\n\n**4. 审计日志**\n记录 AI 的所有操作，可追溯可审计\n\n**5. 定期安全审计**\n定期检查配置变更和安全漏洞\n\n我们可以帮您进行 AI 配置审查（¥3,000 - ¥5,000），确保您的 AI 系统符合安全标准。需要预约吗？`
    };
  }
  
  // 4. 公司信息
  if (lowerMessage.includes('公司') || lowerMessage.includes('关于') || lowerMessage.includes('介绍')) {
    return {
      response: `🛡️ **关于安盾科技**\n\n${PRODUCT_KNOWLEDGE.company.description}\n\n**核心服务：**\n• OpenClaw 安全审计\n• AI 配置审查\n• Token 成本优化\n• 安全咨询\n\n**为什么选择我们：**\n• 专业团队，深耕 AI 安全领域\n• 严格保密，确保客户数据安全\n• 24小时响应，快速交付\n\n**联系方式：**\n• 📧 邮箱：${PRODUCT_KNOWLEDGE.company.contact.email}\n• 💬 Discord：${PRODUCT_KNOWLEDGE.company.contact.discord}\n• ⏰ 工作时间：${PRODUCT_KNOWLEDGE.company.contact.hours}\n\n有什么可以帮您的？`
    };
  }
  
  // 5. 预约/联系方式
  if (lowerMessage.includes('预约') || lowerMessage.includes('联系') || lowerMessage.includes('咨询')) {
    return {
      response: `📅 **预约咨询**\n\n您可以通过以下方式联系我们：\n\n• 📧 邮箱：contact@andun.io\n• 💬 Discord：https://discord.com/invite/clawd\n• 📞 电话：留下您的号码，我们会回拨\n\n**工作时间：** 周一至周五 9:00 - 18:00\n\n**快速咨询：**\n直接在此留下您的联系方式（邮箱/电话），我们的安全专家会在 24 小时内与您联系。\n\n请问您想咨询哪个服务？`
    };
  }
  
  // 6. 默认回复（引导式）
  const remainingMessages = CONFIG.maxMessages - (sessionContext?.messageCount || 0) - 1;
  
  return {
    response: `感谢您的提问！\n\n我是安盾 AI 助手，可以帮您：\n\n**🔍 了解服务：**\n• 问"OpenClaw 审计内容"了解安全审计\n• 问"价格"查看所有服务价格\n• 问"Token 优化"了解成本优化服务\n\n**📝 留下联系方式：**\n直接发送您的邮箱或电话，我们会联系您\n\n**💡 快速咨询：**\n描述您的问题，我会尽力解答\n\n${remainingMessages > 0 ? `（您还有 ${remainingMessages} 条对话机会）` : ''}\n\n您想了解哪方面的内容？`
  };
}

/**
 * AI 聊天接口
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, context } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '请输入您的问题'
    });
  }

  // 创建或获取会话
  const sid = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (!chatSessions.has(sid)) {
    chatSessions.set(sid, {
      messageCount: 0,
      createdAt: new Date(),
      messages: []
    });
  }
  
  const session = chatSessions.get(sid);
  
  // 检查消息限制
  if (session.messageCount >= CONFIG.maxMessages) {
    return res.json({
      success: true,
      response: `您已达到对话次数限制（${CONFIG.maxMessages} 条）。\n\n请留下您的联系方式（邮箱或电话），我们的安全专家会与您详细沟通，为您提供专业建议。\n\n📧 邮箱：contact@andun.io\n💬 Discord：https://discord.com/invite/clawd`,
      sessionId: sid,
      limitReached: true,
      remainingMessages: 0
    });
  }
  
  // 记录用户消息
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });
  session.messageCount++;
  
  // 生成回复
  const aiResult = generateAIResponse(message, session);
  
  // 记录助手回复
  session.messages.push({ role: 'assistant', content: aiResult.response, timestamp: new Date() });
  session.lastActivity = new Date();
  
  // 如果包含联系方式，保存到数据库
  if (aiResult.hasContact) {
    try {
      const contactStmt = db.prepare(`
        INSERT INTO contacts (name, email, phone, service, message, status)
        VALUES (?, ?, ?, ?, ?, 'new')
      `);
      const result = contactStmt.run(
        '网站访客',
        aiResult.contactInfo.email || '',
        aiResult.contactInfo.phone || '',
        'chat',
        message
      );
      console.log(`📞 Chat contact saved: ID ${result.lastInsertRowid}`);
      
      // 异步处理后续操作
      processNewContact(result.lastInsertRowid, {
        name: '网站访客',
        email: aiResult.contactInfo.email || '',
        phone: aiResult.contactInfo.phone || '',
        service: 'other',
        message: message
      }).catch(err => console.error('Error processing chat contact:', err));
    } catch (error) {
      console.error('Error saving chat contact:', error);
    }
  }
  
  // 清理过期会话（保留 30 分钟）
  const now = Date.now();
  for (const [key, value] of chatSessions.entries()) {
    if (now - new Date(value.lastActivity || value.createdAt).getTime() > 30 * 60 * 1000) {
      chatSessions.delete(key);
    }
  }
  
  res.json({
    success: true,
    response: aiResult.response,
    sessionId: sid,
    remainingMessages: CONFIG.maxMessages - session.messageCount
  });
});

/**
 * 获取聊天会话状态
 * GET /api/chat/session/:sessionId
 */
app.get('/api/chat/session/:sessionId', (req, res) => {
  const session = chatSessions.get(req.params.sessionId);
  
  if (!session) {
    return res.json({
      success: true,
      exists: false,
      messageCount: 0,
      remainingMessages: CONFIG.maxMessages
    });
  }
  
  res.json({
    success: true,
    exists: true,
    messageCount: session.messageCount,
    remainingMessages: CONFIG.maxMessages - session.messageCount
  });
});

// ==================== 启动服务器 ====================

app.listen(PORT, () => {
  console.log(`🛡️  安盾科技官网 API 服务已启动`);
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`🔗 API 地址: http://localhost:${PORT}/api`);
  console.log(`📧 邮件服务: ${emailTransporter ? '已配置' : '未配置'}`);
  console.log(`🤖 Agent 通知: ${OPENCLAW_GATEWAY_URL}`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  db.close();
  process.exit(0);
});

module.exports = app;