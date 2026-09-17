/**
 * Watch history, kept in localStorage.
 *
 * Everything the user records lives on their own device - there is no account
 * and no server. Episode ids are stable ("s7e3"), so a catalogue rebuild never
 * orphans a watch history.
 */

const STORAGE_KEY = 'time-team-tracker:v1';
const SCHEMA_VERSION = 1;

const emptyState = () => ({
  version: SCHEMA_VERSION,
  entries: {},
  prefs: { theme: 'system', view: 'grid', filter: 'all', collapsed: [] },
});

/** localStorage throws in private mode / when storage is disabled. */
function safeRead() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeWrite(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const entries = {};
  for (const [id, entry] of Object.entries(raw.entries ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    entries[id] = {
      watched: Boolean(entry.watched),
      watchedAt: typeof entry.watchedAt === 'string' ? entry.watchedAt : null,
      rating: Number.isFinite(entry.rating) ? Math.max(0, Math.min(5, Math.round(entry.rating))) : 0,
      note: typeof entry.note === 'string' ? entry.note.slice(0, 2000) : '',
    };
  }
  return {
    version: SCHEMA_VERSION,
    entries,
    prefs: { ...base.prefs, ...(raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {}) },
  };
}

export function createStore() {
  let state;
  try {
    state = migrate(JSON.parse(safeRead() ?? 'null'));
  } catch {
    state = emptyState();
  }

  const listeners = new Set();
  let persistFailed = false;

  const persist = () => {
    const ok = safeWrite(JSON.stringify(state));
    if (!ok && !persistFailed) {
      persistFailed = true;
      console.warn('Time Team Tracker: this browser refused to save progress locally.');
    }
    return ok;
  };

  const notify = () => {
    for (const listener of listeners) listener(state);
  };

  const commit = () => {
    persist();
    notify();
  };

  const entryFor = (id) =>
    state.entries[id] ?? { watched: false, watchedAt: null, rating: 0, note: '' };

  const mutate = (id, changes) => {
    state.entries[id] = { ...entryFor(id), ...changes };
    const entry = state.entries[id];
    // Drop entries that hold nothing worth keeping.
    if (!entry.watched && !entry.rating && !entry.note) delete state.entries[id];
    commit();
  };

  return {
    get state() {
      return state;
    },
    get persistenceAvailable() {
      return !persistFailed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    entryFor,
    isWatched: (id) => Boolean(state.entries[id]?.watched),
    setWatched(id, watched) {
      mutate(id, { watched, watchedAt: watched ? new Date().toISOString() : null });
    },
    toggleWatched(id) {
      this.setWatched(id, !this.isWatched(id));
    },
    setRating(id, rating) {
      mutate(id, { rating: entryFor(id).rating === rating ? 0 : rating });
    },
    setNote(id, note) {
      mutate(id, { note: note.slice(0, 2000) });
    },
    /** Bulk mark - used by the "mark series watched" control. */
    setManyWatched(ids, watched) {
      const stamp = new Date().toISOString();
      for (const id of ids) {
        const entry = { ...entryFor(id), watched, watchedAt: watched ? stamp : null };
        if (!entry.watched && !entry.rating && !entry.note) delete state.entries[id];
        else state.entries[id] = entry;
      }
      commit();
    },
    setPref(key, value) {
      state.prefs = { ...state.prefs, [key]: value };
      commit();
    },
    watchedCount: () => Object.values(state.entries).filter((entry) => entry.watched).length,
    export() {
      return JSON.stringify(
        { app: 'time-team-tracker', exportedAt: new Date().toISOString(), ...state },
        null,
        2,
      );
    },
    /** Merge an exported file back in; imported watches win over local blanks. */
    import(text, { merge = true } = {}) {
      const parsed = migrate(JSON.parse(text));
      if (merge) {
        for (const [id, entry] of Object.entries(parsed.entries)) {
          const mine = state.entries[id];
          state.entries[id] = mine
            ? {
                watched: mine.watched || entry.watched,
                watchedAt: mine.watchedAt ?? entry.watchedAt,
                rating: mine.rating || entry.rating,
                note: mine.note || entry.note,
              }
            : entry;
        }
      } else {
        state.entries = parsed.entries;
      }
      state.prefs = { ...state.prefs, ...parsed.prefs };
      commit();
      return Object.keys(parsed.entries).length;
    },
    reset() {
      state = emptyState();
      commit();
    },
  };
}
