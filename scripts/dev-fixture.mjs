#!/usr/bin/env node
/**
 * Writes a FAKE catalogue so the interface can be worked on without network
 * access. The episode titles and video ids are invented - never commit the
 * result. `npm run catalogue` overwrites it with the real thing.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'catalogue.json');

const PLACES = [
  ['Athelney', 'Somerset'], ['Beauport Park', 'East Sussex'], ['Papcastle', 'Cumbria'],
  ['Codnor Castle', 'Derbyshire'], ['Llygadwy', 'Powys'], ['Turkdean', 'Gloucestershire'],
  ['Basing House', 'Hampshire'], ['Elveden', 'Suffolk'], ['Nether Poppleton', 'Yorkshire'],
  ['Cooper’s Hole', 'Somerset'], ['Bawsey', 'Norfolk'], ['Greenwich Palace', 'London'],
  ['Dinnington', 'South Yorkshire'], ['Hopton Castle', 'Shropshire'],
];
const VIDEO_IDS = ['dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk', 'JGwWNGJdvx8', 'RgKAFK5djSk'];

const series = [];
for (let number = 1; number <= 20; number += 1) {
  const year = 1993 + number;
  const episodes = [];
  const count = number === 1 ? 4 : 13;
  for (let index = 1; index <= count; index += 1) {
    const [site, county] = PLACES[(number * 7 + index) % PLACES.length];
    const title = `${site}, ${county}`;
    const videoId = VIDEO_IDS[(number * 3 + index) % VIDEO_IDS.length];
    const hasVideo = (number + index) % 4 !== 0;
    episodes.push({
      id: `s${number}e${index}`,
      kind: 'episode',
      series: number,
      episode: index,
      title,
      site,
      county,
      airDate: `${year}-0${(index % 9) + 1}-1${index % 9}`,
      note: null,
      video: hasVideo
        ? {
            id: videoId,
            title: `Time Team S${number}E${index} | ${title}`,
            channel: '@TimeTeamOfficial',
            durationSeconds: 2820 + index * 11,
            confidence: 0.92,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          }
        : null,
      searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`Time Team ${title}`)}`,
      seriesYear: year,
    });
  }
  series.push({ id: `series-${number}`, kind: 'series', number, title: `Series ${number}`, year, episodes });
}

const episodes = series.flatMap((group) => group.episodes);
await writeFile(
  OUTPUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      fixture: true,
      source: { episodes: 'dev fixture - not real data', videos: 'dev fixture - not real data' },
      stats: {
        episodes: episodes.length,
        seriesCount: 20,
        withVideo: episodes.filter((episode) => episode.video).length,
        newlyMatched: 0,
        carriedOver: 0,
        unmatchedUploads: 0,
      },
      problems: ['This is invented data from scripts/dev-fixture.mjs.'],
      series,
      extras: [],
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote a FAKE catalogue with ${episodes.length} episodes. Do not commit it.`);
