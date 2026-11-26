import { Fragment, useEffect, useMemo, useState } from 'react';
import { fmtIDR, fmtNum } from '../format.js';
import { href, navigate } from '../router.js';

const PAGE_SIZE = 100;

export const FIELD_LABEL = {
  cost_before_x: 'Modal belum x',
  old_cost: 'Modal Lama',
  modal: 'Modal',
  prices: 'Margin prices',
  in_sheet: 'In sheet',
  status: 'Status',
  name: 'Product name',
  variant: 'Variant',
  link: 'Link',
  link_source: 'Link source',
  sku_shopee: 'SKU Shopee',
  sku_jaknote: 'SKU Jaknote',
  upload_date: 'Upload date',
  pack_qty: 'X (pack qty)',
  min_order: 'Minimal order',
  min_package_discount: 'Min. paket diskon',
  package_discount_pct: 'Paket diskon %',
  price_adjustment: 'Price adjustment',
  package_discount_status: 'Paket diskon status',
  min_order_active: 'Min. order active',
  target_margin: 'Target margin',
  weight: 'Weight',
  no: 'No.',
};

const ACTION_LABEL = { apply_crawl: 'Apply crawl', sheet_import: 'Sheet import' };
const MONEY_FIELDS = new Set(['cost_before_x', 'old_cost', 'modal']);

const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '—');
const label = (f) => FIELD_LABEL[f] || f;

function fmtValue(field, v) {
  if (v == null || v === '') return <span className="muted">empty</span>;
  if (MONEY_FIELDS.has(field)) return fmtIDR(Number(v));
  if (field === 'prices') {
    try {
      return `40%: ${fmtIDR(JSON.parse(v)[40])}`;
    } catch {
      return v;
    }
  }
  if (field === 'package_discount_pct' || field === 'target_margin') return `${(Number(v) * 100).toFixed(2)}%`;
  return String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v);
}

function delta(field, a, b) {
  if (!MONEY_FIELDS.has(field)) return null;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || a == null || b == null) return null;
  const d = y - x;
  if (!d) return null;
  return (
    <span className="small" style={{ color: d > 0 ? 'var(--status-critical)' : 'var(--status-good)' }}>
      {d > 0 ? '▲ +' : '▼ '}
      {fmtIDR(d)} ({d > 0 ? '+' : ''}
      {((d / x) * 100).toFixed(1)}%)
    </span>
  );
}

