import { useMemo, useState } from 'react';
import { fmtIDR, fmtNum, fmtPct } from '../format.js';

export const RESULT_STYLE = {
  up: { label: 'Price up', icon: '▲', color: 'var(--status-critical)' },
  down: { label: 'Price down', icon: '▼', color: 'var(--status-good)' },
  same: { label: 'Same', icon: '=', color: 'var(--text-secondary)' },
  'no-price': { label: 'No price', icon: '?', color: 'var(--status-warning)' },
  'sku-not-found': { label: 'SKU not on page', icon: '?', color: 'var(--status-warning)' },
  error: { label: 'Error', icon: '!', color: 'var(--status-serious)' },
};

export function DiffCell({ r }) {
  if (!r) return <span className="muted">—</span>;
  const st = RESULT_STYLE[r.result];
  if (r.diff == null) return <span className="small" style={{ color: st.color }}>{st.icon} {st.label}</span>;
  return (
    <span className="diff" style={{ color: st.color }} title={st.label}>
      {st.icon} {r.diff > 0 ? '+' : ''}
      {fmtIDR(r.diff)}
      <span className="small"> ({r.diffPct > 0 ? '+' : ''}{fmtPct(r.diffPct)})</span>
    </span>
  );
}

const FILTERS = [
  ['changed', 'Changed'],
  ['up', 'Price up'],
  ['down', 'Price down'],
  ['oos', 'Out of stock'],
  ['problem', 'Errors / not found'],
  ['all', 'All checked'],
];

export default function JaknotPanel({ products, jaknot, onCrawl, onStop, onCheck, onApply }) {
  const [filter, setFilter] = useState('changed');
  const [checking, setChecking] = useState(null);
  const job = jaknot?.job;
  const results = jaknot?.results || {};

  const jaknotRows = products.filter((p) => p.linkSource === 'Jaknot');
  const rows = jaknotRows.map((p) => ({ p, r: results[p.key] })).filter((x) => x.r);

  const counts = useMemo(() => {
    const c = { up: 0, down: 0, same: 0, oos: 0, problem: 0 };
    for (const { r } of rows) {
      if (r.result === 'up') c.up++;
      else if (r.result === 'down') c.down++;
      else if (r.result === 'same') c.same++;
      else c.problem++;
      if (r.availability && r.availability !== 'InStock') c.oos++;
    }
    return c;
  }, [rows]);

  const shown = rows
    .filter(({ r }) => {
      switch (filter) {
        case 'changed': return r.result === 'up' || r.result === 'down';
        case 'up': return r.result === 'up';
        case 'down': return r.result === 'down';
        case 'oos': return r.availability && r.availability !== 'InStock';
        case 'problem': return !['up', 'down', 'same'].includes(r.result);
        default: return true;
      }
    })
    .sort((a, b) => Math.abs(b.r.diffPct ?? 0) - Math.abs(a.r.diffPct ?? 0));

  const lastChecked = rows.reduce((m, { r }) => (r.checkedAt > m ? r.checkedAt : m), '');
  const running = job?.running;
  const pct = job?.total ? job.done / job.total : 0;

  const check = async (key) => {
    setChecking(key);
    try {
      await onCheck(key);
    } finally {
      setChecking(null);
    }
  };

  return (
    <section className="card jaknot">
      <div className="table-head">
        <div>
          <h2>Jaknot price check</h2>
          <p className="muted small" style={{ margin: '-8px 0 12px' }}>
            Current Jaknot price vs. sheet "Harga Modal Belum x" · {fmtNum(rows.length)} of {fmtNum(jaknotRows.length)} Jaknot SKUs checked
            {lastChecked && ` · last check ${new Date(lastChecked).toLocaleString()}`}
          </p>
        </div>
        <div className="actions">
          {running ? (
            <button className="btn" onClick={onStop} disabled={job.stopRequested}>
              {job.stopRequested ? 'Stopping…' : 'Stop crawl'}
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => onCrawl(jaknotRows.map((p) => p.key))} disabled={!jaknotRows.length}>
                Crawl filtered ({fmtNum(new Set(jaknotRows.map((p) => p.link)).size)} pages)
              </button>
              <button className="btn btn-primary" onClick={() => onCrawl()}>
                Crawl all Jaknot links
              </button>
              <button className="btn" onClick={onApply} title="Write crawled prices into the SQLite data (with audit log)">
                Apply price updates…
              </button>
            </>
          )}
        </div>
      </div>

      {running && (
        <div className="progress">
          <div className="progress-head small">
            <span>Crawling… {fmtNum(job.done)} / {fmtNum(job.total)} pages</span>
            <span className="muted">{job.errors ? `${fmtNum(job.errors)} errors` : ''}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="kpis kpis-sm">
          {[
            ['up', 'Price up', counts.up],
            ['down', 'Price down', counts.down],
            ['same', 'Unchanged', counts.same],
            ['oos', 'Out of stock on Jaknot', counts.oos],
            ['problem', 'Errors / not found', counts.problem],
          ].map(([k, label, v]) => (
            <button key={k} className={`card tile tile-btn${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>
              <div className="tile-label">
                {RESULT_STYLE[k] && <span style={{ color: RESULT_STYLE[k].color }}>{RESULT_STYLE[k].icon} </span>}
                {label}
              </div>
              <div className="tile-value">{fmtNum(v)}</div>
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">No prices checked yet. Click "Crawl all Jaknot links" to fetch current prices.</p>
      ) : (
        <>
          <div className="segmented">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU Jaknote</th>
                  <th className="num">Modal belum x</th>
                  <th className="num">Jaknot now</th>
                  <th className="num">Difference</th>
                  <th>Jaknot stock</th>
                  <th>Checked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map(({ p, r }) => (
                  <tr key={p.key}>
                    <td className="name-cell">
                      <a href={p.link} target="_blank" rel="noreferrer">{p.name}</a>
                      {p.variant && <div className="muted small">{p.variant}</div>}
                      {r.error && <div className="small" style={{ color: 'var(--status-serious)' }}>{r.error}</div>}
                    </td>
                    <td>{p.skuJaknote}<div className="muted small">{p.skuShopee}</div></td>
                    <td className="num">{fmtIDR(r.sheetPrice)}</td>
                    <td className="num strong">{fmtIDR(r.currentPrice)}</td>
                    <td className="num"><DiffCell r={r} /></td>
                    <td>
                      {r.availability ? (
                        <span className={r.availability === 'InStock' ? '' : 'oos'}>
                          {r.availability === 'InStock' ? 'In stock' : r.availability.replace(/([a-z])([A-Z])/g, '$1 $2')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="small muted">{new Date(r.checkedAt).toLocaleString()}</td>
                    <td>
                      <button className="btn btn-sm" disabled={running || checking === p.key} onClick={() => check(p.key)}>
                        {checking === p.key ? '…' : 'Re-check'}
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={8} className="muted empty">Nothing in this view.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {shown.length > 200 && <p className="muted small">Showing top 200 of {fmtNum(shown.length)} by size of difference.</p>}
        </>
      )}
    </section>
  );
}
