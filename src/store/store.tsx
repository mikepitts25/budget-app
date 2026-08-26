import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type {
  Account,
  AppState,
  BudgetLine,
  Category,
  Debt,
  Goal,
  ID,
  MindEdge,
  MindMap,
  MindNode,
  NetWorthSnapshot,
  Person,
  RetirementPlan,
  Settings,
  Transaction,
} from './types';
import { demoState, emptyState } from './seed';
import { categoryAverage, netWorth } from './selectors';
import { addMonths, currentMonth } from '../lib/date';
import { formatMoney } from '../lib/money';

const STORAGE_KEY = 'two-ledgers:v1';

export type Action =
  | { type: 'load'; state: AppState }
  | { type: 'reset'; demo: boolean }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'person/update'; id: ID; patch: Partial<Person> }
  | { type: 'account/add'; account: Account }
  | { type: 'account/update'; id: ID; patch: Partial<Account> }
  | { type: 'account/remove'; id: ID }
  | { type: 'category/add'; category: Category }
  | { type: 'category/update'; id: ID; patch: Partial<Category> }
  | { type: 'category/remove'; id: ID }
  | { type: 'tx/add'; tx: Transaction }
  | { type: 'tx/addMany'; txs: Transaction[] }
  | { type: 'tx/update'; id: ID; patch: Partial<Transaction> }
  | { type: 'tx/remove'; id: ID }
  | { type: 'tx/removeMany'; ids: ID[] }
  | { type: 'tx/bulkCategory'; ids: ID[]; categoryId: ID }
  | { type: 'budget/set'; line: BudgetLine }
  | { type: 'budget/copy'; from: string; to: string }
  | { type: 'budget/autofill'; month: string; lookback: number }
  | { type: 'budget/clear'; month: string }
  | { type: 'goal/add'; goal: Goal }
  | { type: 'goal/update'; id: ID; patch: Partial<Goal> }
  | { type: 'goal/remove'; id: ID }
  | { type: 'goal/fund'; id: ID; amount: number }
  | { type: 'debt/add'; debt: Debt }
  | { type: 'debt/update'; id: ID; patch: Partial<Debt> }
  | { type: 'debt/remove'; id: ID }
  | { type: 'map/add'; map: MindMap }
  | { type: 'map/update'; id: ID; patch: Partial<MindMap> }
  | { type: 'map/remove'; id: ID }
  | { type: 'node/add'; mapId: ID; node: MindNode }
  | { type: 'node/update'; mapId: ID; id: ID; patch: Partial<MindNode> }
  | { type: 'node/remove'; mapId: ID; id: ID }
  | { type: 'edge/add'; mapId: ID; edge: MindEdge }
  | { type: 'edge/remove'; mapId: ID; id: ID }
  | { type: 'retirement/update'; patch: Partial<RetirementPlan> }
  | { type: 'networth/snapshot' }
  | { type: 'suggestion/dismiss'; key: string }
  | { type: 'suggestion/restore'; key: string };

