#!/usr/bin/env node
/**
 * Focused probe, round 2: dump the exact shapes the parsers have to handle.
 * Run from CI, where the sources are reachable.
 */

import { fetchWikitext, parseEpisodeList, parseSectionHeading } from './lib/wikipedia.mjs';
import { extractInitialData } from './lib/youtube.mjs';

const rule = (label) => console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);

/* -------------------------------------------------- Wikipedia episode list */

rule('WIKIPEDIA: List of Time Team episodes');
const wikitext = await fetchWikitext('List of Time Team episodes');
const lines = wikitext.split('\n');
console.log(`wikitext: ${wikitext.length} chars, ${lines.length} lines`);

const headings = lines
  .map((line, index) => ({ index, line: line.trim(), heading: parseSectionHeading(line) }))
  .filter((item) => item.heading);
console.log(`\nheadings (${headings.length}):`);
for (const { index, line, heading } of headings) {
  console.log(`  L${String(index).padStart(5)} ${heading.kind.padEnd(8)} n=${String(heading.number).padEnd(5)} ${line.slice(0, 60)}`);
}

const parsed = parseEpisodeList(wikitext);
const bySeries = {};
for (const episode of parsed) bySeries[episode.series] = (bySeries[episode.series] ?? 0) + 1;
console.log(`\nparsed ${parsed.length} episodes, per series: ${JSON.stringify(bySeries)}`);
console.log(`first 3: ${JSON.stringify(parsed.slice(0, 3), null, 1)}`);

const firstSeries = lines.findIndex((line) => /^==+\s*Series\s*1\b/i.test(line.trim()));
console.log(`\n--- raw lines from the first "Series 1" heading (index ${firstSeries}) ---`);
for (const line of lines.slice(Math.max(0, firstSeries), Math.max(0, firstSeries) + 45)) {
  console.log(`| ${line.slice(0, 160)}`);
}

/* ------------------------------------------------------ YouTube item shape */

rule('YOUTUBE: @TimeTeamOfficial item shape');
const html = await (
  await fetch('https://www.youtube.com/@TimeTeamOfficial/videos?hl=en&gl=GB', {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'en-GB,en;q=0.9',
      cookie: 'SOCS=CAI; PREF=hl=en&gl=GB',
    },
  })
).text();

const data = extractInitialData(html);

/** Find the first object that has the given key, anywhere in the tree. */
function findFirst(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findFirst(item, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (key in node) return node[key];
  for (const value of Object.values(node)) {
    const hit = findFirst(value, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

for (const key of ['richItemRenderer', 'lockupViewModel', 'videoRenderer']) {
  const sample = findFirst(data, key);
  console.log(`\n--- first ${key} ---`);
  if (!sample) {
    console.log('  (not present)');
    continue;
  }
  console.log(JSON.stringify(sample, null, 1).slice(0, 3000));
}
