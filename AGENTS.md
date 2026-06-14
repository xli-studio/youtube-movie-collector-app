# YouTube Movie Collector — Agent Instructions

Hi! This is the setup and development guide for **YouTube Movie Collector**.

YouTube Movie Collector is a Chrome extension + local server combo. When a user browses a YouTube playlist, they click the extension button and the system automatically identifies movies in the playlist, matches posters and metadata, and builds a beautiful personal movie library (Poster Wall).

---

## Project Structure

```
youtube-movie-collector/
├── extension/        # Chrome extension (injects button into YouTube pages)
├── server/           # Local backend (core processing logic)
├── dashboard/        # Frontend Web App (Poster Wall + Review interface)
├── scripts/          # Setup scripts (auto-start service)
├── AGENTS.md         # This file
└── README.md         # User installation guide
```

---

## Core Data Flow

```
User visits a YouTube playlist page
  → Clicks the Chrome extension button
  → Extension grabs the current playlistId
  → POSTs to local server at localhost:3457/collect
  → Server calls YouTube Data API to fetch all video titles + descriptions
  → Server calls LLM API to extract movie names from titles/descriptions
  → Server calls TMDB API to match movie metadata (poster, year, director, overview)
  → Confidence check:
      High confidence  → write directly to local database
      Low confidence   → add to Review queue for user confirmation
  → Dashboard shows real-time processing progress
  → Poster Wall displays the confirmed movie library
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Chrome extension | Manifest V3, vanilla JS, no framework |
| Local server | Node.js + Express |
| Database | better-sqlite3 (local SQLite, zero config) |
| Frontend dashboard | Vanilla HTML + CSS + JS (no framework, single file) |
| LLM | Any OpenAI-compatible API (default: gpt-4o-mini) |
| Auto-start | macOS Launch Agent / Linux systemd / Windows Startup |

---

## Config File

Config is stored at `~/.movie-collector/config.json`:

```json
{
  "apiKey": "",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "youtubeApiKey": "",
  "tmdbApiKey": "",
  "port": 3457,
  "confidenceThreshold": 0.85
}
```

**Field reference:**
- `apiKey` — Your LLM provider's API key (works with OpenAI, DeepSeek, Gemini, or any OpenAI-compatible service)
- `baseUrl` — LLM API endpoint (switch to DeepSeek by setting `https://api.deepseek.com`)
- `model` — Model name to use
- `youtubeApiKey` — YouTube Data API v3 key (free: console.cloud.google.com)
- `tmdbApiKey` — TMDB API key (free: themoviedb.org/settings/api)
- `confidenceThreshold` — Confidence cutoff; items below this go to Review queue (0–1, default 0.85)

---

## Database Schema

Database file lives at `~/.movie-collector/movies.db` with two tables:

**movies** (confirmed films)
```sql
CREATE TABLE movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  poster_path TEXT,
  backdrop_path TEXT,
  overview TEXT,
  director TEXT,
  genres TEXT,          -- JSON array, e.g. ["Drama", "Sci-Fi"]
  rating REAL,
  runtime INTEGER,
  confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**sources** (origin videos, linked to movies)
```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT UNIQUE NOT NULL,
  video_title TEXT,
  playlist_id TEXT,
  movie_id INTEGER REFERENCES movies(id),
  status TEXT DEFAULT 'pending',   -- pending / confirmed / skipped
  confidence REAL,
  raw_match TEXT,                  -- raw LLM response (JSON)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## LLM Prompt (Movie Identification)

System prompt sent to the LLM:

```
You are a movie identification assistant. I will give you a YouTube video title and description. Determine whether the video is related to a specific movie (trailer, clip, review, OST, etc.), and if so, extract the movie details.

Reply in JSON only — no other text:
{
  "is_movie_related": true/false,
  "movie_title": "English title of the movie",
  "movie_title_zh": "Chinese title if known, otherwise null",
  "year": 2023,
  "confidence": 0.95,
  "reason": "One-sentence explanation of your reasoning"
}

If the year is uncertain, set year to null.
confidence is your certainty in this match (0–1).
If the video is unrelated to a movie (e.g. vlog, tutorial), set is_movie_related to false and all other fields to null.
```

