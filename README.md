# YouTube Movie Collector

A Chrome extension + local server that turns your YouTube movie playlists into a personal poster-wall library — automatically.

Browse a YouTube playlist → click one button → the system identifies every film, fetches TMDB posters and metadata, and adds them to a searchable, filterable collection at `http://localhost:3457`.

---

## How it works

```
YouTube playlist
  → Chrome extension grabs the playlist ID
  → Local server calls YouTube Data API for all video titles
  → LLM identifies which videos are movie-related
  → TMDB API matches posters, director, runtime, genres, rating
  → High-confidence matches go straight to your library
  → Low-confidence matches queue for a one-click review
  → Dashboard shows your movie poster wall
```

Everything stays on your machine. No data leaves your computer except the API calls you explicitly configure.

---

## Requirements

- **Node.js** 18 or later — [nodejs.org](https://nodejs.org)
- **Google Chrome** (or any Chromium-based browser)
- Three free API keys (details below):
  - YouTube Data API v3
  - TMDB
  - Any OpenAI-compatible LLM (OpenAI, DeepSeek, Gemini, etc.)

---

## Installation

### 1. Clone and install

```bash
git clone https://github.com/xli_studio/youtube-movie-collector.git
cd youtube-movie-collector
npm install
```

### 2. Run setup

```bash
npm run setup
```

This will:
- Create `~/.movie-collector/config.json` with default settings
- Register the server as a system auto-start service (macOS Launch Agent / Linux systemd / Windows Startup)
- Print the exact path to your config file

### 3. Add your API keys

Open the config file printed by setup (default: `~/.movie-collector/config.json`) and fill in the three keys:

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "youtubeApiKey": "AIza...",
  "tmdbApiKey": "abc123...",
  "port": 3457,
  "confidenceThreshold": 0.85
}
```

See **[API Keys](#api-keys)** below for where to get each one.

### 4. Load the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this project

You should see a 🎬 icon appear in your Chrome toolbar.

### 5. Start the server

```bash
npm start
```

> If you ran `npm run setup`, the server starts automatically on login — you only need this command the first time or after a manual stop.

### 6. Collect a playlist

1. Go to YouTube and open any playlist (the URL will contain `?list=...`)
2. A floating **📽️ Collect this playlist** button appears in the bottom-right corner
3. Click it — the button shows live progress: `⏳ Processing… (12/47)`
4. When done: `✓ Found 38 movies, 3 need review`
5. Click the button (or the 🎬 toolbar icon) to open your library

---

## API Keys

### YouTube Data API v3

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **YouTube Data API v3** and enable it
5. Go to **APIs & Services → Credentials → Create Credentials → API key**
6. Copy the key into `youtubeApiKey` in your config

Free tier includes 10,000 units/day — more than enough for personal use.

### TMDB

1. Create a free account at [themoviedb.org](https://www.themoviedb.org)
2. Go to **Settings → API**
3. Request an API key (choose "Personal / hobby" — approved instantly)
4. Copy the **API Key (v3 auth)** into `tmdbApiKey` in your config

### LLM (movie identification)

The server works with any OpenAI-compatible API:

| Provider | `baseUrl` | Notes |
|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | Default; `gpt-4o-mini` recommended |
| **DeepSeek** | `https://api.deepseek.com` | Very cost-effective |
| **Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | Use `gemini-2.0-flash` |
| **Local (Ollama)** | `http://localhost:11434/v1` | Set `apiKey` to `"ollama"` |

Set `apiKey`, `baseUrl`, and `model` in your config accordingly.

---

## Dashboard

Open `http://localhost:3457` in any browser.

### Poster Wall

- Responsive poster grid with TMDB artwork
- Hover a card to see director, runtime, and genre tags
- Top bar: live search, filter by genre / year / rating
- Cards from multiple playlists show a 📋 source-count badge

### Review Queue

Click **Review** in the top-right corner to see movies the AI wasn't sure about. For each item you can:

- **Click a TMDB candidate** to select it, then **✓ Confirm** to add it to your library
- **✏️ Search** to type a different title and pick from fresh TMDB results
- **✗ Skip** to dismiss the item
- **Skip all** to bulk-dismiss the entire queue

---

## Config reference

| Field | Default | Description |
|---|---|---|
| `apiKey` | `""` | LLM provider API key |
| `baseUrl` | `https://api.openai.com/v1` | LLM API endpoint |
| `model` | `gpt-4o-mini` | Model name |
| `youtubeApiKey` | `""` | YouTube Data API v3 key |
| `tmdbApiKey` | `""` | TMDB API key (v3 auth) |
| `port` | `3457` | Local server port |
| `confidenceThreshold` | `0.85` | Score below which items go to Review (0–1) |

Changes to the config take effect on the next server start (`npm start`).

---

## Troubleshooting

**"📽️ Collect" button doesn't appear on YouTube**
- Make sure the URL contains `?list=` — the button only shows on playlist pages
- Check that the extension is loaded and enabled in `chrome://extensions`

**"Server not running" error when clicking the button**
- Run `npm start` in the project directory
- Check `~/.movie-collector/server.error.log` for crash details

**No movies found / everything goes to Review**
- Verify your `youtubeApiKey` and `tmdbApiKey` are correct
- Try lowering `confidenceThreshold` to `0.7` in your config

**YouTube API quota exceeded**
- The free tier allows ~10,000 units/day; one full playlist fetch uses ~1 unit per 50 videos
- Deduplication ensures the same video is never re-processed

**Change the port**
- Set `"port": 1234` in your config
- Update the extension: open `extension/content.js` and change the `SERVER` constant at the top, then reload the extension in `chrome://extensions`

---

## Data & privacy

- All movie data is stored locally in `~/.movie-collector/movies.db` (SQLite)
- API calls are only made when you click **Collect** — browsing the dashboard uses zero API calls
- Nothing is uploaded to any external server beyond the configured APIs

---

## Tech stack

| Layer | Technology |
|---|---|
| Chrome extension | Manifest V3, vanilla JS |
| Local server | Node.js + Express |
| Database | better-sqlite3 (SQLite, zero config) |
| Dashboard | Single-file HTML + CSS + JS |
| LLM | Any OpenAI-compatible API |
| Auto-start | macOS Launch Agent / Linux systemd / Windows Startup |

---

## License

MIT — built by [xli_studio](https://github.com/xli_studio) using [Claude Code](https://claude.ai/code).
