# Shopee Product Dashboard

A React + Vite dashboard backed by a Node/Express API that reads the published Google Sheet CSV.

## Run

```bash
npm run install:all   # installs root, server, client
npm run dev           # API on :3001, Vite on http://localhost:5173 (proxies /api)
```

Production:

```bash
npm run build && npm start   # Express serves client/dist + API on :3001
```

## Config (env)

- `CSV_URL` — override the sheet CSV URL
- `PORT` — API port (default 3001)
- `DB_FILE` — SQLite file (default `server/data/shopee.db`)
- `CRAWL_CONCURRENCY`, `CRAWL_DELAY_MS` — crawler politeness

## Data storage (SQLite)

All dashboard data lives in `server/data/shopee.db` (override with `DB_FILE`).
On first start the sheet is cloned into it; afterwards use **Re-sync from sheet**.

| Table | What it holds |
|---|---|
| `products` | Clone of the sheet + latest Jaknot crawl result per row |
| `crawl_runs` | One row per crawl: scope, timing, pages, counts of up / down / same / out of stock / not found |
| `crawl_changes` | One row per product per run whose crawl result differs from the DB (price up/down, out of stock, error) — the change report; `applied_at` is set once applied |
| `jaknot_pages` | Raw variants parsed from each crawled page |
| `audit_log` | Every field change (old → new), grouped by `batch_id`, with action `sheet_import` or `apply_crawl` |

**Apply price updates** sets `cost_before_x` (Harga Modal Belum x) to the crawled price and
recomputes the derived columns the same way the sheet does (verified on 891/893 rows):

- `old_cost` (Harga Modal Lama) = round(cost_before_x / X)
- `modal` (Harga Modal Baru) = old_cost + round(1250 / Minimal Order)
- margin price at m% = round(modal / (1 − m))

Only the newest pending change per product is applied. A sheet re-sync won't revert an
applied value unless that cell was actually edited in the sheet.

## API

- `GET /api/data` — products from SQLite + summary
- `POST /api/sync` — re-clone the sheet into SQLite (changed fields audited)
- `GET /api/jaknot` — crawl job status + per-row comparison vs "Harga Modal Belum x"
- `POST /api/jaknot/crawl` — start a background crawl run (body `{ keys: [...] }` to limit rows)
- `POST /api/jaknot/stop` — stop the running crawl
- `POST /api/jaknot/check` — re-check one row now (body `{ key }`)
- `GET /api/runs`, `GET /api/runs/:id` — crawl run reports (+ their changes)
- `GET /api/changes?runId=&result=up|down|changed|oos|problem&pending=1` and `/api/changes.csv`
- `POST /api/apply` — body `{ runId?, changeIds?, productIds?, dryRun?, note? }`; no filter = all pending
- `GET /api/audit?productId=&action=&batchId=`, `/api/audit/batches`, `/api/audit.csv`

### Jaknot crawler (`server/crawler.js`)

Reads the schema.org JSON-LD in each product page's `<head>` (only the head is downloaded),
which lists every variant with its SKU, price and stock. Rows are matched by **SKU Jaknote**.
Tuning: `CRAWL_CONCURRENCY` (default 3), `CRAWL_DELAY_MS` (default 400 ms per worker).
