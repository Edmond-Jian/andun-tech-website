/**
 * AI Chat Widget Unit Tests
 * 测试 AI 助手聊天功能
 */

// Mock DOM environment for testing
const localResponses = {
    'openclaw 安全审计包括哪些内容？': 'OpenClaw 安全审计主要包括以下内容',
    '如何保护 ai 系统的数据安全？': '保护 AI 系统数据安全的关键措施',
    '你们的服务价格是怎样的？': '我们的服务价格如下',
    '你们的服务价格是多少？': '我们的服务价格如下',
    '价格': '我们的服务价格如下',
    'default': '感谢您的提问！'
};

function containsContactInfo(text) {
    const lowerText = text.toLowerCase();
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phonePattern = /1[3-9]\d{9}/;
    const wechatPattern = /微信|wechat|wx/i;
    const contactKeywords = /联系方式|电话|手机|邮箱|联系我|回电|联系电话/;
    
    return emailPattern.test(text) || 
           phonePattern.test(text) || 
           wechatPattern.test(lowerText) ||
           contactKeywords.test(text);
}

function getAIResponse(userMessage) {
    // First check if user provided contact information
    if (containsContactInfo(userMessage)) {
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const phonePattern = /1[3-9]\d{9}/;
        
        let contactInfo = '';
        const email = userMessage.match(emailPattern);
        const phone = userMessage.match(phonePattern);
        
        if (email) contactInfo += `邮箱：${email[0]}<br>`;
        if (phone) contactInfo += `电话：${phone[0]}<br>`;
        
        return `感谢您留下联系方式！${contactInfo ? '<br><br>' + contactInfo : ''}<br><br>我们的安全专家将在 24 小时内与您联系，为您提供专业的咨询服务。<br><br>如有其他问题，欢迎随时咨询！`;
    }

    const localKey = userMessage.toLowerCase();
    if (localResponses[localKey]) {
        return localResponses[localKey];
    }

    return localResponses['default'];
}

// Test cases
function runTests() {
    const results = [];
    
    // Test 1: Price question matching
    console.log('Test 1: 价格问题匹配');
    const priceResponse1 = getAIResponse('你们的服务价格是怎样的？');
    const priceResponse2 = getAIResponse('你们的服务价格是多少？');
    const priceResponse3 = getAIResponse('价格');
    
    results.push({
        name: '价格问题匹配',
        passed: priceResponse1.includes('服务价格') && 
                priceResponse2.includes('服务价格') && 
                priceResponse3.includes('服务价格'),
        details: {
            '价格是怎样的': priceResponse1.includes('服务价格'),
            '价格是多少': priceResponse2.includes('服务价格'),
            '价格': priceResponse3.includes('服务价格')
        }
    });
    
    // Test 2: Contact information detection
    console.log('Test 2: 联系方式检测');
    const contactResponse1 = getAIResponse('我的邮箱是 test@example.com');
    const contactResponse2 = getAIResponse('电话 13800138000');
    const contactResponse3 = getAIResponse('联系我');
    
    results.push({
        name: '联系方式检测',
        passed: contactResponse1.includes('感谢您留下联系方式') && 
                contactResponse2.includes('感谢您留下联系方式') && 
                contactResponse3.includes('感谢您留下联系方式'),
        details: {
            '邮箱检测': contactResponse1.includes('感谢您留下联系方式'),
            '电话检测': contactResponse2.includes('感谢您留下联系方式'),
            '联系关键词': contactResponse3.includes('感谢您留下联系方式')
        }
    });
    
    // Test 3: Email extraction
    console.log('Test 3: 邮箱提取');
    const emailResponse = getAIResponse('请通过 test@example.com 联系我');
    
    results.push({
        name: '邮箱提取',
        passed: emailResponse.includes('test@example.com'),
        details: {
            response: emailResponse
        }
    });
    
    // Test 4: Phone extraction
    console.log('Test 4: 电话提取');
    const phoneResponse = getAIResponse('我的电话是 13912345678');
    
    results.push({
        name: '电话提取',
        passed: phoneResponse.includes('13912345678'),
        details: {
            response: phoneResponse
        }
    });
    
    // Test 5: Default response for unknown questions
    console.log('Test 5: 默认回复');
    const defaultResponse = getAIResponse('随机问题 abc 123');
    
    results.push({
        name: '默认回复',
        passed: defaultResponse.includes('感谢您的提问'),
        details: {
            response: defaultResponse
        }
    });
    
    // Test 6: OpenClaw question
    console.log('Test 6: OpenClaw 问题');
    const openclawResponse = getAIResponse('OpenClaw 安全审计包括哪些内容？');
    
    results.push({
        name: 'OpenClaw 问题',
        passed: openclawResponse.includes('OpenClaw 安全审计'),
        details: {
            response: openclawResponse
        }
    });
    
    // Test 7: Data security question
    console.log('Test 7: 数据安全问题');
    const securityResponse = getAIResponse('如何保护 AI 系统的数据安全？');
    
    results.push({
        name: '数据安全问题',
        passed: securityResponse.includes('数据安全'),
        details: {
            response: securityResponse
        }
    });
    
    // Print results
    console.log('\n========== 测试结果 ==========\n');
    let passed = 0;
    let failed = 0;
    
    results.forEach(result => {
        if (result.passed) {
            console.log(`✅ ${result.name}: 通过`);
            passed++;
        } else {
            console.log(`❌ ${result.name}: 失败`);
            console.log(`   详情: ${JSON.stringify(result.details)}`);
            failed++;
        }
    });
    
    console.log(`\n总计: ${passed} 通过, ${failed} 失败`);
    console.log(`通过率: ${((passed / results.length) * 100).toFixed(1)}%`);
    
    return { passed, failed, results };
}

// Run tests
runTests();