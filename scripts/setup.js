#!/usr/bin/env node
'use strict';

const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execSync }   = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(PROJECT_DIR, 'server', 'index.js');
const NODE_PATH   = process.execPath;

const CONFIG_DIR  = path.join(os.homedir(), '.movie-collector');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_PATH    = path.join(CONFIG_DIR, 'server.log');
const ERR_PATH    = path.join(CONFIG_DIR, 'server.error.log');

const DEFAULT_CONFIG = {
  apiKey:              '',
  baseUrl:             'https://api.openai.com/v1',
  model:               'gpt-4o-mini',
  youtubeApiKey:       '',
  tmdbApiKey:          '',
  port:                3457,
  confidenceThreshold: 0.85,
};

// ── Console helpers ────────────────────────────────────────────────────────

const ok   = msg => console.log(`  ✓  ${msg}`);
const info = msg => console.log(`  →  ${msg}`);
const warn = msg => console.log(`  ⚠  ${msg}`);
const step = msg => console.log(`\n${msg}`);

// ── Steps ──────────────────────────────────────────────────────────────────

function createConfigDir() {
  step('📁  Config directory');
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  ok(CONFIG_DIR);
}

function writeDefaultConfig() {
  step('⚙️   Default config');
  if (fs.existsSync(CONFIG_PATH)) {
    info(`Already exists — skipping  (${CONFIG_PATH})`);
    return;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
  ok(`Created  ${CONFIG_PATH}`);
}

function registerAutoStart() {
  step('🚀  Auto-start service');
  const p = process.platform;
  if      (p === 'darwin') setupMacLaunchAgent();
  else if (p === 'linux')  setupLinuxSystemd();
  else if (p === 'win32')  setupWindowsStartup();
  else warn(`Platform "${p}" not supported — skip auto-start`);
}

// ── macOS: Launch Agent ────────────────────────────────────────────────────

function setupMacLaunchAgent() {
  const agentsDir  = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath  = path.join(agentsDir, 'com.movie-collector.server.plist');
  const label      = 'com.movie-collector.server';

  fs.mkdirSync(agentsDir, { recursive: true });

  // Each argument as a separate <string> so spaces in paths are handled safely
  const plist = `\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SERVER_PATH}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>

  <key>StandardErrorPath</key>
  <string>${ERR_PATH}</string>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist, 'utf8');
  ok(`Plist written  →  ${plistPath}`);

  // Unload first in case of reinstall, then load
  try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}

  try {
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    ok('Launch Agent loaded — server starts automatically on login');
    info('Server is also running right now (RunAtLoad=true)');
    info(`Logs → ${LOG_PATH}`);
  } catch (e) {
    warn('Could not load Launch Agent automatically');
    info(`Run manually:  launchctl load "${plistPath}"`);
  }
}

// ── Linux: systemd user service ────────────────────────────────────────────

function setupLinuxSystemd() {
  const systemdDir  = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(systemdDir, 'movie-collector.service');

  fs.mkdirSync(systemdDir, { recursive: true });

  // Paths are double-quoted so spaces are handled correctly by systemd
  const service = `\
[Unit]
Description=YouTube Movie Collector Server
After=network.target

[Service]
Type=simple
ExecStart="${NODE_PATH}" "${SERVER_PATH}"
WorkingDirectory=${PROJECT_DIR}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_PATH}
StandardError=append:${ERR_PATH}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(servicePath, service, 'utf8');
  ok(`Service file written  →  ${servicePath}`);

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable movie-collector', { stdio: 'pipe' });
    execSync('systemctl --user start  movie-collector', { stdio: 'pipe' });
    ok('Systemd service enabled and started');
    info(`Logs → journalctl --user -u movie-collector -f`);
  } catch (e) {
    warn('Could not enable service automatically');
    info('Run manually:');
    info('  systemctl --user daemon-reload');
    info('  systemctl --user enable movie-collector');
    info('  systemctl --user start  movie-collector');
  }
}

// ── Windows: Startup VBScript ──────────────────────────────────────────────

function setupWindowsStartup() {
  const startupDir = path.join(
    os.homedir(),
    'AppData', 'Roaming', 'Microsoft', 'Windows',
    'Start Menu', 'Programs', 'Startup'
  );
  const scriptPath = path.join(startupDir, 'movie-collector.vbs');

  // Chr(34) = double-quote — wraps paths with spaces safely in VBScript
  const nodeSafe   = NODE_PATH.replace(/"/g, '""');
  const serverSafe = SERVER_PATH.replace(/"/g, '""');

  const vbs = `\
' YouTube Movie Collector — auto-start (generated by npm run setup)
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & "${nodeSafe}" & Chr(34) & " " & _
             Chr(34) & "${serverSafe}" & Chr(34), _
             0, False
`;

  try {
    fs.mkdirSync(startupDir, { recursive: true });
    fs.writeFileSync(scriptPath, vbs, 'utf8');
    ok(`Startup script written  →  ${scriptPath}`);
    info('The server will launch silently on next Windows login');
    info('To start now:  npm start');
  } catch (e) {
    warn(`Could not write startup script: ${e.message}`);
    info('You can start the server manually with:  npm start');
  }
}

// ── Final instructions ─────────────────────────────────────────────────────

function printInstructions() {
  const border = '─'.repeat(54);
  console.log(`
┌${border}┐
│          Setup complete!  Next steps:                │
└${border}┘

  1. Open your config file and fill in the API keys:

       ${CONFIG_PATH}

     Keys needed:
       youtubeApiKey   →  console.cloud.google.com
                          (Enable "YouTube Data API v3")

       tmdbApiKey      →  themoviedb.org/settings/api
                          (Free account required)

       apiKey          →  Your LLM key
                          (OpenAI / DeepSeek / any OpenAI-compatible)

  2. Load the Chrome extension:
       chrome://extensions  →  Developer Mode ON
       →  "Load unpacked"  →  select the  extension/  folder

  3. Open a YouTube playlist and click
       📽️  Collect this playlist

     Your movie library will be at  http://localhost:3457
`);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log('\n🎬  YouTube Movie Collector — Setup\n');
  console.log(`    Project : ${PROJECT_DIR}`);
  console.log(`    Node    : ${NODE_PATH}`);
  console.log(`    Platform: ${process.platform}`);

  createConfigDir();
  writeDefaultConfig();
  registerAutoStart();
  printInstructions();
}

main();
