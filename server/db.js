import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARGINS } from './sheet.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'shopee.db');

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  key                    TEXT NOT NULL UNIQUE,      -- skuShopee|skuJaknote|occurrence (stable across sheet re-imports)
  sheet_row              INTEGER,                   -- position in the sheet at last import
  no                     REAL,
  name                   TEXT,
  variant                TEXT,
  sku_shopee             TEXT,
  sku_jaknote            TEXT,
  weight                 REAL,
  link                   TEXT,
  link_source            TEXT,
  status                 TEXT,
  target_margin          REAL,
  upload_date            TEXT,
  pack_qty               REAL,                      -- "X"
  min_order              REAL,
  min_package_discount   REAL,
  package_discount_pct   REAL,
  price_adjustment       TEXT,
  package_discount_status TEXT,
  min_order_active       TEXT,
  cost_before_x          REAL,                      -- Harga Modal Belum x
  old_cost               REAL,                      -- Harga Modal Lama
  modal                  REAL,                      -- Modal / Harga Modal Baru
  prices                 TEXT,                      -- JSON { "20": 497, ... }
  jaknot_price           REAL,                      -- latest crawled price
  jaknot_availability    TEXT,
  jaknot_sku             TEXT,
  jaknot_error           TEXT,
  jaknot_checked_at      TEXT,
  in_sheet               INTEGER NOT NULL DEFAULT 1, -- 0 if gone from the sheet at last import
  imported_at            TEXT,
  updated_at             TEXT
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,                       -- running | completed | stopped | failed
  scope         TEXT,                                -- all | filtered
  total_pages   INTEGER DEFAULT 0,
  pages_done    INTEGER DEFAULT 0,
  page_errors   INTEGER DEFAULT 0,
  rows_checked  INTEGER DEFAULT 0,
  price_up      INTEGER DEFAULT 0,
  price_down    INTEGER DEFAULT 0,
  unchanged     INTEGER DEFAULT 0,
  out_of_stock  INTEGER DEFAULT 0,
  not_found     INTEGER DEFAULT 0
);

-- One row per product whose crawl result differs from the DB (price change, out of stock, error).
CREATE TABLE IF NOT EXISTS crawl_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES crawl_runs(id),
  product_id     INTEGER NOT NULL REFERENCES products(id),
  checked_at     TEXT NOT NULL,
  url            TEXT,
  result         TEXT NOT NULL,                      -- up | down | same | no-price | sku-not-found | error
  db_price       REAL,                               -- cost_before_x at crawl time
  jaknot_price   REAL,
  diff           REAL,
  diff_pct       REAL,
  availability   TEXT,
  error          TEXT,
  applied_at     TEXT,
  applied_by_audit INTEGER
);
CREATE INDEX IF NOT EXISTS idx_changes_run ON crawl_changes(run_id);
CREATE INDEX IF NOT EXISTS idx_changes_product ON crawl_changes(product_id);

CREATE TABLE IF NOT EXISTS jaknot_pages (
  url          TEXT PRIMARY KEY,
  checked_at   TEXT,
  final_url    TEXT,
  variants     TEXT,                                 -- JSON
  error        TEXT
);

