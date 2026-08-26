import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type {
  Account,
  AppState,
  BudgetLine,
  Category,
  Comment,
  Debt,
  Goal,
  ID,
  MindEdge,
  MindMap,
  MindNode,
  NetWorthSnapshot,
  Person,
  RetirementPlan,
  Rule,
  Scheduled,
  Settings,
  Transaction,
  TxStatus,
} from './types';
import { demoState, emptyState } from './seed';
import { categoryAverage, netWorth } from './selectors';
import { addMonths, currentMonth } from '../lib/date';
import { formatMoney } from '../lib/money';
import { uid } from '../lib/id';

const STORAGE_KEY = 'two-ledgers:v1';
export const SCHEMA_VERSION = 2;

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
  | { type: 'tx/status'; ids: ID[]; status: TxStatus }
  | { type: 'tx/comment'; id: ID; comment: Comment }
  | { type: 'tx/approve'; id: ID; personId: ID }
  | { type: 'tx/transfer'; transfer: TransferInput }
  | { type: 'account/reconcile'; id: ID; date: string; balance: number; adjustment?: Transaction }
  | { type: 'rule/add'; rule: Rule }
  | { type: 'rule/update'; id: ID; patch: Partial<Rule> }
  | { type: 'rule/remove'; id: ID }
  | { type: 'rule/apply'; txs: Transaction[] }
  | { type: 'scheduled/add'; item: Scheduled }
  | { type: 'scheduled/addMany'; items: Scheduled[] }
  | { type: 'scheduled/update'; id: ID; patch: Partial<Scheduled> }
  | { type: 'scheduled/remove'; id: ID }
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

export interface TransferInput {
  date: string;
  /** Positive cents leaving `fromAccountId` and arriving in `toAccountId`. */
  amount: number;
  fromAccountId: ID;
  toAccountId: ID;
  categoryId: ID;
  payee: string;
  note?: string;
}

/** Builds the two mirrored legs that make up one transfer. */
export function buildTransfer(input: TransferInput): [Transaction, Transaction] {
  const transferId = uid('tr');
  const base = {
    date: input.date,
    categoryId: input.categoryId,
    payee: input.payee,
    note: input.note ?? '',
    paidBy: 'joint' as const,
    splitRule: 'income' as const,
    splitShares: {},
    tags: ['transfer'],
    status: 'cleared' as const,
    comments: [],
    approvals: [],
    private: false,
    transferId,
  };
  return [
    { ...base, id: uid('tx'), amount: -Math.abs(input.amount), accountId: input.fromAccountId },
    { ...base, id: uid('tx'), amount: Math.abs(input.amount), accountId: input.toAccountId },
  ];
}

/** Ids of both legs, given any transaction that might be one. */
function transferSiblings(state: AppState, ids: Set<ID>): Set<ID> {
  const transferIds = new Set(
    state.transactions.filter((t) => ids.has(t.id) && t.transferId).map((t) => t.transferId!),
  );
  if (!transferIds.size) return ids;
  const out = new Set(ids);
  for (const t of state.transactions) {
    if (t.transferId && transferIds.has(t.transferId)) out.add(t.id);
  }
  return out;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load':
      return migrate(action.state as unknown);
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
    case 'tx/removeMany': {
      const requested = new Set(action.type === 'tx/remove' ? [action.id] : action.ids);
      const ids = transferSiblings(state, requested);
      return { ...state, transactions: state.transactions.filter((t) => !ids.has(t.id)) };
    }
    case 'tx/status': {
      const ids = new Set(action.ids);
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          ids.has(t.id) ? { ...t, status: action.status } : t,
        ),
      };
    }
    case 'tx/comment':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.id ? { ...t, comments: [...t.comments, action.comment] } : t,
        ),
      };
    case 'tx/approve':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.id && !t.approvals.includes(action.personId)
            ? { ...t, approvals: [...t.approvals, action.personId] }
            : t,
        ),
      };
    case 'tx/transfer':
      return {
        ...state,
        transactions: sortTx([...buildTransfer(action.transfer), ...state.transactions]),
      };

    case 'account/reconcile':
      return {
        ...state,
        accounts: patchIn(state.accounts, action.id, {
          lastReconciled: { date: action.date, balance: action.balance },
        }),
        transactions: action.adjustment
          ? sortTx([action.adjustment, ...state.transactions])
          : state.transactions,
      };

    case 'rule/add':
      return { ...state, rules: [...state.rules, action.rule] };
    case 'rule/update':
      return { ...state, rules: patchIn(state.rules, action.id, action.patch) };
    case 'rule/remove':
      return { ...state, rules: state.rules.filter((r) => r.id !== action.id) };
    case 'rule/apply': {
      const byId = new Map(action.txs.map((t) => [t.id, t]));
      return {
        ...state,
        transactions: state.transactions.map((t) => byId.get(t.id) ?? t),
      };
    }

    case 'scheduled/add':
      return { ...state, scheduled: [...state.scheduled, action.item] };
    case 'scheduled/addMany':
      return { ...state, scheduled: [...state.scheduled, ...action.items] };
    case 'scheduled/update':
      return { ...state, scheduled: patchIn(state.scheduled, action.id, action.patch) };
    case 'scheduled/remove':
      return { ...state, scheduled: state.scheduled.filter((x) => x.id !== action.id) };
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

/**
 * Brings a saved file up to the current schema. v1 stored a typed-in balance per
 * account and a boolean `cleared` per transaction; v2 derives balances from the
 * ledger, so each account's opening balance is back-solved from the balance the
 * user last saw. Migrations are cumulative and must stay idempotent.
 */
export function migrate(raw: any): AppState {
  const base = emptyState();
  const state: AppState = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    rules: raw.rules ?? [],
    scheduled: raw.scheduled ?? [],
    mindMaps: raw.mindMaps ?? base.mindMaps,
    dismissedSuggestions: raw.dismissedSuggestions ?? [],
  };

  const version = raw.version ?? 1;

  state.transactions = (raw.transactions ?? []).map((t: any) => ({
    ...t,
    status: t.status ?? (t.cleared === false ? 'pending' : 'cleared'),
    comments: t.comments ?? [],
    approvals: t.approvals ?? [],
    private: t.private ?? false,
    cleared: undefined,
  }));

  state.accounts = (raw.accounts ?? []).map((a: any) => {
    if (a.openingBalance !== undefined) return { ...a };
    // v1 stored the live balance; recover the opening figure from the ledger so
    // the number on screen does not jump after upgrading.
    const moved = state.transactions
      .filter((t) => t.accountId === a.id)
      .reduce((total, t) => total + t.amount, 0);
    const { balance, ...rest } = a;
    return { ...rest, openingBalance: (balance ?? 0) - moved };
  });

  state.version = Math.max(version, SCHEMA_VERSION);
  return state;
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return demoState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.people)) return demoState();
    return migrate(parsed);
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
