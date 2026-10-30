const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
const LEGACY_APP_MODELS = new Set(['', 'deepseek-chat', 'deepseek-coder']);
const NON_THINKING_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro']);

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  return config.model == null || LEGACY_APP_MODELS.has(config.model)
    ? { ...config, model: DEFAULT_DEEPSEEK_MODEL }
    : config;
}

// Only values previously written by this app are migrated; manual model IDs stay intact.
function normalizeDeepSeekSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  let result = settings;
  if (settings.providers?.deepseek) {
    const config = normalizeConfig(settings.providers.deepseek);
    if (config !== settings.providers.deepseek) result = { ...settings, providers: { ...settings.providers, deepseek: config } };
  }
  if (settings.provider === 'deepseek' && !settings.providers) result = normalizeConfig(result);
  return result;
}

function getDeepSeekRequestBody(endpoint, model) {
  return endpoint === 'https://api.deepseek.com/v1/chat/completions' && NON_THINKING_MODELS.has(model)
    ? { thinking: { type: 'disabled' } }
    : {};
}

module.exports = { DEFAULT_DEEPSEEK_MODEL, normalizeDeepSeekSettings, getDeepSeekRequestBody };
