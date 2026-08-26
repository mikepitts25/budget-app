/** Core domain model for Two Ledgers. All money values are stored as whole cents. */

export type ID = string;

/** ISO 4217 code, e.g. 'USD' or 'EUR'. */
export type CurrencyCode = string;

/**
 * Value of one unit of each foreign currency in the base currency, with the date
 * the couple last set it. The base currency itself is never stored here — it is
 * always exactly 1.
 */
export type ExchangeRates = Record<CurrencyCode, { rate: number; updated: string }>;

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
  /** The currency this account is denominated in. */
  currency: CurrencyCode;
  /**
   * Balance before the first tracked transaction, in this account's own
   * currency. The live balance is derived as openingBalance + the sum of this
   * account's transactions, so the ledger and the balance can never disagree.
   */
  openingBalance: number;
  /** Annual interest rate as a decimal (0.0499 = 4.99%). Relevant for credit/loan/savings. */
  apr: number;
  /** Statement balance from the last reconciliation, for drift detection. */
  lastReconciled?: { date: string; balance: number };
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

/** A remark one partner left on a transaction, so money talk stays in context. */
export interface Comment {
  id: ID;
  personId: ID;
  text: string;
  at: string;
}

/**
 * pending  — seen but not settled at the bank yet; amount may still change.
 * cleared  — posted and confirmed.
 * reconciled — matched against a statement and frozen.
 */
export type TxStatus = 'pending' | 'cleared' | 'reconciled';

/** How the cost of a transaction is shared between partners. */
export type SplitRule = 'even' | 'income' | 'custom' | 'personal';

/** How a transaction came to have the category it has. */
export type CategorySource =
  /** A person chose it. Never overwritten automatically. */
  | 'manual'
  /** A rule matched it. */
  | 'rule'
  /** Matched a payee the household had already categorized. */
  | 'learned'
  /** The import file named a category. */
  | 'imported'
  /** Nothing matched, so it landed in the fallback category. */
  | 'default';

export interface Transaction {
  id: ID;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /**
   * Cents in the account's own currency. Positive = money in, negative = out.
   * This is what the bank actually moved, and it never changes with FX rates.
   */
  amount: number;
  /** Denormalized from the account, so a transaction is self-describing. */
  currency: CurrencyCode;
  /**
   * The same amount converted to the household's base currency, fixed at the
   * time of entry. Every total, budget and report uses this — converting on
   * read would make last year's reports change when today's rate moves.
   */
  baseAmount: number;
  /** Native-to-base rate used for baseAmount, kept for transparency and audit. */
  rate: number;
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
  status: TxStatus;
  /** Set when the transaction was generated from / matched to a recurring series. */
  recurringId?: ID;
  /**
   * Both legs of a transfer share this id. Transfer legs are movement between
   * your own accounts, so they are excluded from income and spending entirely.
   */
  transferId?: ID;
  /** Stable id from the source file or provider (OFX FITID, Plaid transaction id). */
  externalId?: string;
  /** Conversation between partners about this transaction. */
  comments: Comment[];
  /** Person ids who have signed off, for spending above the agreed threshold. */
  approvals: ID[];
  /** Visible only to whoever paid, for couples who keep some spending private. */
  private: boolean;
  /** Where the category came from, so automatic guesses can be reviewed. */
  categorySource: CategorySource;
  /** The rule that filed it, when categorySource is 'rule'. */
  categoryRuleId?: ID;
  /**
   * How sure the automatic match was, 0..1. Only meaningful for 'learned':
   * the share of past transactions from this payee that used this category.
   */
  categoryConfidence?: number;
}

/** A matcher/action pair that files transactions automatically. */
export interface Rule {
  id: ID;
  name: string;
  enabled: boolean;
  /** Lower runs first; the last matching rule to set a field wins. */
  order: number;
  match: {
    payeeContains?: string;
    payeeRegex?: string;
    noteContains?: string;
    accountId?: ID;
    /** Cents, compared against the absolute amount. */
    minAmount?: number;
    maxAmount?: number;
    direction?: 'in' | 'out';
  };
  set: {
    categoryId?: ID;
    splitRule?: SplitRule;
    paidBy?: ID | 'joint';
    addTags?: string[];
    private?: boolean;
    renamePayee?: string;
  };
}

export type Cadence =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'annual';

/** A known future commitment — what makes a cash-flow forecast possible. */
export interface Scheduled {
  id: ID;
  name: string;
  /** Signed cents in the account's currency: negative for bills, positive for income. */
  amount: number;
  /** Denormalized from the account it is paid from. */
  currency: CurrencyCode;
  accountId: ID;
  categoryId: ID;
  cadence: Cadence;
  /** Next occurrence, ISO date. */
  nextDate: string;
  /** Stop generating after this date, if set. */
  endDate?: string;
  paidBy: ID | 'joint';
  splitRule: SplitRule;
  enabled: boolean;
  /** True when proposed by the recurrence detector rather than entered by hand. */
  autoDetected: boolean;
  /** Detector key it came from, so a series is only ever proposed once. */
  sourceKey?: string;
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
  /** Reporting currency. Every total, budget and chart is expressed in it. */
  baseCurrency: CurrencyCode;
  locale: string;
  /** Default rule applied to new shared transactions. */
  defaultSplit: SplitRule;
  /** Target share of take-home pay saved each month (decimal). */
  savingsRateTarget: number;
  /** Month the app opens on, 'YYYY-MM'. Empty = current month. */
  pinnedMonth: string;
  /** Spending above this needs both partners to acknowledge it. 0 disables. */
  bigPurchaseThreshold: number;
  /** Buffer kept in checking when computing safe-to-spend, in cents. */
  safeToSpendBuffer: number;
  /**
   * Which partner is using the app right now. Comments and approvals are
   * attributed to them, and private spending is only itemised for them.
   */
  activePersonId: ID;
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
  rules: Rule[];
  scheduled: Scheduled[];
  /** Manually maintained FX rates against the base currency. */
  rates: ExchangeRates;
  retirement: RetirementPlan;
  /** Savings suggestions the couple dismissed, by suggestion key. */
  dismissedSuggestions: string[];
}
