const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.movie-collector');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  youtubeApiKey: '',
  tmdbApiKey: '',
  port: 3457,
  confidenceThreshold: 0.85,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, CONFIG_DIR, CONFIG_PATH };
