import { useEffect, useRef, useState } from 'react';
import { api, type ServerStatus } from './lib/api';
import { useRoute, type Route } from './lib/router';
import { CaseScreen } from './views/CaseScreen';
import { Cases } from './views/Cases';
import { EvidencePage } from './views/EvidencePage';
import { Home } from './views/Home';
import { NewRecovery } from './views/NewRecovery';

const REPO_URL = 'https://github.com/hudasol/afterglow';

function Wordmark() {
  return (
    <a className="wordmark" href="#/" aria-label="AFTERGLOW home">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <defs>
          <linearGradient id="wm-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c0547e" />
            <stop offset="1" stopColor="#f2a65a" />
          </linearGradient>
        </defs>
        <path d="M4 19a11 11 0 0 1 22 0Z" fill="url(#wm-sun)" />
        <rect x="2" y="21.5" width="26" height="2.6" rx="1.3" fill="currentColor" />
      </svg>
      Afterglow
    </a>
  );
}

function currentPage(route: Route): 'new' | 'cases' | 'evidence' | null {
  switch (route.name) {
    case 'new':
      return 'new';
    case 'cases':
    case 'case':
      return 'cases';
    case 'evidence':
      return 'evidence';
    default:
      return null;
  }
}

function pageTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'Afterglow';
    case 'new':
      return 'Start a recovery | Afterglow';
    case 'cases':
      return 'Your cases | Afterglow';
    case 'case':
      return 'Case | Afterglow';
    case 'evidence':
      return 'Integration and evidence | Afterglow';
  }
}

export function App() {
  const route = useRoute();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    api
      .status()
      .then((result) => !cancelled && setStatus(result))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = pageTitle(route);
  }, [route]);

  // Moving between pages moves focus to the main region. Switching tabs inside a case does not.
  const pageKey = route.name === 'case' ? `case:${route.id}` : route.name;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pageKey]);

  const page = currentPage(route);
  const navLink = (key: 'new' | 'cases' | 'evidence', href: string, label: string) => (
    <a href={href} {...(page === key ? { 'aria-current': 'page' as const } : {})}>
      {label}
    </a>
  );

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to the main content
      </a>
      <header className="site-header">
        <div className="inner">
          <Wordmark />
          <nav className="nav" aria-label="Main">
            {navLink('new', '#/new', 'Start a recovery')}
            {navLink('cases', '#/cases', 'Your cases')}
            {navLink('evidence', '#/evidence', 'Evidence')}
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
        {route.name === 'home' ? <Home /> : null}
        {route.name === 'new' ? <NewRecovery status={status} scenarioId={route.scenario} /> : null}
        {route.name === 'cases' ? <Cases /> : null}
        {route.name === 'case' ? <CaseScreen key={route.id} id={route.id} tab={route.tab} /> : null}
        {route.name === 'evidence' ? <EvidencePage status={status} /> : null}
      </main>
      <footer className="site-footer">
        <div className="inner">
          <p>
            Built by Team Kanban (Huda Mueen Qureshi, Awaiz Ahmed) for the Qloo Agentic Hackathon.
          </p>
          <ul>
            <li>
              <a href={REPO_URL}>Source code</a>
            </li>
            <li>
              <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</a>
            </li>
            {status?.modes.live.placeFacts ? (
              <li>
                Place facts: ©{' '}
                <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
              </li>
            ) : null}
            {status ? (
              <li>
                Version {status.version}
                {status.commit ? `, commit ${status.commit}` : ''}
              </li>
            ) : null}
          </ul>
        </div>
      </footer>
    </div>
  );
}
