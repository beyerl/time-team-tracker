import test from 'node:test';
import assert from 'node:assert/strict';

import { applyVideoLinks, canonicalVideoUrl, parseYouTubeId } from '../src/video-links.js';

// The store reads localStorage when it is created.
globalThis.localStorage = {
  data: {},
  getItem(key) { return this.data[key] ?? null; },
  setItem(key, value) { this.data[key] = value; },
};
const { createStore, migrate } = await import('../src/store.js');
const freshStore = () => {
  globalThis.localStorage.data = {};
  return createStore();
};

const ID = 'dQw4w9WgXcQ';

test('parseYouTubeId reads every link shape a user might paste', () => {
  for (const link of [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?feature=share&v=${ID}&t=42`,
    `youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `  https://music.youtube.com/watch?v=${ID}  `,
  ]) {
    assert.equal(parseYouTubeId(link), ID, link);
  }
});

test('parseYouTubeId rejects links that are not a YouTube video', () => {
  for (const link of ['', 'hello', 'https://vimeo.com/123456', `https://example.com/watch?v=${ID}`,
    'https://www.youtube.com/@TimeTeamClassics', 'https://www.youtube.com/watch?v=short']) {
    assert.equal(parseYouTubeId(link), null, link);
  }
});

test('setVideoLink stores a canonical URL and an empty value removes it', () => {
  const store = freshStore();
  assert.equal(store.setVideoLink('s7e3', `https://youtu.be/${ID}?si=x`), true);
  assert.equal(store.videoLinkFor('s7e3'), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(store.setVideoLink('s7e3', 'not a link'), false);
  assert.equal(store.videoLinkFor('s7e3'), `https://www.youtube.com/watch?v=${ID}`, 'a bad link leaves the old one');
  store.setVideoLink('s7e3', '');
  assert.equal(store.videoLinkFor('s7e3'), null);
});

test('video links travel through export and import', () => {
  const source = freshStore();
  source.setWatched('s1e1', true);
  source.setVideoLink('s1e1', ID);
  const exported = JSON.parse(source.export());
  assert.deepEqual(exported.videos, { s1e1: `https://www.youtube.com/watch?v=${ID}` });

  const target = freshStore();
  target.setVideoLink('s2e2', 'https://youtu.be/aaaaaaaaaaa');
  target.setVideoLink('s1e1', 'https://youtu.be/bbbbbbbbbbb');
  const counts = target.import(JSON.stringify({ ...exported, videos: { ...exported.videos, s3e3: 'https://youtu.be/ccccccccccc' } }));
  assert.deepEqual(counts, { episodes: 1, videos: 2 });
  assert.equal(target.videoLinkFor('s1e1'), 'https://www.youtube.com/watch?v=bbbbbbbbbbb', 'a local link wins a merge');
  assert.equal(target.videoLinkFor('s2e2'), 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
  assert.equal(target.videoLinkFor('s3e3'), 'https://www.youtube.com/watch?v=ccccccccccc');
});

test('migrate keeps older backups and drops unusable links', () => {
  assert.deepEqual(migrate({ entries: {} }).videos, {}, 'a backup from before video links');
  assert.deepEqual(migrate({ videos: { a: 'junk', b: `youtu.be/${ID}` } }).videos, { b: canonicalVideoUrl(ID) });
});

test('applyVideoLinks overrides the catalogue match but remembers it', () => {
  const found = { id: 'catalogue01', url: 'u', thumbnail: 't' };
  const [linked, untouched] = applyVideoLinks(
    [{ id: 's1e1', video: found }, { id: 's1e2', video: null }],
    { s1e1: ID },
  );
  assert.equal(linked.video.id, ID);
  assert.equal(linked.video.manual, true);
  assert.equal(linked.catalogueVideo, found);
  assert.equal(untouched.video, null);
});