function PricesDiff({ oldV, newV }) {
  let a = {};
  let b = {};
  try {
    a = JSON.parse(oldV || '{}');
    b = JSON.parse(newV || '{}');
  } catch {
    return null;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => Number(x) - Number(y));
  return (
    <table className="mini">
      <thead>
        <tr>
          <th>Margin</th>
          <th className="num">Old</th>
          <th className="num">New</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className={a[k] !== b[k] ? '' : 'muted'}>
            <td>{k}%</td>
            <td className="num">{fmtIDR(a[k])}</td>
            <td className="num">{fmtIDR(b[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductHeader({ productId }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    fetch(`/api/products/${productId}`).then((r) => (r.ok ? r.json() : null)).then(setP);
  }, [productId]);
  if (!p) return null;
  return (
    <div className="card product-head">
      <div>
        <div className="muted small">Change history for</div>
        <h2 style={{ margin: '2px 0' }}>
          {p.link ? <a href={p.link} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
        </h2>
        <div className="muted small">
          {p.variant && `${p.variant} · `}SKU Shopee {p.skuShopee || '—'} · SKU Jaknote {p.skuJaknote || '—'} · {p.status}
        </div>
      </div>
      <div className="product-now">
        <div><span className="muted small">Modal belum x</span><strong>{fmtIDR(p.costBeforeX)}</strong></div>
        <div><span className="muted small">Modal Lama</span><strong>{fmtIDR(p.oldCost)}</strong></div>
        <div><span className="muted small">Modal</span><strong>{fmtIDR(p.modal)}</strong></div>
        <div><span className="muted small">Jaknot now</span><strong>{fmtIDR(p.jaknot?.currentPrice)}</strong></div>
      </div>
    </div>
  );
}

export default function AuditPage({ params }) {
  // All filter state lives in the URL so views are shareable / bookmarkable.
  const f = {
    q: params.get('q') || '',
    action: params.get('action') || '',
    batchId: params.get('batchId') || '',
    field: params.get('field') || '',
    productId: params.get('productId') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    page: Number(params.get('page')) || 0,
  };
  const set = (patch) => navigate('audit', { ...f, page: 0, ...patch });

  const [qInput, setQInput] = useState(f.q);
  useEffect(() => setQInput(f.q), [f.q]);
  useEffect(() => {
    if (qInput === f.q) return;
    const t = setTimeout(() => set({ q: qInput }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const [batches, setBatches] = useState([]);
  const [fields, setFields] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch('/api/audit/batches?limit=200').then((r) => r.json()).then(setBatches).catch(() => {});
    fetch('/api/audit/fields').then((r) => r.json()).then(setFields).catch(() => {});
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of ['q', 'action', 'batchId', 'field', 'productId', 'from', 'to']) if (f[k]) q.set(k, f[k]);
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.q, f.action, f.batchId, f.field, f.productId, f.from, f.to]);

  useEffect(() => {
    setError(null);
    const q = new URLSearchParams(query);
    q.set('limit', PAGE_SIZE);
    q.set('offset', f.page * PAGE_SIZE);
    fetch(`/api/audit/search?${q}`)
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setData(j)))
      .catch((e) => setError(e.message));
  }, [query, f.page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters = ['q', 'action', 'batchId', 'field', 'productId', 'from', 'to'].some((k) => f[k]);
  const statFor = (a) => data?.stats.find((s) => s.action === a);
  const selectedBatch = batches.find((b) => b.batch_id === f.batchId);

  return (
    <>
      {f.productId && <ProductHeader productId={f.productId} />}

      <div className="kpis kpis-sm">
        <div className="card tile">
          <div className="tile-label">Entries</div>
          <div className="tile-value">{data ? fmtNum(data.total) : '—'}</div>
          <div className="tile-sub">{hasFilters ? 'matching filters' : 'all time'}</div>
        </div>
        {['apply_crawl', 'sheet_import'].map((a) => (
          <button key={a} className={`card tile tile-btn${f.action === a ? ' active' : ''}`} onClick={() => set({ action: f.action === a ? '' : a })}>
            <div className="tile-label">{ACTION_LABEL[a]}</div>
            <div className="tile-value">{fmtNum(statFor(a)?.n ?? 0)}</div>
            <div className="tile-sub">{fmtNum(statFor(a)?.products ?? 0)} products</div>
          </button>
        ))}
        <div className="card tile">
          <div className="tile-label">Batches</div>
          <div className="tile-value">{fmtNum(batches.length)}</div>
          <div className="tile-sub">imports & applies</div>
        </div>
      </div>

      <div className="audit-layout">
        <aside className="card batches">
          <h2>Batches</h2>
          <button className={`batch${!f.batchId ? ' active' : ''}`} onClick={() => set({ batchId: '' })}>
            <strong>All batches</strong>
          </button>
          {batches.map((b) => (
            <button key={b.batch_id} className={`batch${f.batchId === b.batch_id ? ' active' : ''}`} onClick={() => set({ batchId: b.batch_id })}>
              <div className="batch-top">
                <span className={`tag tag-${b.action}`}>{ACTION_LABEL[b.action] || b.action}</span>
                <span className="muted small">{fmtTime(b.at)}</span>
              </div>
              <div className="small">
                {fmtNum(b.products)} products · {fmtNum(b.rows)} changes{b.run_id ? ` · run #${b.run_id}` : ''}
              </div>
              {b.note && <div className="small muted">“{b.note}”</div>}
            </button>
          ))}
        </aside>

        <section className="card audit-main">
          <div className="filters">
            <input className="input" type="search" placeholder="Search product, SKU, note or batch…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            <select className="input" value={f.action} onChange={(e) => set({ action: e.target.value })}>
              <option value="">All actions</option>
              <option value="apply_crawl">Apply crawl</option>
              <option value="sheet_import">Sheet import</option>
            </select>
            <select className="input" value={f.field} onChange={(e) => set({ field: e.target.value })}>
              <option value="">All fields</option>
              <option value="__row">Row events (new / removed)</option>
              {fields.map((x) => (
                <option key={x.field} value={x.field}>
                  {label(x.field)} ({fmtNum(x.n)})
                </option>
              ))}
            </select>
            <label className="small muted date">
              From <input className="input input-sm" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="small muted date">
              To <input className="input input-sm" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
            </label>
            {hasFilters && (
              <button className="btn btn-sm" onClick={() => navigate('audit')}>
                Clear filters
              </button>
            )}
            <a className="btn btn-sm" href={`/api/audit.csv?${query}`}>
              Export CSV
            </a>
          </div>

          {(selectedBatch || f.productId) && (
            <p className="small muted" style={{ marginTop: -6 }}>
              {selectedBatch && (
                <>
                  Batch <code>{selectedBatch.batch_id}</code> · {ACTION_LABEL[selectedBatch.action]} · {fmtTime(selectedBatch.at)}{' '}
                </>
              )}
              {f.productId && (
                <a href={href('audit', { ...f, productId: '', page: 0 })}>× remove product filter</a>
              )}
            </p>
          )}

          {error && <div className="card error">{error}</div>}
          {!data ? (
            <p className="muted">Loading…</p>
          ) : data.rows.length === 0 ? (
            <p className="muted empty">No audit entries match these filters.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Product</th>
                    <th>Field</th>
                    <th className="num">Old</th>
                    <th className="num">New</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((a) => {
                    const expandable = a.field === 'prices';
                    return (
                      <Fragment key={a.id}>
                        <tr className={expandable ? 'clickable' : ''} onClick={expandable ? () => setOpen(open === a.id ? null : a.id) : undefined}>
                          <td className="small nowrap">{fmtTime(a.at)}</td>
                          <td><span className={`tag tag-${a.action}`}>{ACTION_LABEL[a.action] || a.action}</span></td>
                          <td className="name-cell">
                            {a.product_id ? (
                              <a href={href('audit', { productId: a.product_id })} title="Show this product's full history" onClick={(e) => e.stopPropagation()}>
                                {a.sku_shopee || a.sku_jaknote || `#${a.product_id}`}
                              </a>
                            ) : '—'}
                            <div className="muted small">{a.name}{a.variant ? ` — ${a.variant}` : ''}</div>
                          </td>
                          <td className="nowrap">
                            {a.field ? label(a.field) : <span className="muted">{a.note || 'row event'}</span>}
                            {expandable && <span className="muted small"> {open === a.id ? '▾' : '▸'}</span>}
                          </td>
                          <td className="num muted">{a.field && fmtValue(a.field, a.old_value)}</td>
                          <td className="num">
                            {a.field && <strong>{fmtValue(a.field, a.new_value)}</strong>}
                            <div>{a.field && delta(a.field, a.old_value, a.new_value)}</div>
                          </td>
                          <td className="small muted">
                            {a.source}
                            {a.field && a.note && <div>“{a.note}”</div>}
                            <div>
                              <a href={href('audit', { batchId: a.batch_id })} onClick={(e) => e.stopPropagation()}>batch</a>
                            </div>
                          </td>
                        </tr>
                        {open === a.id && (
                          <tr>
                            <td colSpan={7} className="nested">
                              <PricesDiff oldV={a.old_value} newV={a.new_value} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && pages > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={f.page === 0} onClick={() => navigate('audit', { ...f, page: f.page - 1 })}>
                ← Newer
              </button>
              <span className="small muted">
                Page {f.page + 1} of {fmtNum(pages)} · {fmtNum(data.total)} entries
              </span>
              <button className="btn btn-sm" disabled={f.page >= pages - 1} onClick={() => navigate('audit', { ...f, page: f.page + 1 })}>
                Older →
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
