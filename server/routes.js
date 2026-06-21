const express = require('express');
const router = express.Router();
const { startJob, getJob } = require('./pipeline');
const { searchTmdb, getDetails, getWatchProviders } = require('./tmdb');
const { getDb } = require('./db');
const { loadConfig } = require('./config');

router.post('/collect', async (req, res) => {
  const { playlistId, forceRescan } = req.body;
  if (!playlistId) return res.status(400).json({ error: 'playlistId required' });

  const config = loadConfig();
  if (!config.youtubeApiKey) return res.status(400).json({ error: 'youtubeApiKey not configured' });
  if (!config.apiKey) return res.status(400).json({ error: 'LLM apiKey not configured' });
  if (!config.tmdbApiKey) return res.status(400).json({ error: 'tmdbApiKey not configured' });

  try {
    const jobId = await startJob(playlistId, config, !!forceRescan);
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

router.get('/movies', (req, res) => {
  const db = getDb();
  // playlist_count = distinct playlists that contributed this movie
  const movies = db.prepare(`
    SELECT m.*, COUNT(DISTINCT s.playlist_id) AS playlist_count
    FROM movies m
    LEFT JOIN sources s ON s.movie_id = m.id AND s.status = 'confirmed'
    GROUP BY m.id
    ORDER BY m.confirmed_at DESC
  `).all();
  res.json(movies.map(m => ({ ...m, genres: JSON.parse(m.genres || '[]') })));
});

router.get('/review', (req, res) => {
  const db = getDb();
  const items = db.prepare("SELECT * FROM sources WHERE status = 'pending' ORDER BY created_at DESC").all();
  res.json(items.map(item => ({
    ...item,
    raw_match: item.raw_match ? JSON.parse(item.raw_match) : null,
  })));
});

router.post('/review/:id/confirm', async (req, res) => {
  const db = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });

  const rawMatch = source.raw_match ? JSON.parse(source.raw_match) : {};
  const candidates = rawMatch.tmdb_candidates || [];
  const tmdbId = req.body.tmdb_id || candidates[0]?.id;
  if (!tmdbId) return res.status(400).json({ error: 'tmdb_id required — no candidates available' });

  const config = loadConfig();
  try {
    // Infer media_type from the stored candidates (populated by the pipeline scorer).
    const candidate = candidates.find(c => c.id === tmdbId || c.id === Number(tmdbId));
    const mediaType = req.body.media_type || candidate?.media_type || 'movie';
    const details = await getDetails(tmdbId, mediaType, config.tmdbApiKey);
    const movieId = insertMovie(db, details);
    db.prepare("UPDATE sources SET status = 'confirmed', movie_id = ? WHERE id = ?").run(movieId, source.id);
    res.json({ success: true, movieId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/review/:id/skip', (req, res) => {
  const db = getDb();
  const result = db.prepare("UPDATE sources SET status = 'skipped' WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ success: true });
});

router.post('/review/:id/manual', async (req, res) => {
  const { tmdb_id } = req.body;
  if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id required' });

  const db = getDb();
  const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });

  const config = loadConfig();
  try {
    const mediaType = req.body.media_type || 'movie';
    const details = await getDetails(tmdb_id, mediaType, config.tmdbApiKey);
    const movieId = insertMovie(db, details);
    db.prepare("UPDATE sources SET status = 'confirmed', movie_id = ? WHERE id = ?").run(movieId, source.id);
    res.json({ success: true, movieId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search/tmdb', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });

  const config = loadConfig();
  try {
    // Use /search/multi so the review search finds both movies and TV shows.
    const results = await searchTmdb(q, null, 'unknown', config.tmdbApiKey);
    res.json(results.slice(0, 10));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/movies/:id/watch-providers', async (req, res) => {
  const db = getDb();
  const movie = db.prepare('SELECT tmdb_id, media_type FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'not found' });

  const config = loadConfig();
  try {
    const providers = await getWatchProviders(
      movie.tmdb_id, movie.media_type || 'movie', config.watchRegion || 'CA', config.tmdbApiKey
    );
    res.json(providers || { flatrate: [], rent: [], buy: [], link: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/movies/:id/watched', (req, res) => {
  const db = getDb();
  const result = db.prepare(
    "UPDATE movies SET watched_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ success: true });
});

router.post('/movies/:id/unwatched', (req, res) => {
  const db = getDb();
  const result = db.prepare(
    'UPDATE movies SET watched_at = NULL WHERE id = ?'
  ).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ success: true });
});

function insertMovie(db, details) {
  const existing = db.prepare('SELECT id FROM movies WHERE tmdb_id = ?').get(details.tmdb_id);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO movies (tmdb_id, title, original_title, year, release_date, poster_path, backdrop_path, overview, director, genres, rating, runtime, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    details.tmdb_id, details.title, details.original_title, details.year, details.release_date,
    details.poster_path, details.backdrop_path, details.overview,
    details.director, details.genres, details.rating, details.runtime,
    details.media_type
  );
  return result.lastInsertRowid;
}

module.exports = router;
