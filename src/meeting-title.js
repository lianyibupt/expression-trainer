(function (root) {
  const MAX_TITLE_CHARS = 32;

  function isDefaultMeetingTitle(title) {
    return !String(title || '').trim() || /^(?:会议(?:\s+(?:\d+|\d{4}-[\w-]+))?|未命名(?:会议)?)$/u.test(String(title).trim());
  }

  function normalizeMeetingTitle(title) {
    const text = String(title || '').split(/\r?\n/).find(line => line.trim()) || '';
    const clean = text.replace(/^\s*(?:#+\s*|(?:会议名称|会议主题|标题)\s*[:：]\s*)/u, '')
      .replace(/^[“”「」『』"'`\s]+|[“”「」『』"'`。.!！?？\s]+$/gu, '').replace(/\s+/g, ' ').trim();
    return Array.from(clean).slice(0, MAX_TITLE_CHARS).join('');
  }

  function extractMeetingTitle(transcript) {
    const sentences = String(transcript || '')
      .replace(/^# 原始对话[\s\S]*?\n---\s*\n/u, '')
      .replace(/(?:^|\n)\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?(?:说话人|Speaker)\s*[\w\d一二三四五六七八九十]+\s*[:：]\s*/giu, '\n')
      .split(/[。！？!?\r\n]+/u).map(line => line.trim()).filter(Boolean);
    const meaningful = sentences.filter(line => !/^(?:嗯|啊|好的?|大家好|你们好|你好|谢谢(?:大家)?|喂|能听到吗|听得到吗|开始吧)[，,\s]*$/u.test(line));
    // Prefer an explicit topic statement over opening small talk.
    const topic = meaningful.find(line => /(?:主要|今天|本次|这次|我们).{0,8}(?:讨论|聊|对齐|确认|评审|沟通)/u.test(line)) || meaningful[0] || '';
    return normalizeMeetingTitle(topic.replace(/^(?:(?:好的?|嗯|那么|然后|大家好)[，,\s]*)*/u, '')
      .replace(/^(?:(?:我们|今天|本次|这次|会议)\s*)+(?:主要|重点|一起)?\s*(?:讨论|聊(?:一下)?|对齐|确认|评审|沟通)(?:一下|的是|的是关于|关于)?[，,:：\s]*/u, ''));
  }

  const exports = { isDefaultMeetingTitle, normalizeMeetingTitle, extractMeetingTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.MeetingTitle = exports;
})(globalThis);
