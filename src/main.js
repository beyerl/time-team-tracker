import './styles.css';
import { createStore } from './store.js';
import {
  allEpisodes, episodeCode, filterEpisodes, formatAirDate, formatDuration,
  loadCatalogue, randomUnwatched,
} from './catalogue.js';

const store = createStore();
const $ = (selector) => document.querySelector(selector);

const el = {
  list: $('#series-list'),
  notice: $('#notice'),
  search: $('#search'),
  filters: $('.filters'),
  viewToggle: $('.view-toggle'),
  progressWatched: $('#progress-watched'),
  progressTotal: $('#progress-total'),
  progressFill: $('#progress-fill'),
  progressMeta: $('#progress-meta'),
  catalogueMeta: $('#catalogue-meta'),
  player: $('#player'),
  playerTitle: $('#player-title'),
  playerFrame: $('#player-frame'),
  playerWatched: $('#player-watched'),
  playerOpen: $('#player-open'),
  data: $('#data'),
  dataStatus: $('#data-status'),
};

let catalogue = { series: [], extras: [] };
let episodes = [];
let query = '';
let openEpisodeId = null;

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
  );

const isWatched = (id) => store.isWatched(id);

/* ------------------------------------------------------------------- theme */

function applyTheme() {
  const preference = store.state.prefs.theme ?? 'system';
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-btn').textContent = dark ? '🌙' : '☀️';
}

/* ------------------------------------------------------------------ render */

function episodeCard(episode) {
  const entry = store.entryFor(episode.id);
  const watched = entry.watched;
  const video = episode.video;
  const duration = formatDuration(video?.durationSeconds);
  // The code already has its own line above the title, so it is not repeated here.
  const meta = [formatAirDate(episode.airDate), episode.county]
    .filter(Boolean)
    .join(' · ');

  const thumb = video
    ? `<button type="button" class="episode__thumb" data-action="play" data-id="${episode.id}"
         aria-label="Play ${escapeHtml(episode.title)}">
         <img src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy" decoding="async" />
         <span class="episode__play" aria-hidden="true">▶</span>
         ${duration ? `<span class="episode__duration">${escapeHtml(duration)}</span>` : ''}
         ${watched ? '<span class="episode__tick" aria-hidden="true">✓</span>' : ''}
       </button>`
    : `<div class="episode__thumb episode__thumb--empty">
         <span>No video found yet<br />
           <a class="episode__search" href="${escapeHtml(episode.searchUrl ?? '#')}"
              target="_blank" rel="noopener noreferrer">Search YouTube ↗</a>
         </span>
         ${watched ? '<span class="episode__tick" aria-hidden="true">✓</span>' : ''}
       </div>`;

  const stars = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return `<button type="button" data-action="rate" data-id="${episode.id}" data-value="${value}"
              class="${entry.rating >= value ? 'is-on' : ''}"
              aria-label="Rate ${value} out of 5"${entry.rating >= value ? ' aria-pressed="true"' : ''}>★</button>`;
  }).join('');

  return `
    <article class="episode ${watched ? 'is-watched' : ''}" data-id="${episode.id}">
      ${thumb}
      <div class="episode__body">
        <span class="episode__code">${escapeHtml(episodeCode(episode))}</span>
        <h3 class="episode__title">${escapeHtml(episode.title)}</h3>
        <p class="episode__meta">${escapeHtml(meta)}</p>
        ${entry.note ? `<p class="episode__note-text">${escapeHtml(entry.note)}</p>` : ''}
        <div class="episode__row">
          <label class="episode__watch">
            <input type="checkbox" data-action="watch" data-id="${episode.id}" ${watched ? 'checked' : ''} />
            <span>${watched ? 'Watched' : 'Mark watched'}</span>
          </label>
          <button type="button" class="episode__note-btn" data-action="note-toggle" data-id="${episode.id}"
                  title="Add a note">📝</button>
          <span class="stars">${stars}</span>
        </div>
        <div class="episode__note-editor">
          <textarea data-action="note" data-id="${episode.id}" rows="2"
                    placeholder="Notes about this dig…">${escapeHtml(entry.note)}</textarea>
        </div>
      </div>
    </article>`;
}

