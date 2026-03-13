/**
 * Vercel Serverless Function - Contact API
 * 
 * This file handles contact form submissions in Vercel's serverless environment.
 * Sends notifications to Discord and creates Paperclip issues.
 */

const nodemailer = require('nodemailer');

// In-memory storage for serverless (use external database for production)
// For production, consider using Vercel KV, PlanetScale, or other database
let contacts = [];
let appointments = [];

// Chat session storage (in-memory for serverless)
const chatSessions = new Map();
const CONFIG = { maxMessages: 10 };

// Product knowledge base for AI responses
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

// Generate AI response
function generateAIResponse(userMessage, sessionContext) {
  const lowerMessage = userMessage.toLowerCase();
  
  // Contact info detection
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
  
  // Price inquiry
  if (lowerMessage.includes('价格') || lowerMessage.includes('多少钱') || lowerMessage.includes('收费')) {
    return {
      response: `📋 **服务价格一览**\n\n**单项服务：**\n• 🔐 OpenClaw 安全审计：¥5,000 - ¥8,000\n• ⚙️ AI 配置审查：¥3,000 - ¥5,000\n• 💰 Token 成本优化：¥3,000 起\n• 💡 安全咨询：¥500/小时\n\n**套餐方案：**\n• 🚀 创业套餐：¥15,000（含审计+审查+咨询）\n• 🏢 成长套餐：¥35,000（全面安全服务）\n\n首次咨询可享受 8 折优惠！您对哪个服务感兴趣？`
    };
  }
  
  // OpenClaw audit
  if (lowerMessage.includes('openclaw') || lowerMessage.includes('安全审计')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'openclaw-audit');
    return {
      response: `🔐 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**适合客户：**${service.targetCustomers}\n\n**常见问题：**\n• 审计周期：${service.commonQuestions['时间']}\n• 报告内容：${service.commonQuestions['内容']}\n\n需要预约咨询吗？留下您的联系方式，我们会有专人与您沟通。`
    };
  }
  
  // Config review
  if (lowerMessage.includes('配置审查') || lowerMessage.includes('配置优化')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'ai-config-review');
    return {
      response: `⚙️ **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**支持的 AI 工具：**\n• OpenClaw\n• Cursor\n• GitHub Copilot\n• 其他主流 AI 助手\n\n**交付时间：**${service.commonQuestions['时间']}\n\n需要了解更多吗？留下您的联系方式，我们会为您详细解答。`
    };
  }
  
  // Token optimization
  if (lowerMessage.includes('token') || lowerMessage.includes('成本') || lowerMessage.includes('节省')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'token-optimization');
    return {
      response: `💰 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**为什么选择我们：**\n${service.benefits.map(b => '• ' + b).join('\n')}\n\n**包含内容：**\n${service.features.map(f => '• ' + f).join('\n')}\n\n**效果保障：**${service.commonQuestions['退款']}\n\n很多客户发现 AI 助手一天 Token 消耗数百美元，经我们优化后成本平均降低 30-60%。需要预约分析吗？`
    };
  }
  
  // Consulting
  if (lowerMessage.includes('咨询') || lowerMessage.includes('问答') || lowerMessage.includes('建议')) {
    const service = PRODUCT_KNOWLEDGE.services.find(s => s.id === 'security-consulting');
    return {
      response: `💡 **${service.name}**\n\n${service.description}\n\n**价格：${service.price}**\n\n**咨询范围：**\n${service.commonQuestions['范围']}\n\n**咨询方式：**${service.commonQuestions['方式']}\n**响应时间：**${service.commonQuestions['时间']}\n\n您有什么具体问题需要咨询？可以直接描述，或者留下联系方式预约咨询时间。`
    };
  }
  
  // Packages
  if (lowerMessage.includes('套餐') || lowerMessage.includes('创业') || lowerMessage.includes('成长') || lowerMessage.includes('小企业')) {
    return {
      response: `📦 **套餐方案**\n\n**🚀 创业套餐 - ¥15,000**\n适合：个人创业者、初创企业\n包含：\n• OpenClaw 安全审计 x2次\n• AI 配置审查 x2次\n• 安全咨询 x2小时\n• 季度安全报告\n• 邮件支持\n\n**🏢 成长套餐 - ¥35,000**\n适合：小型企业\n包含：\n• OpenClaw 安全审计 x5次\n• AI 配置审查 x5次\n• 安全咨询 x10小时\n• 月度安全报告\n• 专属技术支持\n• 紧急响应服务\n\n您是企业还是个人使用？我可以帮您推荐最合适的方案。`
    };
  }
  
  // Data security
  if (lowerMessage.includes('数据') && (lowerMessage.includes('安全') || lowerMessage.includes('保护'))) {
    return {
      response: `🔒 **AI 系统数据安全保障**\n\n保护 AI 系统数据安全的关键措施：\n\n**1. 最小权限原则**\n只授予 AI 工具必要的权限，避免过度授权\n\n**2. 敏感信息过滤**\n自动识别和标记敏感内容，防止泄露\n\n**3. 数据访问控制**\n限制 AI 访问敏感文件和目录\n\n**4. 审计日志**\n记录 AI 的所有操作，可追溯可审计\n\n**5. 定期安全审计**\n定期检查配置变更和安全漏洞\n\n我们可以帮您进行 AI 配置审查（¥3,000 - ¥5,000），确保您的 AI 系统符合安全标准。需要预约吗？`
    };
  }
  
  // Company info
  if (lowerMessage.includes('公司') || lowerMessage.includes('关于') || lowerMessage.includes('介绍')) {
    return {
      response: `🛡️ **关于安盾科技**\n\n${PRODUCT_KNOWLEDGE.company.description}\n\n**核心服务：**\n• OpenClaw 安全审计\n• AI 配置审查\n• Token 成本优化\n• 安全咨询\n\n**为什么选择我们：**\n• 专业团队，深耕 AI 安全领域\n• 严格保密，确保客户数据安全\n• 24小时响应，快速交付\n\n**联系方式：**\n• 📧 邮箱：${PRODUCT_KNOWLEDGE.company.contact.email}\n• 💬 Discord：${PRODUCT_KNOWLEDGE.company.contact.discord}\n• ⏰ 工作时间：${PRODUCT_KNOWLEDGE.company.contact.hours}\n\n有什么可以帮您的？`
    };
  }
  
  // Contact/appointment
  if (lowerMessage.includes('预约') || lowerMessage.includes('联系') || lowerMessage.includes('咨询')) {
    return {
      response: `📅 **预约咨询**\n\n您可以通过以下方式联系我们：\n\n• 📧 邮箱：contact@andun.io\n• 💬 Discord：https://discord.com/invite/clawd\n• 📞 电话：留下您的号码，我们会回拨\n\n**工作时间：** 周一至周五 9:00 - 18:00\n\n**快速咨询：**\n直接在此留下您的联系方式（邮箱/电话），我们的安全专家会在 24 小时内与您联系。\n\n请问您想咨询哪个服务？`
    };
  }
  
  // Default response
  const remainingMessages = CONFIG.maxMessages - (sessionContext?.messageCount || 0) - 1;
  return {
    response: `感谢您的提问！\n\n我是安盾 AI 助手，可以帮您：\n\n**🔍 了解服务：**\n• 问"OpenClaw 审计内容"了解安全审计\n• 问"价格"查看所有服务价格\n• 问"Token 优化"了解成本优化服务\n\n**📝 留下联系方式：**\n直接发送您的邮箱或电话，我们会联系您\n\n**💡 快速咨询：**\n描述您的问题，我会尽力解答\n\n${remainingMessages > 0 ? `（您还有 ${remainingMessages} 条对话机会）` : ''}\n\n您想了解哪方面的内容？`
  };
}

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

