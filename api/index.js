/**
 * Vercel Serverless Function - Contact API
 * 
 * This file handles contact form submissions in Vercel's serverless environment.
 */

const nodemailer = require('nodemailer');

// In-memory storage for serverless (use external database for production)
// For production, consider using Vercel KV, PlanetScale, or other database
let contacts = [];
let appointments = [];

// Email transporter
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
    }
}

initEmailTransporter();

// Helper functions
function getServiceName(service) {
    const names = {
        'audit': 'OpenClaw 安全审计',
        'review': 'AI 配置审查',
        'consulting': '安全咨询',
        'other': '其他咨询'
    };
    return names[service] || '咨询服务';
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(s) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s];
    });
}

// Main handler
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const path = req.url.split('?')[0];
    const method = req.method;

    // Health check
    if (path === '/api/health' && method === 'GET') {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                email: emailTransporter ? 'configured' : 'not_configured',
                database: 'memory'
            }
        });
        return;
    }

    // Contact form submission
    if (path === '/api/contact' && method === 'POST') {
        const { name, email, phone, service, message } = req.body;

        if (!name || !email) {
            res.status(400).json({ success: false, error: '姓名和邮箱为必填项' });
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.status(400).json({ success: false, error: '请提供有效的邮箱地址' });
            return;
        }

        const newContact = {
            id: contacts.length + 1,
            name,
            email,
            phone: phone || null,
            service: service || 'other',
            message: message || null,
            status: 'new',
            created_at: new Date().toISOString()
        };

        contacts.unshift(newContact);

        // Send welcome email
        if (emailTransporter) {
            try {
                await emailTransporter.sendMail({
                    from: process.env.SMTP_FROM || 'noreply@andun.io',
                    to: email,
                    subject: '感谢您的咨询 - 安盾科技',
                    html: `
                        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                                <h1>🛡️ 安盾科技</h1>
                                <p>AI 安全解决方案专家</p>
                            </div>
                            <div style="background: #f9f9f9; padding: 30px;">
                                <p>尊敬的 <strong>${escapeHtml(name)}</strong> 您好！</p>
                                <p>感谢您选择安盾科技。我们已收到您的咨询请求，我们的工作人员将在 24 小时内与您联系。</p>
                                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <h3>您的咨询信息</h3>
                                    <p><strong>服务类型：</strong>${getServiceName(service)}</p>
                                    ${phone ? `<p><strong>联系电话：</strong>${escapeHtml(phone)}</p>` : ''}
                                </div>
                                <p>如有紧急需求，请联系：contact@andun.io</p>
                            </div>
                        </div>
                    `
                });
            } catch (error) {
                console.error('Failed to send welcome email:', error);
            }
        }

        res.json({
            success: true,
            contactId: newContact.id,
            message: '感谢您的咨询！我们已收到您的信息，工作人员将在24小时内与您联系。'
        });
        return;
    }

    // Get contacts list
    if (path === '/api/contacts' && method === 'GET') {
        const { status } = req.query;
        let filtered = contacts;
        if (status) {
            filtered = contacts.filter(c => c.status === status);
        }
        res.json({ success: true, contacts: filtered, total: filtered.length });
        return;
    }

    // Get single contact
    const contactMatch = path.match(/^\/api\/contacts\/(\d+)$/);
    if (contactMatch && method === 'GET') {
        const id = parseInt(contactMatch[1]);
        const contact = contacts.find(c => c.id === id);
        if (!contact) {
            res.status(404).json({ success: false, error: '联系人不存在' });
            return;
        }
        res.json({ success: true, contact });
        return;
    }

    // Update contact
    if (contactMatch && method === 'PATCH') {
        const id = parseInt(contactMatch[1]);
        const index = contacts.findIndex(c => c.id === id);
        if (index === -1) {
            res.status(404).json({ success: false, error: '联系人不存在' });
            return;
        }
        const { status, notes } = req.body;
        if (status) contacts[index].status = status;
        if (notes !== undefined) contacts[index].notes = notes;
        contacts[index].updated_at = new Date().toISOString();
        res.json({ success: true, contact: contacts[index] });
        return;
    }

    // Create appointment
    const appointmentMatch = path.match(/^\/api\/contacts\/(\d+)\/appointments$/);
    if (appointmentMatch && method === 'POST') {
        const contactId = parseInt(appointmentMatch[1]);
        const contact = contacts.find(c => c.id === contactId);
        if (!contact) {
            res.status(404).json({ success: false, error: '联系人不存在' });
            return;
        }
        const { scheduled_time, duration_minutes = 60 } = req.body;
        const newAppointment = {
            id: appointments.length + 1,
            contact_id: contactId,
            scheduled_time,
            duration_minutes,
            status: 'pending',
            created_at: new Date().toISOString()
        };
        appointments.push(newAppointment);
        
        // Update contact status
        const index = contacts.findIndex(c => c.id === contactId);
        contacts[index].status = 'scheduled';
        contacts[index].appointment_time = scheduled_time;
        
        res.json({ success: true, appointmentId: newAppointment.id, message: '预约创建成功' });
        return;
    }

    // Stats
    if (path === '/api/stats' && method === 'GET') {
        res.json({
            success: true,
            stats: {
                total: contacts.length,
                new: contacts.filter(c => c.status === 'new').length,
                scheduled: contacts.filter(c => c.status === 'scheduled').length,
                completed: contacts.filter(c => c.status === 'completed').length
            }
        });
        return;
    }

    // 404
    res.status(404).json({ success: false, error: 'Not found' });
};