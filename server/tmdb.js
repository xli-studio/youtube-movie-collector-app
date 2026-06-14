const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function searchMovie(title, year, apiKey) {
  const params = { api_key: apiKey, query: title };
  if (year) params.year = year;

  const response = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 15000 });
  return response.data.results || [];
}

async function getMovieDetails(tmdbId, apiKey) {
  const response = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'credits' },
    timeout: 15000,
  });

  const data = response.data;
  const director = data.credits?.crew?.find(p => p.job === 'Director')?.name || null;
  const genres = data.genres?.map(g => g.name) || [];
  const year = data.release_date ? parseInt(data.release_date.slice(0, 4)) : null;

  return {
    tmdb_id: data.id,
    title: data.title,
    original_title: data.original_title,
    year,
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path,
    overview: data.overview,
    director,
    genres: JSON.stringify(genres),
    rating: data.vote_average,
    runtime: data.runtime,
  };
}

module.exports = { searchMovie, getMovieDetails };
