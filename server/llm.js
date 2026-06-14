const axios = require('axios');

const SYSTEM_PROMPT = `You are a movie identification assistant. I will give you a YouTube video title and description. Determine whether the video is related to a specific movie (trailer, clip, review, OST, etc.), and if so, extract the movie details.

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
If the video is unrelated to a movie (e.g. vlog, tutorial), set is_movie_related to false and all other fields to null.`;

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Could not parse LLM response as JSON: ${text.slice(0, 200)}`);
  }
}

async function identifyMovie(video, config) {
  const userMessage = `Title: ${video.video_title}\nDescription: ${video.description.slice(0, 500) || '(none)'}`;

  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const content = response.data.choices[0].message.content;
  return parseJsonSafely(content);
}

module.exports = { identifyMovie };