function seriesSection(group, visibleEpisodes) {
  const collapsed = (store.state.prefs.collapsed ?? []).includes(group.id);
  const watched = group.episodes.filter((episode) => isWatched(episode.id)).length;
  const total = group.episodes.length;
  const percent = total ? Math.round((watched / total) * 100) : 0;
  const view = store.state.prefs.view ?? 'grid';

  return `
    <section class="series ${collapsed ? 'is-collapsed' : ''}" data-group="${group.id}">
      <button type="button" class="series__head" data-action="toggle-series" data-group="${group.id}"
              aria-expanded="${!collapsed}">
        <span class="series__caret" aria-hidden="true">▾</span>
        <h2 class="series__title">${escapeHtml(group.title)}
          ${group.year ? `<span class="series__year">· ${group.year}</span>` : ''}</h2>
        <span class="series__spacer"></span>
        <span class="series__bar" aria-hidden="true"><i style="width:${percent}%"></i></span>
        <span class="series__count">${watched}/${total}</span>
      </button>
      <div class="series__tools">
        <button type="button" class="chip" data-action="mark-series" data-group="${group.id}" data-watched="true">
          Mark all watched
        </button>
        <button type="button" class="chip" data-action="mark-series" data-group="${group.id}" data-watched="false">
          Clear series
        </button>
      </div>
      <div class="episodes" data-view="${view}">
        ${visibleEpisodes.map(episodeCard).join('')}
      </div>
    </section>`;
}

function extrasSection() {
  const extras = catalogue.extras ?? [];
  if (!extras.length || query || (store.state.prefs.filter ?? 'all') !== 'all') return '';
  return `
    <h2 class="extras__head">Also on the channels (${extras.length})</h2>
    <section class="series">
      <div class="series__tools"></div>
      <div class="episodes" data-view="grid">
        ${extras
          .slice(0, 48)
          .map(
            (video) => `
          <article class="episode">
            <a class="episode__thumb" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy" decoding="async" />
              <span class="episode__play" aria-hidden="true">▶</span>
            </a>
            <div class="episode__body">
              <h3 class="episode__title">${escapeHtml(video.title)}</h3>
              <p class="episode__meta">${escapeHtml(video.channel ?? '')}</p>
            </div>
          </article>`,
          )
          .join('')}
      </div>
    </section>`;
}

function render() {
  const filter = store.state.prefs.filter ?? 'all';
  const visible = filterEpisodes(episodes, { query, filter, isWatched });
  const visibleByGroup = new Map();
  for (const episode of visible) {
    if (!visibleByGroup.has(episode.groupId)) visibleByGroup.set(episode.groupId, []);
    visibleByGroup.get(episode.groupId).push(episode);
  }

  const sections = catalogue.series
    .filter((group) => visibleByGroup.has(group.id))
    .map((group) => seriesSection(group, visibleByGroup.get(group.id)))
    .join('');

  if (!sections) {
    el.list.innerHTML = episodes.length
      ? '<p class="empty">Nothing matches those filters. Try widening the search.</p>'
      : `<p class="empty">The catalogue has not been built yet.<br />
           Run <code>npm run catalogue</code>, or let the scheduled workflow fill it in.</p>`;
  } else {
    el.list.innerHTML = sections + extrasSection();
  }

  updateProgress();
}

function updateProgress() {
  const total = episodes.length;
  const watched = episodes.filter((episode) => isWatched(episode.id)).length;
  const percent = total ? Math.round((watched / total) * 100) : 0;
  el.progressWatched.textContent = String(watched);
  el.progressTotal.textContent = String(total);
  el.progressFill.style.width = `${percent}%`;

  const withVideo = episodes.filter((episode) => episode.video).length;
  const remaining = total - watched;
  el.progressMeta.textContent = total
    ? `${percent}% complete · ${remaining} to go · ${withVideo} episodes have a video linked`
    : 'No episodes loaded yet.';
}

