import { useCallback, useEffect, useState } from 'react';
import { fmtIDR, fmtNum, fmtPct } from '../format.js';
import { RESULT_STYLE } from './JaknotPanel.jsx';

const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '—');
const duration = (a, b) => {
  if (!a || !b) return '';
  const s = Math.round((new Date(b) - new Date(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const FIELD_LABEL = {
  cost_before_x: 'Modal belum x',
  old_cost: 'Modal Lama',
  modal: 'Modal',
  prices: 'Margin prices',
};

function fmtValue(field, v) {
  if (v == null) return '—';
  if (field === 'prices') {
    try {
      const p = JSON.parse(v);
      return `40%: ${fmtIDR(p[40])}`;
    } catch {
      return v;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? fmtNum(n) : v;
}

function RunChanges({ runId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetch(`/api/runs/${runId}`).then((r) => r.json()).then((j) => setRows(j.changes || []));
  }, [runId]);
  if (!rows) return <p className="muted small">Loading…</p>;
  if (!rows.length) return <p className="muted small">No changes recorded in this run — every checked price matched.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Result</th>
            <th className="num">DB price</th>
            <th className="num">Jaknot</th>
            <th className="num">Diff</th>
            <th>Stock</th>
            <th>Applied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const st = RESULT_STYLE[c.result] || RESULT_STYLE.error;
            return (
              <tr key={c.id}>
                <td className="name-cell">
                  {c.sku_shopee} <span className="muted small">/ {c.sku_jaknote}</span>
                  <div className="muted small">{c.name}{c.variant ? ` — ${c.variant}` : ''}</div>
                  {c.error && <div className="small" style={{ color: 'var(--status-serious)' }}>{c.error}</div>}
                </td>
                <td style={{ color: st.color, whiteSpace: 'nowrap' }}>{st.icon} {st.label}</td>
                <td className="num">{fmtIDR(c.db_price)}</td>
                <td className="num">{fmtIDR(c.jaknot_price)}</td>
                <td className="num">{c.diff == null ? '—' : `${c.diff > 0 ? '+' : ''}${fmtIDR(c.diff)} (${fmtPct(c.diff_pct)})`}</td>
                <td>{c.availability === 'InStock' ? 'In stock' : c.availability ? <span className="oos">{c.availability}</span> : '—'}</td>
                <td className="small">{c.applied_at ? fmtTime(c.applied_at) : c.result === 'up' || c.result === 'down' ? <span className="muted">pending</span> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunsTab({ refreshKey, onApplyRun }) {
  const [runs, setRuns] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    fetch('/api/runs').then((r) => r.json()).then(setRuns);
  }, [refreshKey]);

  if (!runs.length) return <p className="muted">No crawl runs yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Started</th>
            <th>Status</th>
            <th className="num">Pages</th>
            <th className="num">Rows</th>
            <th className="num">▲ Up</th>
            <th className="num">▼ Down</th>
            <th className="num">= Same</th>
            <th className="num">Out of stock</th>
            <th className="num">Not found / err</th>
            <th className="num">Pending</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <FragmentRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onApplyRun={onApplyRun} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ r, open, onToggle, onApplyRun }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td>{open ? '▾' : '▸'} #{r.id} <span className="muted small">{r.scope}</span></td>
        <td className="small">{fmtTime(r.started_at)}<div className="muted">{duration(r.started_at, r.finished_at)}</div></td>
        <td>{r.status}</td>
        <td className="num">{fmtNum(r.pages_done)}/{fmtNum(r.total_pages)}</td>
        <td className="num">{fmtNum(r.rows_checked)}</td>
        <td className="num">{fmtNum(r.price_up)}</td>
        <td className="num">{fmtNum(r.price_down)}</td>
        <td className="num">{fmtNum(r.unchanged)}</td>
        <td className="num">{fmtNum(r.out_of_stock)}</td>
        <td className="num">{fmtNum(r.not_found)}</td>
        <td className="num">{r.pending_apply ? <strong>{fmtNum(r.pending_apply)}</strong> : <span className="muted">0</span>}</td>
        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
          <a className="btn btn-sm" href={`/api/changes.csv?runId=${r.id}`}>CSV</a>{' '}
          <button className="btn btn-sm" disabled={!r.pending_apply} onClick={() => onApplyRun(r.id)}>Apply</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={12} className="nested">
            <RunChanges runId={r.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function AuditTab({ refreshKey }) {
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [action, setAction] = useState('');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    fetch('/api/audit/batches').then((r) => r.json()).then(setBatches);
  }, [refreshKey]);

  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: '1000' });
    if (batchId) q.set('batchId', batchId);
    if (action) q.set('action', action);
    fetch(`/api/audit?${q}`).then((r) => r.json()).then(setRows);
  }, [batchId, action]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const csv = `/api/audit.csv?${new URLSearchParams({ ...(batchId && { batchId }), ...(action && { action }) })}`;

  return (
    <>
      <div className="filters">
        <select className="input input-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="apply_crawl">Apply crawl</option>
          <option value="sheet_import">Sheet import</option>
        </select>
        <select className="input input-sm" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {fmtTime(b.at)} · {b.action} · {fmtNum(b.products)} products{b.note ? ` · ${b.note}` : ''}
            </option>
          ))}
        </select>
        <a className="btn btn-sm" href={csv}>Export CSV</a>
        <a className="btn btn-sm" href={`#/audit${batchId || action ? `?${new URLSearchParams({ ...(batchId && { batchId }), ...(action && { action }) })}` : ''}`}>
          Open full audit page →
        </a>
      </div>
      {!rows ? (
        <p className="muted small">Loading…</p>
      ) : !rows.length ? (
        <p className="muted">No audit entries.</p>
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
                <th>Source / note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="small">{fmtTime(a.at)}</td>
                  <td className="small">{a.action}</td>
                  <td className="name-cell">
                    {a.sku_shopee || '—'}
                    <div className="muted small">{a.name}</div>
                  </td>
                  <td>{a.field ? FIELD_LABEL[a.field] || a.field : <span className="muted">{a.note}</span>}</td>
                  <td className="num muted">{a.field ? fmtValue(a.field, a.old_value) : ''}</td>
                  <td className="num strong">{a.field ? fmtValue(a.field, a.new_value) : ''}</td>
                  <td className="small muted">{[a.source, a.field && a.note].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= 1000 && <p className="muted small">Showing latest 1,000 entries — export CSV for all.</p>}
        </div>
      )}
    </>
  );
}

export default function Reports({ refreshKey, onApplyRun }) {
  const [tab, setTab] = useState('runs');
  return (
    <section className="card reports">
      <div className="table-head">
        <h2>Reports</h2>
        <div className="segmented">
          <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Crawl runs</button>
          <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit log</button>
        </div>
      </div>
      {tab === 'runs' ? <RunsTab refreshKey={refreshKey} onApplyRun={onApplyRun} /> : <AuditTab refreshKey={refreshKey} />}
    </section>
  );
}
