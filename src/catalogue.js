/**
 * Loads the generated catalogue and derives the views the UI needs.
 * The file is fetched at runtime (rather than bundled) so a refreshed
 * catalogue reaches users without a rebuild, and so the Android build can ship
 * the same asset.
 */

export async function loadCatalogue(url = 'catalogue.json') {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load the catalogue (${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data.series)) throw new Error('The catalogue file is malformed.');
  return data;
}

/** Every episode across all series, in broadcast order. */
export const allEpisodes = (catalogue) =>
  catalogue.series.flatMap((group) =>
    group.episodes.map((episode) => ({ ...episode, groupId: group.id, groupTitle: group.title })),
  );

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatAirDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Label such as "S07E03", or "Special" for one-offs. */
export function episodeCode(episode) {
  if (episode.kind === 'special' || episode.series == null) return 'Special';
  return `S${String(episode.series).padStart(2, '0')}E${String(episode.episode ?? 0).padStart(2, '0')}`;
}

/** Text blob an episode is searched against. */
const haystack = (episode) =>
  [episode.title, episode.site, episode.county, episode.note, episode.video?.title, episodeCode(episode)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function filterEpisodes(episodes, { query = '', filter = 'all', isWatched }) {
  const needle = query.trim().toLowerCase();
  return episodes.filter((episode) => {
    if (needle && !haystack(episode).includes(needle)) return false;
    switch (filter) {
      case 'unwatched':
        return !isWatched(episode.id);
      case 'watched':
        return isWatched(episode.id);
      case 'with-video':
        return Boolean(episode.video);
      case 'no-video':
        return !episode.video;
      default:
        return true;
    }
  });
}

/** Pick a random unwatched episode, preferring ones that have a video. */
export function randomUnwatched(episodes, isWatched) {
  const unwatched = episodes.filter((episode) => !isWatched(episode.id));
  if (!unwatched.length) return null;
  const withVideo = unwatched.filter((episode) => episode.video);
  const pool = withVideo.length ? withVideo : unwatched;
  return pool[Math.floor(Math.random() * pool.length)];
}
