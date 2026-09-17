/**
 * Resolves Time Team uploads to video ids + thumbnails, so nobody ever has to
 * paste a YouTube link by hand.
 *
 * Two routes, tried in order:
 *   1. YouTube Data API v3, when a YOUTUBE_API_KEY is available. Stable, quota'd.
 *   2. The public InnerTube endpoint the website itself uses. No key required.
 *
 * Both funnel into the same deep-walk extractor: rather than reaching into
 * fixed response paths (which YouTube reshuffles regularly) we walk the whole
 * payload and pick up anything that looks like a video.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** `SOCS=CAI` skips the EU consent interstitial that otherwise replaces the page. */
const BROWSER_HEADERS = {
  'user-agent': UA,
  'accept-language': 'en-GB,en;q=0.9',
  cookie: 'SOCS=CAI; PREF=hl=en&gl=GB',
};

export const thumbnailFor = (videoId, quality = 'hqdefault') =>
  `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;

export const watchUrlFor = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

async function getText(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...BROWSER_HEADERS, ...init.headers } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function getJson(url, init = {}) {
  return JSON.parse(await getText(url, init));
}

/* ------------------------------------------------------------------ parsing */

/** Pull an embedded JSON blob (`ytInitialData = {...};`) out of a channel page. */
export function extractInitialData(html) {
  const markers = [/ytInitialData\s*=\s*/, /window\["ytInitialData"\]\s*=\s*/];
  for (const marker of markers) {
    const match = marker.exec(html);
    if (!match) continue;
    const start = html.indexOf('{', match.index + match[0].length - 1);
    if (start === -1) continue;
    const json = sliceBalancedJson(html, start);
    if (json) {
      try {
        return JSON.parse(json);
      } catch {
        /* try the next marker */
      }
    }
  }
  return null;
}

/** Walk forward from an opening brace to its match, ignoring braces in strings. */
export function sliceBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Flatten YouTube's `{runs:[{text}]}` / `{simpleText}` / `{content}` text nodes. */
export function readText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text ?? '').join('');
  return '';
}

/** "1:02:33" -> 3753 seconds. */
export function parseDuration(label) {
  const parts = String(label ?? '')
    .trim()
    .split(':')
    .map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * YouTube no longer ships `videoRenderer` on channel pages - the grid is built
 * from `lockupViewModel`, which scatters the video id across several fields and
 * nests the title differently. Rather than chase exact paths (which move), each
 * item subtree is searched for the first thing that looks like an id, a title
 * and a duration. Older renderer shapes still parse, so continuations that
 * return them keep working.
 */

/** Keys whose values are a single video's subtree. */
const ITEM_KEYS = new Set([
  'lockupViewModel',
  'videoRenderer',
  'gridVideoRenderer',
  'playlistVideoRenderer',
  'compactVideoRenderer',
  'reelItemRenderer',
]);

/** Fields that have been observed to carry the 11-character video id. */
const ID_KEYS = ['contentId', 'videoId', 'addedVideoId', 'animationActivationTargetId'];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const THUMB_URL = /i\.ytimg\.com\/(?:vi|vi_webp|an_webp)\/([A-Za-z0-9_-]{11})\//;
const CLOCK = /^\d{1,3}(?::\d{2}){1,2}$/;

/** Button labels and overlay text that must never be mistaken for a title. */
const NOT_A_TITLE = /^(watch later|now playing|add to queue|share|download|save|shorts|live)$/i;

const isVideoId = (value) => typeof value === 'string' && VIDEO_ID.test(value);

/** Depth-first search of an item subtree for the first video id it mentions. */
export function findVideoId(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findVideoId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of ID_KEYS) {
    if (isVideoId(node[key])) return node[key];
  }
  if (typeof node.url === 'string') {
    const match = THUMB_URL.exec(node.url);
    if (match) return match[1];
  }
  for (const value of Object.values(node)) {
    const found = findVideoId(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The first `title`-keyed text in the subtree that is not button furniture. */
export function findTitle(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findTitle(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of ['title', 'headline']) {
    const text = readText(node[key]).trim();
    if (text && !NOT_A_TITLE.test(text)) return text;
  }
  for (const value of Object.values(node)) {
    const found = findTitle(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The first clock-shaped string in the subtree, as seconds. */
export function findDurationSeconds(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDurationSeconds(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.lengthSeconds === 'string' && Number(node.lengthSeconds) > 0) {
    return Number(node.lengthSeconds);
  }
  for (const [key, value] of Object.entries(node)) {
    const text = readText(value).trim();
    if (text && CLOCK.test(text) && /text|length|duration|badge/i.test(key)) {
      return parseDuration(text);
    }
  }
  for (const value of Object.values(node)) {
    const found = findDurationSeconds(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Collect every video in an InnerTube payload, plus the continuation tokens
 * needed to ask for the next page.
 */
export function harvestVideos(payload) {
  const videos = new Map();
  const continuations = [];
  const seen = new Set();

  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const token = node.continuationCommand?.token ?? node.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === 'string') continuations.push(token);

    for (const [key, value] of Object.entries(node)) {
      if (ITEM_KEYS.has(key) && value && typeof value === 'object') {
        const id = findVideoId(value);
        const title = findTitle(value);
        if (id && title && !videos.has(id)) {
          videos.set(id, {
            id,
            title,
            durationSeconds: findDurationSeconds(value),
            publishedLabel: readText(value.publishedTimeText) || null,
          });
        }
      }
      visit(value);
    }
  };

  visit(payload);
  return { videos: [...videos.values()], continuations: [...new Set(continuations)] };
}

/* ------------------------------------------------------------------ fetching */

/** Resolve a channel handle (`@TimeTeamOfficial`) to its page HTML. */
async function fetchChannelPage(handle, tab = 'videos') {
  const clean = handle.startsWith('@') ? handle : `@${handle}`;
  return getText(`https://www.youtube.com/${clean}/${tab}?hl=en&gl=GB`);
}