-- Every change to product data: one row per field changed.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  batch_id     TEXT NOT NULL,                        -- groups rows written by one action
  action       TEXT NOT NULL,                        -- sheet_import | apply_crawl
  product_id   INTEGER REFERENCES products(id),
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  source       TEXT,                                 -- e.g. crawl_change:123, sheet
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_product ON audit_log(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_log(batch_id);
`);

const now = () => new Date().toISOString();
const newBatchId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const roundHalfUp = (x) => Math.floor(x + 0.5);

// Fields copied from the sheet on import (sheet field -> column).
const SHEET_FIELDS = {
  no: 'no',
  name: 'name',
  variant: 'variant',
  skuShopee: 'sku_shopee',
  skuJaknote: 'sku_jaknote',
  weight: 'weight',
  link: 'link',
  linkSource: 'link_source',
  status: 'status',
  targetMargin: 'target_margin',
  uploadDate: 'upload_date',
  packQty: 'pack_qty',
  minOrder: 'min_order',
  minPackageDiscount: 'min_package_discount',
  packageDiscountPct: 'package_discount_pct',
  priceAdjustment: 'price_adjustment',
  packageDiscountStatus: 'package_discount_status',
  minOrderActive: 'min_order_active',
  costBeforeX: 'cost_before_x',
  oldCost: 'old_cost',
  modal: 'modal',
  prices: 'prices',
};

const COST_FIELDS = ['cost_before_x', 'old_cost', 'modal', 'prices'];

const asText = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Clone the sheet into SQLite. Existing rows are matched by key; every changed field
 * is written to the audit log. Rows missing from the sheet are flagged in_sheet = 0.
 */
export function importSheet(sheetProducts) {
  const at = now();
  const batch = newBatchId('import');
  const seen = {};
  const existing = new Map(db.prepare('SELECT * FROM products').all().map((r) => [r.key, r]));
  const cols = Object.values(SHEET_FIELDS);
  const insert = db.prepare(
    `INSERT INTO products (key, sheet_row, ${cols.join(', ')}, in_sheet, imported_at, updated_at)
     VALUES (@key, @sheet_row, ${cols.map((c) => '@' + c).join(', ')}, 1, @at, @at)`
  );
  const audit = db.prepare(
    `INSERT INTO audit_log (at, batch_id, action, product_id, field, old_value, new_value, source, note)
     VALUES (?, ?, 'sheet_import', ?, ?, ?, ?, 'sheet', ?)`
  );
  const lastAudit = db.prepare(
    `SELECT action, old_value FROM audit_log WHERE product_id = ? AND field = ? ORDER BY id DESC LIMIT 1`
  );
  const stats = { inserted: 0, updated: 0, unchanged: 0, removed: 0, fieldsChanged: 0, keptCrawlValues: 0, batchId: batch };

  db.transaction(() => {
    const keys = new Set();
    sheetProducts.forEach((p, i) => {
      const base = `${p.skuShopee}|${p.skuJaknote}`;
      seen[base] = (seen[base] || 0) + 1;
      const key = `${base}|${seen[base]}`;
      keys.add(key);
      const row = { key, sheet_row: i, at };
      for (const [f, c] of Object.entries(SHEET_FIELDS)) {
        row[c] = f === 'prices' ? JSON.stringify(p.prices) : p[f] ?? null;
      }
      const old = existing.get(key);
      if (!old) {
        const { lastInsertRowid } = insert.run(row);
        audit.run(at, batch, lastInsertRowid, null, null, null, 'new row from sheet');
        stats.inserted++;
        return;
      }
      // Don't let a stale sheet value undo a crawl update: if the last change to a cost field was
      // apply_crawl and the sheet still holds the value from before that apply, keep the DB value.
      for (const c of COST_FIELDS) {
        if (asText(old[c]) === asText(row[c])) continue;
        const last = lastAudit.get(old.id, c);
        if (last?.action === 'apply_crawl' && last.old_value === asText(row[c])) {
          row[c] = old[c];
          stats.keptCrawlValues++;
        }
      }
      const changed = cols.filter((c) => asText(old[c]) !== asText(row[c]));
      const flagBack = old.in_sheet === 0;
      if (!changed.length && !flagBack && old.sheet_row === i) {
        stats.unchanged++;
        return;
      }
      for (const c of changed) audit.run(at, batch, old.id, c, asText(old[c]), asText(row[c]), null);
      stats.fieldsChanged += changed.length;
      db.prepare(
        `UPDATE products SET sheet_row = @sheet_row, ${cols.map((c) => `${c} = @${c}`).join(', ')},
           in_sheet = 1, imported_at = @at ${changed.length ? ', updated_at = @at' : ''} WHERE id = @id`
      ).run({ ...row, id: old.id });
      if (changed.length) stats.updated++;
      else stats.unchanged++;
    });
    for (const [key, old] of existing) {
      if (!keys.has(key) && old.in_sheet) {
        db.prepare('UPDATE products SET in_sheet = 0, updated_at = ? WHERE id = ?').run(at, old.id);
        audit.run(at, batch, old.id, 'in_sheet', '1', '0', 'row no longer in sheet');
        stats.removed++;
      }
    }
  })();
  return stats;
}

export const productCount = () => db.prepare('SELECT COUNT(*) n FROM products').get().n;

/** Products in the shape the frontend uses. */
export function listProducts() {
  return db
    .prepare('SELECT * FROM products WHERE in_sheet = 1 ORDER BY sheet_row')
    .all()
    .map(toApi);
}

export function getProductsByLink(url) {
  return db.prepare('SELECT * FROM products WHERE in_sheet = 1 AND link = ?').all(url);
}

export function toApi(r) {
  return {
    id: r.id,
    key: r.key,
    no: r.no,
    name: r.name || '',
    variant: r.variant || '',
    skuShopee: r.sku_shopee || '',
    skuJaknote: r.sku_jaknote || '',
    weight: r.weight,
    link: r.link || '',
    linkSource: r.link_source,
    status: r.status,
    targetMargin: r.target_margin,
    uploadDate: r.upload_date,
    packQty: r.pack_qty,
    minOrder: r.min_order,
    minPackageDiscount: r.min_package_discount,
    packageDiscountPct: r.package_discount_pct,
    priceAdjustment: r.price_adjustment || '',
    packageDiscountStatus: r.package_discount_status || '',
    minOrderActive: r.min_order_active || '',
    costBeforeX: r.cost_before_x,
    oldCost: r.old_cost,
    newCost: r.modal,
    modal: r.modal,
    prices: r.prices ? JSON.parse(r.prices) : {},
    costChangePct: r.old_cost && r.modal != null ? (r.modal - r.old_cost) / r.old_cost : null,
    updatedAt: r.updated_at,
    jaknot: r.jaknot_checked_at ? jaknotResult(r) : null,
  };
}

/** Compare the latest crawl for a product with its current cost_before_x. */
export function jaknotResult(r) {
  const sheet = r.cost_before_x;
  const current = r.jaknot_price;
  let result;
  if (current == null) result = !r.jaknot_error ? 'no-price' : r.jaknot_error.startsWith('SKU ') ? 'sku-not-found' : 'error';
  else if (sheet == null) result = 'no-price';
  else if (current > sheet) result = 'up';
  else if (current < sheet) result = 'down';
  else result = 'same';
  return {
    checkedAt: r.jaknot_checked_at,
    error: r.jaknot_error,
    jaknotSku: r.jaknot_sku,
    availability: r.jaknot_availability,
    currentPrice: current,
    sheetPrice: sheet,
    diff: current != null && sheet != null ? current - sheet : null,
    diffPct: current != null && sheet ? (current - sheet) / sheet : null,
    result,
  };
}

// ---------- crawl runs ----------
export function createRun(scope, totalPages) {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO crawl_runs (started_at, status, scope, total_pages) VALUES (?, 'running', ?, ?)`)
    .run(now(), scope, totalPages);
  return Number(lastInsertRowid);
}

