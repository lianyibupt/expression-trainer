const list = document.getElementById('resources');
const errorBox = document.getElementById('error');
const allButton = document.getElementById('prepare-all');
const cancelButton = document.getElementById('cancel');
const refreshButton = document.getElementById('refresh');
function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function render(items) {
  const busy = items.some(item => item.busy), ready = items.filter(item => item.ready).length;
  allButton.disabled = busy || ready === items.length;
  cancelButton.hidden = !busy; refreshButton.disabled = busy;
  document.getElementById('summary').textContent = ready === items.length ? '全部资源已就绪，可以开始使用。' : `${ready} / ${items.length} 项已就绪${busy ? ' · 正在准备，请保持应用打开' : ''}`;
  for (const item of items) {
    let card = document.getElementById(`resource-${item.id}`);
    if (!card) { card = element('section', '', 'resource'); card.id = `resource-${item.id}`; list.append(card); }
    card.replaceChildren();
    const header = element('div', '', 'resource-header'); header.append(element('h2', item.label));
    const button = element('button', item.ready ? '已就绪' : item.error ? '重试' : '下载并准备');
    button.disabled = busy || item.ready; button.addEventListener('click', () => install(item.id)); header.append(button); card.append(header);
    card.append(element('p', item.description));
    card.append(element('p', item.bytes ? `下载大小 ${formatBytes(item.bytes)}` : item.sizeHint));
    if (item.stage || item.ready) card.append(element('p', item.ready ? '已就绪' : item.stage, 'state'));
    if (item.total && !item.ready) {
      const progress = element('progress'); progress.max = item.total; progress.value = item.received || 0; progress.setAttribute('aria-label', `${item.label}下载进度`); card.append(progress);
      card.append(element('p', `${formatBytes(item.received || 0)} / ${formatBytes(item.total)}`));
    }
    if (item.detail && !item.ready) card.append(element('p', item.detail));
    if (item.error) card.append(element('p', item.error, 'error'));
  }
}
async function install(id) {
  errorBox.textContent = ''; allButton.disabled = true;
  try { const result = await window.api.installResource(id); render(result.items); if (!result.success) errorBox.textContent = result.error; }
  catch (error) { errorBox.textContent = error.message; await refresh(); }
}
async function refresh() {
  try { render(await window.api.getResourceStatus()); } catch (error) { errorBox.textContent = error.message; }
}
allButton.addEventListener('click', () => install('all'));
cancelButton.addEventListener('click', () => window.api.cancelResourceInstall());
refreshButton.addEventListener('click', refresh);
document.getElementById('ai-settings').addEventListener('click', () => window.api.openSettings());
const unsubscribe = window.api.onResourceProgress(render);
window.addEventListener('beforeunload', unsubscribe, { once: true });
refresh();
