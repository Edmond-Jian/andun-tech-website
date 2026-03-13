/**
 * Vercel Serverless Function - Chat API
 * AI assistant chat endpoint with product recommendations
 */

// In-memory session storage (for serverless)
const chatSessions = new Map();
const CONFIG = { maxMessages: 10 };

// Product knowledge base
const PRODUCT_KNOWLEDGE = {
  services: [
    {
      id: 'token-optimization',
      name: 'Token 成本优化',
      price: '¥3,000 起',
      description: '分析 AI 系统 Token 消耗模式，识别成本黑洞，提供针对性优化方案',
      features: ['Token 消耗分析报告', '成本优化建议', '配置调优方案', '持续监控指导'],
      benefits: ['节省高达 50% 的 AI 成本', '优化后成本降幅 < 20% 全额退款'],
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
      commonQuestions: {
        '时间': '3-5 个工作日完成审计报告',
        '内容': '包括配置审查、权限检查、漏洞检测和修复建议'
      }
    },
    {
      id: 'ai-config-review',
      name: 'AI 配置审查',
      price: '¥3,000 - ¥5,000',
      description: '全面审查 AI 系统配置，确保工具权限、数据访问、敏感信息处理符合安全标准',
      features: ['AI工具权限审计', '数据流安全分析', '合规性检查', '优化建议报告'],
      commonQuestions: {
        '范围': '支持 OpenClaw、Cursor、Copilot 等主流 AI 工具',
        '时间': '2-3 个工作日完成审查报告'
      }
    },
    {
      id: 'security-consulting',
      name: '安全咨询',
      price: '¥500/小时',
      description: '一对一安全咨询，解答 AI 安全相关问题，提供定制化解决方案',
      features: ['实时在线解答', '安全架构建议', '风险评估', '定制解决方案'],
      commonQuestions: {
        '方式': '在线会议或电话咨询',
        '时间': '按需预约，最快当天响应'
      }
    }
  ],
  packages: [
    {
      name: '创业套餐',
      price: '¥15,000',
      description: '适合个人创业者和初创企业'
    },
    {
      name: '成长套餐',
      price: '¥35,000',
      description: '适合小型企业，提供全面安全服务'
    }
  ],
  company: {
    name: '安盾科技',
    contact: {
      email: 'contact@andun.io',
      discord: 'https://discord.com/invite/clawd'
    }
  }
};

