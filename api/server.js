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
      database: 'connected'
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

  // 2. 通知 Agent 系统（通过 OpenClaw Gateway）
  await notifyAgentSystem(contactId, contactData);

  // 3. 发送通知给销售团队
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