// Discord notification
async function sendToDiscord(contact) {
    const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
    const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1480530477298356294'; // #ask channel

    const serviceName = getServiceName(contact.service);
    
    const embed = {
        title: '📩 新客户咨询',
        color: 0x667eea,
        fields: [
            { name: '姓名', value: contact.name, inline: true },
            { name: '邮箱', value: contact.email, inline: true },
            { name: '服务类型', value: serviceName, inline: true },
            { name: '联系电话', value: contact.phone || '未提供', inline: true },
            { name: '留言', value: contact.message || '无', inline: false },
            { name: '时间', value: new Date(contact.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), inline: false }
        ],
        footer: { text: '安盾科技 - 客户咨询系统' },
        timestamp: new Date().toISOString()
    };

    // Try webhook first, then bot API
    if (DISCORD_WEBHOOK_URL) {
        try {
            const response = await fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });
            if (response.ok) return { success: true, method: 'webhook' };
        } catch (error) {
            console.error('Discord webhook failed:', error.message);
        }
    }

    // Fallback to bot API
    if (DISCORD_BOT_TOKEN && DISCORD_CHANNEL_ID) {
        try {
            const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ embeds: [embed] })
            });
            if (response.ok) return { success: true, method: 'bot_api' };
        } catch (error) {
            console.error('Discord bot API failed:', error.message);
        }
    }

    return { success: false, error: 'No Discord credentials configured' };
}

