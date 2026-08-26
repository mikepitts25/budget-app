import React, { useEffect, useState } from 'react';
import { useApp } from './store/store';
import { addMonths, currentMonth, monthLabel } from './lib/date';
import Dashboard from './pages/Dashboard';
import Forecast from './pages/Forecast';
import Insights from './pages/Insights';
import Transactions from './pages/Transactions';
import Budget from './pages/Budget';
import Together from './pages/Together';
import Goals from './pages/Goals';
import SavingsFinder from './pages/SavingsFinder';
import MindMapPage from './pages/MindMapPage';
import DebtPage from './pages/DebtPage';
import NetWorthPage from './pages/NetWorthPage';
import Retirement from './pages/Retirement';
import Plans from './pages/Plans';
import Reports from './pages/Reports';
import SettingsPage from './pages/SettingsPage';

export type PageKey =
  | 'dashboard' | 'forecast' | 'transactions' | 'budget' | 'together' | 'insights'
  | 'goals' | 'savings' | 'mindmap' | 'plans'
  | 'debt' | 'networth' | 'retirement' | 'reports' | 'settings';

interface NavEntry {
  key: PageKey;
  label: string;
  icon: string;
  section: string;
  subtitle: string;
}

const NAV: NavEntry[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '◈', section: 'Overview', subtitle: 'Where the two of you stand this month' },
  { key: 'forecast', label: 'Forecast', icon: '◔', section: 'Overview', subtitle: 'What is coming, and what is safe to spend' },
  { key: 'transactions', label: 'Transactions', icon: '≡', section: 'Overview', subtitle: 'Every dollar in and out' },
  { key: 'insights', label: 'Insights', icon: '⌁', section: 'Overview', subtitle: 'Patterns, anomalies and what they mean' },
  { key: 'reports', label: 'Reports', icon: '◫', section: 'Overview', subtitle: 'Trends across categories and months' },

  { key: 'budget', label: 'Budget', icon: '◐', section: 'Month', subtitle: 'Plan the month before it spends itself' },
  { key: 'together', label: 'Together', icon: '⚖', section: 'Month', subtitle: 'Who paid what, and who owes whom' },
  { key: 'savings', label: 'Find savings', icon: '✦', section: 'Month', subtitle: 'Money you are leaving on the table' },

  { key: 'goals', label: 'Goals', icon: '◎', section: 'Plan', subtitle: 'House, car, travel — funded and forecast' },
  { key: 'mindmap', label: 'Mind map', icon: '❖', section: 'Plan', subtitle: 'Think out loud about the life you are building' },
  { key: 'plans', label: 'Scenarios', icon: '⟐', section: 'Plan', subtitle: 'What a house, a car or a baby actually costs' },
  { key: 'retirement', label: 'Retirement', icon: '⌛', section: 'Plan', subtitle: 'The long game, for both of you' },

  { key: 'debt', label: 'Debt payoff', icon: '⧗', section: 'Wealth', subtitle: 'Snowball, avalanche, and the interest you save' },
  { key: 'networth', label: 'Net worth', icon: '▲', section: 'Wealth', subtitle: 'Accounts, assets and what you owe' },
  { key: 'settings', label: 'Settings', icon: '⚙', section: 'Wealth', subtitle: 'Household, categories and your data' },
];

const PAGES: Record<PageKey, React.ComponentType> = {
  dashboard: Dashboard,
  forecast: Forecast,
  insights: Insights,
  transactions: Transactions,
  budget: Budget,
  together: Together,
  goals: Goals,
  savings: SavingsFinder,
  mindmap: MindMapPage,
  plans: Plans,
  debt: DebtPage,
  networth: NetWorthPage,
  retirement: Retirement,
  reports: Reports,
  settings: SettingsPage,
};

const readHash = (): PageKey => {
  const key = window.location.hash.replace('#', '') as PageKey;
  return key in PAGES ? key : 'dashboard';
};

export default function App() {
  const { state, dispatch, month, setMonth } = useApp();
  const [page, setPage] = useState<PageKey>(readHash);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The drawer must never survive a navigation, or it covers the page you chose.
  const go = (key: PageKey) => {
    window.location.hash = key;
    setPage(key);
    setNavOpen(false);
  };

  const entry = NAV.find((n) => n.key === page)!;
  const Page = PAGES[page];
  const sections = [...new Set(NAV.map((n) => n.section))];
  const isCurrent = month === currentMonth();

  return (
    <div className="app">
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">2L</div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name truncate">{state.settings.householdName}</div>
            <div className="brand-sub">Two Ledgers</div>
          </div>
        </div>

        {sections.map((section) => (
          <React.Fragment key={section}>
            <div className="nav-section">{section}</div>
            {NAV.filter((n) => n.section === section).map((n) => (
              <button
                key={n.key}
                className={`nav-item ${n.key === page ? 'active' : ''}`}
                onClick={() => go(n.key)}
              >
                <span className="nav-icon">{n.icon}</span>
                <span className="truncate">{n.label}</span>
              </button>
            ))}
          </React.Fragment>
        ))}

        <div className="spacer" />
        <div className="row gap-6" style={{ padding: '10px 8px 0' }}>
          {state.people.map((p) => (
            <span key={p.id} className="chip" style={{ borderColor: p.color }}>
              <span className="dot" style={{ background: p.color }} />
              {p.name}
            </span>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="btn ghost sm nav-toggle"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={navOpen}
          >
            ☰
          </button>
          <div className="topbar-title">
            <h1>{entry.label}</h1>
            <span className="topbar-sub">{entry.subtitle}</span>
          </div>
          <div className="spacer" />

          <div className="row gap-4">
            <button className="btn ghost sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <button
              className="btn sm month-label"
              onClick={() => setMonth(currentMonth())}
              title="Jump to the current month"
              style={{ minWidth: 108 }}
            >
              {monthLabel(month, 'long')}
            </button>
            <button
              className="btn ghost sm"
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={month >= currentMonth()}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          {!isCurrent && <span className="chip warn">Viewing a past month</span>}

          <button
            className="btn ghost sm"
            title="Toggle theme"
            onClick={() =>
              dispatch({
                type: 'settings/update',
                patch: { theme: state.settings.theme === 'dark' ? 'light' : 'dark' },
              })
            }
          >
            {state.settings.theme === 'dark' ? '☾' : '☀'}
          </button>
        </header>

        <div className="content">
          <Page />
        </div>
      </main>
    </div>
  );
}
