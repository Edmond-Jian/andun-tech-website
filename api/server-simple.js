/**
 * 安盾科技官网后端 API（简化版 - 无需原生依赖）
 * 
 * 功能：
 * 1. 接收客户联系方式
 * 2. 发送邮件通知
 * 3. 存储到 JSON 文件
 * 4. 通知 Agent 系统
 * 
 * 使用方法：
 * 1. 复制 .env.example 为 .env 并配置
 * 2. npm install
 * 3. npm start
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件（管理后台）
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// 数据目录
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 数据存储函数
function loadData(filePath, defaultValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error loading ${filePath}:`, error);
    }
    return defaultValue;
}

function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

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
        console.log('⚠️  Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env to enable email');
    }
}

initEmailTransporter();

// OpenClaw Gateway 配置
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'ollama';

// Discord 通知配置
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

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
            database: 'json_file'
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
        // 加载现有数据
        const contacts = loadData(CONTACTS_FILE);
        
        // 创建新联系人
        const newContact = {
            id: contacts.length > 0 ? Math.max(...contacts.map(c => c.id)) + 1 : 1,
            name,
            email,
            phone: phone || null,
            service: service || 'other',
            message: message || null,
            status: 'new',
            assigned_to: null,
            appointment_time: null,
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        contacts.unshift(newContact); // 新记录放前面
        saveData(CONTACTS_FILE, contacts);
        
        const contactId = newContact.id;

        console.log(`📥 New contact: ${name} <${email}> [ID: ${contactId}]`);

        // 异步处理后续操作（不阻塞响应）
        processNewContact(contactId, newContact).catch(err => {
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

    let contacts = loadData(CONTACTS_FILE);

    if (status) {
        contacts = contacts.filter(c => c.status === status);
    }

    const paginatedContacts = contacts.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({ success: true, contacts: paginatedContacts, total: contacts.length });
});

/**
 * 获取单个联系人
 * GET /api/contacts/:id
 */
app.get('/api/contacts/:id', (req, res) => {
    const contacts = loadData(CONTACTS_FILE);
    const contact = contacts.find(c => c.id === parseInt(req.params.id));

    if (!contact) {
        return res.status(404).json({ success: false, error: '联系人不存在' });
    }

    // 获取相关的预约记录
    const appointments = loadData(APPOINTMENTS_FILE);
    const contactAppointments = appointments.filter(a => a.contact_id === contact.id);

    res.json({ success: true, contact, appointments: contactAppointments });
});

/**
 * 更新联系人状态
 * PATCH /api/contacts/:id
 */
app.patch('/api/contacts/:id', (req, res) => {
    const { status, assigned_to, notes } = req.body;
    const id = parseInt(req.params.id);
    
    const contacts = loadData(CONTACTS_FILE);
    const index = contacts.findIndex(c => c.id === id);

    if (index === -1) {
        return res.status(404).json({ success: false, error: '联系人不存在' });
    }

    if (status) contacts[index].status = status;
    if (assigned_to) contacts[index].assigned_to = assigned_to;
    if (notes !== undefined) contacts[index].notes = notes;
    contacts[index].updated_at = new Date().toISOString();

    saveData(CONTACTS_FILE, contacts);

    res.json({ success: true, contact: contacts[index] });
});

/**
 * 创建预约
 * POST /api/contacts/:id/appointments
 */
app.post('/api/contacts/:id/appointments', async (req, res) => {
    const contactId = parseInt(req.params.id);
    const { scheduled_time, duration_minutes = 60 } = req.body;

    if (!scheduled_time) {
        return res.status(400).json({ success: false, error: '请提供预约时间' });
    }

    const contacts = loadData(CONTACTS_FILE);
    const contact = contacts.find(c => c.id === contactId);
    
    if (!contact) {
        return res.status(404).json({ success: false, error: '联系人不存在' });
    }

    // 创建预约记录
    const appointments = loadData(APPOINTMENTS_FILE);
    const newAppointment = {
        id: appointments.length > 0 ? Math.max(...appointments.map(a => a.id)) + 1 : 1,
        contact_id: contactId,
        scheduled_time: scheduled_time,
        duration_minutes: duration_minutes,
        status: 'pending',
        calendar_event_id: null,
        created_at: new Date().toISOString()
    };
    appointments.push(newAppointment);
    saveData(APPOINTMENTS_FILE, appointments);

    // 更新联系人状态
    const contactIndex = contacts.findIndex(c => c.id === contactId);
    contacts[contactIndex].status = 'scheduled';
    contacts[contactIndex].appointment_time = scheduled_time;
    contacts[contactIndex].updated_at = new Date().toISOString();
    saveData(CONTACTS_FILE, contacts);

    console.log(`📅 Appointment created: Contact ${contactId} at ${scheduled_time}`);

    // 发送预约确认邮件
    if (emailTransporter) {
        sendAppointmentEmail(contact, scheduled_time).catch(err => {
            console.error('Error sending appointment email:', err);
        });
    }

    res.json({
        success: true,
        appointmentId: newAppointment.id,
        message: '预约创建成功'
    });
});

