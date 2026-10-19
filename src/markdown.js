/* Lightweight minutes Markdown: escaped text only, no raw HTML or active links. */
const MeetingMarkdown = (() => {
  const escape = text => String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function inline(text, depth = 0) {
    if (depth > 12) return escape(text);
    const tokens = /(`+)([^\n]*?)\1|\\([\\`*_{}\[\]()#+.!|>\-])|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
    let result = '';
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      result += escape(text.slice(offset, match.index));
      if (match[1]) result += `<code>${escape(match[2])}</code>`;
      else if (match[3]) result += escape(match[3]);
      else if (match[4] || match[5]) result += `<strong>${inline(match[4] || match[5], depth + 1)}</strong>`;
      else result += `<em>${inline(match[6] || match[7], depth + 1)}</em>`;
      offset = match.index + match[0].length;
    }
    return result + escape(text.slice(offset));
  }

  // Pipes inside code spans or escaped with a backslash are cell content.
  function cells(line) {
    const result = [];
    let cell = '';
    let codeFence = 0;
    const source = line.trim();
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === '\\' && i + 1 < source.length) {
        cell += char + source[++i];
      } else if (char === '`') {
        const run = source.slice(i).match(/^`+/)[0];
        if (!codeFence) codeFence = run.length;
        else if (codeFence === run.length) codeFence = 0;
        cell += run;
        i += run.length - 1;
      } else if (char === '|' && !codeFence) {
        result.push(cell.trim());
        cell = '';
      } else cell += char;
    }
    result.push(cell.trim());
    if (source.startsWith('|')) result.shift();
    if (source.endsWith('|') && result.at(-1) === '') result.pop();
    return result;
  }

  const listItem = line => line.match(/^( *)([-+*]|\d+[.)])\s+(.+)$/);
  const fence = line => line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  const heading = line => line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
  const rule = line => /^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(line);
  function tableHeader(lines, index) {
    if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) return false;
    const separators = cells(lines[index + 1]);
    return separators.length > 0 && separators.length === cells(lines[index]).length &&
      separators.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function blocks(lines, depth = 0) {
    if (depth > 20) return `<p>${escape(lines.join('\n'))}</p>`;
    const result = [];
    let i = 0;
    const startsBlock = index => heading(lines[index]) || fence(lines[index]) || rule(lines[index]) ||
      /^\s{0,3}>/.test(lines[index]) || listItem(lines[index]) || tableHeader(lines, index);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const code = fence(line);
      const title = heading(line);
      if (code) {
        const content = [];
        i++;
        while (i < lines.length) {
          const close = fence(lines[i]);
          if (close && close[1][0] === code[1][0] && close[1].length >= code[1].length && !close[2].trim()) { i++; break; }
          content.push(lines[i++]);
        }
        result.push(`<pre><code>${escape(content.join('\n'))}</code></pre>`);
      } else if (title) {
        result.push(`<h${title[1].length}>${inline(title[2])}</h${title[1].length}>`);
        i++;
      } else if (rule(line)) {
        result.push('<hr>');
        i++;
      } else if (tableHeader(lines, i)) {
        const headers = cells(line);
        const separators = cells(lines[i + 1]);
        const align = separators.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
        const row = (values, tag) => `<tr>${headers.map((_, col) => `<${tag} style="text-align:${align[col]}">${inline(values[col] || '')}</${tag}>`).join('')}</tr>`;
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !startsBlock(i)) {
          rows.push(row(cells(lines[i++]), 'td'));
        }
        result.push(`<div class="markdown-table" role="region" aria-label="会议纪要表格" tabindex="0"><table><thead>${row(headers, 'th')}</thead><tbody>${rows.join('')}</tbody></table></div>`);
      } else if (/^\s{0,3}>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}> ?/, ''));
        result.push(`<blockquote>${blocks(quote, depth + 1)}</blockquote>`);
      } else if (listItem(line)) {
        const first = listItem(line);
        const indent = first[1].length;
        const ordered = /^\d/.test(first[2]);
        const tag = ordered ? 'ol' : 'ul';
        const start = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
        const items = [];
        while (i < lines.length) {
          const item = listItem(lines[i]);
          if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered || rule(lines[i])) break;
          const content = [item[3]];
          const contentIndent = item[0].length - item[3].length;
          i++;
          while (i < lines.length) {
            if (!lines[i].trim()) {
              // Keep blank lines within the item only when indented content follows.
              let next = i + 1;
              while (next < lines.length && !lines[next].trim()) next++;
              if (next >= lines.length || lines[next].search(/\S/) <= indent) break;
              content.push('');
              i++;
            } else if (lines[i].search(/\S/) > indent) {
              const spaces = lines[i].search(/\S/);
              content.push(lines[i++].slice(Math.min(spaces, contentIndent)));
            } else break;
          }
          // Tight list items do not need an extra paragraph box.
          const body = blocks(content, depth + 1).replace(/^<p>([\s\S]*?)<\/p>/, '$1');
          items.push(`<li>${body}</li>`);
          while (i < lines.length && !lines[i].trim()) i++;
        }
        result.push(`<${tag}${start}>${items.join('')}</${tag}>`);
      } else {
        const paragraph = [line.trim()];
        i++;
        while (i < lines.length && lines[i].trim() && !startsBlock(i)) paragraph.push(lines[i++].trim());
        result.push(`<p>${paragraph.map(text => inline(text)).join('<br>')}</p>`);
      }
    }
    return result.join('\n');
  }

  function render(markdown) {
    let source = String(markdown || '').replace(/\r\n?/g, '\n').trim();
    const wrapped = source.match(/^```(?:markdown|md)\s*\n([\s\S]*)\n```$/i);
    if (wrapped) source = wrapped[1];
    return blocks(source.replace(/\t/g, '    ').split('\n'));
  }
  return { render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MeetingMarkdown;