/**
 * Page through a channel's uploads using the same InnerTube endpoint the
 * website uses. No API key needed.
 */
export async function fetchChannelVideosViaInnerTube(handle, { maxPages = 40, log = () => {} } = {}) {
  const html = await fetchChannelPage(handle);
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] ?? '2.20240101.00.00';
  const initial = extractInitialData(html);
  if (!initial) throw new Error(`could not read channel data for ${handle}`);

  const collected = new Map();
  let { videos, continuations } = harvestVideos(initial);
  for (const video of videos) collected.set(video.id, video);
  log(`  ${handle}: ${collected.size} videos on first page`);

  const endpoint = `https://www.youtube.com/youtubei/v1/browse${apiKey ? `?key=${apiKey}` : ''}`;
  const visitedTokens = new Set();
  let queue = continuations;

  for (let page = 0; page < maxPages && queue.length; page += 1) {
    const token = queue.shift();
    if (!token || visitedTokens.has(token)) continue;
    visitedTokens.add(token);

    let payload;
    try {
      payload = await getJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'GB' } },
          continuation: token,
        }),
      });
    } catch (error) {
      log(`  ${handle}: continuation failed (${error.message})`);
      break;
    }

    const next = harvestVideos(payload);
    const before = collected.size;
    for (const video of next.videos) collected.set(video.id, video);
    queue = queue.concat(next.continuations.filter((item) => !visitedTokens.has(item)));
    if (collected.size === before) break; // nothing new - stop paging
    log(`  ${handle}: ${collected.size} videos after page ${page + 2}`);
  }

  return [...collected.values()];
}

/** Uploads via the official Data API, when a key is configured. */
export async function fetchChannelVideosViaApi(handle, apiKey, { log = () => {} } = {}) {
  const clean = handle.startsWith('@') ? handle.slice(1) : handle;
  const channel = await getJson(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(clean)}&key=${apiKey}`,
  );
  const uploads = channel?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`no uploads playlist for ${handle}`);

  const videos = [];
  let pageToken = '';
  do {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50` +
      `&playlistId=${uploads}&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await getJson(url);
    for (const item of page.items ?? []) {
      const id = item?.contentDetails?.videoId;
      if (!id) continue;
      videos.push({
        id,
        title: (item.snippet?.title ?? '').trim(),
        durationSeconds: null,
        publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
      });
    }
    pageToken = page.nextPageToken ?? '';
    log(`  ${handle}: ${videos.length} videos`);
  } while (pageToken);

  return videos;
}

/**
 * Collect uploads from every configured channel, preferring the Data API and
 * falling back to InnerTube. A failing channel never sinks the whole build.
 */
export async function collectChannelVideos(handles, { apiKey, log = () => {} } = {}) {
  const byId = new Map();
  const problems = [];

  for (const handle of handles) {
    try {
      const videos = apiKey
        ? await fetchChannelVideosViaApi(handle, apiKey, { log })
        : await fetchChannelVideosViaInnerTube(handle, { log });
      for (const video of videos) {
        if (!byId.has(video.id)) byId.set(video.id, { ...video, channel: handle });
      }
      log(`  ${handle}: collected ${videos.length}`);
    } catch (error) {
      problems.push(`${handle}: ${error.message}`);
      log(`  ${handle}: FAILED - ${error.message}`);
    }
  }

  return { videos: [...byId.values()], problems };
}
