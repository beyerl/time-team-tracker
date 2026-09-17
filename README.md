# Time Team Tracker

A small web app for keeping track of which **Time Team** episodes you have
watched. Progress lives in your browser — there is no account and no server.

**You never paste a YouTube link.** A build step looks the episodes up from
Wikipedia, finds the matching uploads on the official Time Team YouTube
channels, and stores the video ids and thumbnails in `public/catalogue.json`.
A scheduled workflow keeps it current as more episodes are uploaded.

## What it does

- Every series and special, grouped and collapsible, with per-series progress
- Thumbnail for each episode that has a video, and an in-page player
- Episodes without a video link to a YouTube search instead
- Watched marks, 1–5 ratings and free-text notes, all saved locally
- Search across site, county and episode title; filter by watched / has video
- "Surprise me" picks a random unwatched episode
- Export and import your progress as JSON, to back up or move devices
- Light and dark themes, and a layout that works on a phone

## Running it locally

```bash
npm install
npm run catalogue     # look up episodes + YouTube videos (needs internet)
npm run dev           # http://localhost:5173
```

No internet, or just want to work on the interface?

```bash
npm run dev:fixture   # writes a FAKE catalogue - do not commit the result
npm run dev
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run catalogue` | Rebuild `public/catalogue.json` from Wikipedia + YouTube |
| `npm run catalogue:offline` | Re-derive the file from what is committed, no network |
| `npm test` | Unit tests for the wikitext parser and the video matcher |
| `npm run build` | Production build into `dist/` |

## How the lookup works

1. **Episodes** come from Wikipedia's episode list, read as wikitext through
   the MediaWiki API. The parser copes with both table shapes the page has
   used over the years (`{{Episode list}}` templates and plain wikitables).
2. **Videos** come from the channels listed in
   [`scripts/catalogue.config.json`](scripts/catalogue.config.json). If a
   `YOUTUBE_API_KEY` is set the YouTube Data API is used; otherwise the script
   pages through the channel with the same public endpoint the website itself
   uses, so no key is required.
3. **Matching** scores each episode against each upload on how much of the
   episode title the video title covers, weighting distinctive words (a place
   name like *Athelney*) far above common ones (*castle*). An explicit
   `S04E07` marker in a video title boosts the score. Best pairs are taken
   first, and no video is ever assigned to two episodes.

The build is deliberately hard to break:

- A thin or failed lookup never overwrites a good catalogue — previously found
  videos are carried over and every problem is printed.
- The Pages deploy treats the lookup as best-effort, so the site still ships if
  YouTube or Wikipedia is unreachable.
- The app tells you when episodes have no video yet, rather than failing quietly.

Setting a `YOUTUBE_API_KEY` repository secret is optional but makes the lookup
more reliable. Adjust the channels or the match threshold in
`scripts/catalogue.config.json`.

## Deployment

### Web (GitHub Pages)

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the tests,
refreshes the catalogue, builds, and publishes on every push to `main`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The site then appears at
`https://beyerl.github.io/time-team-tracker/`.

[`.github/workflows/refresh-catalogue.yml`](.github/workflows/refresh-catalogue.yml)
re-runs the lookup weekly and commits the file when anything changed.

### Android (Capacitor)

[`.github/workflows/android.yml`](.github/workflows/android.yml) wraps the same
build in a Capacitor shell and uploads an installable APK as a workflow
artifact. Run it from the Actions tab, or let it run on a push to `main`, then
download the artifact and install it.

The `android/` directory is generated during the build rather than committed,
so the native project always matches the installed Capacitor version. The
catalogue is bundled into the APK, so the episode list works offline — only
video playback needs a connection.

Push a `v*` tag to also attach the APK to a GitHub release. For a *signed*
release build, add these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Your keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Without them the workflow still produces the unsigned debug APK.

To build the app locally instead:

```bash
npm run build
npx cap add android     # first time only
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Your data

Watch history is kept in `localStorage` under `time-team-tracker:v1`, keyed by
stable episode ids (`s07e03`), so rebuilding the catalogue never loses your
progress. Clearing site data does clear it — use **Data → Export backup** first.

---

Time Team is a Channel 4 production. This project stores no video content; it
links to the official YouTube channels.