/**
 * 获取统计数据
 */
app.get('/api/stats', (req, res) => {
    const contacts = loadData(CONTACTS_FILE);

    const stats = {
        total: contacts.length,
        new: contacts.filter(c => c.status === 'new').length,
        scheduled: contacts.filter(c => c.status === 'scheduled').length,
        completed: contacts.filter(c => c.status === 'completed').length
    };

    res.json({ success: true, stats });
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
        } catch (error) {
            console.error(`❌ Failed to send welcome email: ${error.message}`);
        }
    }

    // 2. 通知 Agent 系统（通过 OpenClaw Gateway）
    await notifyAgentSystem(contactId, contactData);

    // 3. 发送通知给销售团队
    await notifySalesTeam(contactId, contactData);

    // 4. 发送 Discord 通知
    await notifyDiscord(contactId, contactData);
}

/**
 * 发送欢迎邮件给客户
 */
async function sendWelcomeEmail(contactData) {
    const { name, email, service, message } = contactData;

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
        const response = await fetch(`${OPENCLAW_GATEWAY_URL}/api/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`
            },
            body: JSON.stringify({
                channel: 'webchat',
                message: `🔔 新客户咨询 #${contactId}\n\n姓名: ${contactData.name}\n邮箱: ${contactData.email}\n${contactData.phone ? '电话: ' + contactData.phone + '\n' : ''}服务: ${getServiceName(contactData.service)}\n${contactData.message ? '留言: ' + contactData.message : ''}\n\n请及时处理！`
            })
        });

        if (response.ok) {
            console.log(`✅ Agent notified for contact ${contactId}`);
        } else {
            console.log(`⚠️  Agent notification failed: ${response.status}`);
        }
    } catch (error) {
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
          <a href="${process.env.ADMIN_URL || 'http://localhost:3001'}/admin" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">查看详情</a>
        </p>
      `
        });
        console.log(`✅ Sales team notified: ${salesEmail}`);
    } catch (error) {
        console.error(`❌ Sales notification failed: ${error.message}`);
    }
}

/**
 * 发送 Discord 通知
 */
async function notifyDiscord(contactId, contactData) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
        console.log('⚠️  Discord notification skipped (not configured)');
        return;
    }

    const embed = {
        title: `📩 新客户咨询 #${contactId}`,
        color: 0x667eea,
        fields: [
            { name: '姓名', value: contactData.name, inline: true },
            { name: '邮箱', value: contactData.email, inline: true },
            { name: '服务类型', value: getServiceName(contactData.service), inline: true },
            { name: '联系电话', value: contactData.phone || '未提供', inline: true },
            { name: '留言', value: contactData.message || '无', inline: false },
            { name: '时间', value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), inline: false }
        ],
        footer: { text: '安盾科技 - 客户咨询系统' },
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        });

        if (response.ok) {
            console.log(`✅ Discord notification sent for contact ${contactId}`);
        } else {
            const error = await response.text();
            console.error(`❌ Discord API error: ${response.status} ${error}`);
        }
    } catch (error) {
        console.error(`❌ Discord notification failed: ${error.message}`);
    }
}

// ==================== 启动服务器 ====================

app.listen(PORT, () => {
    console.log(`🛡️  安盾科技官网 API 服务已启动`);
    console.log(`📡 监听端口: ${PORT}`);
    console.log(`🔗 API 地址: http://localhost:${PORT}/api`);
    console.log(`📊 管理后台: http://localhost:${PORT}/admin`);
    console.log(`📧 邮件服务: ${emailTransporter ? '已配置' : '未配置（使用 .env 配置 SMTP）'}`);
    console.log(`🤖 Agent 通知: ${OPENCLAW_GATEWAY_URL}`);
});

module.exports = app;