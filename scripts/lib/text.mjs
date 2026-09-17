/**
 * Title normalisation and fuzzy matching helpers.
 *
 * These are pure functions on purpose: the network-facing parts of the
 * catalogue build cannot be tested offline, but the matching logic - which is
 * what decides whether an episode gets a video and a thumbnail - can be.
 */

/** Words that carry no signal when matching a YouTube title to an episode. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
  'time', 'team', 'series', 'season', 'episode', 'ep', 'part', 'full', 'hd', 'remastered',
  'archaeology', 'archaeological', 'documentary', 'classic', 'classics', 'official',
]);

/** Channel furniture that regularly shows up in uploaded episode titles. */
const NOISE_PATTERNS = [
  /\|\s*time team.*$/i,
  /\btime team\b/gi,
  /\bfull episode\b/gi,
  /\bfree documentary\b/gi,
  /\bs\d{1,2}\s*[e|x]\s*\d{1,2}\b/gi,
  /\bseries\s*\d{1,2}\b/gi,
  /\bseason\s*\d{1,2}\b/gi,
  /\bepisode\s*\d{1,3}\b/gi,
  /\b(19|20)\d{2}\b/g,
];
// Note: bracketed and parenthesised text is deliberately kept - uploads very
// often carry the site name there, e.g. "Lost Fortress (Athelney, Somerset)".


/** Strip accents so "Caerwent" style spellings survive round-tripping. */
export function deaccent(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Lowercase, drop channel furniture and punctuation, collapse whitespace. */
export function normaliseTitle(value) {
  let text = deaccent(value).toLowerCase();
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, ' ');
  text = text.replace(/[^a-z0-9]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Significant tokens of a title, with stop words and 1-character noise removed. */
export function tokenise(value) {
  return normaliseTitle(value)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Inverse document frequency over a corpus of titles, so that distinctive place
 * names ("athelney") outweigh words every other episode also uses ("castle").
 */
export function buildIdf(titles) {
  const documentCount = titles.length || 1;
  const seenIn = new Map();
  for (const title of titles) {
    for (const token of new Set(tokenise(title))) {
      seenIn.set(token, (seenIn.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map();
  for (const [token, count] of seenIn) {
    idf.set(token, Math.log(1 + documentCount / count));
  }
  return idf;
}

const weightOf = (token, idf) => idf?.get(token) ?? Math.log(2);

/**
 * How much of the episode title is covered by the video title, weighted by how
 * distinctive each word is. Returns 0..1.
 */
export function coverageScore(episodeTitle, videoTitle, idf) {
  const wanted = new Set(tokenise(episodeTitle));
  if (wanted.size === 0) return 0;
  const found = new Set(tokenise(videoTitle));
  let total = 0;
  let matched = 0;
  for (const token of wanted) {
    const weight = weightOf(token, idf);
    total += weight;
    if (found.has(token)) matched += weight;
    else if ([...found].some((candidate) => isNearMiss(token, candidate))) matched += weight * 0.7;
  }
  return total === 0 ? 0 : matched / total;
}

/** Tolerates a single typo / plural / spelling variant between two words. */
export function isNearMiss(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  return levenshtein(a, b) === 1;
}

/** Standard iterative Levenshtein distance. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Pull an explicit "S03E07" / "Series 3 Episode 7" marker out of a video title. */
export function extractSeriesEpisode(value) {
  const text = deaccent(value).toLowerCase();
  const compact = text.match(/\bs(?:eries)?\s*(\d{1,2})\s*(?:[ex]|episode)\s*(\d{1,3})\b/);
  if (compact) return { series: Number(compact[1]), episode: Number(compact[2]) };
  const series = text.match(/\bseries\s*(\d{1,2})\b/);
  const episode = text.match(/\bepisode\s*(\d{1,3})\b/);
  if (series && episode) return { series: Number(series[1]), episode: Number(episode[2]) };
  if (series) return { series: Number(series[1]), episode: null };
  return null;
}

/**
 * Score a single episode/video pair. Combines title coverage with a bonus when
 * the video title states a series/episode number that agrees with the episode.
 */
export function scorePair(episode, video, idf) {
  let score = coverageScore(episode.title, video.title, idf);
  if (episode.site) {
    score = Math.max(score, coverageScore(episode.site, video.title, idf) * 0.95);
  }
  const marker = extractSeriesEpisode(video.title);
  if (marker && episode.series != null) {
    if (marker.series === episode.series) {
      score += marker.episode === episode.episode ? 0.25 : 0.08;
    } else {
      score -= 0.2;
    }
  }
  return Math.max(0, Math.min(1, score));
}

/**
 * Assign at most one video per episode and one episode per video, best pairs
 * first. Greedy over a globally sorted candidate list: good enough here and far
 * easier to reason about than an optimal assignment.
 *
 * @returns {Map<string, {video: object, confidence: number}>} keyed by episode id
 */
export function matchEpisodesToVideos(episodes, videos, { threshold = 0.62 } = {}) {
  const idf = buildIdf([...episodes.map((e) => e.title), ...videos.map((v) => v.title)]);
  const candidates = [];
  for (const episode of episodes) {
    for (const video of videos) {
      const confidence = scorePair(episode, video, idf);
      if (confidence >= threshold) candidates.push({ episode, video, confidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  const byEpisode = new Map();
  const usedVideos = new Set();
  for (const { episode, video, confidence } of candidates) {
    if (byEpisode.has(episode.id) || usedVideos.has(video.id)) continue;
    byEpisode.set(episode.id, { video, confidence: Number(confidence.toFixed(3)) });
    usedVideos.add(video.id);
  }
  return byEpisode;
}
