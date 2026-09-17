#!/usr/bin/env node
/**
 * Builds public/catalogue.json: every Time Team episode, paired with the
 * YouTube upload it corresponds to.
 *
 * This is the whole point of the project's data layer - nobody pastes a
 * YouTube link by hand. Run it locally with `npm run catalogue`, or let the
 * scheduled workflow keep it current.
 *
 * Flags:
 *   --offline      re-derive the file from what is already committed, no network
 *   --allow-empty  do not fail the run when the lookup produced too little
 *   --quiet        only print the summary
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchEpisodeList } from './lib/wikipedia.mjs';
import { collectChannelVideos, thumbnailFor, watchUrlFor } from './lib/youtube.mjs';
import { matchEpisodesToVideos } from './lib/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'catalogue.json');
const CONFIG = path.join(ROOT, 'scripts', 'catalogue.config.json');

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const allowEmpty = args.has('--allow-empty');
const quiet = args.has('--quiet');
const log = (message) => {
  if (!quiet) console.log(message);
};

/** Stable id so a user's watch history survives catalogue rebuilds. */
export function episodeId(episode) {
  if (episode.kind === 'special') {
    const slug = episode.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `sp-${slug}`.slice(0, 60);
  }
  return `s${episode.series}e${episode.episode}`;
}

