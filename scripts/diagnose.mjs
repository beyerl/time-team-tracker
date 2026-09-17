#!/usr/bin/env node
/**
 * Prints what the upstream sources actually return, so the parsers can be
 * fixed against reality rather than guesswork. Run it from CI, where the
 * network is reachable: `node scripts/diagnose.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { CANDIDATE_PAGES, fetchWikitext, parseEpisodeList, parseSectionHeading } from './lib/wikipedia.mjs';
import { extractInitialData, harvestVideos } from './lib/youtube.mjs';

const rule = (label) => console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);

async function diagnoseWikipedia() {
  for (const page of CANDIDATE_PAGES) {
    rule(`WIKIPEDIA: ${page}`);
    let wikitext;
    try {
      wikitext = await fetchWikitext(page);
    } catch (error) {
      console.log(`  fetch failed: ${error.message}`);
      continue;
    }
    const lines = wikitext.split('\n');
    console.log(`  wikitext: ${wikitext.length} chars, ${lines.length} lines`);

    const headings = lines
      .map((line) => ({ line, heading: parseSectionHeading(line) }))
      .filter((item) => item.heading);
    console.log(`  headings found: ${headings.length}`);
    for (const { line, heading } of headings.slice(0, 40)) {
      console.log(`    ${heading.kind.padEnd(8)} n=${String(heading.number).padEnd(4)} ${line.trim().slice(0, 70)}`);
    }

    const parsed = parseEpisodeList(wikitext);
    const seriesSeen = [...new Set(parsed.map((episode) => episode.series))];
    console.log(`  parseEpisodeList -> ${parsed.length} episodes across series ${JSON.stringify(seriesSeen.slice(0, 25))}`);
    console.log(`  first 5 parsed: ${JSON.stringify(parsed.slice(0, 5).map((e) => `${e.series}x${e.episode} ${e.title}`), null, 1)}`);

    // Show the raw lines around the first series heading, which is what the
    // row parser has to cope with.
    const firstSeries = lines.findIndex((line) => /^==+\s*Series\s*1\b/i.test(line.trim()));
    if (firstSeries !== -1) {
      console.log(`  --- raw lines ${firstSeries}..${firstSeries + 30} ---`);
      for (const line of lines.slice(firstSeries, firstSeries + 30)) {
        console.log(`    | ${line.slice(0, 150)}`);
      }
    } else {
      console.log('  (no "Series 1" heading found; first 25 non-empty lines:)');
      for (const line of lines.filter((item) => item.trim()).slice(0, 25)) {
        console.log(`    | ${line.slice(0, 150)}`);
      }
    }
  }
}

async function diagnoseYouTube() {
  const config = JSON.parse(await readFile(new URL('./catalogue.config.json', import.meta.url), 'utf8'));
  const handles = [...config.channels, '@TimeTeam', '@thetimeteam'];

  for (const handle of handles) {
    rule(`YOUTUBE: ${handle}`);
    const url = `https://www.youtube.com/${handle}/videos?hl=en&gl=GB`;
    let response;
    let html;
    try {
      response = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'accept-language': 'en-GB,en;q=0.9',
          cookie: 'SOCS=CAI; PREF=hl=en&gl=GB',
        },
      });
      html = await response.text();
    } catch (error) {
      console.log(`  fetch threw: ${error.message}`);
      continue;
    }

    console.log(`  HTTP ${response.status}, ${html.length} chars`);
    console.log(`  looks like consent wall: ${/consent\.youtube|Before you continue|CONSENT_/i.test(html)}`);
    console.log(`  contains "videoId": ${(html.match(/"videoId"/g) ?? []).length} occurrences`);
    console.log(`  contains ytInitialData marker: ${/ytInitialData/.test(html)}`);
    console.log(`  INNERTUBE_API_KEY present: ${/"INNERTUBE_API_KEY":"/.test(html)}`);

    const data = extractInitialData(html);
    if (!data) {
      console.log('  extractInitialData -> null');
      const idx = html.indexOf('ytInitialData');
      if (idx !== -1) console.log(`  raw around marker: ${html.slice(idx - 40, idx + 220).replace(/\n/g, ' ')}`);
      continue;
    }
    console.log(`  extractInitialData -> keys: ${Object.keys(data).join(', ')}`);
    const harvested = harvestVideos(data);
    console.log(`  harvestVideos -> ${harvested.videos.length} videos, ${harvested.continuations.length} continuations`);
    console.log(`  sample: ${JSON.stringify(harvested.videos.slice(0, 5).map((v) => v.title))}`);

    // What renderer names does the payload actually use?
    const renderers = new Set();
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) return node.forEach((item) => walk(item, depth + 1));
      for (const [key, value] of Object.entries(node)) {
        if (/Renderer$/.test(key)) renderers.add(key);
        walk(value, depth + 1);
      }
    };
    walk(data);
    console.log(`  renderer types: ${[...renderers].slice(0, 30).join(', ')}`);
  }
}

await diagnoseWikipedia();
await diagnoseYouTube();
