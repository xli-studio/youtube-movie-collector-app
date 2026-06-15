const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadConfig } = require('./config');
const { getDb } = require('./db');
const routes = require('./routes');

const config = loadConfig();
const app = express();

// Server binds to 127.0.0.1 only, so open CORS is safe.
// Content scripts run in the YouTube page context, making their Origin
// https://www.youtube.com — not chrome-extension:// — so origin filtering
// would block legitimate extension requests.
app.use(cors());
app.use(express.json());
// Dashboard (served before API routes so '/' returns the HTML)
app.use(express.static(path.join(__dirname, '..', 'dashboard')));
app.use(routes);

// Initialize DB on startup so the first request isn't slow
getDb();

const port = config.port || 3457;
app.listen(port, '127.0.0.1', () => {
  console.log(`Movie Collector server running at http://localhost:${port}`);
  console.log(`Config: ~/.movie-collector/config.json`);
});