export function getRun(id) {
  return db.prepare('SELECT * FROM crawl_runs WHERE id = ?').get(id);
}

export function finishRun(id, status) {
  db.prepare('UPDATE crawl_runs SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), id);
}

// Mark runs left "running" by a server restart.
db.prepare(`UPDATE crawl_runs SET status = 'failed', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'`).run(now());

/**
 * Store one crawled page: update every product that uses this URL with its variant's price,
 * write a crawl_changes row for anything that differs, and bump the run counters.
 */
export function recordPage(runId, url, page) {
  const at = page.checkedAt;
  const products = getProductsByLink(url);
  const counts = { rows_checked: 0, price_up: 0, price_down: 0, unchanged: 0, out_of_stock: 0, not_found: 0 };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO jaknot_pages (url, checked_at, final_url, variants, error) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET checked_at = excluded.checked_at, final_url = excluded.final_url,
         variants = excluded.variants, error = excluded.error`
    ).run(url, at, page.finalUrl || null, JSON.stringify(page.variants), page.error);

    for (const p of products) {
      const sku = (p.sku_jaknote || '').toUpperCase();
      const v =
        page.variants.find((x) => x.sku.toUpperCase() === sku) ||
        page.variants.find((x) => x.url && x.url === url) ||
        (page.variants.length === 1 ? page.variants[0] : null);

      const error = v ? null : page.error || `SKU ${p.sku_jaknote} not on page`;
      db.prepare(
        `UPDATE products SET jaknot_price = ?, jaknot_availability = ?, jaknot_sku = ?, jaknot_error = ?, jaknot_checked_at = ?
         WHERE id = ?`
      ).run(v?.price ?? null, v?.availability ?? null, v?.sku ?? null, error, at, p.id);

      const r = jaknotResult({
        ...p,
        jaknot_price: v?.price ?? null,
        jaknot_availability: v?.availability ?? null,
        jaknot_sku: v?.sku ?? null,
        jaknot_error: error,
        jaknot_checked_at: at,
      });
      counts.rows_checked++;
      if (r.result === 'up') counts.price_up++;
      else if (r.result === 'down') counts.price_down++;
      else if (r.result === 'same') counts.unchanged++;
      else counts.not_found++;
      const oos = r.availability && r.availability !== 'InStock';
      if (oos) counts.out_of_stock++;

      if (r.result !== 'same' || oos) {
        db.prepare(
          `INSERT INTO crawl_changes (run_id, product_id, checked_at, url, result, db_price, jaknot_price, diff, diff_pct, availability, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(runId, p.id, at, url, r.result, r.sheetPrice, r.currentPrice, r.diff, r.diffPct, r.availability, error);
      }
    }

    db.prepare(
      `UPDATE crawl_runs SET pages_done = pages_done + 1, page_errors = page_errors + @page_errors,
         rows_checked = rows_checked + @rows_checked, price_up = price_up + @price_up, price_down = price_down + @price_down,
         unchanged = unchanged + @unchanged, out_of_stock = out_of_stock + @out_of_stock, not_found = not_found + @not_found
       WHERE id = @id`
    ).run({ ...counts, page_errors: page.error ? 1 : 0, id: runId });
  })();
}

