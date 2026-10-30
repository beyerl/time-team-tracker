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

/**
 * Pull an explicit series/episode marker out of a video title. Covers the
 * shapes the channels use: "S03E07", "S3 E7", "S5 EP1", "S06E11",
 * "Series 3 Episode 7" and "(Full Episode S15E06)".
 */
export function extractSeriesEpisode(value) {
  const text = deaccent(value).toLowerCase();
  const compact = text.match(/\bs(?:eries)?\s*(\d{1,2})\s*(?:ep(?:isode)?|e|x)\s*(\d{1,3})\b/);
  if (compact) return { series: Number(compact[1]), episode: Number(compact[2]) };
  const series = text.match(/\bseries\s*(\d{1,2})\b/);
  const episode = text.match(/\bepisode\s*(\d{1,3})\b/);
  if (series && episode) return { series: Number(series[1]), episode: Number(episode[1]) };
  if (series) return { series: Number(series[1]), episode: null };
  return null;
}

/**
 * Uploads that mention an episode but are not the episode: commentaries,
 * Teatime Q&As, previews, marathons and the like.
 */
const NOT_AN_EPISODE =
  /\b(commentary|teatime|tea time|preview|trailer|masterclass|q\s*&\s*a|marathon|compilation|best of|dig diar(?:y|ies)|editor'?s choice|top \d+|reaction|shorts?)\b/i;

/** The year an episode first aired: its own air date, else its series' year. */
export function episodeYear(episode) {
  const fromDate = /^(\d{4})/.exec(episode.airDate ?? '')?.[1];
  if (fromDate) return Number(fromDate);
  return episode.seriesYear ?? null;
}

/**
 * Episodes from the original Channel 4 run (before the 2020s revival) live on
 * the Time Team Classics channel; later digs live on the main channel.
 */
export function isClassicEra(episode, cutoffYear = 2020) {
  const year = episodeYear(episode);
  if (year != null) return year < cutoffYear;
  return episode.series != null && episode.series <= 20;
}

/**
 * Why a video cannot be the given episode, or null when it may be.
 *
 * `rules` comes from catalogue.config.json:
 *   classicChannel, classicCutoffYear       - pre-cutoff episodes only match this channel
 *   minimumFullEpisodeSeconds               - anything shorter is a clip
 *   classicMinimumSeconds/MaximumSeconds    - a classic episode runs ~50 minutes
 */
export function videoRejection(episode, video, rules = {}, marker = extractSeriesEpisode(video.title)) {
  const title = video.title ?? '';
  if (NOT_AN_EPISODE.test(title)) return 'not a full episode (commentary, preview, compilation...)';

  const seconds = video.durationSeconds ?? null;
  const minimum = rules.minimumFullEpisodeSeconds ?? 0;
  if (seconds != null && seconds < minimum) return `too short (${Math.round(seconds / 60)} min)`;

  if (!rules.classicChannel) return null;
  if (!isClassicEra(episode, rules.classicCutoffYear)) {
    // The Classics channel only carries the original run.
    return video.channel === rules.classicChannel ? `${rules.classicChannel} only has pre-${rules.classicCutoffYear ?? 2020} episodes` : null;
  }

  if (video.channel && video.channel !== rules.classicChannel) {
    return `pre-${rules.classicCutoffYear ?? 2020} episodes must come from ${rules.classicChannel}`;
  }
  if (seconds != null && rules.classicMinimumSeconds && seconds < rules.classicMinimumSeconds) {
    return `too short for a full episode (${Math.round(seconds / 60)} min)`;
  }
  if (seconds != null && rules.classicMaximumSeconds && seconds > rules.classicMaximumSeconds) {
    return `too long for a single episode (${Math.round(seconds / 60)} min)`;
  }

  if (marker?.episode != null) {
    if (episode.kind === 'special') return `special cannot match an S${marker.series}E${marker.episode} upload`;
    if (marker.series !== episode.series || marker.episode !== episode.episode) {
      return `title says S${marker.series}E${marker.episode}`;
    }
  }
  return null;
}

/** Coverage of the episode's title, or of its dig location, by the video title. */
export function titleCoverage(episode, video, idf) {
  let coverage = coverageScore(episode.title, video.title, idf);
  // The site alone: a county ("Yorkshire") is shared by far too many digs.
  if (episode.site) {
    coverage = Math.max(coverage, coverageScore(episode.site, video.title, idf) * 0.95);
  }
  return coverage;
}

/**
 * Series/episode markers to trust, keyed by video id.
 *
 * The channels have numbered some uploads differently from the broadcast
 * order: Hylton Castle (aired as series 2 episode 5) is uploaded as "S2 E2",
 * and the Saxon graves of episode 2 as "S2 E5". So a marker is dropped to
 * series-only - leaving the upload to compete on its title within that series -
 * when its title plainly describes a different dig from the same series, and
 * then also on any weakly matching upload that claims the dig thus displaced.
 */
export function trustedMarkers(videos, episodes, idf) {
  const find = (series, episode) => episodes.find((e) => e.series === series && e.episode === episode);
  const markers = new Map();
  const weak = new Map();
  const displaced = new Set();

  for (const video of videos) {
    const marker = extractSeriesEpisode(video.title);
    markers.set(video.id, marker);
    if (marker?.episode == null) continue;
    const labelled = find(marker.series, marker.episode);
    if (!labelled) continue;
    const own = titleCoverage(labelled, video, idf);
    if (own >= 0.35) continue;
    weak.set(video.id, labelled);
    const rival = episodes.find(
      (e) => e !== labelled && e.series === marker.series && titleCoverage(e, video, idf) >= Math.max(0.5, own + 0.3),
    );
    if (rival) {
      markers.set(video.id, { series: marker.series, episode: null });
      displaced.add(rival);
    }
  }
  for (const [videoId, labelled] of weak) {
    if (displaced.has(labelled)) markers.set(videoId, { series: labelled.series, episode: null });
  }
  return markers;
}

/**
 * Score a single episode/video pair. Title coverage decides, except that an
 * explicit series/episode marker agreeing with the episode is decisive (the
 * Classics channel renames uploads, but keeps the marker) and one that
 * disagrees rules the pair out.
 */
export function scorePair(episode, video, idf, marker = extractSeriesEpisode(video.title)) {
  const coverage = titleCoverage(episode, video, idf);
  if (marker && episode.series != null) {
    if (marker.series !== episode.series) return 0;
    // Above 1 on purpose, so an upload that only resembles the title never
    // beats one that states the right series and episode.
    if (marker.episode === episode.episode) return 1 + coverage;
    if (marker.episode != null) return 0;
    return coverage + 0.08;
  }
  return coverage;
}

/**
 * Assign at most one video per episode and one episode per video, best pairs
 * first. Greedy over a globally sorted candidate list: good enough here and far
 * easier to reason about than an optimal assignment. Pairs that `rules` rule
 * out (see videoRejection) are never considered.
 *
 * @returns {Map<string, {video: object, confidence: number}>} keyed by episode id
 */
export function matchEpisodesToVideos(episodes, videos, { threshold = 0.62, rules = null } = {}) {
  // Sites belong in the corpus too: otherwise a rare place name ("Oakham")
  // falls back to the default weight and is outweighed by "castle".
  const idf = buildIdf([
    ...episodes.map((e) => e.title),
    ...episodes.filter((e) => e.site && e.site !== e.title).map((e) => e.site),
    ...videos.map((v) => v.title),
  ]);
  const markers = trustedMarkers(videos, episodes, idf);
  const candidates = [];
  for (const episode of episodes) {
    for (const video of videos) {
      const marker = markers.get(video.id);
      if (rules && videoRejection(episode, video, rules, marker)) continue;
      const confidence = scorePair(episode, video, idf, marker);
      if (confidence >= threshold) candidates.push({ episode, video, confidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  const byEpisode = new Map();
  const usedVideos = new Set();
  for (const { episode, video, confidence } of candidates) {
    if (byEpisode.has(episode.id) || usedVideos.has(video.id)) continue;
    byEpisode.set(episode.id, { video, confidence: Number(Math.min(1, confidence).toFixed(3)) });
    usedVideos.add(video.id);
  }
  return byEpisode;
}
