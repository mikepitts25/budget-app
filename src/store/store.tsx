import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
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
import { formatIn } from '../lib/currency';
import { uid } from '../lib/id';

const STORAGE_KEY = 'two-ledgers:v1';
export const SCHEMA_VERSION = 3;

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
  | { type: 'rate/set'; code: string; rate: number; updated: string }
  | { type: 'rate/remove'; code: string }
  | { type: 'currency/setBase'; code: string }
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
  /** Positive cents leaving `fromAccountId`, in that account's currency. */
  amount: number;
  fromAccountId: ID;
  toAccountId: ID;
  categoryId: ID;
  payee: string;
  note?: string;
  /**
   * Cents actually received, in the destination account's currency. Only
   * meaningful across currencies, where the real received amount includes the
   * provider's spread and fees. Omit it and the current rate is used.
   */
  receivedAmount?: number;
}

/**
 * Builds the two mirrored legs of a transfer.
 *
 * Across currencies the legs carry different native amounts — dollars out,
 * euros in — but they are the same money, so both legs share one base value.
 * Deriving the receiving leg's base amount independently would make a transfer
 * appear to create or destroy money whenever the rate moved.
 */
export function buildTransfer(state: AppState, input: TransferInput): [Transaction, Transaction] {
  const transferId = uid('tr');
  const from = state.accounts.find((a) => a.id === input.fromAccountId);
  const to = state.accounts.find((a) => a.id === input.toAccountId);
  const baseCurrency = state.settings.baseCurrency;
  const fromCurrency = from?.currency ?? baseCurrency;
  const toCurrency = to?.currency ?? baseCurrency;
  const fromRate = rateOfCurrency(state, fromCurrency);
  const toRate = rateOfCurrency(state, toCurrency);

  const sent = Math.abs(input.amount);
  const baseValue = Math.round(sent * fromRate);
  const received = input.receivedAmount ?? Math.round(baseValue / toRate);
  // The rate implied by what actually left and arrived, which is what a person
  // would check against their transfer provider's receipt.
  const receivedRate = received > 0 ? baseValue / received : toRate;

  const shared = {
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
    categorySource: 'manual' as const,
    transferId,
  };

  return [
    {
      ...shared,
      id: uid('tx'),
      amount: -sent,
      accountId: input.fromAccountId,
      currency: fromCurrency,
      rate: fromRate,
      baseAmount: -baseValue,
    },
    {
      ...shared,
      id: uid('tx'),
      amount: received,
      accountId: input.toAccountId,
      currency: toCurrency,
      rate: receivedRate,
      baseAmount: baseValue,
    },
  ];
}

const rateOfCurrency = (state: AppState, code: string): number =>
  code === state.settings.baseCurrency ? 1 : (state.rates?.[code]?.rate ?? 1);

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
        transactions: sortTx([...buildTransfer(state, action.transfer), ...state.transactions]),
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

    case 'rate/set':
      return {
        ...state,
        rates: { ...state.rates, [action.code]: { rate: action.rate, updated: action.updated } },
      };
    case 'rate/remove': {
      const { [action.code]: _removed, ...rest } = state.rates;
      return { ...state, rates: rest };
    }
    case 'currency/setBase': {
      // Changing the base currency re-expresses every stored base amount through
      // the old base, so history keeps its meaning instead of silently changing
      // by the size of the exchange rate.
      const previous = state.settings.baseCurrency;
      if (action.code === previous) return state;
      const newBaseInOldBase = rateOfCurrency(state, action.code);
      if (!newBaseInOldBase) return state;

      const rescale = (amountInOldBase: number) =>
        Math.round(amountInOldBase / newBaseInOldBase);

      const rates: AppState['rates'] = {};
      for (const [code, entry] of Object.entries(state.rates)) {
        if (code === action.code) continue;
        rates[code] = { rate: entry.rate / newBaseInOldBase, updated: entry.updated };
      }
      // The old base currency is now foreign, and needs a rate of its own.
      rates[previous] = { rate: 1 / newBaseInOldBase, updated: state.rates[action.code]?.updated ?? '' };

      return {
        ...state,
        settings: { ...state.settings, baseCurrency: action.code },
        rates,
        transactions: state.transactions.map((t) => ({
          ...t,
          baseAmount: rescale(t.baseAmount),
          rate: t.rate / newBaseInOldBase,
        })),
        budget: state.budget.map((b) => ({ ...b, planned: rescale(b.planned) })),
        goals: state.goals.map((g) => ({
          ...g,
          target: rescale(g.target),
          saved: rescale(g.saved),
          monthlyContribution: rescale(g.monthlyContribution),
        })),
        debts: state.debts.map((d) => ({
          ...d,
          balance: rescale(d.balance),
          minPayment: rescale(d.minPayment),
        })),
        netWorth: state.netWorth.map((n) => ({
          ...n,
          assets: rescale(n.assets),
          liabilities: rescale(n.liabilities),
        })),
        retirement: {
          ...state.retirement,
          currentSavings: rescale(state.retirement.currentSavings),
          monthlyContribution: rescale(state.retirement.monthlyContribution),
          desiredAnnualSpend: rescale(state.retirement.desiredAnnualSpend),
        },
      };
    }
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

/**
 * Actions that should not create an undo step. Loading a file, switching who is
 * using the app or flipping the theme are not edits to the household's data, and
 * cluttering the undo stack with them makes undo useless for the edits that
 * matter.
 */
const TRANSIENT_ACTIONS = new Set<Action['type']>(['load', 'settings/update']);

export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

const HISTORY_LIMIT = 50;

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

