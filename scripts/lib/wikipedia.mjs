/**
 * Builds the episode catalogue (series, numbers, titles, air dates) from
 * Wikipedia's episode list, so the app ships a real programme guide rather than
 * a hand-maintained spreadsheet.
 *
 * The page has been reformatted several times over the years, so the parser
 * accepts both shapes it has used: {{Episode list}} templates and plain
 * wikitables.
 */

const API = 'https://en.wikipedia.org/w/api.php';

/** Candidate page titles, tried in order until one yields episodes. */
export const INDEX_PAGE = 'List of Time Team episodes';

/**
 * The index page holds no tables of its own: each series section transcludes a
 * separate article ({{:Time Team (series 4)}}). Those sub-articles are where
 * the episodes actually live, so the fetch follows them.
 *
 * Deliberately NOT included: the show's main "Time Team" article. It parses
 * into hundreds of infobox parameter rows that look like episodes but are not.
 */
export const CANDIDATE_PAGES = [INDEX_PAGE];

/** Remove refs, comments, templates, wiki links and markup from a cell. */
export function cleanWikitext(value) {
  let text = String(value ?? '');
  text = text.replace(/<ref[^>]*\/>/gi, ' ');
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  // [[target|label]] -> label, [[target]] -> target
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
  text = text.replace(/\{\{[^{}]*\}\}/g, ' ');
  text = text.replace(/'''?/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/^["“”\s]+|["“”\s]+$/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Parse the date formats the page mixes: {{Start date}}, "16 January 1994". */
export function parseAirDate(value) {
  const raw = String(value ?? '');
  const startDate = /\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(raw);
  if (startDate) {
    const [, y, m, d] = startDate;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const text = cleanWikitext(raw);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return iso[0];
  const long = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (long) {
    const month = MONTHS[long[2].toLowerCase().slice(0, 3)];
    if (month) return `${long[3]}-${month}-${String(long[1]).padStart(2, '0')}`;
  }
  const monthFirst = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase().slice(0, 3)];
    if (month) return `${monthFirst[3]}-${month}-${String(monthFirst[2]).padStart(2, '0')}`;
  }
  return null;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Split "Athelney, Somerset" into its site and county halves. */
export function splitSite(title) {
  const text = cleanWikitext(title);
  const comma = text.lastIndexOf(',');
  if (comma === -1) return { site: text, county: null };
  return { site: text.slice(0, comma).trim(), county: text.slice(comma + 1).trim() || null };
}

/** `== Series 4 (1997) ==` -> {number: 4, year: 1997} */
export function parseSectionHeading(line) {
  const heading = /^={2,4}\s*(.+?)\s*={2,4}$/.exec(line.trim());
  if (!heading) return null;
  const text = cleanWikitext(heading[1]);
  const series = /^series\s+(\d{1,2})/i.exec(text);
  const year = /\((\d{4})/.exec(text);
  if (series) return { kind: 'series', number: Number(series[1]), year: year ? Number(year[1]) : null, label: text };
  if (/special/i.test(text)) return { kind: 'specials', number: null, year: year ? Number(year[1]) : null, label: text };
  return { kind: 'other', label: text };
}

/** Read `|Key = value` pairs out of a single {{Episode list}} template body. */
export function parseEpisodeListTemplate(body) {
  const fields = {};
  let depth = 0;
  let current = '';
  const parts = [];
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const pair = body.slice(i, i + 2);
    if (pair === '{{' || pair === '[[') depth += 1;
    if (pair === '}}' || pair === ']]') depth -= 1;
    if (char === '|' && depth <= 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase().replace(/\s+/g, '');
    fields[key] = part.slice(eq + 1).trim();
  }
  return fields;
}

/**
 * Parse a full wikitext page into a flat list of episodes.
 * Every episode carries the series context of the heading it appeared under.
 */
export function parseEpisodeList(wikitext, options = {}) {
  const {
    defaultSeries = null,
    defaultKind = 'series',
    defaultYear = null,
    defaultLabel = 'Episodes',
  } = options;
  const lines = String(wikitext ?? '').split('\n');
  const episodes = [];
  let context = { kind: defaultKind, number: defaultSeries, year: defaultYear, label: defaultLabel };
  let withinSeriesCounter = 0;

  const push = ({ title, numberInSeries, airDate, note }) => {
    const cleanTitle = cleanWikitext(title);
    if (!cleanTitle || cleanTitle.length < 2) return;
    if (/^(title|episode|site|no\.?|#|series)$/i.test(cleanTitle)) return; // header row
    // "link1 = List of Time Team episodes" and friends: template parameters
    // from an infobox or series-overview box, not episodes.
    if (cleanTitle.includes('=')) return;
    // Outside a known series (or the specials section) a row cannot be placed,
    // so it is boilerplate rather than an episode.
    if (context.kind !== 'specials' && context.number == null) return;
    withinSeriesCounter += 1;
    const episodeNumber = Number.isFinite(numberInSeries) && numberInSeries > 0 ? numberInSeries : withinSeriesCounter;
    const { site, county } = splitSite(cleanTitle);
    episodes.push({
      kind: context.kind === 'specials' ? 'special' : 'episode',
      series: context.kind === 'specials' ? null : context.number,
      seriesLabel: context.label,
      seriesYear: context.year,
      episode: episodeNumber,
      title: cleanTitle,
      site,
      county,
      airDate: airDate ?? null,
      note: note ? cleanWikitext(note) : null,
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const heading = parseSectionHeading(line);
    if (heading && heading.kind !== 'other') {
      context = heading;
      withinSeriesCounter = 0;
      continue;
    }
    if (heading && heading.kind === 'other' && /^(references|see also|external links|notes)$/i.test(heading.label)) {
      context = { kind: 'other', label: heading.label };
      continue;
    }
    if (context.kind === 'other') continue;

    // Shape 1: {{Episode list ...}}, possibly spanning several lines.
    if (/^\s*\{\{\s*episode list/i.test(line)) {
      let body = line;
      let depth = countBraces(line);
      while (depth > 0 && i + 1 < lines.length) {
        i += 1;
        body += `\n${lines[i]}`;
        depth += countBraces(lines[i]);
      }
      const fields = parseEpisodeListTemplate(body.replace(/^\s*\{\{\s*episode list\s*/i, '').replace(/\}\}\s*$/, ''));
      push({
        title: fields.title ?? fields.rtitle ?? '',
        numberInSeries: Number(fields.episodenumber2 ?? fields.episodenumber),
        airDate: parseAirDate(fields.originalairdate ?? ''),
        note: fields.shortsummary,
      });
      continue;
    }

    // Shape 2: a plain wikitable row, cells split by "||" or leading "|".
    if (/^\s*\|(?!\})/.test(line) && !/^\s*\|[-+]/.test(line)) {
      let rowText = line;
      // Gather following cell-continuation lines belonging to the same row.
      while (i + 1 < lines.length && /^\s*\|(?![-+}])/.test(lines[i + 1]) && !/^\s*\|\s*\|/.test(lines[i + 1])) {
        if (/\|\|/.test(rowText)) break;
        i += 1;
        rowText += ` || ${lines[i].replace(/^\s*\|/, '')}`;
      }
      const cells = rowText
        .replace(/^\s*\|/, '')
        .split(/\|\|/)
        .map((cell) => cell.replace(/^\s*[a-z-]+\s*=\s*"[^"]*"\s*\|/i, '').trim());
      if (cells.length < 2) continue;

      const leadingNumber = Number(cleanWikitext(cells[0]).replace(/[^\d]/g, ''));
      const titleCell = cells.find((cell, index) => index > 0 && cleanWikitext(cell).length > 2);
      const dateCell = cells.map((cell) => parseAirDate(cell)).find(Boolean);
      if (!titleCell) continue;
      push({
        title: titleCell,
        numberInSeries: leadingNumber,
        airDate: dateCell,
        note: null,
      });
    }
  }

  return episodes;
}

const countBraces = (line) =>
  (line.match(/\{\{/g)?.length ?? 0) - (line.match(/\}\}/g)?.length ?? 0);

/** Split wikitext into sections, each carrying the heading that opened it. */
export function splitSections(wikitext) {
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of String(wikitext ?? '').split('\n')) {
    const heading = parseSectionHeading(line);
    if (heading) {
      sections.push(current);
      current = { heading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.map(({ heading, lines }) => ({ heading, body: lines.join('\n') }));
}

/**
 * Find `{{:Time Team (series 4)}}` style transclusions, tagged with the series
 * of the section they appeared in.
 */
export function findTransclusions(wikitext) {
  const found = [];
  for (const { heading, body } of splitSections(wikitext)) {
    if (!heading || heading.kind === 'other') continue;
    const pattern = /\{\{:\s*([^}|]+?)\s*\}\}/g;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      found.push({ page: match[1], series: heading.number, kind: heading.kind, year: heading.year });
    }
  }
  return found;
}

/** Fetch raw wikitext for a page via the MediaWiki action API. */
export async function fetchWikitext(page) {
  const url =
    `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&formatversion=2&format=json&redirects=1`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'time-team-tracker/1.0 (episode catalogue builder)' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${page}`);
  const data = await response.json();
  if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
  return data?.parse?.wikitext ?? '';
}

/**
 * Build the episode list: parse whatever the index page holds inline, then
 * follow each transcluded series article and parse that too.
 */
export async function fetchEpisodeList({ log = () => {} } = {}) {
  const problems = [];
  let wikitext;
  try {
    wikitext = await fetchWikitext(INDEX_PAGE);
  } catch (error) {
    problems.push(`${INDEX_PAGE}: ${error.message}`);
    log(`  ${INDEX_PAGE}: FAILED - ${error.message}`);
    return { episodes: [], problems };
  }

  const episodes = parseEpisodeList(wikitext);
  log(`  ${INDEX_PAGE}: ${episodes.length} episodes inline`);

  const transclusions = findTransclusions(wikitext);
  log(`  following ${transclusions.length} transcluded series articles`);

  for (const { page, series, kind, year } of transclusions) {
    try {
      const sub = await fetchWikitext(page);
      const parsed = parseEpisodeList(sub, {
        defaultSeries: series,
        defaultKind: kind,
        defaultYear: year,
        defaultLabel: page,
      });
      log(`    ${page}: ${parsed.length} episodes`);
      episodes.push(...parsed);
    } catch (error) {
      problems.push(`${page}: ${error.message}`);
      log(`    ${page}: FAILED - ${error.message}`);
    }
  }

  return { episodes, problems };
}
