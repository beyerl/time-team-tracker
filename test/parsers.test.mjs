import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanWikitext, parseAirDate, parseEpisodeList, splitSite, parseSectionHeading, findTransclusions,
  isEpisodeTableHeader, parseHeaderCells,
} from '../scripts/lib/wikipedia.mjs';
import {
  extractInitialData, harvestVideos, parseDuration, readText, thumbnailFor,
} from '../scripts/lib/youtube.mjs';
import {
  matchEpisodesToVideos, normaliseTitle, tokenise, extractSeriesEpisode, levenshtein, videoRejection,
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
  const html = 'x var ytInitialData = {"v":{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"A }{ B"}]},"lengthText":{"simpleText":"48:12"}}},"c":{"continuationCommand":{"token":"T1"}}};y';
  const { videos, continuations } = harvestVideos(extractInitialData(html));
  assert.equal(videos.length, 1);
  assert.equal(videos[0].title, 'A }{ B');
  assert.equal(videos[0].durationSeconds, 2892);
  assert.deepEqual(continuations, ['T1']);
});

// Shape captured from a live channel page: YouTube dropped videoRenderer in
// favour of lockupViewModel, which carries no plain `videoId` field at all.
test('harvestVideos reads the lockupViewModel shape channels now serve', () => {
  const payload = {
    contents: {
      richGridRenderer: {
        contents: [
          {
            richItemRenderer: {
              content: {
                lockupViewModel: {
                  contentImage: {
                    thumbnailViewModel: {
                      image: {
                        sources: [
                          { url: 'https://i.ytimg.com/vi/k038y-J5kfY/hq720.jpg?sqp=-oaymwEc', width: 360 },
                        ],
                      },
                      overlays: [
                        {
                          thumbnailBottomOverlayViewModel: {
                            badges: [
                              {
                                thumbnailBadgeViewModel: {
                                  text: '35:45',
                                  animationActivationTargetId: 'k038y-J5kfY',
                                  animatedText: 'Now playing',
                                },
                              },
                            ],
                          },
                        },
                        {
                          thumbnailHoverOverlayToggleActionsViewModel: {
                            buttons: [
                              {
                                toggleButtonViewModel: {
                                  defaultButtonViewModel: {
                                    buttonViewModel: {
                                      accessibilityText: 'Watch later',
                                      onTap: {
                                        innertubeCommand: {
                                          playlistEditEndpoint: {
                                            actions: [{ addedVideoId: 'k038y-J5kfY', action: 'ACTION_ADD_VIDEO' }],
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  metadata: {
                    lockupMetadataViewModel: {
                      title: { content: 'Athelney, Somerset | Time Team' },
                    },
                  },
                },
              },
            },
          },
          { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NEXT' } } } },
        ],
      },
    },
  };

  const { videos, continuations } = harvestVideos(payload);
  assert.equal(videos.length, 1, 'one video found');
  assert.equal(videos[0].id, 'k038y-J5kfY');
  assert.equal(videos[0].title, 'Athelney, Somerset | Time Team', 'title, not "Watch later"');
  assert.equal(videos[0].durationSeconds, 2145, '35:45 read from the badge');
  assert.deepEqual(continuations, ['NEXT']);
});

test('harvestVideos ignores an item with no resolvable title', () => {
  const payload = {
    lockupViewModel: {
      contentImage: { sources: [{ url: 'https://i.ytimg.com/vi/k038y-J5kfY/hq720.jpg' }] },
      button: { accessibilityText: 'Watch later' },
    },
  };
  assert.equal(harvestVideos(payload).videos.length, 0);
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
  // The shapes the Classics channel actually uses.
  assert.deepEqual(extractSeriesEpisode('Search for Richmond Palace (Full Episode) | S5 EP1 | Time Team'), { series: 5, episode: 1 });
  assert.deepEqual(extractSeriesEpisode('Lost Roman Villa | Time Team - S2 E3'), { series: 2, episode: 3 });
  assert.deepEqual(extractSeriesEpisode('Bawsey St James, Norfolk | S06E11 | Time Team'), { series: 6, episode: 11 });
});

const RULES = {
  classicChannel: '@TimeTeamClassics',
  classicCutoffYear: 2020,
  minimumFullEpisodeSeconds: 1200,
  classicMinimumSeconds: 2400,
  classicMaximumSeconds: 4200,
};
const classic = (extra = {}) => ({ id: 's12e1', kind: 'episode', series: 12, episode: 1, title: "The Manor That's Back to Front", seriesYear: 2005, ...extra });
const upload = (extra = {}) => ({ id: 'v1', title: "The Manor That's Back to Front (Full Episode) | S12 EP1 | Time Team", channel: '@TimeTeamClassics', durationSeconds: 2923, ...extra });

test('videoRejection accepts a full classic episode from the Classics channel', () => {
  assert.equal(videoRejection(classic(), upload(), RULES), null);
});

test('videoRejection turns away commentaries, clips and wrong channels', () => {
  assert.match(videoRejection(classic(), upload({ title: "Time Team Commentary: 'The Manor That's Back to Front' | S12E01", durationSeconds: 316 }), RULES), /not a full episode/);
  assert.match(videoRejection(classic(), upload({ title: "Teatime 4 | The Manor That's Back to Front" }), RULES), /not a full episode/);
  assert.match(videoRejection(classic(), upload({ durationSeconds: 1500 }), RULES), /too short/);
  assert.match(videoRejection(classic(), upload({ durationSeconds: 17000 }), RULES), /too long/);
  assert.match(videoRejection(classic(), upload({ channel: '@TimeTeamOfficial' }), RULES), /must come from @TimeTeamClassics/);
});

test('videoRejection holds a classic upload to its series/episode marker', () => {
  assert.match(videoRejection(classic(), upload({ title: 'Norman Neighbours (Full Episode) | S12 EP11 | Time Team' }), RULES), /S12E11/);
});

test('videoRejection keeps revival episodes off the Classics channel', () => {
  const revival = { id: 's21e1', kind: 'episode', series: 21, episode: 1, title: 'Lizard Peninsula', seriesYear: 2022 };
  assert.equal(videoRejection(revival, upload({ channel: '@TimeTeamOfficial', title: 'Lizard Peninsula | TIME TEAM' }), RULES), null);
  assert.match(videoRejection(revival, upload({ title: 'Lizard Peninsula | FULL EPISODE' }), RULES), /only has pre-2020/);
});

test('matcher prefers the upload with the right marker over a commentary with the same title', () => {
  const episodes = [classic()];
  const videos = [
    upload({ id: 'commentary', title: "Time Team Commentary: 'The Manor That's Back to Front' | S12E01", channel: '@TimeTeamOfficial', durationSeconds: 316 }),
    upload({ id: 'renamed', title: 'Uncovering a Tudor Mystery | Time Team - S12 E1' }),
  ];
  assert.equal(matchEpisodesToVideos(episodes, videos, { rules: RULES }).get('s12e1').video.id, 'renamed');
});

test('matcher sees through uploads numbered differently from the broadcast order', () => {
  const episodes = [
    { id: 's2e2', kind: 'episode', series: 2, episode: 2, title: 'The Saxon Graves', site: 'Winterbourne Gunner', seriesYear: 1995 },
    { id: 's2e5', kind: 'episode', series: 2, episode: 5, title: 'Medieval Dining Hall', site: 'Hylton Castle', seriesYear: 1995 },
  ];
  const videos = [
    upload({ id: 'hylton', title: 'Uncovering the Lost Medieval Secrets of Hilton Castle - Sunderland Archaeology | Time Team - S2 E2' }),
    upload({ id: 'graves', title: 'Secrets of the Saxon Graveyard - Unearthing 3,000 Years of History | Time Team - S2 E5' }),
  ];
  const matched = matchEpisodesToVideos(episodes, videos, { rules: RULES });
  assert.equal(matched.get('s2e5')?.video.id, 'hylton');
  assert.notEqual(matched.get('s2e2')?.video.id, 'hylton');
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

// The index page holds no tables: each series section transcludes its own
// article, so the fetch has to follow them.
test('findTransclusions tags each transcluded article with its series', () => {
  const wikitext = [
    '==Episodes==',
    '===Series 1 (1994)===',
    "{{Main|Time Team (series 1){{!}}''Time Team'' (series 1)}}",
    '{{:Time Team (series 1)}}',
    '===Series 2 (1995)===',
    '{{:Time Team (series 2)}}',
    '==References==',
    '{{:Should Not Be Followed}}',
  ].join('\n');

  const found = findTransclusions(wikitext);
  assert.deepEqual(
    found.map((item) => [item.page, item.series, item.year]),
    [['Time Team (series 1)', 1, 1994], ['Time Team (series 2)', 2, 1995]],
  );
});

test('parseEpisodeList takes the site from an Aux location column', () => {
  const sub = [
    '{{Episode list/sublist|Time Team series 2',
    '|EpisodeNumber2=5',
    '|Title=Medieval Dining Hall',
    '|Aux1=<span class="location">[[Hylton Castle]], [[City of Sunderland|Sunderland]]</span>',
    '|OriginalAirDate={{Start date|1995|2|5|df=y}}',
    '}}',
  ].join('\n');
  const [episode] = parseEpisodeList(sub, { defaultSeries: 2, defaultYear: 1995 });
  assert.equal(episode.title, 'Medieval Dining Hall');
  assert.equal(episode.site, 'Hylton Castle');
  assert.equal(episode.county, 'Sunderland');
});

test('parseEpisodeList can be given a forced series for a sub-article', () => {
  const sub = [
    '{| class="wikitable"',
    '! No. !! Title !! Original air date',
    '|-',
    '| 1 || [[Athelney]], Somerset || 16 January 1994',
    '|-',
    '| 2 || Dorchester, Oxfordshire || 23 January 1994',
    '|}',
  ].join('\n');

  // With no context the rows cannot be placed, so nothing is emitted.
  assert.equal(parseEpisodeList(sub).length, 0);

  const placed = parseEpisodeList(sub, { defaultSeries: 4, defaultYear: 1997 });
  assert.equal(placed.length, 2);
  assert.equal(placed[0].series, 4);
  assert.equal(placed[0].seriesYear, 1997);
  assert.equal(placed[0].title, 'Athelney, Somerset');
  assert.equal(placed[1].episode, 2);
});

test('template parameter rows are never mistaken for episodes', () => {
  const junk = [
    '{{Series overview',
    '| link1 = List of Time Team episodes #Series 1 (1994)',
    '| start1 = 16 January 1994',
    '| network1 = Channel 4',
    '}}',
  ].join('\n');
  const parsed = parseEpisodeList(junk, { defaultSeries: 1 });
  assert.deepEqual(parsed.map((e) => e.title), [], 'infobox parameters produce no episodes');
});

// The series articles carry a cast table as well as an episode table. Its rows
// were being read as episodes ("Tony Robinson" as S01E01), colliding with the
// real ones on episode id.
test('a cast table alongside an episode table is ignored', () => {
  const article = [
    '==Cast==',
    '{| class="wikitable"',
    '! Name !! Role',
    '|-',
    '| [[Tony Robinson]] || Presenter',
    '|-',
    '| [[Phil Harding (archaeologist)|Phil Harding]] || Field archaeologist',
    '|}',
    '',
    '==Episodes==',
    '{| class="wikitable"',
    '! No. !! Title !! Original air date',
    '|-',
    '| 1 || The Guerrilla Base of the King || 16 January 1994',
    '|-',
    '| 2 || On the Edge of an Empire || 23 January 1994',
    '|}',
  ].join('\n');

  const parsed = parseEpisodeList(article, { defaultSeries: 1, defaultYear: 1994 });
  assert.deepEqual(
    parsed.map((episode) => episode.title),
    ['The Guerrilla Base of the King', 'On the Edge of an Empire'],
    'only the episode table is read',
  );
  assert.deepEqual(parsed.map((episode) => episode.episode), [1, 2], 'numbering is not shifted by the cast rows');
});

test('isEpisodeTableHeader needs both an episode-ish and a date-ish column', () => {
  assert.equal(isEpisodeTableHeader(['No.', 'Title', 'Original air date']), true);
  assert.equal(isEpisodeTableHeader(['Name', 'Role']), false);
  assert.equal(isEpisodeTableHeader(['Title', 'Synopsis']), false, 'no date column');
  assert.equal(isEpisodeTableHeader([]), false);
});

test('parseHeaderCells splits a wikitable header row', () => {
  assert.deepEqual(parseHeaderCells('! No. !! Title !! Original air date'), ['No.', 'Title', 'Original air date']);
});

test('a header-less table is not assumed to hold episodes', () => {
  const article = [
    '{| class="wikitable"',
    '|-',
    '| [[Tony Robinson]] || Presenter',
    '|}',
    '{| class="wikitable"',
    '! No. !! Title !! Original air date',
    '|-',
    '| 1 || The Guerrilla Base of the King || 16 January 1994',
    '|}',
  ].join('\n');
  assert.deepEqual(
    parseEpisodeList(article, { defaultSeries: 1 }).map((e) => e.title),
    ['The Guerrilla Base of the King'],
  );
});

test('a sub-article heading without a year keeps the year it was given', () => {
  const sub = [
    '==Series 1==',
    '{| class="wikitable"',
    '! No. !! Title !! Original air date',
    '|-',
    '| 1 || The Guerrilla Base of the King || 16 January 1994',
    '|}',
  ].join('\n');
  const parsed = parseEpisodeList(sub, { defaultSeries: 1, defaultYear: 1994 });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].seriesYear, 1994, 'year survives the repeated heading');
  assert.equal(parsed[0].series, 1);
});
