import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CSV_URL, parseSheet, summarize } from './sheet.js';
import {
  DB_FILE,
  applyChanges,
  auditBatches,
  auditFields,
  db,
  getProduct,
  searchAudit,
  getRun,
  importSheet,
  listAudit,
  listChanges,
  listProducts,
  listRuns,
  productCount,
} from './db.js';
import { checkOne, jobStatus, startCrawl, stopCrawl } from './crawler.js';

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ---------- sheet -> SQLite ----------
async function syncFromSheet() {
  const res = await fetch(CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const stats = importSheet(parseSheet(await res.text()));
  console.log('sheet import', stats);
  return stats;
}

const lastImport = () =>
  db.prepare(`SELECT batch_id, MIN(at) AS at FROM audit_log WHERE action = 'sheet_import' GROUP BY batch_id ORDER BY MIN(id) DESC LIMIT 1`).get() ||
  db.prepare(`SELECT MAX(imported_at) AS at FROM products`).get();

// Products always come from SQLite.
app.get('/api/data', wrap(async (_req, res) => {
  const products = listProducts();
  res.json({ fetchedAt: lastImport()?.at ?? null, products, summary: summarize(products), dbFile: path.basename(DB_FILE) });
}));

// Re-clone the sheet into SQLite (changed fields are audited).
app.post('/api/sync', wrap(async (_req, res) => {
  res.json(await syncFromSheet());
}));

// ---------- Jaknot crawl ----------
const resultsMap = (products) => Object.fromEntries(products.filter((p) => p.jaknot).map((p) => [p.key, p.jaknot]));

app.get('/api/jaknot', wrap(async (_req, res) => {
  res.json({ job: jobStatus(), results: resultsMap(listProducts()) });
}));

// Body: { keys?: string[] } to crawl only those rows.
app.post('/api/jaknot/crawl', wrap(async (req, res) => {
  const keys = req.body?.keys;
  const urls = listProducts()
    .filter((p) => p.linkSource === 'Jaknot' && (!keys || keys.includes(p.key)))
    .map((p) => p.link);
  if (!urls.length) return res.status(400).json({ error: 'No Jaknot links to crawl' });
  const runId = startCrawl(urls, keys ? 'filtered' : 'all');
  if (!runId) return res.status(409).json({ error: 'A crawl is already running', job: jobStatus() });
  res.status(202).json({ job: jobStatus() });
}));

app.post('/api/jaknot/stop', (_req, res) => {
  stopCrawl();
  res.json({ job: jobStatus() });
});

app.post('/api/jaknot/check', wrap(async (req, res) => {
  const p = listProducts().find((x) => x.key === req.body?.key);
  if (!p || p.linkSource !== 'Jaknot') return res.status(404).json({ error: 'Row has no Jaknot link' });
  const runId = await checkOne(p.link);
  const fresh = listProducts().find((x) => x.key === p.key);
  res.json({ key: p.key, runId, result: fresh.jaknot });
}));

// ---------- crawl reports ----------
app.get('/api/runs', wrap(async (_req, res) => {
  res.json(listRuns());
}));

app.get('/api/runs/:id', wrap(async (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run, changes: listChanges({ runId: run.id, limit: 5000 }) });
}));

// Query: runId, result (up|down|changed|oos|problem|...), pending=1
app.get('/api/changes', wrap(async (req, res) => {
  const { runId, result, pending } = req.query;
  res.json(listChanges({ runId: runId && Number(runId), result, pendingOnly: pending === '1', limit: 5000 }));
}));

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');

app.get('/api/changes.csv', wrap(async (req, res) => {
  const { runId, result, pending } = req.query;
  const rows = listChanges({ runId: runId && Number(runId), result, pendingOnly: pending === '1', limit: 100000 });
  const cols = ['id', 'run_id', 'checked_at', 'sku_shopee', 'sku_jaknote', 'name', 'variant', 'result', 'db_price', 'jaknot_price', 'diff', 'diff_pct', 'availability', 'error', 'applied_at', 'url'];
  res.type('text/csv').attachment(`jaknot-changes${runId ? `-run${runId}` : ''}.csv`).send(toCsv(rows, cols));
}));

// ---------- apply crawl results ----------
// Body: { runId?, changeIds?, productIds?, dryRun?, note? } — no filter = all pending changes.
app.post('/api/apply', wrap(async (req, res) => {
  const { runId, changeIds, productIds, dryRun, note } = req.body || {};
  res.json(applyChanges({ runId, changeIds, productIds, dryRun: !!dryRun, note }));
}));

// ---------- audit log ----------
app.get('/api/audit', wrap(async (req, res) => {
  const { productId, action, batchId, limit } = req.query;
  res.json(listAudit({ productId: productId && Number(productId), action, batchId, limit: Math.min(Number(limit) || 500, 10000) }));
}));

app.get('/api/audit/batches', wrap(async (req, res) => {
  res.json(auditBatches(Math.min(Number(req.query.limit) || 50, 1000)));
}));

// Paged search for the audit page: q, action, batchId, field, productId, from, to, limit, offset
app.get('/api/audit/search', wrap(async (req, res) => {
  const { q, action, batchId, field, productId, from, to, limit, offset } = req.query;
  res.json(
    searchAudit({
      q: q?.trim() || undefined,
      action: action || undefined,
      batchId: batchId || undefined,
      field: field || undefined,
      productId: productId ? Number(productId) : undefined,
      from: from || undefined,
      to: to || undefined,
      limit: Math.min(Number(limit) || 100, 1000),
      offset: Math.max(Number(offset) || 0, 0),
    })
  );
}));

app.get('/api/audit/fields', wrap(async (_req, res) => {
  res.json(auditFields());
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const p = getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
}));

app.get('/api/audit.csv', wrap(async (req, res) => {
  const { q, action, batchId, field, productId, from, to } = req.query;
  const { rows } = searchAudit({
    q: q?.trim() || undefined,
    action: action || undefined,
    batchId: batchId || undefined,
    field: field || undefined,
    productId: productId ? Number(productId) : undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 1000000,
  });
  const cols = ['id', 'at', 'batch_id', 'action', 'product_id', 'sku_shopee', 'sku_jaknote', 'name', 'field', 'old_value', 'new_value', 'source', 'note'];
  res.type('text/csv').attachment('audit-log.csv').send(toCsv(rows, cols));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve the built client in production.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// First start: clone the sheet into an empty database.
if (productCount() === 0) {
  try {
    await syncFromSheet();
  } catch (err) {
    console.error('Initial sheet import failed:', err.message);
  }
}

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT} (db: ${DB_FILE})`));
