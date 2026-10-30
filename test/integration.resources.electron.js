// Packaged application, real preload IPC, clean userData and optional upstream downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-packaged-ui-'));
  const executable = path.join(root, 'dist/mac-arm64/智能会议和表达训练.app/Contents/MacOS/智能会议和表达训练');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`], env, timeout: 30000 });
  const errors = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    const main = await app.firstWindow();
    await main.waitForFunction(() => Boolean(window.meetingWorkspace));
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(userData));
    assert.equal(await main.title(), '智能会议和表达训练');
    assert.equal(await main.evaluate(async () => Object.values((await window.api.getSettings()).providers).every(provider => !provider.apiKey)), true);
    const resourcePage = await app.waitForEvent('window', { predicate: page => page.url().includes('resources.html'), timeout: 10000 }).catch(() => app.windows().find(page => page.url().includes('resources.html')));
    assert(resourcePage, 'first run should open resource preparation');
    await resourcePage.locator('.resource').first().waitFor();
    assert.equal(await resourcePage.locator('.resource').count(), 7);
    assert.equal(await resourcePage.locator('#summary').textContent(), '0 / 7 项已就绪');
    await resourcePage.evaluate(() => window.scrollTo(0, 0));
    await resourcePage.screenshot({ path: path.join(root, 'dist/resource-setup-preview.png') });
    await resourcePage.locator('#ai-settings').click();
    const settingsPage = app.windows().find(page => page.url().includes('settings.html')) || await app.waitForEvent('window');
    await settingsPage.locator('#apikey').waitFor();
    assert.equal(await settingsPage.locator('#apikey').inputValue(), '');
    assert.equal(await settingsPage.locator('#btn-resources').count(), 1);
    await settingsPage.close();
    const nativeLoaded = await app.evaluate(({ app }) => {
      const sherpa = process.mainModule.require(app.getAppPath() + '/node_modules/sherpa-onnx-node');
      return typeof sherpa.OnlineRecognizer === 'function';
    });
    assert.equal(nativeLoaded, true, 'packaged native ASR module should load');
    if (process.env.VERIFY_RESOURCE_DOWNLOADS === '1') {
      await resourcePage.locator('#resource-audio button').click();
      await resourcePage.locator('#resource-audio button').filter({ hasText: '已就绪' }).waitFor({ timeout: 240000 });
      await resourcePage.locator('#resource-paraformer button').click();
      await resourcePage.locator('#resource-paraformer button').filter({ hasText: '已就绪' }).waitFor({ timeout: 240000 });
      const asr = await main.evaluate(async () => {
        const settings = await window.api.getSettings();
        settings.asr.modelPreset = 'paraformer-streaming'; settings.asr.engine = 'paraformer';
        await window.api.saveSettings(settings);
        const started = await window.api.initASR('packaged-resource-smoke');
        if (!started.success) return started;
        await window.api.feedAudio(new Float32Array(16000), 'packaged-resource-smoke');
        await window.api.stopASR('packaged-resource-smoke');
        return started;
      });
      assert.equal(asr.success, true, JSON.stringify(asr));
      await resourcePage.screenshot({ path: path.join(root, 'dist/resource-ready-preview.png') });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ packagedUI: 'passed', cleanSettings: 'passed', resourceCards: 7, nativeASR: 'loaded', resourceDownloads: process.env.VERIFY_RESOURCE_DOWNLOADS === '1' ? 'audio environment and realtime model passed' : 'not requested', userData }, null, 2));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
