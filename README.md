# Budget Saver

Envelope-style personal budgeting that keeps its data in your own Google Sheet and syncs between an iPhone and a Windows laptop.

You create up to 10 categories, top up money into them, and every expense reduces the balance of its category. The app is a single static HTML file. Google Apps Script acts as a free API in front of a Google Sheet, so there is no server to run and no subscription.

## Features

- **Envelope budgeting.** Up to 10 categories, each with its own remaining balance. The Dashboard shows total cash, per-category balances, and categories that have gone over.
- **Top ups and expenses.** Log income with the Masuk tab and spending with the Keluar tab. Press `N` on a laptop to add an entry quickly.
- **Peta (mind map).** A map of the selected month's money flow. The center shows income minus spending. Income and spending branch into categories, then into notes, with the five largest notes per category and the rest grouped as "Lainnya". Thicker lines mean larger amounts. Tap a note to see and edit its transactions.
- **Sync across devices.** The same Google account serves both devices. You can also open and edit the Sheet directly, and changes appear in the app on the next sync.
- **Works offline.** Entries are queued on the device and sent when the connection returns.
- **Apple-style interface.** System fonts, dark mode, large titles, bottom sheets, and a Liquid Glass tab bar with a draggable lens. Edge and Chrome add edge refraction; Safari falls back to a plain glass blur.
- **Installable.** Add it to the iPhone home screen or install it from Edge or Chrome on Windows.
- **CSV export** from Settings.

## How it works

```
index.html (static hosting)  ->  Apps Script web app (API)  ->  Google Sheet
```

- The app keeps its state in `localStorage` and applies changes optimistically.
- Changes go into an operation queue and are sent to the Apps Script endpoint as a single JSON request. Operations are idempotent, so retrying is safe.
- The script validates a shared secret (`API_TOKEN`), takes a script lock, applies the operations, and returns the full dataset.
- The Sheet has four tabs: `Dashboard`, `Kategori`, `Top Up (Income)`, and `Catat Harian (Pengeluaran)`. The Dashboard keeps live formulas, so the Sheet stays useful on its own.
- The Apps Script URL and token are entered in Settings and are never stored in the source, so the hosted site can be public.

## Setup

The full guide, in Indonesian, is in [`PANDUAN.md`](PANDUAN.md). In short:

1. Create a new Google Sheet and open **Extensions > Apps Script**.
2. Paste `apps-script/Code.gs` and replace `GANTI_TOKEN_INI` with a long random token of your own (24 characters or more).
3. Optionally paste `apps-script/appsscript.json` to set the time zone to Asia/Jakarta.
4. **Deploy > New deployment > Web app**, with *Execute as: Me* and *Who has access: Anyone*. Copy the URL ending in `/exec`.
5. Host `index.html`, `sw.js`, `manifest.webmanifest`, and the icons on any HTTPS static host (Netlify Drop, GitHub Pages, Cloudflare Pages).
6. Open the app, go to **Atur** (Settings), enter the web app URL and the token, and press **Hubungkan**. The sheets are created automatically on first connect.
7. On a second device, use **Salin tautan perangkat lain** on the first one and paste it into the setup link field on the second.

After changing `Code.gs`, deploy a new version: **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

## Project layout

```
index.html              the whole app (HTML, CSS, JS)
sw.js                   service worker, network-first cache for offline use
manifest.webmanifest    PWA manifest
icon-192.png, icon-512.png, apple-touch-icon.png
apps-script/Code.gs     API and sheet setup
apps-script/appsscript.json
PANDUAN.md              setup guide (Indonesian)
test/                   Node tests (fake Apps Script runtime, Playwright end-to-end)
```

## Tests

The tests run `Code.gs` against a small fake Apps Script runtime and drive the app with Playwright against a mock server.

```
node test/gas-test.js    # Code.gs API behavior
node test/e2e.js         # app flows
node test/map-e2e.js     # Peta tab
```

The end-to-end tests need Playwright and Chromium. Only Chromium has been tested; Safari and real Google Sheets have not.

## Security

"Anyone" access only opens the door. Every request is rejected without the token, and anyone who has both the URL and the token can read and write your data, so keep both private. To rotate the token, change it in `Code.gs`, deploy a new version, and enter the new token on each device. The setup link contains the token, so do not share it.

## Differences from the original spreadsheet

Remaining category balance counts only top ups dated on or before the expense date. The original formula counted every top up, including ones that arrived later.

## Notes

- Category names can be changed and the change cascades to all of their transactions. A category that still has transactions cannot be deleted.
- Do not delete the hidden ID column in the Sheet. Rows typed by hand without an ID get one on the next read.
- The interface is in Indonesian.