/** Update one card in place, so ticking a box never reshuffles the page. */
function refreshCard(id) {
  const card = el.list.querySelector(`.episode[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const watched = isWatched(id);
  const entry = store.entryFor(id);
  card.classList.toggle('is-watched', watched);
  const label = card.querySelector('.episode__watch span');
  if (label) label.textContent = watched ? 'Watched' : 'Mark watched';
  const box = card.querySelector('input[data-action="watch"]');
  if (box) box.checked = watched;
  card.querySelectorAll('.stars button').forEach((button) => {
    button.classList.toggle('is-on', entry.rating >= Number(button.dataset.value));
  });

  const group = card.closest('.series');
  if (group) refreshSeriesHeader(group);
  updateProgress();
}

function refreshSeriesHeader(section) {
  const group = catalogue.series.find((item) => item.id === section.dataset.group);
  if (!group) return;
  const watched = group.episodes.filter((episode) => isWatched(episode.id)).length;
  const total = group.episodes.length;
  section.querySelector('.series__count').textContent = `${watched}/${total}`;
  section.querySelector('.series__bar i').style.width = `${total ? (watched / total) * 100 : 0}%`;
}

/* ------------------------------------------------------------------ player */

function openPlayer(episodeId) {
  const episode = episodes.find((item) => item.id === episodeId);
  if (!episode?.video) return;
  openEpisodeId = episodeId;
  el.playerTitle.textContent = `${episodeCode(episode)} · ${episode.title}`;
  el.playerFrame.innerHTML = `<iframe
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(episode.video.id)}?autoplay=1&rel=0"
      title="${escapeHtml(episode.title)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
      allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  el.playerOpen.href = episode.video.url;
  el.playerWatched.textContent = isWatched(episodeId) ? 'Mark as not watched' : 'Mark as watched';
  el.player.showModal();
}

function closePlayer() {
  el.playerFrame.innerHTML = ''; // stops playback
  openEpisodeId = null;
  if (el.player.open) el.player.close();
}

/* ------------------------------------------------------------------ events */

// A thumbnail that fails to load (offline, or a size YouTube never generated)
// should leave a clean tile rather than a broken-image glyph.
el.list.addEventListener(
  'error',
  (event) => {
    const image = event.target;
    if (image.tagName !== 'IMG') return;
    image.remove();
  },
  true,
);

el.list.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id, group } = target.dataset;

  if (action === 'play') openPlayer(id);

  if (action === 'rate') {
    store.setRating(id, Number(target.dataset.value));
    refreshCard(id);
  }

  if (action === 'note-toggle') {
    const card = target.closest('.episode');
    card.classList.toggle('is-noting');
    if (card.classList.contains('is-noting')) card.querySelector('textarea')?.focus();
  }

  if (action === 'toggle-series') {
    const collapsed = new Set(store.state.prefs.collapsed ?? []);
    if (collapsed.has(group)) collapsed.delete(group);
    else collapsed.add(group);
    store.setPref('collapsed', [...collapsed]);
    const section = el.list.querySelector(`.series[data-group="${CSS.escape(group)}"]`);
    section?.classList.toggle('is-collapsed', collapsed.has(group));
    target.setAttribute('aria-expanded', String(!collapsed.has(group)));
  }

  if (action === 'mark-series') {
    const entry = catalogue.series.find((item) => item.id === group);
    if (!entry) return;
    store.setManyWatched(entry.episodes.map((episode) => episode.id), target.dataset.watched === 'true');
    render();
  }
});

el.list.addEventListener('change', (event) => {
  const target = event.target.closest('[data-action="watch"]');
  if (!target) return;
  store.setWatched(target.dataset.id, target.checked);
  refreshCard(target.dataset.id);
});

el.list.addEventListener(
  'blur',
  (event) => {
    const target = event.target.closest('[data-action="note"]');
    if (!target) return;
    store.setNote(target.dataset.id, target.value);
    const card = target.closest('.episode');
    const existing = card.querySelector('.episode__note-text');
    const value = store.entryFor(target.dataset.id).note;
    if (existing) existing.remove();
    if (value) {
      card
        .querySelector('.episode__meta')
        .insertAdjacentHTML('afterend', `<p class="episode__note-text">${escapeHtml(value)}</p>`);
    }
  },
  true,
);

let searchTimer;
el.search.addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value;
  searchTimer = setTimeout(() => {
    query = value;
    render();
  }, 150);
});

el.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  store.setPref('filter', button.dataset.filter);
  syncToolbar();
  render();
});

el.viewToggle.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  store.setPref('view', button.dataset.view);
  syncToolbar();
  render();
});

$('#theme-btn').addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(store.state.prefs.theme ?? 'system') + 1) % order.length];
  store.setPref('theme', next);
  applyTheme();
});

