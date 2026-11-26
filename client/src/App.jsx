import { useCallback, useEffect, useMemo, useState } from 'react';
import KpiRow from './components/KpiRow.jsx';
import StatusChart from './components/StatusChart.jsx';
import UploadsChart from './components/UploadsChart.jsx';
import WorkflowProgress from './components/WorkflowProgress.jsx';
import CostChangeChart from './components/CostChangeChart.jsx';
import ProductTable from './components/ProductTable.jsx';
import JaknotPanel from './components/JaknotPanel.jsx';
import ApplyDialog from './components/ApplyDialog.jsx';
import Reports from './components/Reports.jsx';
import AuditPage from './components/AuditPage.jsx';
import { href, useRoute } from './router.js';

export const STATUS_ORDER = ['Active', 'Belum Upload', 'Habis', 'Deleted'];
export const LINK_SOURCES = ['Jaknot', 'Shopee', 'Other', 'No link'];

export default function App() {
  const route = useRoute();
  const page = route.path === 'audit' ? 'audit' : 'dashboard';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [source, setSource] = useState('All');

  const [notice, setNotice] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [applyScope, setApplyScope] = useState(null); // { runId?, label }
  const [reportKey, setReportKey] = useState(0);
  const bumpReports = () => setReportKey((k) => k + 1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Jaknot price crawl ----
  const [jaknot, setJaknot] = useState(null);
  const [crawlError, setCrawlError] = useState(null);

  const loadJaknot = useCallback(async () => {
    try {
      const res = await fetch('/api/jaknot');
      if (res.ok) setJaknot(await res.json());
    } catch {
      /* backend not reachable; keep last state */
    }
  }, []);

  useEffect(() => {
    loadJaknot();
  }, [loadJaknot]);

  // Poll while a crawl is running; refresh reports when it ends.
  const running = !!jaknot?.job?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadJaknot, 1500);
    return () => {
      clearInterval(t);
      bumpReports();
    };
  }, [running, loadJaknot]);

  const syncSheet = async () => {
    if (!window.confirm('Re-import all rows from the Google Sheet into SQLite?\n\nChanged fields are recorded in the audit log. Prices applied from a crawl are kept unless the sheet value itself was edited.')) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setNotice(`Sheet imported: ${j.inserted} new, ${j.updated} updated (${j.fieldsChanged} fields), ${j.removed} removed, ${j.unchanged} unchanged${j.keptCrawlValues ? `, ${j.keptCrawlValues} crawl-applied values kept` : ''}.`);
      await Promise.all([load(), loadJaknot()]);
      bumpReports();
    } catch (e) {
      setNotice(`Sheet import failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const onApplied = async (j) => {
    setApplyScope(null);
    setNotice(
      <>
        Applied {j.products} price updates ({j.fieldsChanged} field changes).{' '}
        <a href={href('audit', { batchId: j.batchId })}>View in audit log →</a>
      </>
    );
    await Promise.all([load(), loadJaknot()]);
    bumpReports();
  };

  const startCrawl = async (keys) => {
    setCrawlError(null);
    const res = await fetch('/api/jaknot/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keys ? { keys } : {}),
    });
    if (!res.ok) setCrawlError((await res.json()).error);
    loadJaknot();
  };

  const stopCrawl = async () => {
    await fetch('/api/jaknot/stop', { method: 'POST' });
    loadJaknot();
  };

  const checkOne = async (key) => {
    const res = await fetch('/api/jaknot/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const json = await res.json();
    if (!res.ok) return setCrawlError(json.error);
    setJaknot((j) => ({ ...j, results: { ...j?.results, [key]: json.result } }));
    bumpReports();
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.products.filter(
      (p) =>
        (status === 'All' || p.status === status) &&
        (source === 'All' || p.linkSource === source) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.variant.toLowerCase().includes(q) ||
          p.skuShopee.toLowerCase().includes(q) ||
          p.skuJaknote.toLowerCase().includes(q))
    );
  }, [data, search, status, source]);

  const statuses = useMemo(() => {
    if (!data) return [];
    const all = Object.keys(data.summary.byStatus);
    return [...STATUS_ORDER.filter((s) => all.includes(s)), ...all.filter((s) => !STATUS_ORDER.includes(s))];
  }, [data]);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Shopee Product Dashboard</h1>
          <nav className="nav">
            <a href="#/" className={page === 'dashboard' ? 'active' : ''}>Dashboard</a>
            <a href="#/audit" className={page === 'audit' ? 'active' : ''}>Audit log</a>
          </nav>
          <p className="muted">
            {data
              ? `SQLite (${data.dbFile}) · last sheet import ${data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : '—'}`
              : 'Loading…'}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => load()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button className="btn" onClick={syncSheet} disabled={syncing || running}>
            {syncing ? 'Importing…' : 'Re-sync from sheet'}
          </button>
        </div>
      </header>

      {notice && (
        <div className="card notice">
          {notice}
          <button className="btn btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {page === 'dashboard' && error && !data && <div className="card error">Could not load data: {error}</div>}

      {page === 'audit' && <AuditPage params={route.params} />}

      {page === 'dashboard' && data && (
        <>
          <div className="filters">
            <input
              className="input"
              type="search"
              placeholder="Search product, variant or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="All">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Link source">
              <option value="All">All links</option>
              {LINK_SOURCES.filter((s) => data.summary.byLinkSource?.[s]).map((s) => (
                <option key={s} value={s}>
                  {s === 'No link' ? 'No link' : `${s} link`} ({data.summary.byLinkSource[s]})
                </option>
              ))}
            </select>
            {(search || status !== 'All' || source !== 'All') && (
              <span className="muted small">
                {filtered.length} of {data.products.length} SKUs
              </span>
            )}
          </div>

          <KpiRow products={filtered} />

          <div className="grid">
            <StatusChart products={filtered} order={statuses} />
            <WorkflowProgress products={filtered} />
            <UploadsChart products={filtered} />
            <CostChangeChart products={filtered} />
          </div>

          {crawlError && <div className="card error" style={{ marginBottom: 12 }}>Crawl: {crawlError}</div>}
          <JaknotPanel
            products={filtered}
            jaknot={jaknot}
            onCrawl={startCrawl}
            onStop={stopCrawl}
            onCheck={checkOne}
            onApply={() => setApplyScope({ label: 'all pending changes' })}
          />

          <ProductTable products={filtered} margins={data.summary.margins} jaknotResults={jaknot?.results} />

          <Reports refreshKey={reportKey} onApplyRun={(runId) => setApplyScope({ runId, label: `run #${runId}` })} />

          {applyScope && <ApplyDialog scope={applyScope} onClose={() => setApplyScope(null)} onApplied={onApplied} />}
        </>
      )}
    </div>
  );
}
