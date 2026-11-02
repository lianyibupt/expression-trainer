const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configureUserDataPath } = require('../lib/app-user-data');

function mockApp({ packaged = false, name = 'expression-trainer', userData, explicitSwitch = false } = {}) {
  const appData = '/local/Application Support';
  let currentPath = userData || path.join(appData, name);
  return {
    isPackaged: packaged,
    getName: () => name,
    getPath: key => key === 'appData' ? appData : currentPath,
    setPath: (key, value) => { assert.equal(key, 'userData'); currentPath = value; },
    commandLine: { hasSwitch: key => key === 'user-data-dir' && explicitSwitch }
  };
}

for (const packaged of [false, true]) {
  test(`${packaged ? 'packaged' : 'development'} startup reuses the existing settings directory`, () => {
    const app = mockApp({ packaged, name: packaged ? '智能会议和表达训练' : 'expression-trainer' });
    configureUserDataPath(app);
    assert.equal(app.getPath('userData'), '/local/Application Support/智能表达训练');
  });
}

test('preserves explicit user-data-dir overrides', () => {
  const app = mockApp({ explicitSwitch: true });
  const before = app.getPath('userData');
  configureUserDataPath(app);
  assert.equal(app.getPath('userData'), before);
});

test('preserves userData paths set by launch wrappers', () => {
  const app = mockApp({ userData: '/tmp/isolated-meeting-test' });
  configureUserDataPath(app);
  assert.equal(app.getPath('userData'), '/tmp/isolated-meeting-test');
});
