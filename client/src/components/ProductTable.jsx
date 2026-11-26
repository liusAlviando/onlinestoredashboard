import { useMemo, useState } from 'react';
import { fmtIDR, fmtNum, fmtPct } from '../format.js';
import { STATUS_STYLE } from './StatusChart.jsx';
import { DiffCell } from './JaknotPanel.jsx';

const PAGE_SIZE = 50;

export default function ProductTable({ products, margins, jaknotResults = {} }) {
  const [margin, setMargin] = useState(margins.includes(40) ? 40 : margins[0]);
  const [sort, setSort] = useState({ key: 'no', dir: 1 });
  const [page, setPage] = useState(0);

  const columns = [
    { key: 'no', label: '#', get: (p) => p.no, num: true },
    { key: 'name', label: 'Product', get: (p) => p.name },
    { key: 'skuShopee', label: 'SKU Shopee', get: (p) => p.skuShopee },
    { key: 'status', label: 'Status', get: (p) => p.status },
    { key: 'oldCost', label: 'Old modal', get: (p) => p.oldCost, num: true },
    { key: 'modal', label: 'Modal', get: (p) => p.modal, num: true },
    { key: 'costChangePct', label: 'Δ cost', get: (p) => p.costChangePct, num: true },
    { key: 'costBeforeX', label: 'Modal belum x', get: (p) => p.costBeforeX, num: true },
    { key: 'jaknotNow', label: 'Jaknot now', get: (p) => jaknotResults[p.key]?.currentPrice, num: true },
    { key: 'jaknotDiff', label: 'Δ Jaknot', get: (p) => jaknotResults[p.key]?.diffPct, num: true },
    { key: 'price', label: `Price @ ${margin}%`, get: (p) => p.prices[margin], num: true },
    { key: 'packageDiscountPct', label: 'Paket diskon', get: (p) => p.packageDiscountPct, num: true },
    { key: 'uploadDate', label: 'Uploaded', get: (p) => p.uploadDate },
  ];

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    return [...products].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (col.num ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sort, margin, jaknotResults]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  return (
    <section className="card">
      <div className="table-head">
        <h2>Products ({fmtNum(products.length)} SKUs)</h2>
        <label className="small">
          Price at margin{' '}
          <select className="input input-sm" value={margin} onChange={(e) => setMargin(Number(e.target.value))}>
            {margins.map((m) => (
              <option key={m} value={m}>
                {m}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''} onClick={() => toggleSort(c.key)}>
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const st = STATUS_STYLE[p.status] || { color: 'var(--text-secondary)', icon: '•' };
              return (
                <tr key={`${p.skuShopee}-${p.no}-${i}`}>
                  <td className="num muted">{fmtNum(p.no)}</td>
                  <td className="name-cell">
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                    <div className="muted small">
                      {p.variant}
                      {p.variant && ' · '}
                      <span className={`src src-${p.linkSource.replace(/\s/g, '').toLowerCase()}`}>{p.linkSource}</span>
                      {p.id && (
                        <>
                          {' · '}
                          <a href={`#/audit?productId=${p.id}`}>history</a>
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    {p.skuShopee}
                    <div className="muted small">{p.skuJaknote}</div>
                  </td>
                  <td>
                    <span className="badge">
                      <span className="status-icon" style={{ background: st.color }}>
                        {st.icon}
                      </span>
                      {p.status}
                    </span>
                  </td>
                  <td className="num">{fmtIDR(p.oldCost)}</td>
                  <td className="num">{fmtIDR(p.modal)}</td>
                  <td className="num">{p.costChangePct == null ? '—' : `${p.costChangePct > 0 ? '+' : ''}${fmtPct(p.costChangePct)}`}</td>
                  <td className="num">{fmtIDR(p.costBeforeX)}</td>
                  <td className="num">{fmtIDR(jaknotResults[p.key]?.currentPrice)}</td>
                  <td className="num"><DiffCell r={jaknotResults[p.key]} /></td>
                  <td className="num strong">{fmtIDR(p.prices[margin])}</td>
                  <td className="num">
                    {fmtPct(p.packageDiscountPct)}
                    <div className="muted small">min {fmtNum(p.minPackageDiscount)}</div>
                  </td>
                  <td>{p.uploadDate || '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="muted empty">
                  No products match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            ← Prev
          </button>
          <span className="small muted">
            Page {current + 1} of {pages}
          </span>
          <button className="btn btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