/**
 * Wraps the reducer with an undo stack. State snapshots are cheap here because
 * the reducer is already immutable — every action returns a fresh object and
 * shares everything it did not touch.
 */
export function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    if (!history.past.length) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    };
  }
  if (action.type === 'redo') {
    if (!history.future.length) return history;
    const [next, ...rest] = history.future;
    return {
      past: [...history.past, history.present].slice(-HISTORY_LIMIT),
      present: next,
      future: rest,
    };
  }

  const next = reducer(history.present, action);
  if (next === history.present) return history;
  if (TRANSIENT_ACTIONS.has(action.type)) return { ...history, present: next };

  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    // Any new edit abandons the redo branch, as it does in every editor.
    future: [],
  };
}

const sortTx = (txs: Transaction[]): Transaction[] =>
  [...txs].sort((a, b) => b.date.localeCompare(a.date));

function mapMap(state: AppState, id: ID, fn: (m: MindMap) => MindMap): AppState {
  return { ...state, mindMaps: state.mindMaps.map((m) => (m.id === id ? fn(m) : m)) };
}

/**
 * Brings a saved file up to the current schema. Migrations are cumulative and
 * must stay idempotent.
 *
 * v1 → v2: balances were typed in per account and transactions had a boolean
 * `cleared`. Balances are now derived from the ledger, so each opening balance
 * is back-solved from the balance the user last saw.
 *
 * v2 → v3: everything was implicitly one currency. Accounts gain an explicit
 * currency, transactions gain their native currency plus a base-currency amount
 * and the rate used, and categories gain a provenance so automatic guesses can
 * be told apart from choices a person made. A single-currency file converts
 * with every rate at 1, so no number changes.
 */
export function migrate(raw: any): AppState {
  const base = emptyState();
  const state: AppState = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    rules: raw.rules ?? [],
    scheduled: raw.scheduled ?? [],
    rates: raw.rates ?? {},
    mindMaps: raw.mindMaps ?? base.mindMaps,
    dismissedSuggestions: raw.dismissedSuggestions ?? [],
  };

  const version = raw.version ?? 1;

  // v2 stored the household currency under `currency`.
  const baseCurrency: string =
    raw.settings?.baseCurrency ?? raw.settings?.currency ?? base.settings.baseCurrency;
  state.settings.baseCurrency = baseCurrency;
  delete (state.settings as unknown as Record<string, unknown>).currency;

  const accountCurrency = new Map<string, string>(
    (raw.accounts ?? []).map((a: any) => [a.id, a.currency ?? baseCurrency]),
  );

  state.transactions = (raw.transactions ?? []).map((t: any) => {
    const currency = t.currency ?? accountCurrency.get(t.accountId) ?? baseCurrency;
    const rate = t.rate ?? (currency === baseCurrency ? 1 : (state.rates[currency]?.rate ?? 1));
    return {
      ...t,
      status: t.status ?? (t.cleared === false ? 'pending' : 'cleared'),
      comments: t.comments ?? [],
      approvals: t.approvals ?? [],
      private: t.private ?? false,
      currency,
      rate,
      baseAmount: t.baseAmount ?? Math.round(t.amount * rate),
      // Pre-v3 transactions have no provenance. Treating them as manual is the
      // safe default: it means rules will not silently reclassify years of
      // history the first time they run.
      categorySource: t.categorySource ?? 'manual',
      cleared: undefined,
    };
  });

  state.scheduled = (raw.scheduled ?? []).map((item: any) => ({
    ...item,
    currency: item.currency ?? accountCurrency.get(item.accountId) ?? baseCurrency,
  }));

  state.accounts = (raw.accounts ?? []).map((a: any) => {
    const currency = a.currency ?? baseCurrency;
    if (a.openingBalance !== undefined) return { ...a, currency };
    // v1 stored the live balance; recover the opening figure from the ledger so
    // the number on screen does not jump after upgrading.
    const moved = state.transactions
      .filter((t) => t.accountId === a.id)
      .reduce((total, t) => total + t.amount, 0);
    const { balance, ...rest } = a;
    return { ...rest, currency, openingBalance: (balance ?? 0) - moved };
  });

  // Whoever is using the app must always resolve to a real person.
  if (!state.people.some((p) => p.id === state.settings.activePersonId)) {
    state.settings.activePersonId = state.people[0]?.id ?? '';
  }

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
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Format cents. Defaults to the household's base currency; pass `currency` to
   * render a native amount, such as a euro account's own balance.
   */
  money: (cents: number, opts?: { compact?: boolean; sign?: boolean; currency?: string }) => string;
  /** The month the app is currently focused on. */
  month: string;
  setMonth: (month: string) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [history, dispatchHistory] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadState(),
    future: [],
  }));
  const state = history.present;
  const [month, setMonth] = React.useState<string>(() => state.settings.pinnedMonth || currentMonth());

  const dispatch = useCallback((action: Action) => dispatchHistory(action), []);
  const undo = useCallback(() => dispatchHistory({ type: 'undo' }), []);
  const redo = useCallback(() => dispatchHistory({ type: 'redo' }), []);

  useEffect(() => {
    const handle = window.setTimeout(() => saveState(state), 250);
    return () => window.clearTimeout(handle);
  }, [state]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  // Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      dispatch,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      money: (cents, opts) =>
        formatIn(cents, opts?.currency ?? state.settings.baseCurrency, {
          locale: state.settings.locale,
          compact: opts?.compact,
          sign: opts?.sign,
        }),
      month,
      setMonth,
    }),
    [state, month, history.past.length, history.future.length, dispatch, undo, redo],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export { STORAGE_KEY };