// ---------- reports ----------
export function listRuns(limit = 50) {
  return db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM crawl_changes c WHERE c.run_id = r.id AND c.result IN ('up','down') AND c.applied_at IS NULL) AS pending_apply,
         (SELECT COUNT(*) FROM crawl_changes c WHERE c.run_id = r.id AND c.applied_at IS NOT NULL) AS applied
       FROM crawl_runs r ORDER BY r.id DESC LIMIT ?`
    )
    .all(limit);
}

export function listChanges({ runId, result, pendingOnly, limit = 1000 } = {}) {
  const where = [];
  const args = {};
  if (runId) (where.push('c.run_id = @runId'), (args.runId = runId));
  if (result === 'oos') where.push(`c.availability IS NOT NULL AND c.availability <> 'InStock'`);
  else if (result === 'changed') where.push(`c.result IN ('up','down')`);
  else if (result === 'problem') where.push(`c.result NOT IN ('up','down','same')`);
  else if (result) (where.push('c.result = @result'), (args.result = result));
  if (pendingOnly) where.push(`c.applied_at IS NULL AND c.result IN ('up','down')`);
  return db
    .prepare(
      `SELECT c.*, p.name, p.variant, p.sku_shopee, p.sku_jaknote, p.cost_before_x AS current_db_price
       FROM crawl_changes c JOIN products p ON p.id = c.product_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.id DESC LIMIT @limit`
    )
    .all({ ...args, limit });
}

export function listAudit({ productId, action, batchId, limit = 500 } = {}) {
  const where = [];
  const args = { limit };
  if (productId) (where.push('a.product_id = @productId'), (args.productId = productId));
  if (action) (where.push('a.action = @action'), (args.action = action));
  if (batchId) (where.push('a.batch_id = @batchId'), (args.batchId = batchId));
  return db
    .prepare(
      `SELECT a.*, p.name, p.variant, p.sku_shopee, p.sku_jaknote
       FROM audit_log a LEFT JOIN products p ON p.id = a.product_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.id DESC LIMIT @limit`
    )
    .all(args);
}

/**
 * Paged, searchable audit query for the audit page.
 * Filters: q (name / SKU / note / batch), action, batchId, field, productId, from, to (ISO dates, inclusive).
 */
export function searchAudit({ q, action, batchId, field, productId, from, to, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = {};
  if (q) {
    where.push(`(p.name LIKE @q OR p.variant LIKE @q OR p.sku_shopee LIKE @q OR p.sku_jaknote LIKE @q OR a.note LIKE @q OR a.batch_id LIKE @q)`);
    args.q = `%${q}%`;
  }
  if (action) (where.push('a.action = @action'), (args.action = action));
  if (batchId) (where.push('a.batch_id = @batchId'), (args.batchId = batchId));
  if (field === '__row') where.push('a.field IS NULL');
  else if (field) (where.push('a.field = @field'), (args.field = field));
  if (productId) (where.push('a.product_id = @productId'), (args.productId = productId));
  if (from) (where.push('a.at >= @from'), (args.from = from));
  if (to) (where.push('a.at < @to'), (args.to = new Date(new Date(to).getTime() + 86400000).toISOString().slice(0, 10)));
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM audit_log a LEFT JOIN products p ON p.id = a.product_id ${clause}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(args).n;
  const rows = db
    .prepare(
      `SELECT a.*, p.name, p.variant, p.sku_shopee, p.sku_jaknote, p.link ${base} ORDER BY a.id DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...args, limit, offset });
  const stats = db
    .prepare(`SELECT a.action, COUNT(*) n, COUNT(DISTINCT a.product_id) products ${base} GROUP BY a.action`)
    .all(args);
  return { total, rows, stats };
}