const patchIn = <T extends { id: ID }>(xs: T[], id: ID, patch: Partial<T>): T[] =>
  xs.map((x) => (x.id === id ? { ...x, ...patch } : x));

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load':
      return action.state;
    case 'reset':
      return action.demo ? demoState() : emptyState();
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'person/update':
      return { ...state, people: patchIn(state.people, action.id, action.patch) };

    case 'account/add':
      return { ...state, accounts: [...state.accounts, action.account] };
    case 'account/update':
      return { ...state, accounts: patchIn(state.accounts, action.id, action.patch) };
    case 'account/remove':
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.id),
        transactions: state.transactions.filter((t) => t.accountId !== action.id),
      };

    case 'category/add':
      return { ...state, categories: [...state.categories, action.category] };
    case 'category/update':
      return { ...state, categories: patchIn(state.categories, action.id, action.patch) };
    case 'category/remove': {
      // Never orphan history: spending moves to Miscellaneous rather than vanishing.
      const fallback =
        state.categories.find((c) => c.name === 'Miscellaneous' && c.id !== action.id)?.id ??
        state.categories.find((c) => c.id !== action.id)?.id;
      if (!fallback) return state;
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.id),
        transactions: state.transactions.map((t) =>
          t.categoryId === action.id ? { ...t, categoryId: fallback } : t,
        ),
        budget: state.budget.filter((b) => b.categoryId !== action.id),
      };
    }

    case 'tx/add':
      return { ...state, transactions: sortTx([action.tx, ...state.transactions]) };
    case 'tx/addMany':
      return { ...state, transactions: sortTx([...action.txs, ...state.transactions]) };
    case 'tx/update':
      return {
        ...state,
        transactions: sortTx(patchIn(state.transactions, action.id, action.patch)),
      };
    case 'tx/remove':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) };
    case 'tx/removeMany': {
      const ids = new Set(action.ids);
      return { ...state, transactions: state.transactions.filter((t) => !ids.has(t.id)) };
    }
    case 'tx/bulkCategory': {
      const ids = new Set(action.ids);
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          ids.has(t.id) ? { ...t, categoryId: action.categoryId } : t,
        ),
      };
    }

    case 'budget/set': {
      const rest = state.budget.filter(
        (b) => !(b.month === action.line.month && b.categoryId === action.line.categoryId),
      );
      return { ...state, budget: [...rest, action.line] };
    }
    case 'budget/copy': {
      const source = state.budget.filter((b) => b.month === action.from);
      const rest = state.budget.filter((b) => b.month !== action.to);
      return {
        ...state,
        budget: [...rest, ...source.map((b) => ({ ...b, month: action.to }))],
      };
    }
    case 'budget/autofill': {
      const rest = state.budget.filter((b) => b.month !== action.month);
      const lines: BudgetLine[] = state.categories
        .filter((c) => c.kind === 'expense' && !c.archived)
        .map((c) => ({
          month: action.month,
          categoryId: c.id,
          planned: categoryAverage(state, c.id, addMonths(action.month, -1), action.lookback),
          rollover: state.budget.find((b) => b.categoryId === c.id)?.rollover ?? false,
        }))
        .filter((l) => l.planned > 0);
      return { ...state, budget: [...rest, ...lines] };
    }
    case 'budget/clear':
      return { ...state, budget: state.budget.filter((b) => b.month !== action.month) };

    case 'goal/add':
      return { ...state, goals: [...state.goals, action.goal] };
    case 'goal/update':
      return { ...state, goals: patchIn(state.goals, action.id, action.patch) };
    case 'goal/remove':
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id) };
    case 'goal/fund':
      return {
        ...state,
        goals: state.goals.map((g) =>
          g.id === action.id ? { ...g, saved: Math.max(0, g.saved + action.amount) } : g,
        ),
      };

    case 'debt/add':
      return { ...state, debts: [...state.debts, action.debt] };
    case 'debt/update':
      return { ...state, debts: patchIn(state.debts, action.id, action.patch) };
    case 'debt/remove':
      return { ...state, debts: state.debts.filter((d) => d.id !== action.id) };

    case 'map/add':
      return { ...state, mindMaps: [...state.mindMaps, action.map] };
    case 'map/update':
      return { ...state, mindMaps: patchIn(state.mindMaps, action.id, action.patch) };
    case 'map/remove':
      return { ...state, mindMaps: state.mindMaps.filter((m) => m.id !== action.id) };
    case 'node/add':
      return mapMap(state, action.mapId, (m) => ({ ...m, nodes: [...m.nodes, action.node] }));
    case 'node/update':
      return mapMap(state, action.mapId, (m) => ({
        ...m,
        nodes: patchIn(m.nodes, action.id, action.patch),
      }));
    case 'node/remove':
      return mapMap(state, action.mapId, (m) => ({
        ...m,
        nodes: m.nodes.filter((n) => n.id !== action.id),
        edges: m.edges.filter((e) => e.from !== action.id && e.to !== action.id),
      }));
    case 'edge/add':
      return mapMap(state, action.mapId, (m) =>
        m.edges.some((e) => e.from === action.edge.from && e.to === action.edge.to)
          ? m
          : { ...m, edges: [...m.edges, action.edge] },
      );
    case 'edge/remove':
      return mapMap(state, action.mapId, (m) => ({
        ...m,
        edges: m.edges.filter((e) => e.id !== action.id),
      }));

    case 'retirement/update':
      return { ...state, retirement: { ...state.retirement, ...action.patch } };

    case 'networth/snapshot': {
      const { assets, liabilities } = netWorth(state);
      const month = currentMonth();
      const rest = state.netWorth.filter((s) => s.month !== month);
      const snap: NetWorthSnapshot = { month, assets, liabilities };
      return { ...state, netWorth: [...rest, snap].sort((a, b) => a.month.localeCompare(b.month)) };
    }

    case 'suggestion/dismiss':
      return {
        ...state,
        dismissedSuggestions: [...new Set([...state.dismissedSuggestions, action.key])],
      };
    case 'suggestion/restore':
      return {
        ...state,
        dismissedSuggestions: state.dismissedSuggestions.filter((k) => k !== action.key),
      };
  }
}

const sortTx = (txs: Transaction[]): Transaction[] =>
  [...txs].sort((a, b) => b.date.localeCompare(a.date));

function mapMap(state: AppState, id: ID, fn: (m: MindMap) => MindMap): AppState {
  return { ...state, mindMaps: state.mindMaps.map((m) => (m.id === id ? fn(m) : m)) };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return demoState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.people)) return demoState();
    // Forward-compatible defaults for fields added after a save was written.
    return { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...parsed.settings } };
  } catch {
    return demoState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failures are not worth interrupting the session for.
  }
}

interface Ctx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Format cents in the household's currency. */
  money: (cents: number, opts?: { compact?: boolean; sign?: boolean }) => string;
  /** The month the app is currently focused on. */
  month: string;
  setMonth: (month: string) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [month, setMonth] = React.useState<string>(() => state.settings.pinnedMonth || currentMonth());

  useEffect(() => {
    const handle = window.setTimeout(() => saveState(state), 250);
    return () => window.clearTimeout(handle);
  }, [state]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      dispatch,
      money: (cents, opts) =>
        formatMoney(cents, {
          currency: state.settings.currency,
          locale: state.settings.locale,
          ...opts,
        }),
      month,
      setMonth,
    }),
    [state, month],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export { STORAGE_KEY };