---

## Confidence & Review Logic

```
LLM returns confidence >= 0.85
  → Call TMDB API to match the movie
  → Write to movies table, status = 'confirmed'

LLM returns confidence < 0.85, OR TMDB returns multiple results for the same title
  → Write to sources table, status = 'pending'
  → Show in Dashboard Review interface:
      - Original YouTube video title
      - LLM's best guess for movie name
      - Up to 3 TMDB candidates
      - User actions: ✓ Confirm / ✏️ Search manually / ✗ Skip
```

---

## Dashboard Interface

Dashboard runs at `http://localhost:3457` with two views:

**Poster Wall (main view)**
- Movie poster grid; each card shows: poster image, title, year, rating
- On hover: director, runtime, genre tags
- Top-right badge: number of source playlists (one movie can come from multiple playlists)
- Top bar: search box, filter by genre / year / rating

**Review interface**
- Pending confirmation queue with item count badge
- Each item shows: YouTube video title vs TMDB candidate cards
- Users can confirm one by one or bulk-skip

---

## Chrome Extension Behaviour

The extension injects into all YouTube pages (`youtube.com/*`):

1. Detects whether the current page contains a playlist (URL includes `list=` parameter)
2. If yes, shows a floating button in the bottom-right corner: "📽️ Collect this playlist"
3. On click:
   - Extracts `playlistId`
   - POSTs to `http://localhost:3457/collect`
   - Button switches to progress state: "Processing… (12/47)"
   - On completion, shows: "✓ Found 38 movies, 3 need review"
   - Clicking the notification opens the Dashboard

---

## API Endpoints

```
POST /collect              # Receive a playlist and start processing
GET  /status/:jobId        # Poll processing progress
GET  /movies               # Get all confirmed movies
GET  /review               # Get pending review queue
POST /review/:id/confirm   # Confirm a review item
POST /review/:id/skip      # Skip a review item
POST /review/:id/manual    # Manually assign a TMDB movie ID
GET  /search/tmdb?q=...    # Search TMDB (used by Review interface)
```

---

## Installation (user perspective)

```bash
# 1. Clone the repo
git clone https://github.com/xli_studio/youtube-movie-collector.git
cd youtube-movie-collector
npm install

# 2. Run setup (creates config directory + registers auto-start service)
npm run setup

# 3. Fill in your API keys
# Open ~/.movie-collector/config.json and add your keys

# 4. Load the Chrome extension
# Go to chrome://extensions → enable Developer mode → Load unpacked → select the extension/ folder

# 5. Start the server
npm start

# 6. Go to YouTube, open any playlist, click the extension button
```

---

## Build Order (MVP priority)

1. **Server core pipeline** — YouTube API fetch → LLM identification → TMDB match → SQLite write
2. **Chrome extension** — playlist detection + floating button + POST trigger
3. **Dashboard Poster Wall** — basic poster grid display
4. **Review interface** — pending queue + three user actions
5. **Setup script** — `npm run setup` auto-configuration
6. **README** — user installation guide

---

## Key Constraints

- **Fully local data** — all movie data lives in the user's local SQLite; nothing is uploaded to any server
- **Tokens only on demand** — opening the Dashboard makes zero API calls; tokens are only used when the user clicks "Collect"
- **Deduplication** — the same `video_id` is never processed twice; the same `tmdb_id` is never stored twice
- **TMDB result caching** — each movie triggers only one TMDB API call; results are cached in the local database
- **Extensibility** — the `playlist_id` field in the `sources` table is designed to hold any source identifier, making it straightforward to support other platforms in the future

---

## About

Built by [xli_studio](https://github.com/xli_studio) using Claude Code as the primary development tool.
Architecture inspired by the local-first approach of [Tab Out](https://github.com/zarazhangrui/tab-out).
