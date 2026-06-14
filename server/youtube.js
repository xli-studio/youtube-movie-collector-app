const axios = require('axios');

async function fetchPlaylistVideos(playlistId, apiKey) {
  const videos = [];
  let pageToken = null;

  do {
    const params = {
      part: 'snippet',
      maxResults: 50,
      playlistId,
      key: apiKey,
    };
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', { params });
    const data = response.data;

    for (const item of data.items || []) {
      const snippet = item.snippet;
      if (snippet.resourceId?.kind === 'youtube#video') {
        videos.push({
          video_id: snippet.resourceId.videoId,
          video_title: snippet.title,
          description: snippet.description || '',
          playlist_id: playlistId,
        });
      }
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return videos;
}

module.exports = { fetchPlaylistVideos };
