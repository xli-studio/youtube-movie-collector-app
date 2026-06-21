const { v4: uuidv4 } = require('uuid');
const { fetchPlaylistVideos } = require('./youtube');
const { identifyMovie } = require('./llm');
const { searchTmdb, getDetails } = require('./tmdb');
const { getDb } = require('./db');

// In-memory job store (sufficient for a single-user local server)
const jobs = new Map();

// Case-insensitive partial match between the LLM's director_guess and a TMDB
// director list. Accepts partials (e.g. "Nolan" matches "Christopher Nolan").
function directorsMatch(guess, directors) {
  if (!guess || !directors || directors.length === 0) return false;
  const g = guess.trim().toLowerCase();
  return directors.some(name => {
    const n = name.trim().toLowerCase();
    return n === g || n.includes(g) || g.includes(n);
  });
}

// Strips punctuation and normalises whitespace/case for deterministic comparison.
// 同时去除冠词前缀（the/a/an）并将 ASCII 分数 "数字 1/2" 标准化为 Unicode ½
function normalizeTitle(str) {
  return (str || '')
    .toLowerCase()
    // 将 "数字 1/2"（如 "8 1/2"）统一为 Unicode ½，使其与 "8½" 的结果一致
    .replace(/(\d)\s+1\/2/g, '$1½')
    .replace(/[^\w\s½]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 去除冠词前缀，避免 "The …" 与无冠词版本不匹配
    .replace(/^(the |a |an )/, '');
}

// Score every TMDB candidate against the LLM extraction, then return the top 10
// sorted descending. Scoring weights:
//   +50  exact normalized title match
//   +40  exact normalized original-title match
//   Year (yearConfidence='high'):     +6 match, +2 off-by-1, -3 mismatch
//   Year (yearConfidence='low'/null): +3 match, +1 off-by-1,  0 mismatch
//   +10  media_type matches tmdb_type_guess
//   -15  media_type mismatches
//   0-15 vote_count (log-scaled)
//   0-5  popularity  (log-scaled)
// yearEvidence 暂存入参数签名，供未来逻辑扩展使用，当前评分不直接使用该值
function scoreCandidates(candidates, searchTerm, releaseYear, tmdbTypeGuess, yearConfidence, yearEvidence) { // eslint-disable-line no-unused-vars
  const normSearch = normalizeTitle(searchTerm);

  return candidates
    .map(c => {
      const normTitle    = normalizeTitle(c.title);
      const normOriginal = normalizeTitle(c.original_title || '');
      let score = 0;

      if (normTitle === normSearch)         score += 50;
      else if (normOriginal === normSearch) score += 40;

      // 年份置信度为 high 时给予适度加/减分；low/null 时只小幅加分，不惩罚误差
      if (releaseYear && c.year) {
        const match = c.year === releaseYear;
        const off1  = Math.abs(c.year - releaseYear) === 1;
        if (yearConfidence === 'high') {
          if (match)      score += 6;
          else if (off1)  score += 2;
          else            score -= 3;
        } else {
          // low 或 null：仅小幅正向加分，绝不惩罚
          if (match)      score += 3;
          else if (off1)  score += 1;
          // mismatch: 0
        }
      }

      if (tmdbTypeGuess !== 'unknown' && c.media_type) {
        score += c.media_type === tmdbTypeGuess ? 10 : -15;
      }

      score += Math.min(Math.log((c.vote_count || 0) + 1) * 1.5, 15);
      score += Math.min(Math.log((c.popularity  || 0) + 1),       5);

      return { ...c, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function insertMovie(db, details) {
  const existing = db.prepare('SELECT id FROM movies WHERE tmdb_id = ?').get(details.tmdb_id);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO movies (tmdb_id, title, original_title, year, release_date, poster_path, backdrop_path,
                        overview, director, genres, rating, runtime, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    details.tmdb_id, details.title, details.original_title, details.year, details.release_date,
    details.poster_path, details.backdrop_path, details.overview,
    details.director, details.genres, details.rating, details.runtime,
    details.media_type
  );
  return result.lastInsertRowid;
}

async function runPipeline(job, config) {
  const db = getDb();
  const seenStmt = db.prepare('SELECT id, status FROM sources WHERE video_id = ?');

  const videos = await fetchPlaylistVideos(job.playlistId, config.youtubeApiKey);
  job.total = videos.length;

  for (const video of videos) {
    job.processed++;

    try {
      // Deduplication. forceRescan re-processes pending sources by deleting them first;
      // confirmed and skipped sources are never re-run.
      const existing = seenStmt.get(video.video_id);
      if (existing) {
        if (!job.forceRescan || existing.status !== 'pending') {
          job.skipped++;
          continue;
        }
        db.prepare('DELETE FROM sources WHERE id = ?').run(existing.id);
      }

      const llmResult = await identifyMovie(video, config);

      if (llmResult.is_clip_or_scene) {
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'skipped', null, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, JSON.stringify(llmResult));
        job.skipped++;
        continue;
      }

      if (llmResult.tmdb_type_guess === 'unknown' || llmResult.detectedTitle === 'Unknown') {
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'skipped', null, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, JSON.stringify(llmResult));
        job.skipped++;
        continue;
      }

      // --- TMDB search ---
      // alt_titles is optional; the LLM schema may add it in future.
      const searchTitles = [llmResult.searchTerm, ...(llmResult.alt_titles || [])].filter(Boolean);
      const type = llmResult.tmdb_type_guess; // 'movie' | 'tv' | 'unknown'

      // 年份不传给 TMDB 搜索接口，由评分系统单独处理年份匹配（避免 TMDB 年份过滤遗漏结果）
      const searchResults = await Promise.all(
        searchTitles.map(t => searchTmdb(t, null, type, config.tmdbApiKey))
      );

      // Merge results from all searches, deduplicated by TMDB id.
      const seenIds = new Set();
      const merged = [];
      for (const results of searchResults) {
        for (const r of results) {
          if (!seenIds.has(r.id)) { seenIds.add(r.id); merged.push(r); }
        }
      }

      const scored = scoreCandidates(
        merged, llmResult.searchTerm, llmResult.release_year_guess, type,
        llmResult.release_year_confidence, llmResult.release_year_evidence
      );

      const rawMatchData = {
        ...llmResult,
        tmdb_candidates: scored.slice(0, 3),
        top_score:    scored[0]?.score ?? null,
        second_score: scored[1]?.score ?? null,
        match_reason: null,
      };

      if (scored.length === 0) {
        rawMatchData.match_reason = 'no_candidates';
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'pending', null, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, JSON.stringify(rawMatchData));
        job.pending_review++;
        continue;
      }

      const top    = scored[0];
      const second = scored[1];
      const scoreGap     = top.score - (second?.score ?? 0);
      const normSearch   = normalizeTitle(llmResult.searchTerm);
      const topTitleExact =
        normalizeTitle(top.title)          === normSearch ||
        normalizeTitle(top.original_title) === normSearch;
      const directorGuess = llmResult.director_guess || null;

      // Count how many of the scored candidates share an exact normalized title.
      const exactMatchCount = scored.filter(c =>
        normalizeTitle(c.title) === normSearch ||
        normalizeTitle(c.original_title) === normSearch
      ).length;

      let confirmed       = false;
      let matchReason     = null;
      let confirmedDetails = null;

      // 路径1：导演验证——遍历前3名候选，先做标题相容性检查（避免为无关结果拉取 credits）
      if (!confirmed && directorGuess !== null) {
        for (const candidate of scored.slice(0, 3)) {
          // 标题与搜索词不相容则跳过，不发起 API 请求
          const titleCompatible =
            normalizeTitle(candidate.title)          === normSearch ||
            normalizeTitle(candidate.original_title) === normSearch;
          if (!titleCompatible) continue;

          const details = await getDetails(candidate.id, candidate.media_type, config.tmdbApiKey);
          if (directorsMatch(directorGuess, details.directors)) {
            confirmed        = true;
            matchReason      = 'director';
            confirmedDetails = details;
            break;
          }
        }
      }

      // Auto-confirm path 2 — exact title + explicit year (both required).
      if (!confirmed && topTitleExact && llmResult.release_year_guess && top.year === llmResult.release_year_guess) {
        confirmed   = true;
        matchReason = 'exact_title_year';
      }

      // Guard — multiple candidates share the same normalized title and there is no
      // year or director signal to break the tie: always send to review.
      if (!confirmed && exactMatchCount > 1 && !llmResult.release_year_guess && !directorGuess) {
        matchReason = 'ambiguous_same_title';
      }
      // Auto-confirm path 3 — decisive score gap + single exact title match.
      // exactMatchCount === 1 prevents this from firing when "Batman" (1989) and
      // "Batman" (2003) both match; requiring a single exact match ensures we know
      // which film the gap is about.
      else if (!confirmed && scoreGap > 30 && topTitleExact && exactMatchCount === 1) {
        confirmed   = true;
        matchReason = 'gap_and_title';
      }

      // 路径4：规范主导——当顶部候选的投票数对次位候选具有压倒性优势时自动确认
      // 需同时满足：标题精确匹配、无导演提示、年份无高置信度冲突、分差 ≥ 15
      if (!confirmed && topTitleExact && directorGuess === null) {
        // 若年份置信度为 high 且存在年份冲突，则不自动确认
        const noYearConflict =
          llmResult.release_year_confidence !== 'high' ||
          !llmResult.release_year_guess ||
          top.year === llmResult.release_year_guess;
        if (
          noYearConflict &&
          top.vote_count >= 4 * (second?.vote_count ?? 0) + 1 &&
          scoreGap >= 15
        ) {
          confirmed   = true;
          matchReason = 'canonical_dominance';
        }
      }

      rawMatchData.match_reason = matchReason;
      const rawMatch = JSON.stringify(rawMatchData);

      if (confirmed) {
        if (!confirmedDetails) {
          confirmedDetails = await getDetails(top.id, top.media_type, config.tmdbApiKey);
        }
        const movieId = insertMovie(db, confirmedDetails);
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, movie_id, status, confidence, raw_match)
          VALUES (?, ?, ?, ?, 'confirmed', null, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, movieId, rawMatch);
        job.confirmed++;
      } else {
        db.prepare(`
          INSERT OR IGNORE INTO sources (video_id, video_title, playlist_id, status, confidence, raw_match)
          VALUES (?, ?, ?, 'pending', null, ?)
        `).run(video.video_id, video.video_title, video.playlist_id, rawMatch);
        job.pending_review++;
      }
    } catch (err) {
      job.errors.push({ video_id: video.video_id, error: err.message });
    }
  }

  job.status = 'done';
}

async function startJob(playlistId, config, forceRescan = false) {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    playlistId,
    forceRescan,
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