// Paperclip issue creation
async function createPaperclipIssue(contact) {
    const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100';
    const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY;
    const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || 'fd2eac5b-3e88-4da4-b930-f01f1139167d';

    if (!PAPERCLIP_API_KEY) {
        return { success: false, error: 'No Paperclip API key configured' };
    }

    const serviceName = getServiceName(contact.service);
    
    const issueData = {
        title: `客户咨询：${contact.name} - ${serviceName}`,
        description: `## 客户信息\n\n**姓名**：${contact.name}\n**邮箱**：${contact.email}\n**电话**：${contact.phone || '未提供'}\n**服务类型**：${serviceName}\n\n## 留言\n\n${contact.message || '无'}\n\n---\n*提交时间：${new Date(contact.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*`,
        priority: 'medium',
        status: 'todo'
    };

    try {
        const response = await fetch(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(issueData)
        });

        if (response.ok) {
            const data = await response.json();
            return { success: true, issueId: data.id, issueNumber: data.issueNumber };
        }

        const error = await response.text();
        return { success: false, error };
    } catch (error) {
        console.error('Paperclip issue creation failed:', error.message);
        return { success: false, error: error.message };
    }
}

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
                discord: process.env.DISCORD_BOT_TOKEN ? 'configured' : 'not_configured',
                paperclip: process.env.PAPERCLIP_API_KEY ? 'configured' : 'not_configured',
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

        // Send notifications in parallel (don't wait for them)
        const notifications = [];

        // 1. Discord notification
        notifications.push(
            sendToDiscord(newContact).then(result => ({
                type: 'discord',
                ...result
            }))
        );

        // 2. Paperclip issue creation
        notifications.push(
            createPaperclipIssue(newContact).then(result => ({
                type: 'paperclip',
                ...result
            }))
        );

        // 3. Welcome email (if SMTP configured)
        if (emailTransporter) {
            notifications.push(
                emailTransporter.sendMail({
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
                }).then(() => ({ type: 'email', success: true })).catch(error => ({ type: 'email', success: false, error: error.message }))
            );
        }

        // Wait for all notifications but don't fail if some fail
        const results = await Promise.allSettled(notifications);
        
        // Log results
        console.log('Notification results:', results.map(r => r.value || r.reason));

        // Send welcome email (optional, don't fail if it fails)
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

    // Chat API
    if (path === '/api/chat' && method === 'POST') {
        const { message, sessionId, context } = req.body;

        if (!message || message.trim().length === 0) {
            res.status(400).json({ success: false, error: '请输入您的问题' });
            return;
        }

        // Create or get session
        const sid = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (!chatSessions.has(sid)) {
            chatSessions.set(sid, {
                messageCount: 0,
                createdAt: new Date(),
                messages: []
            });
        }
        
        const session = chatSessions.get(sid);
        
        // Check message limit
        if (session.messageCount >= CONFIG.maxMessages) {
            res.json({
                success: true,
                response: `您已达到对话次数限制（${CONFIG.maxMessages} 条）。\n\n请留下您的联系方式（邮箱或电话），我们的安全专家会与您详细沟通，为您提供专业建议。\n\n📧 邮箱：contact@andun.io\n💬 Discord：https://discord.com/invite/clawd`,
                sessionId: sid,
                limitReached: true,
                remainingMessages: 0
            });
            return;
        }
        
        // Record user message
        session.messages.push({ role: 'user', content: message, timestamp: new Date() });
        session.messageCount++;
        
        // Generate response
        const aiResult = generateAIResponse(message, session);
        
        // Record assistant response
        session.messages.push({ role: 'assistant', content: aiResult.response, timestamp: new Date() });
        session.lastActivity = new Date();
        
        // If contains contact info, save to contacts
        if (aiResult.hasContact) {
            const newContact = {
                id: contacts.length + 1,
                name: '网站访客',
                email: aiResult.contactInfo.email || '',
                phone: aiResult.contactInfo.phone || '',
                service: 'chat',
                message: message,
                status: 'new',
                created_at: new Date().toISOString()
            };
            contacts.unshift(newContact);
            
            // Send notifications (async, don't wait)
            sendToDiscord(newContact).catch(err => console.error('Discord notification failed:', err));
            createPaperclipIssue(newContact).catch(err => console.error('Paperclip issue creation failed:', err));
        }
        
        // Clean up old sessions (keep for 30 minutes)
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
        return;
    }

    // Get chat session status
    const sessionMatch = path.match(/^\/api\/chat\/session\/([a-zA-Z0-9_-]+)$/);
    if (sessionMatch && method === 'GET') {
        const sid = sessionMatch[1];
        const session = chatSessions.get(sid);
        
        if (!session) {
            res.json({
                success: true,
                exists: false,
                messageCount: 0,
                remainingMessages: CONFIG.maxMessages
            });
            return;
        }
        
        res.json({
            success: true,
            exists: true,
            messageCount: session.messageCount,
            remainingMessages: CONFIG.maxMessages - session.messageCount
        });
        return;
    }

    // 404
    res.status(404).json({ success: false, error: 'Not found' });
};