/**
 * AI反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 */

const { getRealtimePrompt, getReportPrompt, getMeetingMinutesPrompt, getMeetingMinutesChunkPrompt, getTranscriptPolishPrompt, getTranscriptPunctuatePrompt } = require('./prompts');
const { log, startTask } = require('./runtime-log');

const MEETING_MINUTES_CHUNK_CHARS = 12000;

// 润稿是“逐字重写”，输出长度≈输入长度：每块上限要明显小于 max_tokens(8192) 能覆盖的输出量，
// 并在行边界切分，避免截断或把单个说话人长句拦腰切开。
const POLISH_CHUNK_CHARS = 4000;

// 各后端的 API 配置
const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

/**
 * 发送请求到 OpenAI 兼容接口
 */
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200, { temperature = 0.7, requireComplete = false, operation = 'AI 请求' } = {}) {
  const task = startTask('AI', operation, { model });
  let httpStatus;
  try {
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
        temperature
      })
    });
    httpStatus = response.status;

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${error}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (requireComplete) {
      if (choice?.finish_reason === 'length') throw new Error('纪要内容因输出长度限制被截断，请缩短原文或调整模型后重试');
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('AI 返回内容为空，请重试');
    }
    const result = choice?.message?.content;
    task.done({ httpStatus, textChars: typeof result === 'string' ? result.length : 0 });
    return result;
  } catch (error) {
    task.fail(error, { httpStatus });
    throw error;
  }
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

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150, { operation: '实时表达反馈' });
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

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 8192, { operation: '表达报告' });
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
  ], 8192, { temperature: 0.2, requireComplete: true, operation: '会议纪要汇总' });
}

async function sendMinutesChunkSummary(text, settings, customPrompt, operation) {
  const config = getProviderConfig(settings);
  const prompt = getMeetingMinutesChunkPrompt(text, customPrompt);
  const messages = [
    {
      role: 'system',
      content: prompt.system
    },
    { role: 'user', content: prompt.user }
  ];
  return callAPI(config.endpoint, config.apiKey, config.model, messages, 4000, { temperature: 0.2, requireComplete: true, operation });
}

async function sendMeetingMinutes(fullText, stats, settings, customPrompt) {
  const chunks = splitMeetingText(fullText);
  log('AI', '准备生成会议纪要', { textChars: String(fullText || '').length, chunks: chunks.length, provider: settings.provider });
  if (chunks.length <= 1) return sendMinutesRequest(chunks[0] || '', stats, settings, customPrompt);

  const summaries = [];
  for (const chunk of chunks) {
    const summary = await sendMinutesChunkSummary(chunk, settings, customPrompt, `会议纪要片段 ${summaries.length + 1}/${chunks.length}`);
    summaries.push(`[片段 ${summaries.length + 1}/${chunks.length}]\n${summary}`);
  }
  return sendMinutesRequest(summaries.join('\n\n'), stats, settings, customPrompt);
}

/**
 * 按行边界切分逐字稿，供润稿“逐字重写”使用。
 * 润稿要求逐字重写，输出长度≈输入长度：每块必须明显小于 max_tokens 能覆盖的输出量，
 * 且只能在行边界切分，避免截断，也避免把单个说话人连续发言拦腰切开、或让拼接处的单换行变成空行。
 * 唯一例外：某一行本身超过 maxChars 时，才在该行内部按句末标点（。！？!?）切分。
 * 保证：只要没有任何单行超过 maxChars，chunks.join('\n') === text.trim()。
 * @param {string} text - 原始逐字稿文本（可能含“说话人 N：”前缀行与空行）
 * @param {number} maxChars - 单块字符上限
 * @returns {string[]} 逐块文本
 */
function splitTranscriptForPolish(text, maxChars = POLISH_CHUNK_CHARS) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  // 空行也是有效单元：把空行留在块内，才能用 join('\n') 原样重现空行分隔
  const units = source.split('\n');
  const chunks = [];
  let buffer = [];

  const flush = () => {
    if (buffer.length) {
      chunks.push(buffer.join('\n'));
      buffer = [];
    }
  };

  // 尝试把下一行并入当前块；放得下则并入并返回 true
  const grow = (unit) => {
    const candidate = buffer.length ? `${buffer.join('\n')}\n${unit}` : unit;
    if (candidate.length <= maxChars) {
      buffer.push(unit);
      return true;
    }
    return false;
  };

  for (const unit of units) {
    if (unit.length > maxChars) {
      // 单行超长（罕见的长独白）：先落盘已有内容，再只对这一行按句末标点切
      flush();
      let rest = unit;
      while (rest.length > maxChars) {
        const idx = Math.max(
          rest.lastIndexOf('。', maxChars),
          rest.lastIndexOf('！', maxChars),
          rest.lastIndexOf('？', maxChars),
          rest.lastIndexOf('!', maxChars),
          rest.lastIndexOf('?', maxChars)
        );
        // 句末标点落在窗口后半段才提前切（切点含该标点），否则按 maxChars 硬切；
        // 标点恰在 maxChars 处时最多切到 maxChars，保证每块 ≤ maxChars
        const at = idx > Math.floor(maxChars * 0.5) ? Math.min(idx + 1, maxChars) : maxChars;
        chunks.push(rest.slice(0, at));
        rest = rest.slice(at);
      }
      if (rest) buffer.push(rest);
      continue;
    }
    if (buffer.length && !grow(unit)) {
      flush();
      buffer.push(unit);
    } else if (!buffer.length) {
      buffer.push(unit);
    }
  }
  flush();
  return chunks;
}

async function sendTranscriptPolish(fullText, settings, customPrompt) {
  const source = String(fullText || '').trim();
  if (!source) return '';
  const config = getProviderConfig(settings);
  const chunks = splitTranscriptForPolish(source);
  const parts = [];
  for (const chunk of chunks) {
    const prompt = getTranscriptPolishPrompt(chunk, customPrompt);
    const result = await callAPI(config.endpoint, config.apiKey, config.model, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 8192, { operation: `逐字稿润稿片段 ${parts.length + 1}/${chunks.length}` });
    parts.push((result || '').trim());
  }
  return parts.join('\n');
}

async function sendTranscriptPunctuate(fullText, settings, customPrompt) {
  const source = String(fullText || '').trim();
  if (!source) return '';
  const config = getProviderConfig(settings);
  const chunks = splitTranscriptForPolish(source);
  const parts = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const prompt = getTranscriptPunctuatePrompt(chunk, customPrompt);
    const result = await callAPI(config.endpoint, config.apiKey, config.model, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 8192, { operation: `逐字稿标点片段 ${parts.length + 1}/${chunks.length}` });
    parts.push((result || '').trim());
  }
  return parts.join('\n');
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
  const task = startTask('AI', '测试模型连接', { provider: settings.provider, model: config.model });
  if (!config.endpoint) {
    task.fail(new Error('端点地址未配置'));
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
      task.fail(new Error('HTTP request failed'), { httpStatus: response.status });
      return { success: false, error: `API 请求失败 (${response.status}): ${error}` };
    }

    task.done({ httpStatus: response.status });
    return { success: true };
  } catch (error) {
    task.fail(error);
    return { success: false, error: `连接失败: ${error.message}` };
  }
}

module.exports = {
  sendFeedback,
  sendReport,
  sendMeetingMinutes,
  sendTranscriptPolish,
  sendTranscriptPunctuate,
  splitMeetingText,
  splitTranscriptForPolish,
  testConnection
};