/** Group a flat episode list into series, specials last. */
export function groupIntoSeries(episodes) {
  const groups = new Map();
  for (const episode of episodes) {
    const key = episode.kind === 'special' ? 'specials' : `series-${episode.series}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        kind: episode.kind === 'special' ? 'specials' : 'series',
        number: episode.kind === 'special' ? null : episode.series,
        title: episode.kind === 'special' ? 'Specials' : `Series ${episode.series}`,
        year: episode.seriesYear ?? null,
        episodes: [],
      });
    }
    const group = groups.get(key);
    if (group.year == null && episode.seriesYear != null) group.year = episode.seriesYear;
    group.episodes.push(episode);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'series' ? -1 : 1;
    return (a.number ?? 0) - (b.number ?? 0);
  });
  for (const group of ordered) {
    group.episodes.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }
  return ordered;
}

const searchUrlFor = (title) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`Time Team ${title}`)}`;

async function readExistingCatalogue() {
  if (!existsSync(OUTPUT)) return null;
  try {
    return JSON.parse(await readFile(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

/** videoId lookups from a previously built catalogue, keyed by episode id. */
function previousVideoIndex(catalogue) {
  const index = new Map();
  for (const group of catalogue?.series ?? []) {
    for (const episode of group.episodes ?? []) {
      if (episode.video?.id) index.set(episode.id, episode.video);
    }
  }
  return index;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  const existing = await readExistingCatalogue();
  const carriedOver = previousVideoIndex(existing);
  const problems = [];

  let episodes = [];
  let videos = [];

  if (offline) {
    log('Offline mode: rebuilding from the committed catalogue.');
    episodes = (existing?.series ?? []).flatMap((group) =>
      (group.episodes ?? []).map((episode) => ({ ...episode, seriesYear: group.year })),
    );
  } else {
    log('Fetching the episode list from Wikipedia...');
    const wiki = await fetchEpisodeList({ log });
    episodes = wiki.episodes;
    problems.push(...wiki.problems);
    log(`  -> ${episodes.length} episodes`);

    log('Looking up YouTube uploads...');
    const apiKey = process.env.YOUTUBE_API_KEY?.trim();
    log(`  using ${apiKey ? 'the YouTube Data API' : 'the public InnerTube endpoint (no API key set)'}`);
    const channels = await collectChannelVideos(config.channels, { apiKey, log });
    videos = channels.videos;
    problems.push(...channels.problems);
    log(`  -> ${videos.length} uploads across ${config.channels.length} channels`);
  }

  // Fall back to the committed episode list if Wikipedia let us down but we
  // have a good catalogue from a previous run.
  const previousEpisodeCount = (existing?.series ?? []).reduce(
    (total, group) => total + (group.episodes?.length ?? 0),
    0,
  );
  if (!offline && episodes.length < previousEpisodeCount) {
    log(`  episode list looks short (${episodes.length} < ${previousEpisodeCount}); keeping the committed list`);
    problems.push(`episode list fetch returned ${episodes.length}, kept previous ${previousEpisodeCount}`);
    episodes = (existing?.series ?? []).flatMap((group) =>
      (group.episodes ?? []).map((episode) => ({ ...episode, seriesYear: group.year })),
    );
  }

  // Two rows that resolve to the same id would silently merge downstream (they
  // share a watch-history key and a video match), so collisions are dropped
  // rather than left to overwrite each other.
  const seenIds = new Set();
  const duplicates = [];
  const withIds = [];
  for (const episode of episodes) {
    const id = episodeId(episode);
    if (seenIds.has(id)) {
      duplicates.push(`${id} (${episode.title})`);
      continue;
    }
    seenIds.add(id);
    withIds.push({ ...episode, id });
  }
  if (duplicates.length) {
    problems.push(`dropped ${duplicates.length} duplicate episode ids: ${duplicates.slice(0, 8).join(', ')}`);
  }

  log('Matching episodes to uploads...');
  const matches = videos.length
    ? matchEpisodesToVideos(withIds, videos, { threshold: config.matchThreshold })
    : new Map();

  let matchedCount = 0;
  let carriedCount = 0;
  const usedVideoIds = new Set();

  const decorated = withIds.map((episode) => {
    const match = matches.get(episode.id);
    let video = null;
    if (match) {
      video = {
        id: match.video.id,
        title: match.video.title,
        channel: match.video.channel ?? null,
        durationSeconds: match.video.durationSeconds ?? null,
        confidence: match.confidence,
        url: watchUrlFor(match.video.id),
        thumbnail: thumbnailFor(match.video.id),
      };
      matchedCount += 1;
    } else if (carriedOver.has(episode.id)) {
      // A previous run found this one; a thin fetch should not lose it.
      video = carriedOver.get(episode.id);
      carriedCount += 1;
    }
    if (video) usedVideoIds.add(video.id);

    return {
      id: episode.id,
      kind: episode.kind,
      series: episode.series ?? null,
      episode: episode.episode ?? null,
      title: episode.title,
      site: episode.site ?? null,
      county: episode.county ?? null,
      airDate: episode.airDate ?? null,
      note: episode.note ?? null,
      video,
      searchUrl: searchUrlFor(episode.title),
      seriesYear: episode.seriesYear ?? null,
    };
  });

  const minimumSeconds = config.minimumFullEpisodeSeconds ?? 1200;
  const unmatched = videos
    .filter((video) => !usedVideoIds.has(video.id))
    .filter((video) => (video.durationSeconds ?? minimumSeconds) >= minimumSeconds)
    .map((video) => ({
      id: video.id,
      title: video.title,
      channel: video.channel ?? null,
      durationSeconds: video.durationSeconds ?? null,
      url: watchUrlFor(video.id),
      thumbnail: thumbnailFor(video.id),
    }));

  const series = groupIntoSeries(decorated);
  const catalogue = {
    generatedAt: new Date().toISOString(),
    source: {
      episodes: offline ? 'committed catalogue' : 'en.wikipedia.org',
      videos: offline ? 'committed catalogue' : config.channels.join(', '),
    },
    stats: {
      episodes: decorated.length,
      seriesCount: series.filter((group) => group.kind === 'series').length,
      withVideo: decorated.filter((episode) => episode.video).length,
      newlyMatched: matchedCount,
      carriedOver: carriedCount,
      unmatchedUploads: unmatched.length,
    },
    problems,
    series,
    extras: unmatched,
  };

  // Episode count alone is not enough: a mis-parse can yield hundreds of junk
  // rows all landing in a single group. Demand a plausible series structure too.
  const expected = config.minimumEpisodesExpected ?? 0;
  const expectedSeries = config.minimumSeriesExpected ?? 0;
  const seriesFound = series.filter((group) => group.kind === 'series').length;
  const healthy = decorated.length >= expected && seriesFound >= expectedSeries;

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  if (healthy || allowEmpty || !existing) {
    await writeFile(OUTPUT, `${JSON.stringify(catalogue, null, 2)}\n`);
    log(`\nWrote ${path.relative(ROOT, OUTPUT)}`);
  } else {
    log('\nResult looks worse than what is committed; leaving the existing catalogue in place.');
  }

  console.log(
    `Catalogue: ${catalogue.stats.episodes} episodes across ${catalogue.stats.seriesCount} series, ` +
      `${catalogue.stats.withVideo} with a video (${catalogue.stats.newlyMatched} matched now, ` +
      `${catalogue.stats.carriedOver} carried over), ${catalogue.stats.unmatchedUploads} unmatched uploads.`,
  );
  if (problems.length) {
    console.log('Problems encountered:');
    for (const problem of problems) console.log(`  - ${problem}`);
  }

  if (!healthy && !allowEmpty) {
    console.error(
      `\nExpected at least ${expected} episodes across ${expectedSeries} series, but found ` +
        `${decorated.length} episodes across ${seriesFound} series. ` +
        'Re-run with --allow-empty to accept this result.',
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Catalogue build failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
