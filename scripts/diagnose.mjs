#!/usr/bin/env node
/**
 * Prints the structure of Wikipedia's episode list, so the wikitext parser can
 * be fixed against the real page. Run from CI, where the source is reachable.
 */

import { fetchWikitext, parseEpisodeList, parseSectionHeading } from './lib/wikipedia.mjs';

const page = process.argv[2] ?? 'List of Time Team episodes';
console.log(`=== ${page} ===`);

const wikitext = await fetchWikitext(page);
const lines = wikitext.split('\n');
console.log(`wikitext: ${wikitext.length} chars, ${lines.length} lines`);

const headings = lines
  .map((line, index) => ({ index, line: line.trim(), heading: parseSectionHeading(line) }))
  .filter((item) => item.heading);
console.log(`\nheadings recognised (${headings.length}):`);
for (const { index, line, heading } of headings) {
  console.log(`  L${String(index).padStart(5)} ${heading.kind.padEnd(8)} n=${String(heading.number).padEnd(5)} ${line.slice(0, 55)}`);
}

// Every "==" line, even ones parseSectionHeading rejects.
const rawHeadings = lines.filter((line) => /^\s*={2,}/.test(line));
console.log(`\nall "==" lines (${rawHeadings.length}): ${JSON.stringify(rawHeadings.slice(0, 35).map((l) => l.trim().slice(0, 45)))}`);

const parsed = parseEpisodeList(wikitext);
const bySeries = {};
for (const episode of parsed) bySeries[episode.series] = (bySeries[episode.series] ?? 0) + 1;
console.log(`\nparsed ${parsed.length} episodes, per series: ${JSON.stringify(bySeries)}`);
console.log(`first 3 parsed: ${JSON.stringify(parsed.slice(0, 3))}`);

const anchor = lines.findIndex((line) => /^==+\s*Series\s*1\b/i.test(line.trim()));
console.log(`\n--- 45 raw lines from "Series 1" (index ${anchor}) ---`);
for (const line of lines.slice(Math.max(0, anchor), Math.max(0, anchor) + 45)) {
  console.log(`| ${line.slice(0, 165)}`);
}
