/** Core domain model for Two Ledgers. All money values are stored as whole cents. */

export type ID = string;

/** A member of the household. Two is the norm, but the model allows more. */
export interface Person {
  id: ID;
  name: string;
  color: string;
  /** Gross annual income in cents — used for income-proportional splitting. */
  annualIncome: number;
}

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit'
  | 'investment'
  | 'retirement'
  | 'property'
  | 'loan';

export interface Account {
  id: ID;
  name: string;
  institution: string;
  type: AccountType;
  /** 'joint' or a Person id. */
  owner: ID | 'joint';
  /** Current balance in cents. Liabilities are stored as a positive amount owed. */
  balance: number;
  /** Annual interest rate as a decimal (0.0499 = 4.99%). Relevant for credit/loan/savings. */
  apr: number;
  archived: boolean;
}

export type CategoryKind = 'income' | 'expense';

/** Buckets used for the 50/30/20 style health check and reporting rollups. */
export type CategoryGroup =
  | 'Income'
  | 'Housing'
  | 'Transport'
  | 'Food'
  | 'Health'
  | 'Kids'
  | 'Lifestyle'
  | 'Subscriptions'
  | 'Debt'
  | 'Savings'
  | 'Other';

export interface Category {
  id: ID;
  name: string;
  group: CategoryGroup;
  kind: CategoryKind;
  /** Essential (needs) vs discretionary (wants) — drives the savings finder. */
  essential: boolean;
  icon: string;
  archived: boolean;
}

/** How the cost of a transaction is shared between partners. */
export type SplitRule = 'even' | 'income' | 'custom' | 'personal';

export interface Transaction {
  id: ID;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Cents. Positive = money in, negative = money out. */
  amount: number;
  accountId: ID;
  categoryId: ID;
  payee: string;
  note: string;
  /** Who actually paid. 'joint' means it left a shared account. */
  paidBy: ID | 'joint';
  splitRule: SplitRule;
  /** For 'custom' and 'personal': personId -> share weight (0..1, summing to 1). */
  splitShares: Record<ID, number>;
  tags: string[];
  cleared: boolean;
  /** Set when the transaction was generated from / matched to a recurring series. */
  recurringId?: ID;
}

/** A planned envelope amount for one category in one month. */
export interface BudgetLine {
  /** 'YYYY-MM' */
  month: string;
  categoryId: ID;
  /** Cents planned to spend (expense) or expected (income). */
  planned: number;
  /** Carry unspent money into next month. */
  rollover: boolean;
}

export type GoalKind =
  | 'house'
  | 'car'
  | 'vacation'
  | 'emergency'
  | 'retirement'
  | 'education'
  | 'wedding'
  | 'baby'
  | 'renovation'
  | 'custom';

export interface Goal {
  id: ID;
  name: string;
  kind: GoalKind;
  /** Cents. */
  target: number;
  saved: number;
  /** ISO date the couple wants this funded by. */
  targetDate: string;
  /** Cents per month currently being set aside. */
  monthlyContribution: number;
  /** Optional account the goal is funded from, for reconciliation. */
  accountId?: ID;
  /** Lower number = funded first when surplus is allocated. */
  priority: number;
  /** Expected annual return while saving (decimal). Cash goals should use ~0.04. */
  expectedReturn: number;
  notes: string;
  archived: boolean;
}

export interface Debt {
  id: ID;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  kind: 'credit' | 'student' | 'auto' | 'mortgage' | 'personal' | 'medical';
}

export interface NetWorthSnapshot {
  /** 'YYYY-MM' */
  month: string;
  assets: number;
  liabilities: number;
}

export type MindNodeKind = 'root' | 'goal' | 'idea' | 'question' | 'risk' | 'milestone' | 'money';

export interface MindNode {
  id: ID;
  label: string;
  detail: string;
  kind: MindNodeKind;
  x: number;
  y: number;
  /** Optional link to a savings goal — pulls live progress onto the canvas. */
  goalId?: ID;
  /** Optional cost estimate in cents, rolled up on the canvas. */
  estimate?: number;
  owner?: ID | 'joint';
  done?: boolean;
}

export interface MindEdge {
  id: ID;
  from: ID;
  to: ID;
  label: string;
}

export interface MindMap {
  id: ID;
  name: string;
  nodes: MindNode[];
  edges: MindEdge[];
}

/** Assumptions behind the retirement projection. */
export interface RetirementPlan {
  currentAge: Record<ID, number>;
  retireAge: Record<ID, number>;
  /** Cents already invested for retirement (outside of tracked accounts). */
  currentSavings: number;
  monthlyContribution: number;
  /** Decimals. */
  expectedReturn: number;
  inflation: number;
  /** Cents/year the couple wants to spend in retirement, in today's money. */
  desiredAnnualSpend: number;
  safeWithdrawalRate: number;
}

export interface Settings {
  householdName: string;
  currency: string;
  locale: string;
  /** Default rule applied to new shared transactions. */
  defaultSplit: SplitRule;
  /** Target share of take-home pay saved each month (decimal). */
  savingsRateTarget: number;
  /** Month the app opens on, 'YYYY-MM'. Empty = current month. */
  pinnedMonth: string;
  theme: 'dark' | 'light';
  onboarded: boolean;
}

export interface AppState {
  version: number;
  settings: Settings;
  people: Person[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budget: BudgetLine[];
  goals: Goal[];
  debts: Debt[];
  netWorth: NetWorthSnapshot[];
  mindMaps: MindMap[];
  retirement: RetirementPlan;
  /** Savings suggestions the couple dismissed, by suggestion key. */
  dismissedSuggestions: string[];
}
