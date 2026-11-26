import { createRun, finishRun, getRun, recordPage } from './db.js';

const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY) || 3;
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS) || 400; // pause between requests per worker
const TIMEOUT_MS = 20000;
const MAX_BYTES = 300 * 1024; // JSON-LD lives in <head>; no need to download the full ~1.3 MB page
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the response only until </head> (or MAX_BYTES), then abort the rest. */
async function fetchHead(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.includes('</head>')) break;
    }
    ctrl.abort(); // drop the rest of the body
    return { html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract every schema.org Product (one per variant) from the page's JSON-LD. */
export function parseProducts(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let json;
    try {
      json = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack = Array.isArray(json) ? [...json] : [json];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
      if (node['@type'] !== 'Product') continue;
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      const price = Number(offer?.price ?? offer?.lowPrice);
      out.push({
        sku: node.sku ? String(node.sku).trim() : '',
        name: node.name || '',
        price: Number.isFinite(price) ? price : null,
        availability: offer?.availability ? String(offer.availability).split('/').pop() : null,
        url: offer?.url || null,
      });
    }
  }
  return out;
}

export async function fetchPage(url) {
  const checkedAt = new Date().toISOString();
  try {
    const { html, finalUrl } = await fetchHead(url);
    const variants = parseProducts(html);
    return { checkedAt, finalUrl, variants, error: variants.length ? null : 'No product data found on page' };
  } catch (err) {
    return { checkedAt, variants: [], error: err.name === 'AbortError' ? 'Timed out' : err.message };
  }
}

/** Crawl one URL inside a run and store the result in SQLite. */
export async function crawlUrl(runId, url) {
  const page = await fetchPage(url);
  recordPage(runId, url, page);
  return page;
}

// ---- background job (progress lives in crawl_runs) ----
const job = { running: false, stopRequested: false, runId: null };

export function jobStatus() {
  const run = job.runId ? getRun(job.runId) : null;
  return {
    running: job.running,
    stopRequested: job.stopRequested,
    runId: job.runId,
    total: run?.total_pages ?? 0,
    done: run?.pages_done ?? 0,
    errors: run?.page_errors ?? 0,
    startedAt: run?.started_at ?? null,
    finishedAt: run?.finished_at ?? null,
    status: run?.status ?? null,
  };
}

export function stopCrawl() {
  if (job.running) job.stopRequested = true;
}

/** Crawl the given URLs in the background as a new crawl run. Returns the run id, or null if busy. */
export function startCrawl(urls, scope = 'all') {
  if (job.running) return null;
  const queue = [...new Set(urls)];
  const runId = createRun(scope, queue.length);
  Object.assign(job, { running: true, stopRequested: false, runId });
  const worker = async () => {
    while (queue.length && !job.stopRequested) {
      const url = queue.shift();
      await crawlUrl(runId, url);
      if (queue.length) await sleep(DELAY_MS);
    }
  };
  Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    .then(() => finishRun(runId, job.stopRequested ? 'stopped' : 'completed'))
    .catch((err) => {
      console.error('crawl failed', err);
      finishRun(runId, 'failed');
    })
    .finally(() => {
      job.running = false;
    });
  return runId;
}

/** Re-check a single URL synchronously as its own run. */
export async function checkOne(url) {
  const runId = createRun('single', 1);
  await crawlUrl(runId, url);
  finishRun(runId, 'completed');
  return runId;
}