// Generate AI response
function generateAIResponse(userMessage, messageCount) {
  const lowerMessage = userMessage.toLowerCase();
  const remainingMessages = CONFIG.maxMessages - messageCount - 1;
  
  // Contact detection
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
      response: `感谢您留下联系方式！\n\n${contactInfo}\n我们的安全专家将在 24 小时内与您联系，为您提供专业的咨询服务。`,
      hasContact: true,
      contactInfo: { email: email?.[0], phone: phone?.[0] }
    };
  }
  
  // Price
  if (lowerMessage.includes('价格') || lowerMessage.includes('多少钱') || lowerMessage.includes('收费')) {
    return {
      response: `📋 **服务价格一览**\n\n**单项服务：**\n• 🔐 OpenClaw 安全审计：¥5,000 - ¥8,000\n• ⚙️ AI 配置审查：¥3,000 - ¥5,000\n• 💰 Token 成本优化：¥3,000 起\n• 💡 安全咨询：¥500/小时\n\n**套餐方案：**\n• 🚀 创业套餐：¥15,000\n• 🏢 成长套餐：¥35,000\n\n首次咨询可享受 8 折优惠！您对哪个服务感兴趣？`
    };
  }
  
  // OpenClaw
  if (lowerMessage.includes('openclaw') || lowerMessage.includes('安全审计')) {
    const s = PRODUCT_KNOWLEDGE.services.find(x => x.id === 'openclaw-audit');
    return {
      response: `🔐 **${s.name}**\n\n${s.description}\n\n**价格：${s.price}**\n\n**包含：**\n${s.features.map(f => '• ' + f).join('\n')}\n\n**周期：**${s.commonQuestions['时间']}\n\n需要预约吗？留下联系方式，我们会联系您。`
    };
  }
  
  // Config review
  if (lowerMessage.includes('配置审查') || lowerMessage.includes('配置优化')) {
    const s = PRODUCT_KNOWLEDGE.services.find(x => x.id === 'ai-config-review');
    return {
      response: `⚙️ **${s.name}**\n\n${s.description}\n\n**价格：${s.price}**\n\n**包含：**\n${s.features.map(f => '• ' + f).join('\n')}\n\n**支持：**${s.commonQuestions['范围']}\n\n需要了解更多？留下联系方式。`
    };
  }
  
  // Token
  if (lowerMessage.includes('token') || lowerMessage.includes('成本') || lowerMessage.includes('节省')) {
    const s = PRODUCT_KNOWLEDGE.services.find(x => x.id === 'token-optimization');
    return {
      response: `💰 **${s.name}**\n\n${s.description}\n\n**价格：${s.price}**\n\n**效果：**${s.commonQuestions['效果']}\n**保障：**${s.commonQuestions['退款']}\n\n需要分析您的 AI 成本吗？`
    };
  }
  
  // Consulting
  if (lowerMessage.includes('咨询')) {
    const s = PRODUCT_KNOWLEDGE.services.find(x => x.id === 'security-consulting');
    return {
      response: `💡 **${s.name}**\n\n${s.description}\n\n**价格：${s.price}**\n\n**方式：**${s.commonQuestions['方式']}\n\n有问题请直接描述，或留下联系方式预约。`
    };
  }
  
  // Package
  if (lowerMessage.includes('套餐')) {
    return {
      response: `📦 **套餐方案**\n\n**🚀 创业套餐 - ¥15,000**\n适合：个人创业者、初创企业\n包含：审计x2、审查x2、咨询x2小时\n\n**🏢 成长套餐 - ¥35,000**\n适合：小型企业\n包含：审计x5、审查x5、咨询x10小时、专属支持\n\n您是企业还是个人？我帮您推荐。`
    };
  }
  
  // Data security
  if (lowerMessage.includes('数据') && lowerMessage.includes('安全')) {
    return {
      response: `🔒 **AI 系统数据安全**\n\n关键措施：\n\n1. **最小权限** - 只授予必要权限\n2. **敏感信息过滤** - 自动识别标记\n3. **数据访问控制** - 限制访问范围\n4. **审计日志** - 记录所有操作\n5. **定期审计** - 检查安全漏洞\n\n需要配置审查服务吗？`
    };
  }
  
  // Company
  if (lowerMessage.includes('公司') || lowerMessage.includes('关于') || lowerMessage.includes('介绍')) {
    return {
      response: `🛡️ **关于安盾科技**\n\n专注于 AI 安全领域，提供专业、可靠的 AI 安全解决方案。\n\n**核心服务：**\n• OpenClaw 安全审计\n• AI 配置审查\n• Token 成本优化\n• 安全咨询\n\n**联系：**\n• 📧 contact@andun.io\n• 💬 https://discord.com/invite/clawd\n\n有什么可以帮您？`
    };
  }
  
  // Contact
  if (lowerMessage.includes('预约') || lowerMessage.includes('联系')) {
    return {
      response: `📅 **预约咨询**\n\n• 📧 邮箱：contact@andun.io\n• 💬 Discord：https://discord.com/invite/clawd\n• 📞 电话：留下号码，我们回拨\n\n工作时间：周一至周五 9:00-18:00\n\n请问想咨询哪个服务？`
    };
  }
  
  // Default
  return {
    response: `感谢您的提问！\n\n我是安盾 AI 助手，可以帮您：\n\n**了解服务：**\n• 问"价格"查看服务报价\n• 问"OpenClaw 审计"了解安全审计\n• 问"Token 优化"了解成本优化\n\n**留下联系方式：**\n发送邮箱或电话，我们会联系您\n\n${remainingMessages > 0 ? `（剩余 ${remainingMessages} 条对话）` : ''}\n\n您想了解什么？`
  };
}

// Discord notification
async function sendToDiscord(contact) {
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1481973665439547424';
  
  if (!DISCORD_BOT_TOKEN) return { success: false, error: 'No Discord token' };
  
  const embed = {
    title: '📩 新客户咨询（来自AI助手）',
    color: 0x667eea,
    fields: [
      { name: '姓名', value: contact.name || '网站访客', inline: true },
      { name: '邮箱', value: contact.email || '未提供', inline: true },
      { name: '电话', value: contact.phone || '未提供', inline: true },
      { name: '来源', value: '网站AI助手', inline: true },
      { name: '时间', value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), inline: false }
    ],
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
    return { success: response.ok };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Main handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }
  
  const { message, sessionId, context } = req.body;
  
  if (!message || message.trim().length === 0) {
    res.status(400).json({ success: false, error: '请输入您的问题' });
    return;
  }
  
  // Session management
  const sid = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (!chatSessions.has(sid)) {
    chatSessions.set(sid, { messageCount: 0, createdAt: new Date(), messages: [] });
  }
  
  const session = chatSessions.get(sid);
  
  // Check limit
  if (session.messageCount >= CONFIG.maxMessages) {
    res.json({
      success: true,
      response: `您已达到对话次数限制（${CONFIG.maxMessages} 条）。\n\n请留下您的联系方式，我们的安全专家会与您详细沟通。\n\n📧 contact@andun.io\n💬 https://discord.com/invite/clawd`,
      sessionId: sid,
      limitReached: true,
      remainingMessages: 0
    });
    return;
  }
  
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });
  session.messageCount++;
  
  // Generate response
  const aiResult = generateAIResponse(message, session.messageCount);
  
  session.messages.push({ role: 'assistant', content: aiResult.response, timestamp: new Date() });
  session.lastActivity = new Date();
  
  // Save contact info
  if (aiResult.hasContact) {
    sendToDiscord({
      name: '网站访客',
      email: aiResult.contactInfo.email || '',
      phone: aiResult.contactInfo.phone || '',
      source: 'AI助手'
    }).catch(err => console.error('Discord notification failed:', err));
  }
  
  // Cleanup old sessions
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
};