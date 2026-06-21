const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';

// Normalize a raw TMDB result (from any search endpoint) to a common shape.
// `defaultMediaType` is used when the raw result has no media_type field
// (i.e. from /search/movie or /search/tv, which don't include it).
function normalizeResult(r, defaultMediaType) {
  const release = r.release_date || r.first_air_date || '';
  const mediaType = r.media_type || (defaultMediaType === 'unknown' ? 'movie' : defaultMediaType);
  return {
    id: r.id,
    media_type: mediaType,
    title: r.title || r.name || '',
    original_title: r.original_title || r.original_name || '',
    year: release ? parseInt(release.slice(0, 4)) : null,
    vote_count: r.vote_count || 0,
    popularity: r.popularity || 0,
    poster_path: r.poster_path || null,
  };
}

// Search TMDB using the appropriate endpoint for the content type.
//   type 'movie'   → /search/movie
//   type 'tv'      → /search/tv
//   anything else  → /search/multi (persons filtered out)
async function searchTmdb(title, year, type, apiKey) {
  const isMovie = type === 'movie';
  const isTv    = type === 'tv';
  const endpoint = isMovie ? '/search/movie' : isTv ? '/search/tv' : '/search/multi';

  // year 参数保留于函数签名供调用方传入，但不转发给 TMDB API——
  // 年份匹配由 pipeline 评分系统负责，避免 API 年份过滤遗漏候选结果
  const params = { api_key: apiKey, query: title };

  const response = await axios.get(`${TMDB_BASE}${endpoint}`, { params, timeout: 15000 });

  // For multi, exclude person results; for movie/tv, all results are the right type.
  const isMulti = !isMovie && !isTv;
  const raw = (response.data.results || []).filter(r =>
    !isMulti || r.media_type === 'movie' || r.media_type === 'tv'
  );

  const results = raw.map(r => normalizeResult(r, type));
  console.log(
    `[TMDB ${endpoint}] "${title}" →`,
    results.slice(0, 5).map(r => `"${r.title}" id=${r.id} year=${r.year} type=${r.media_type}`)
  );
  return results;
}

// Fetch full details (including credits) for a movie or TV show.
// `mediaType` determines the TMDB endpoint: 'tv' → /tv/{id}, else → /movie/{id}.
async function getDetails(tmdbId, mediaType, apiKey) {
  const isTv = mediaType === 'tv';
  const endpoint = isTv ? 'tv' : 'movie';

  const response = await axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'credits' },
    timeout: 15000,
  });

  const data = response.data;
  const crew = data.credits?.crew || [];
  const directorCrews = crew.filter(p => p.job === 'Director').map(p => p.name);
  // TV series list creators separately; include them as director equivalents for matching.
  const creators = isTv ? (data.created_by || []).map(p => p.name) : [];
  const directors = [...new Set([...directorCrews, ...creators])];

  const title = data.title || data.name || '';
  const original_title = data.original_title || data.original_name || '';
  const release = data.release_date || data.first_air_date || '';
  const year = release ? parseInt(release.slice(0, 4)) : null;
  const release_date = (isTv ? data.first_air_date : data.release_date) || null;
  const genres = data.genres?.map(g => g.name) || [];
  const runtime = isTv ? (data.episode_run_time?.[0] || null) : (data.runtime || null);

  return {
    tmdb_id: data.id,
    title,
    original_title,
    year,
    release_date,
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path,
    overview: data.overview,
    director: directors[0] || null,
    directors,
    genres: JSON.stringify(genres),
    rating: data.vote_average,
    runtime,
    media_type: isTv ? 'tv' : 'movie',
  };
}

module.exports = { searchTmdb, getDetails };
