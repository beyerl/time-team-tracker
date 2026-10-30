/**
 * YouTube links the user set by hand, overriding the catalogue's match.
 *
 * Links are stored as canonical watch URLs keyed by episode id, so they read
 * naturally in an exported backup and survive any catalogue rebuild.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

/**
 * The video id in anything a user might paste: a watch, share, embed, shorts
 * or live URL, with or without the scheme, or a bare id. Null when it is not
 * a YouTube video.
 */
export function parseYouTubeId(input) {
  const text = String(input ?? '').trim();
  if (VIDEO_ID.test(text)) return text;

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOST.test(url.hostname)) return null;

  if (/youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.split('/')[1];
    return VIDEO_ID.test(id ?? '') ? id : null;
  }
  const fromQuery = url.searchParams.get('v');
  if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery;
  const fromPath = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(url.pathname);
  return fromPath ? fromPath[1] : null;
}

export const watchUrlFor = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/** A pasted link as the canonical URL that gets stored, or null if unusable. */
export function canonicalVideoUrl(input) {
  const id = parseYouTubeId(input);
  return id ? watchUrlFor(id) : null;
}

/** The `video` object the UI expects, built from a stored link. */
export function videoFromLink(link) {
  const id = parseYouTubeId(link);
  if (!id) return null;
  return {
    id,
    url: watchUrlFor(id),
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    title: null,
    durationSeconds: null,
    manual: true,
  };
}

/**
 * Episodes with the user's links applied. The catalogue's own match is kept
 * as `catalogueVideo`, so a link can be removed again.
 */
export function applyVideoLinks(episodes, links = {}) {
  return episodes.map((episode) => {
    const video = links[episode.id] ? videoFromLink(links[episode.id]) : null;
    return video
      ? { ...episode, video, catalogueVideo: episode.video ?? null }
      : { ...episode, catalogueVideo: episode.video ?? null };
  });
}
