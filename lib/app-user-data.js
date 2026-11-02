const path = require('node:path');

// The display name may change; the settings directory must remain stable.
// Preserve isolated paths supplied by launch wrappers and --user-data-dir.
function configureUserDataPath(app) {
  if (app.commandLine.hasSwitch('user-data-dir')) return;
  const appData = app.getPath('appData');
  if (app.getPath('userData') === path.join(appData, app.getName())) {
    app.setPath('userData', path.join(appData, '智能表达训练'));
  }
}

module.exports = { configureUserDataPath };
