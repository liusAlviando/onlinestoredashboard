import { useEffect, useState } from 'react';
import { fmtIDR, fmtNum } from '../format.js';

/**
 * Preview (dry run) then apply pending crawl price changes.
 * scope: { runId?, label }
 */
export default function ApplyDialog({ scope, onClose, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const body = (extra) => JSON.stringify({ ...(scope.runId ? { runId: scope.runId } : {}), ...extra });

  useEffect(() => {
    fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ dryRun: true }) })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setPreview(j)))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.runId]);

  const apply = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ note: note || undefined }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      onApplied(j);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>Apply Jaknot prices — {scope.label}</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Sets <strong>Modal belum x</strong> to the crawled Jaknot price, then recalculates Modal Lama (÷ X), Modal (+ 1250 ÷ Minimal Order) and
          all margin prices. Every field change is written to the audit log.
        </p>
        {error && <div className="card error">{error}</div>}
        {!preview && !error && <p className="muted">Loading preview…</p>}
        {preview && preview.products === 0 && <p className="muted">No pending price changes to apply.</p>}
        {preview && preview.products > 0 && (
          <>
            <p>
              <strong>{fmtNum(preview.products)}</strong> products · {fmtNum(preview.fieldsChanged)} field changes
              {preview.superseded > 0 && <span className="muted"> · {fmtNum(preview.superseded)} older changes superseded</span>}
            </p>
            <div className="table-wrap modal-table">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Modal belum x</th>
                    <th className="num">Modal Lama</th>
                    <th className="num">Modal</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((it) => (
                    <tr key={it.changeId}>
                      <td className="name-cell">
                        {it.skuShopee}
                        <div className="muted small">{it.name}</div>
                      </td>
                      {['costBeforeX', 'oldCost', 'modal'].map((f) => (
                        <td key={f} className="num">
                          <span className="muted">{fmtIDR(it.from[f])}</span> → <strong>{fmtIDR(it.to[f])}</strong>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <input className="input" style={{ width: '100%', marginTop: 12 }} placeholder="Note for the audit log (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
        <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={busy || !preview?.products}>
            {busy ? 'Applying…' : `Apply ${preview?.products ? fmtNum(preview.products) : ''} updates`}
          </button>
        </div>
      </div>
    </div>
  );
}
