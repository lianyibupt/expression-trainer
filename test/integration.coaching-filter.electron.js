// Exercise the native category popup while simulated ASR keeps refreshing local hints.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'coaching-filter-integration-'));
app.setPath('userData', temp);
app.setLoginItemSettings = () => {};
fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ meeting: {
  autoStartRecording: false, autoDetectMeeting: false, expressionOptimizationEnabled: false, autoSaveArtifacts: false } }));
let modelRequests = 0;
global.fetch = async () => { modelRequests++; throw new Error('Unexpected model request'); };
const timeout = setTimeout(() => { console.error('Filter integration timed out'); app.exit(1); }, 20000);

(async () => {
  require('../main'); await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const point = await win.webContents.executeJavaScript(`(async () => {
    const ws = window.meetingWorkspace, t = ws.sessions.get(ws.sessions.activeId).trainer;
    await t.getSettings(); t.session.titleSource = 'manual'; t.isRecording = true;
    t.switchStage('optimize');
    window.filterTest = { trainer: t, select: t.localCoachingFilter, options: [...t.localCoachingFilter.options], mutations: 0 };
    window.filterTest.observer = new MutationObserver(records => { window.filterTest.mutations += records.length; });
    window.filterTest.observer.observe(t.localCoachingFilter, { childList: true, characterData: true, attributes: true, subtree: true });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = t.localCoachingFilter.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  win.focus();
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  const openResult = await win.webContents.executeJavaScript(`(async () => {
    const state = window.filterTest;
    for (let i = 0; i < 7; i++) {
      state.trainer.handleASRResult({ text: '这个这个接口，后续我们尽快跟进一下，第' + i + '项', isFinal: false });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { mutations: state.mutations,
      sameNodes: state.options.every((option, i) => option === state.select.options[i]),
      focused: state.select.getRootNode().activeElement === state.select,
      latestPreview: state.trainer.localCoachingAnalysisText.includes('第6项'),
      count: state.select.options.length };
  })()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  assert.equal(openResult.mutations, 0, JSON.stringify(openResult));
  assert.equal(openResult.sameNodes, true);
  assert.equal(openResult.focused, true);
  assert.equal(openResult.latestPreview, true, 'local analysis must keep updating while choosing a category');
  assert.equal(openResult.count, 9);
  const selectedResult = await win.webContents.executeJavaScript(`(async () => {
    const state = window.filterTest;
    state.select.value = 'action'; state.select.dispatchEvent(new Event('change'));
    for (let i = 0; i < 3; i++) {
      state.trainer.handleASRResult({ text: '后续我们尽快跟进一下，第' + i + '个检查项', isFinal: false });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    state.trainer.isRecording = false;
    state.observer.disconnect();
    return { value: state.select.value, mutations: state.mutations,
      cards: [...state.trainer.localCoachingContent.querySelectorAll('.coaching-card strong')].map(el => el.textContent) };
  })()`);
  assert.equal(selectedResult.value, 'action');
  assert.equal(selectedResult.mutations, 0);
  assert.ok(selectedResult.cards.includes('行动闭环'));
  assert.equal(modelRequests, 0);
  console.log('Category filter Electron integration passed: native-popup interaction, stable option nodes, zero option mutations during live refresh, retained focus and selection, continuing previews and zero model requests.');
  clearTimeout(timeout); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
