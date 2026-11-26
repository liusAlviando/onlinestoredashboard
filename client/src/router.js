import { useEffect, useState } from 'react';

/** Parse "#/audit?action=x&q=y" -> { path: 'audit', params: URLSearchParams } */
function parse() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { path: path || '', params: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Build a hash href, dropping empty params. */
export function href(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false));
  const s = q.toString();
  return `#/${path}${s ? `?${s}` : ''}`;
}

export const navigate = (path, params) => {
  window.location.hash = href(path, params);
};
