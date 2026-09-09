/**
 * AI反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 */

const { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt, getTranscriptPolishPrompt } = require('./prompts');

const MEETING_MINUTES_CHUNK_CHARS = 12000;

// 各后端的 API 配置
const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

/**
 * 发送请求到 OpenAI 兼容接口
 */
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 获取endpoint和配置
 */
function getProviderConfig(settings) {
  const { provider, apiKey, model, ollamaUrl, baseUrl, customModel } = settings;

  switch (provider) {
    case 'openai':
      return {
        endpoint: PROVIDER_ENDPOINTS.openai,
        apiKey,
        model: model || 'gpt-4o-mini'
      };
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey,
        model: model || 'deepseek-chat'
      };
    case 'ollama':
      return {
        endpoint: `${ollamaUrl || 'http://localhost:11434'}/v1/chat/completions`,
        apiKey: 'ollama', // Ollama 不需要真实key但接口需要这个字段
        model: model || 'qwen2.5:7b'
      };
    case 'custom':
      // 用户输入 BASE URL，自动追加 /chat/completions
      const base = (baseUrl || '').replace(/\/+$/, '');
      const endpoint = base ? `${base}/chat/completions` : '';
      return {
        endpoint,
        apiKey: apiKey || '',
        model: customModel || model || ''
      };
    default:
      throw new Error(`未知的 provider: ${provider}`);
  }
}

/**
 * 发送实时反馈请求
 * @param {string} text - 当前累积文本
 * @param {Object} settings - 用户设置
 * @returns {string} 反馈HTML
 */
async function sendFeedback(text, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getRealtimePrompt(text, null, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150);
  return result;
}

/**
 * 发送结束报告请求
 * @param {string} fullText - 完整文本
 * @param {Object} stats - 统计数据
 * @param {Object} settings - 用户设置
 * @returns {string} 报告文本
 */
async function sendReport(fullText, stats, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getReportPrompt(fullText, stats, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 8192);
  return result;
}

function splitMeetingText(text, maxChars = MEETING_MINUTES_CHUNK_CHARS) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const chunks = [];
  let remaining = source;
  while (remaining.length > maxChars) {
    const candidate = remaining.slice(0, maxChars);
    const boundaries = [candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('\n'), candidate.search(/[。！？!?；;]\s*[^\n]*$/)];
    const boundary = Math.max(...boundaries);
    const cutAt = boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendMinutesRequest(text, stats, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getMeetingMinutesPrompt(text, stats, customPrompt);
  return callAPI(config.endpoint, config.apiKey, config.model, [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], 8192);
}

async function sendMinutesChunkSummary(text, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const customBlock = customPrompt?.goals ? `\n用户目标：${customPrompt.goals}` : '';
  const messages = [
    {
      role: 'system',
      content: `你是会议内容预处理助手。只从原文提取事实，输出简洁的中间摘要，供后续正式会议纪要使用。
提取：会议主题、结论、讨论观点、明确决策、明确待办、风险和未决问题。
没有明确出现的信息不要补写。负责人、截止时间、状态、依据和影响不明确时写“未明确”。不要生成正式 Markdown 章节，不要添加解释。${customBlock}`
    },
    { role: 'user', content: `请整理以下会议原文片段：\n\n${text}` }
  ];
  return callAPI(config.endpoint, config.apiKey, config.model, messages, 2500);
}

async function sendMeetingMinutes(fullText, stats, settings, customPrompt) {
  const chunks = splitMeetingText(fullText);
  if (chunks.length <= 1) return sendMinutesRequest(chunks[0] || '', stats, settings, customPrompt);

  const summaries = [];
  for (const chunk of chunks) {
    summaries.push(await sendMinutesChunkSummary(chunk, settings, customPrompt));
  }
  return sendMinutesRequest(summaries.join('\n\n'), stats, settings, customPrompt);
}

async function sendTranscriptPolish(fullText, settings, customPrompt) {
  const source = String(fullText || '').trim();
  if (!source) return '';
  const config = getProviderConfig(settings);
  const chunks = splitMeetingText(source);
  const parts = [];
  for (const chunk of chunks) {
    const prompt = getTranscriptPolishPrompt(chunk, customPrompt);
    const result = await callAPI(config.endpoint, config.apiKey, config.model, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 8192);
    parts.push((result || '').trim());
  }
  return parts.join('\n\n');
}

/**
 * 将AI返回的纯文本反馈格式化为HTML
 */
function formatFeedback(text) {
  // 简单处理：检测是否包含建议标记
  let html = text
    .replace(/→/g, '<span class="suggestion"> → </span>')
    .replace(/⚠️/g, '<span class="issue">⚠️</span>')
    .replace(/✓/g, '<span class="suggestion">✓</span>')
    .replace(/\n/g, '<br>');

  return html;
}

/**
 * 测试 LLM 连通性
 * 发送一条极简请求验证配置是否可用
 */
async function testConnection(settings) {
  const config = getProviderConfig(settings);
  if (!config.endpoint) {
    return { success: false, error: '端点地址未配置' };
  }

  const messages = [
    { role: 'user', content: 'OK' }
  ];

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: 2,
        temperature: 0
      })
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '未知错误');
      return { success: false, error: `API 请求失败 (${response.status}): ${error}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}` };
  }
}

module.exports = {
  sendFeedback,
  sendReport,
  sendMeetingMinutes,
  sendTranscriptPolish,
  splitMeetingText,
  testConnection
};
