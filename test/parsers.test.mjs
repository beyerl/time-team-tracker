import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanWikitext, parseAirDate, parseEpisodeList, splitSite, parseSectionHeading,
} from '../scripts/lib/wikipedia.mjs';
import {
  extractInitialData, harvestVideos, parseDuration, readText, thumbnailFor,
} from '../scripts/lib/youtube.mjs';
import {
  matchEpisodesToVideos, normaliseTitle, tokenise, extractSeriesEpisode, levenshtein,
} from '../scripts/lib/text.mjs';

const wikitext = readFileSync(new URL('./fixtures/sample.wiki', import.meta.url), 'utf8');

test('cleanWikitext strips links, refs and markup', () => {
  assert.equal(cleanWikitext("[[Dorchester-on-Thames|Dorchester]], Oxon<ref>x</ref>"), 'Dorchester, Oxon');
  assert.equal(cleanWikitext("'''Bold''' &amp; [[Plain]]"), 'Bold & Plain');
});

test('parseAirDate handles the formats the page mixes', () => {
  assert.equal(parseAirDate('{{Start date|1995|01|08}}'), '1995-01-08');
  assert.equal(parseAirDate('16 January 1994'), '1994-01-16');
  assert.equal(parseAirDate('January 16, 1994'), '1994-01-16');
  assert.equal(parseAirDate('not a date'), null);
});

test('splitSite separates site from county', () => {
  assert.deepEqual(splitSite('Athelney, Somerset'), { site: 'Athelney', county: 'Somerset' });
  assert.deepEqual(splitSite('Various'), { site: 'Various', county: null });
});

test('parseSectionHeading recognises series and specials', () => {
  assert.deepEqual(parseSectionHeading('== Series 4 (1997) =='), { kind: 'series', number: 4, year: 1997, label: 'Series 4 (1997)' });
  assert.equal(parseSectionHeading('== Specials ==').kind, 'specials');
});

test('parseEpisodeList reads wikitable rows and Episode list templates', () => {
  const episodes = parseEpisodeList(wikitext);
  const s1 = episodes.filter((e) => e.series === 1);
  assert.equal(s1.length, 3, 'three series 1 episodes');
  assert.equal(s1[0].title, 'Athelney, Somerset');
  assert.equal(s1[0].airDate, '1994-01-16');
  assert.equal(s1[0].county, 'Somerset');
  assert.equal(s1[1].title, 'Dorchester, Oxfordshire');
  assert.equal(s1[2].title, 'Llanbedrgoch, Anglesey');

  const s2 = episodes.filter((e) => e.series === 2);
  assert.equal(s2.length, 2);
  assert.equal(s2[0].title, 'Beauport Park, East Sussex');
  assert.equal(s2[0].episode, 1);
  assert.equal(s2[0].airDate, '1995-01-08');
  assert.match(s2[0].note, /Roman bath house/);
  assert.equal(s2[1].title, 'Llangian, Gwynedd');

  const specials = episodes.filter((e) => e.kind === 'special');
  assert.equal(specials.length, 1);
  assert.equal(specials[0].title, 'The Big Roman Dig, Various');

  assert.ok(!episodes.some((e) => /this line must be ignored/i.test(e.title)), 'references section skipped');
});

test('youtube initial data extraction survives braces inside strings', () => {
  const html = 'x var ytInitialData = {"v":{"videoId":"abcdefghijk","title":{"runs":[{"text":"A }{ B"}]},"lengthText":{"simpleText":"48:12"}},"c":{"continuationCommand":{"token":"T1"}}};y';
  const { videos, continuations } = harvestVideos(extractInitialData(html));
  assert.equal(videos.length, 1);
  assert.equal(videos[0].title, 'A }{ B');
  assert.equal(videos[0].durationSeconds, 2892);
  assert.deepEqual(continuations, ['T1']);
});

test('youtube helpers', () => {
  assert.equal(parseDuration('1:02:33'), 3753);
  assert.equal(parseDuration('nope'), null);
  assert.equal(readText({ runs: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(thumbnailFor('abcdefghijk'), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
});

test('title normalisation keeps site names inside brackets', () => {
  assert.equal(normaliseTitle('Lost Fortress (Athelney, Somerset) | Time Team'), 'lost fortress athelney somerset');
  assert.deepEqual(tokenise('Time Team Series 3 Episode 2'), []);
});

test('extractSeriesEpisode reads S/E markers', () => {
  assert.deepEqual(extractSeriesEpisode('Time Team S02E03 - Beauport Park'), { series: 2, episode: 3 });
  assert.deepEqual(extractSeriesEpisode('Series 12 Episode 5 | Papcastle'), { series: 12, episode: 5 });
  assert.equal(extractSeriesEpisode('No markers here'), null);
});

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
});

test('matcher pairs episodes with the right uploads and rejects noise', () => {
  const episodes = [
    { id: 'a', title: 'Athelney, Somerset', series: 1, episode: 1, site: 'Athelney' },
    { id: 'b', title: 'Beauport Park, East Sussex', series: 2, episode: 3, site: 'Beauport Park' },
    { id: 'c', title: 'Papcastle, Cumbria', series: 12, episode: 5, site: 'Papcastle' },
  ];
  const videos = [
    { id: 'v1', title: "Alfred the Great's Lost Fortress (Athelney, Somerset) | Time Team FULL EPISODE" },
    { id: 'v2', title: 'Time Team S02E03 - Beauport Park, East Sussex' },
    { id: 'v3', title: 'Ten Years of Time Team - a look back' },
    { id: 'v4', title: 'Time Team Series 12 Episode 5 | Papcastle, Cumbria [HD]' },
  ];
  const matched = matchEpisodesToVideos(episodes, videos);
  assert.equal(matched.get('a').video.id, 'v1');
  assert.equal(matched.get('b').video.id, 'v2');
  assert.equal(matched.get('c').video.id, 'v4');
  assert.equal(matched.size, 3, 'the unrelated upload is not assigned');
});

test('matcher never assigns one video to two episodes', () => {
  const episodes = [
    { id: 'a', title: 'Athelney, Somerset', series: 1, episode: 1 },
    { id: 'b', title: 'Athelney, Somerset', series: 9, episode: 4 },
  ];
  const videos = [{ id: 'v1', title: 'Athelney, Somerset | Time Team' }];
  assert.equal(matchEpisodesToVideos(episodes, videos).size, 1);
});
