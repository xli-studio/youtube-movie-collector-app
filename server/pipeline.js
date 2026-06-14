const { v4: uuidv4 } = require('uuid');
const { fetchPlaylistVideos } = require('./youtube');
const { identifyMovie } = require('./llm');
const { searchMovie, getMovieDetails } = require('./tmdb');
const { getDb } = require('./db');

// In-memory job store (sufficient for a single-user local server)
const jobs = new Map();

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function insertMovie(db, details) {
  const existing = db.prepare('SELECT id FROM movies WHERE tmdb_id = ?').get(details.tmdb_id);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO movies (tmdb_id, title, original_title, year, poster_path, backdrop_path, overview, director, genres, rating, runtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    details.tmdb_id, details.title, details.original_title, details.year,
    details.poster_path, details.backdrop_path, details.overview,
    details.director, details.genres, details.rating, details.runtime
  );
  return result.lastInsertRowid;
}

async function runPipeline(job, config) {
  const db = getDb();
  const seenStmt = db.prepare('SELECT id FROM sources WHERE video_id = ?');

  const videos = await fetchPlaylistVideos(job.playlistId, config.youtubeApiKey);
  job.total = videos.length;

  for (const video of videos) {
    job.processed++;

    try {
      // Deduplication — never reprocess the same video_id
      if (seenStmt.get(video.video_id)) {
        job.skipped++;
        continue;
      }

      const llmResult = await identifyMovie(video, config);

      if (!llmResult.is_movie_related) {
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'skipped', ?, ?)
        `).run(video.video_id, video.video_title, video.playlist_id,
               llmResult.confidence ?? null, JSON.stringify(llmResult));
        job.skipped++;
        continue;
      }

      // Fetch TMDB candidates regardless of confidence (needed for review UI)
      const candidates = await searchMovie(llmResult.movie_title, llmResult.year, config.tmdbApiKey);
      const rawMatch = JSON.stringify({ ...llmResult, tmdb_candidates: candidates.slice(0, 3) });

      const highConfidence = (llmResult.confidence ?? 0) >= config.confidenceThreshold;

      if (highConfidence && candidates.length === 1) {
        // Unambiguous high-confidence match — auto-confirm
        const details = await getMovieDetails(candidates[0].id, config.tmdbApiKey);
        const movieId = insertMovie(db, details);

        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, movie_id, status, confidence, raw_match)
          VALUES (?, ?, ?, ?, 'confirmed', ?, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, movieId, llmResult.confidence, rawMatch);

        job.confirmed++;
      } else {
        // Low confidence OR multiple TMDB results → queue for review
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, llmResult.confidence, rawMatch);

        job.pending_review++;
      }
    } catch (err) {
      job.errors.push({ video_id: video.video_id, error: err.message });
    }
  }

  job.status = 'done';
}

async function startJob(playlistId, config) {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    playlistId,
    status: 'running',
    total: 0,
    processed: 0,
    confirmed: 0,
    pending_review: 0,
    skipped: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  runPipeline(job, config).catch(err => {
    job.status = 'error';
    job.error = err.message;
  });

  return jobId;
}

module.exports = { startJob, getJob };
