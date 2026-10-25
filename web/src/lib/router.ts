import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'new'; scenario: string | null }
  | { name: 'cases' }
  | { name: 'case'; id: string; tab: CaseTab }
  | { name: 'evidence' };

export type CaseTab = 'options' | 'trace' | 'compare' | 'evidence' | 'history';
const TABS: CaseTab[] = ['options', 'trace', 'compare', 'evidence', 'history'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/u, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'new') {
    return { name: 'new', scenario: new URLSearchParams(query).get('scenario') };
  }
  if (parts[0] === 'cases' && parts[1]) {
    const tab = TABS.find((candidate) => candidate === parts[2]) ?? 'options';
    return { name: 'case', id: decodeURIComponent(parts[1]), tab };
  }
  if (parts[0] === 'cases') return { name: 'cases' };
  if (parts[0] === 'evidence') return { name: 'evidence' };
  return { name: 'home' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function caseHref(id: string, tab: CaseTab = 'options'): string {
  return `#/cases/${encodeURIComponent(id)}${tab === 'options' ? '' : `/${tab}`}`;
}

export function go(hash: string): void {
  window.location.hash = hash;
}