export function auditFields() {
  return db.prepare(`SELECT field, COUNT(*) n FROM audit_log WHERE field IS NOT NULL GROUP BY field ORDER BY n DESC`).all();
}

export function getProduct(id) {
  const r = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return r ? toApi(r) : null;
}

export function auditBatches(limit = 50) {
  return db
    .prepare(
      `SELECT batch_id, action, MIN(at) AS at, COUNT(*) AS rows, COUNT(DISTINCT product_id) AS products,
         MAX(CASE WHEN action = 'apply_crawl' THEN note END) AS note,
         MAX(CASE WHEN source LIKE 'crawl_change:%' THEN (SELECT run_id FROM crawl_changes WHERE id = CAST(substr(source, 14) AS INTEGER)) END) AS run_id
       FROM audit_log GROUP BY batch_id ORDER BY MIN(id) DESC LIMIT ?`
    )
    .all(limit);
}

// ---------- apply crawl results ----------
/** Recompute derived costs the way the sheet does. */
export function deriveCosts(costBeforeX, packQty, minOrder) {
  const x = packQty > 0 ? packQty : 1;
  const oldCost = roundHalfUp(costBeforeX / x);
  const fee = minOrder > 0 ? roundHalfUp(1250 / minOrder) : 0;
  const modal = oldCost + fee;
  const prices = {};
  for (const m of MARGINS) prices[m] = roundHalfUp(modal / (1 - m / 100));
  return { oldCost, modal, prices };
}