$('#random-btn').addEventListener('click', () => {
  const pick = randomUnwatched(episodes, isWatched);
  if (!pick) {
    flashNotice('Every episode is ticked off. That is the whole run — well dug.');
    return;
  }
  const collapsed = (store.state.prefs.collapsed ?? []).filter((id) => id !== pick.groupId);
  store.setPref('collapsed', collapsed);
  store.setPref('filter', 'all');
  query = '';
  el.search.value = '';
  syncToolbar();
  render();
  const card = el.list.querySelector(`.episode[data-id="${CSS.escape(pick.id)}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (card) {
    card.style.outline = '2px solid var(--gold)';
    setTimeout(() => {
      card.style.outline = '';
    }, 2200);
  }
});

el.playerWatched.addEventListener('click', () => {
  if (!openEpisodeId) return;
  store.toggleWatched(openEpisodeId);
  el.playerWatched.textContent = isWatched(openEpisodeId) ? 'Mark as not watched' : 'Mark as watched';
  refreshCard(openEpisodeId);
});

$('#player-close').addEventListener('click', closePlayer);
el.player.addEventListener('close', closePlayer);
el.player.addEventListener('click', (event) => {
  if (event.target === el.player) closePlayer();
});

/* -------------------------------------------------------------- data sheet */

$('#data-btn').addEventListener('click', () => {
  el.dataStatus.textContent = '';
  el.dataStatus.className = 'sheet__status';
  el.data.showModal();
});
$('#data-close').addEventListener('click', () => el.data.close());
el.data.addEventListener('click', (event) => {
  if (event.target === el.data) el.data.close();
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([store.export()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `time-team-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Backup downloaded.', true);
});

$('#import-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const count = store.import(await file.text());
    render();
    setStatus(`Imported ${count} episode${count === 1 ? '' : 's'}.`, true);
  } catch (error) {
    setStatus(`That file could not be read: ${error.message}`, false);
  } finally {
    event.target.value = '';
  }
});

$('#reset-btn').addEventListener('click', () => {
  if (!window.confirm('Clear every watched mark, rating and note on this device?')) return;
  store.reset();
  applyTheme();
  syncToolbar();
  render();
  setStatus('Everything cleared.', true);
});

function setStatus(message, ok) {
  el.dataStatus.textContent = message;
  el.dataStatus.className = `sheet__status ${ok ? 'is-ok' : 'is-bad'}`;
}

function flashNotice(message) {
  el.notice.hidden = false;
  el.notice.innerHTML = escapeHtml(message);
  setTimeout(() => {
    el.notice.hidden = true;
  }, 4000);
}

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== el.search) {
    event.preventDefault();
    el.search.focus();
  }
});

/* -------------------------------------------------------------------- boot */

function syncToolbar() {
  const filter = store.state.prefs.filter ?? 'all';
  const view = store.state.prefs.view ?? 'grid';
  el.filters.querySelectorAll('[data-filter]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === filter);
  });
  el.viewToggle.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
}

function showCatalogueNotice() {
  const messages = [];
  if (catalogue.bootstrap || !episodes.length) {
    messages.push(
      'The episode catalogue has not been built yet. Run <code>npm run catalogue</code> locally, ' +
        'or trigger the <strong>Refresh catalogue</strong> workflow — it looks the episodes and their ' +
        'YouTube videos up automatically.',
    );
  } else {
    const withoutVideo = episodes.filter((episode) => !episode.video).length;
    if (withoutVideo) {
      messages.push(
        `${withoutVideo} of ${episodes.length} episodes have no video on the official channels yet. ` +
          'Those cards link to a YouTube search instead.',
      );
    }
  }
  if (!store.persistenceAvailable) {
    messages.push('This browser is blocking local storage, so progress will not be remembered.');
  }
  if (messages.length) {
    el.notice.hidden = false;
    el.notice.innerHTML = messages.map((message) => `<p style="margin:0 0 6px">${message}</p>`).join('');
  }
}

async function boot() {
  applyTheme();
  syncToolbar();
  try {
    catalogue = await loadCatalogue();
    episodes = allEpisodes(catalogue);
  } catch (error) {
    el.list.innerHTML = `<p class="empty">The catalogue could not be loaded.<br />${escapeHtml(error.message)}</p>`;
    return;
  }

  render();
  showCatalogueNotice();

  el.catalogueMeta.textContent = catalogue.generatedAt
    ? `Catalogue built ${new Date(catalogue.generatedAt).toLocaleString()} · ` +
      `${catalogue.stats?.withVideo ?? 0} of ${catalogue.stats?.episodes ?? 0} episodes linked to a video.`
    : 'Catalogue not built yet.';

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme());
}

boot();