/**
 * Apply pending price changes (result up/down, not yet applied) to products:
 * cost_before_x := jaknot_price, then recompute old_cost, modal and margin prices.
 * Only the newest pending change per product is applied. Every field change is audited.
 * Options: { runId, changeIds, productIds, dryRun }
 */
export function applyChanges({ runId, changeIds, productIds, dryRun = false, note } = {}) {
  const where = [`c.applied_at IS NULL`, `c.result IN ('up','down')`, `c.jaknot_price IS NOT NULL`];
  const args = {};
  if (runId) (where.push('c.run_id = @runId'), (args.runId = runId));
  if (changeIds?.length) where.push(`c.id IN (${changeIds.map(Number).filter(Number.isFinite).join(',') || 'NULL'})`);
  if (productIds?.length) where.push(`c.product_id IN (${productIds.map(Number).filter(Number.isFinite).join(',') || 'NULL'})`);

  const pending = db
    .prepare(
      `SELECT c.*, p.cost_before_x, p.old_cost, p.modal, p.prices, p.pack_qty, p.min_order, p.name, p.sku_shopee
       FROM crawl_changes c JOIN products p ON p.id = c.product_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.id DESC`
    )
    .all(args);

  // newest change per product wins; older ones are marked superseded
  const latest = new Map();
  const superseded = [];
  for (const c of pending) {
    if (latest.has(c.product_id)) superseded.push(c.id);
    else latest.set(c.product_id, c);
  }

  const at = now();
  const batch = newBatchId('apply');
  const plan = [];
  for (const c of latest.values()) {
    const next = { cost_before_x: c.jaknot_price, ...deriveCosts(c.jaknot_price, c.pack_qty, c.min_order) };
    const changes = [
      ['cost_before_x', c.cost_before_x, next.cost_before_x],
      ['old_cost', c.old_cost, next.oldCost],
      ['modal', c.modal, next.modal],
      ['prices', c.prices, JSON.stringify(next.prices)],
    ].filter(([, a, b]) => asText(a) !== asText(b));
    plan.push({ change: c, next, changes });
  }

  const summary = {
    batchId: dryRun ? null : batch,
    dryRun,
    products: plan.length,
    fieldsChanged: plan.reduce((n, p) => n + p.changes.length, 0),
    superseded: superseded.length,
    items: plan.map(({ change: c, next, changes }) => ({
      changeId: c.id,
      productId: c.product_id,
      name: c.name,
      skuShopee: c.sku_shopee,
      from: { costBeforeX: c.cost_before_x, oldCost: c.old_cost, modal: c.modal },
      to: { costBeforeX: next.cost_before_x, oldCost: next.oldCost, modal: next.modal },
      fields: changes.map(([f]) => f),
    })),
  };
  if (dryRun || !plan.length) return summary;

  const audit = db.prepare(
    `INSERT INTO audit_log (at, batch_id, action, product_id, field, old_value, new_value, source, note)
     VALUES (?, ?, 'apply_crawl', ?, ?, ?, ?, ?, ?)`
  );
  const upd = db.prepare(
    `UPDATE products SET cost_before_x = ?, old_cost = ?, modal = ?, prices = ?, updated_at = ? WHERE id = ?`
  );
  const mark = db.prepare(`UPDATE crawl_changes SET applied_at = ?, applied_by_audit = ? WHERE id = ?`);

  db.transaction(() => {
    for (const { change: c, next, changes } of plan) {
      let firstAudit = null;
      for (const [field, a, b] of changes) {
        const { lastInsertRowid } = audit.run(at, batch, c.product_id, field, asText(a), asText(b), `crawl_change:${c.id}`, note || null);
        firstAudit ??= Number(lastInsertRowid);
      }
      upd.run(next.cost_before_x, next.oldCost, next.modal, JSON.stringify(next.prices), at, c.product_id);
      mark.run(at, firstAudit, c.id);
    }
    for (const id of superseded) mark.run(at, null, id);
  })();
  return summary;
}
