import type {
  Account,
  AppState,
  BudgetLine,
  Category,
  Debt,
  Goal,
  MindMap,
  Person,
  Transaction,
} from './types';
import { addMonths, currentMonth, daysInMonth, todayISO } from '../lib/date';
import { uid } from '../lib/id';

/** Euros per dollar for the demo household. Realistic, not live. */
const EUR_RATE = 1.08;

/** Deterministic PRNG so the demo household looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Salary', group: 'Income', kind: 'income', essential: false, icon: '💼', archived: false },
  { name: 'Bonus', group: 'Income', kind: 'income', essential: false, icon: '🎉', archived: false },
  { name: 'Side income', group: 'Income', kind: 'income', essential: false, icon: '🛠️', archived: false },
  { name: 'Rent / Mortgage', group: 'Housing', kind: 'expense', essential: true, icon: '🏠', archived: false },
  { name: 'Utilities', group: 'Housing', kind: 'expense', essential: true, icon: '💡', archived: false },
  { name: 'Internet & Phone', group: 'Housing', kind: 'expense', essential: true, icon: '📶', archived: false },
  { name: 'Home maintenance', group: 'Housing', kind: 'expense', essential: true, icon: '🔧', archived: false },
  { name: 'Groceries', group: 'Food', kind: 'expense', essential: true, icon: '🛒', archived: false },
  { name: 'Restaurants', group: 'Food', kind: 'expense', essential: false, icon: '🍽️', archived: false },
  { name: 'Coffee', group: 'Food', kind: 'expense', essential: false, icon: '☕', archived: false },
  { name: 'Car payment', group: 'Transport', kind: 'expense', essential: true, icon: '🚗', archived: false },
  { name: 'Fuel', group: 'Transport', kind: 'expense', essential: true, icon: '⛽', archived: false },
  { name: 'Transit & rideshare', group: 'Transport', kind: 'expense', essential: false, icon: '🚇', archived: false },
  { name: 'Car insurance', group: 'Transport', kind: 'expense', essential: true, icon: '🛡️', archived: false },
  { name: 'Health insurance', group: 'Health', kind: 'expense', essential: true, icon: '🏥', archived: false },
  { name: 'Pharmacy & care', group: 'Health', kind: 'expense', essential: true, icon: '💊', archived: false },
  { name: 'Fitness', group: 'Health', kind: 'expense', essential: false, icon: '🏋️', archived: false },
  { name: 'Childcare', group: 'Kids', kind: 'expense', essential: true, icon: '🧸', archived: false },
  { name: 'Pets', group: 'Kids', kind: 'expense', essential: true, icon: '🐾', archived: false },
  { name: 'Shopping', group: 'Lifestyle', kind: 'expense', essential: false, icon: '🛍️', archived: false },
  { name: 'Entertainment', group: 'Lifestyle', kind: 'expense', essential: false, icon: '🎬', archived: false },
  { name: 'Travel', group: 'Lifestyle', kind: 'expense', essential: false, icon: '✈️', archived: false },
  { name: 'Gifts & giving', group: 'Lifestyle', kind: 'expense', essential: false, icon: '🎁', archived: false },
  { name: 'Personal care', group: 'Lifestyle', kind: 'expense', essential: false, icon: '💇', archived: false },
  { name: 'Streaming & apps', group: 'Subscriptions', kind: 'expense', essential: false, icon: '📺', archived: false },
  { name: 'Debt payments', group: 'Debt', kind: 'expense', essential: true, icon: '💳', archived: false },
  { name: 'Bank fees', group: 'Debt', kind: 'expense', essential: false, icon: '🏦', archived: false },
  { name: 'Savings transfer', group: 'Savings', kind: 'expense', essential: false, icon: '🐖', archived: false },
  { name: 'Investments', group: 'Savings', kind: 'expense', essential: false, icon: '📈', archived: false },
  { name: 'Miscellaneous', group: 'Other', kind: 'expense', essential: false, icon: '❓', archived: false },
];

export function makeCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, id: uid('cat') }));
}

export function emptyState(): AppState {
  const categories = makeCategories();
  const alex: Person = { id: uid('p'), name: 'Partner A', color: '#7c8cff', annualIncome: 0 };
  const jordan: Person = { id: uid('p'), name: 'Partner B', color: '#4fd1a5', annualIncome: 0 };
  return {
    version: 1,
    settings: {
      householdName: 'Our Household',
      baseCurrency: 'USD',
      locale: 'en-US',
      defaultSplit: 'even',
      savingsRateTarget: 0.2,
      pinnedMonth: '',
      bigPurchaseThreshold: 25000,
      safeToSpendBuffer: 50000,
      activePersonId: alex.id,
      theme: 'dark',
      onboarded: false,
    },
    people: [alex, jordan],
    accounts: [],
    categories,
    transactions: [],
    budget: [],
    goals: [],
    debts: [],
    netWorth: [],
    mindMaps: [starterMindMap()],
    rules: [],
    scheduled: [],
    rates: {},
    retirement: {
      currentAge: { [alex.id]: 34, [jordan.id]: 33 },
      retireAge: { [alex.id]: 62, [jordan.id]: 62 },
      currentSavings: 0,
      monthlyContribution: 0,
      expectedReturn: 0.065,
      inflation: 0.025,
      desiredAnnualSpend: 8000000,
      safeWithdrawalRate: 0.04,
    },
    dismissedSuggestions: [],
  };
}

export function starterMindMap(): MindMap {
  const root = uid('n');
  const house = uid('n');
  const kid = uid('n');
  const travel = uid('n');
  const retire = uid('n');
  return {
    id: uid('mm'),
    name: 'Our next ten years',
    nodes: [
      { id: root, label: 'Our life plan', detail: 'Everything we are aiming at, in one picture.', kind: 'root', x: 620, y: 360 },
      { id: house, label: 'Buy a house', detail: '20% down, 3 bed, near the park.', kind: 'goal', x: 300, y: 180 },
      { id: kid, label: 'Start a family', detail: 'Childcare, bigger car, one income dip.', kind: 'goal', x: 320, y: 560 },
      { id: travel, label: 'Japan, spring 2027', detail: 'Three weeks, shoulder season.', kind: 'goal', x: 940, y: 200 },
      { id: retire, label: 'Retire at 62', detail: 'Both of us, same year.', kind: 'goal', x: 950, y: 540 },
    ],
    edges: [
      { id: uid('e'), from: root, to: house, label: '' },
      { id: uid('e'), from: root, to: kid, label: '' },
      { id: uid('e'), from: root, to: travel, label: '' },
      { id: uid('e'), from: root, to: retire, label: '' },
    ],
  };
}

interface Rule {
  category: string;
  payee: string | string[];
  /** In the paying account's own currency. */
  amount: [number, number];
  /** Times per month. Fractional means "sometimes". */
  perMonth: number;
  day?: number;
  paidBy?: 'a' | 'b' | 'joint';
  split?: 'even' | 'income' | 'personal';
  /** Forces the paying account, for costs that are always in euros. */
  account?: 'euro';
}

const RULES: Rule[] = [
  { category: 'Rent / Mortgage', payee: 'Calle Mayor Arrendamientos', amount: [245000, 245000], perMonth: 1, day: 3, paidBy: 'joint', account: 'euro' },
  { category: 'Utilities', payee: ['Iberdrola Energía', 'Aguas Municipales'], amount: [7000, 17000], perMonth: 2, paidBy: 'joint', account: 'euro' },
  { category: 'Internet & Phone', payee: ['Fiberline Internet', 'Cellcom Wireless'], amount: [6500, 14500], perMonth: 2, paidBy: 'joint' },
  { category: 'Groceries', payee: ['Green Grocer', 'SuperMart', 'Corner Market'], amount: [4200, 18500], perMonth: 6, paidBy: 'joint' },
  { category: 'Restaurants', payee: ['Tavola', 'Noodle Bar', 'Blue Fig Cafe', 'Taqueria Sol', 'Pizza Nova'], amount: [2400, 11800], perMonth: 7 },
  { category: 'Coffee', payee: ['Daily Grind Coffee'], amount: [480, 920], perMonth: 17 },
  { category: 'Fuel', payee: ['QuickFuel', 'Shellside'], amount: [3800, 6900], perMonth: 3 },
  { category: 'Transit & rideshare', payee: ['RideNow', 'Metro Transit'], amount: [900, 4200], perMonth: 4 },
  { category: 'Car payment', payee: 'Ascent Auto Finance', amount: [43800, 43800], perMonth: 1, day: 12, paidBy: 'joint' },
  { category: 'Car insurance', payee: 'Harbor Mutual Insurance', amount: [18400, 18400], perMonth: 1, day: 8, paidBy: 'joint' },
  { category: 'Health insurance', payee: 'Meridian Health', amount: [32000, 32000], perMonth: 1, day: 5, paidBy: 'joint' },
  { category: 'Pharmacy & care', payee: ['Wellspring Pharmacy'], amount: [1200, 8600], perMonth: 1.5 },
  { category: 'Fitness', payee: 'Ironworks Gym', amount: [5900, 5900], perMonth: 1, day: 3 },
  { category: 'Streaming & apps', payee: 'Netflix', amount: [1599, 1899], perMonth: 1, day: 14 },
  { category: 'Streaming & apps', payee: 'Spotify Family', amount: [1699, 1699], perMonth: 1, day: 7 },
  { category: 'Streaming & apps', payee: 'Hulu', amount: [1799, 1799], perMonth: 1, day: 18 },
  { category: 'Streaming & apps', payee: 'Disney Plus', amount: [1399, 1399], perMonth: 1, day: 22 },
  { category: 'Streaming & apps', payee: 'CloudDrive Storage', amount: [999, 999], perMonth: 1, day: 9 },
  { category: 'Streaming & apps', payee: 'The Daily Ledger News', amount: [1700, 1700], perMonth: 1, day: 25 },
  { category: 'Shopping', payee: ['Everything Store', 'Thread & Co', 'HomeGoods Depot'], amount: [1900, 24000], perMonth: 5 },
  { category: 'Entertainment', payee: ['Cinemaxx', 'Vinyl Room', 'Board & Brew'], amount: [1800, 9800], perMonth: 2 },
  { category: 'Personal care', payee: ['Shear Studio', 'Glow Apothecary'], amount: [2400, 9500], perMonth: 1.5 },
  { category: 'Pets', payee: ['Paws & Claws Vet', 'Petmart'], amount: [2200, 16000], perMonth: 1.5, paidBy: 'joint' },
  { category: 'Gifts & giving', payee: ['Giving Fund', 'Bloom Florist'], amount: [2500, 12000], perMonth: 1 },
  { category: 'Bank fees', payee: ['Overdraft fee', 'ATM fee'], amount: [300, 3500], perMonth: 0.5, paidBy: 'joint' },
  { category: 'Miscellaneous', payee: ['Sundry', 'Parking'], amount: [700, 4500], perMonth: 2 },
];

/** Builds a realistic nine-month history for a two-income household. */
export function demoState(): AppState {
  const base = emptyState();
  const rand = rng(20260826);
  const catId = (name: string) => base.categories.find((c) => c.name === name)!.id;

  const [a, b] = base.people;
  const people: Person[] = [
    { ...a, name: 'Alex', color: '#7c8cff', annualIncome: 11200000 },
    { ...b, name: 'Jordan', color: '#4fd1a5', annualIncome: 7800000 },
  ];

  const targetBalances: Record<string, number> = {};
  // The demo household is paid in dollars and pays rent in euros, which is the
  // case multi-currency support exists for.
  const accounts: Account[] = [
    { id: uid('ac'), name: 'Joint Checking', institution: 'Harbor Bank', type: 'checking', owner: 'joint', currency: 'USD', openingBalance: 942000, apr: 0.0005, archived: false },
    { id: uid('ac'), name: 'Euro Account', institution: 'Banco Ibérico', type: 'checking', owner: 'joint', currency: 'EUR', openingBalance: 310000, apr: 0, archived: false },
    { id: uid('ac'), name: 'Emergency Fund', institution: 'Harbor Bank', type: 'savings', owner: 'joint', currency: 'USD', openingBalance: 1180000, apr: 0.041, archived: false },
    { id: uid('ac'), name: 'House Fund', institution: 'Harbor Bank', type: 'savings', owner: 'joint', currency: 'USD', openingBalance: 3640000, apr: 0.042, archived: false },
    { id: uid('ac'), name: "Alex's Checking", institution: 'Northline', type: 'checking', owner: people[0].id, currency: 'USD', openingBalance: 318000, apr: 0, archived: false },
    { id: uid('ac'), name: "Jordan's Checking", institution: 'Northline', type: 'checking', owner: people[1].id, currency: 'USD', openingBalance: 264000, apr: 0, archived: false },
    { id: uid('ac'), name: 'Sapphire Card', institution: 'Northline', type: 'credit', owner: 'joint', currency: 'USD', openingBalance: 412000, apr: 0.2274, archived: false },
    { id: uid('ac'), name: 'Brokerage', institution: 'Vantage', type: 'investment', owner: 'joint', currency: 'USD', openingBalance: 4820000, apr: 0, archived: false },
    { id: uid('ac'), name: "Alex's 401(k)", institution: 'Vantage', type: 'retirement', owner: people[0].id, currency: 'USD', openingBalance: 14250000, apr: 0, archived: false },
    { id: uid('ac'), name: "Jordan's 403(b)", institution: 'Vantage', type: 'retirement', owner: people[1].id, currency: 'USD', openingBalance: 9180000, apr: 0, archived: false },
  ];
  const joint = accounts[0];
  const euro = accounts[1];
  const emergencyFund = accounts[2];
  const houseFund = accounts[3];
  const alexAcc = accounts[4];
  const jordanAcc = accounts[5];
  const card = accounts[6];
  const brokerage = accounts[7];
  for (const a of accounts) targetBalances[a.id] = a.openingBalance;

  const debts: Debt[] = [
    { id: uid('d'), name: 'Sapphire Card', balance: 412000, apr: 0.2274, minPayment: 12500, kind: 'credit' },
    { id: uid('d'), name: "Alex's Student Loan", balance: 2180000, apr: 0.0575, minPayment: 24800, kind: 'student' },
    { id: uid('d'), name: 'Auto Loan', balance: 1690000, apr: 0.0649, minPayment: 43800, kind: 'auto' },
  ];

  const transactions: Transaction[] = [];
  const months: string[] = [];
  for (let i = 8; i >= 0; i--) months.push(addMonths(currentMonth(), -i));
  const today = todayISO();

  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const currencyOf = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.currency ?? 'USD';

  const push = (
    t: Partial<Transaction> & Pick<Transaction, 'date' | 'amount' | 'accountId' | 'categoryId' | 'payee'>,
  ) => {
    if (t.date > today) return;
    const currency = t.currency ?? currencyOf(t.accountId);
    const rate = t.rate ?? (currency === 'USD' ? 1 : EUR_RATE);
    transactions.push({
      id: uid('tx'),
      note: '',
      paidBy: 'joint',
      splitRule: 'even',
      splitShares: {},
      tags: [],
      status: 'cleared',
      comments: [],
      approvals: [],
      private: false,
      categorySource: 'manual',
      ...t,
      currency,
      rate,
      baseAmount: t.baseAmount ?? Math.round(t.amount * rate),
    } as Transaction);
  };

  /**
   * Two legs, one id. Across currencies the legs have different native amounts —
   * dollars leave, euros arrive — but represent the same money, so the receiving
   * leg's base amount is pinned to the sending leg's rather than recomputed.
   */
  const pushTransfer = (
    date: string,
    amount: number,
    fromId: string,
    toId: string,
    payee: string,
    categoryId: string,
  ) => {
    if (date > today) return;
    const transferId = uid('tr');
    const fromCurrency = currencyOf(fromId);
    const toCurrency = currencyOf(toId);
    const fromRate = fromCurrency === 'USD' ? 1 : EUR_RATE;
    const toRate = toCurrency === 'USD' ? 1 : EUR_RATE;
    const baseValue = Math.round(amount * fromRate);
    const received = Math.round(baseValue / toRate);

    push({ date, amount: -amount, accountId: fromId, categoryId, payee, transferId, splitRule: 'income' });
    push({
      date,
      amount: received,
      accountId: toId,
      categoryId,
      payee,
      transferId,
      splitRule: 'income',
      baseAmount: baseValue,
    });
  };

  months.forEach((month, monthIndex) => {
    const dim = daysInMonth(month);
    const day = (n: number) => `${month}-${String(Math.min(dim, Math.max(1, n))).padStart(2, '0')}`;

    // Paychecks: Alex semi-monthly, Jordan monthly, both with small variation.
    push({ date: day(1), amount: between(345000, 352000), accountId: alexAcc.id, categoryId: catId('Salary'), payee: 'Northwind Labs Payroll', note: '', paidBy: people[0].id, splitRule: 'personal' });
    push({ date: day(15), amount: between(345000, 352000), accountId: alexAcc.id, categoryId: catId('Salary'), payee: 'Northwind Labs Payroll', note: '', paidBy: people[0].id, splitRule: 'personal' });
    push({ date: day(24), amount: between(478000, 492000), accountId: jordanAcc.id, categoryId: catId('Salary'), payee: 'Riverside School District', note: '', paidBy: people[1].id, splitRule: 'personal' });
    if (monthIndex === 2) {
      push({ date: day(20), amount: 620000, accountId: joint.id, categoryId: catId('Bonus'), payee: 'Northwind Labs Bonus', note: 'Annual bonus', paidBy: 'joint', splitRule: 'income' });
    }
    if (monthIndex % 3 === 1) {
      push({ date: day(11), amount: between(45000, 130000), accountId: jordanAcc.id, categoryId: catId('Side income'), payee: 'Weekend tutoring', note: '', paidBy: people[1].id, splitRule: 'personal' });
    }

    // Transfers into the shared goals — two legs each, so nothing is double counted.
    pushTransfer(day(2), 95000, joint.id, houseFund.id, 'Transfer to House Fund', catId('Savings transfer'));
    pushTransfer(day(2), 30000, joint.id, emergencyFund.id, 'Transfer to Emergency Fund', catId('Savings transfer'));
    pushTransfer(day(6), 60000, joint.id, brokerage.id, 'Vantage Brokerage', catId('Investments'));
    // Dollars in, euros out: the rent has to be funded before it is due.
    pushTransfer(day(1), 300000, joint.id, euro.id, 'Wise transfer to Euro Account', catId('Savings transfer'));
    // Debt service.
    push({ date: day(17), amount: -24800, accountId: alexAcc.id, categoryId: catId('Debt payments'), payee: 'Crestline Student Loans', note: '', paidBy: people[0].id, splitRule: 'personal' });
    push({ date: day(21), amount: -between(15000, 42000), accountId: joint.id, categoryId: catId('Debt payments'), payee: 'Sapphire Card Payment', note: '', paidBy: 'joint', splitRule: 'income' });

    for (const rule of RULES) {
      // Subscription prices creep upward over the window; the finder should notice.
      const drift = rule.category === 'Streaming & apps' ? 1 + monthIndex * 0.012 : 1;
      const count =
        rule.perMonth >= 1 ? Math.round(rule.perMonth) : rand() < rule.perMonth ? 1 : 0;
      for (let i = 0; i < count; i++) {
        const payee = Array.isArray(rule.payee) ? pick(rule.payee) : rule.payee;
        const d = rule.day ? rule.day : between(1, dim);
        const payer =
          rule.paidBy === 'joint'
            ? 'joint'
            : rule.paidBy === 'a'
              ? people[0].id
              : rule.paidBy === 'b'
                ? people[1].id
                : rand() < 0.55
                  ? people[0].id
                  : people[1].id;
        const account =
          rule.account === 'euro'
            ? euro.id
            : payer === 'joint'
              ? rand() < 0.75
                ? joint.id
                : card.id
              : payer === people[0].id
                ? alexAcc.id
                : jordanAcc.id;
        push({
          date: day(d),
          amount: -Math.round(between(rule.amount[0], rule.amount[1]) * drift),
          accountId: account,
          categoryId: catId(rule.category),
          payee,
          note: '',
          paidBy: payer as string,
          splitRule: rule.split ?? 'even',
        });
      }
    }

    // A couple of seasonal one-offs so the trends are not flat.
    if (monthIndex === 4) push({ date: day(9), amount: -184000, accountId: card.id, categoryId: catId('Travel'), payee: 'Skyline Airways', note: 'Weekend trip', paidBy: 'joint', splitRule: 'even' });
    if (monthIndex === 7) push({ date: day(16), amount: -96000, accountId: joint.id, categoryId: catId('Home maintenance'), payee: 'Ace Plumbing', note: 'Water heater', paidBy: 'joint', splitRule: 'income' });
  });

  // A real ledger is a mixture: payees seen many times were learned confidently,
  // one-offs fell through to the fallback category and are worth a look, and a
  // few were filed by hand. Marking everything 'manual' would leave the review
  // queue permanently empty and misreport how the categories got there.
  const payeeCounts = new Map<string, number>();
  for (const t of transactions) {
    const key = t.payee.toLowerCase();
    payeeCounts.set(key, (payeeCounts.get(key) ?? 0) + 1);
  }
  for (const t of transactions) {
    if (t.transferId) continue;
    const seen = payeeCounts.get(t.payee.toLowerCase()) ?? 1;
    if (seen >= 6) {
      t.categorySource = 'learned';
      t.categoryConfidence = 0.94;
    } else if (seen >= 3) {
      t.categorySource = 'learned';
      t.categoryConfidence = 0.7;
    } else {
      t.categorySource = 'default';
      t.categoryConfidence = undefined;
    }
  }
  // Rent, salary and the loan payment are the ones anybody would have set
  // themselves.
  for (const t of transactions) {
    if (/Arrendamientos|Payroll|School District|Student Loans/i.test(t.payee)) {
      t.categorySource = 'manual';
      t.categoryConfidence = undefined;
    }
  }

  transactions.sort((x, y) => y.date.localeCompare(x.date));

  // Balances are derived, so back out each account's opening figure from the
  // balance we want it to show today.
  for (const account of accounts) {
    const moved = transactions
      .filter((t) => t.accountId === account.id)
      .reduce((total, t) => total + t.amount, 0);
    account.openingBalance = (targetBalances[account.id] ?? 0) - moved;
  }

  const goals: Goal[] = [
    { id: uid('g'), name: 'House down payment', kind: 'house', target: 9000000, saved: 3640000, targetDate: addMonths(currentMonth(), 26) + '-01', monthlyContribution: 95000, accountId: accounts[2].id, priority: 2, expectedReturn: 0.042, notes: '20% on a $450k home plus closing costs.', archived: false },
    { id: uid('g'), name: 'Emergency fund (6 months)', kind: 'emergency', target: 3000000, saved: 1180000, targetDate: addMonths(currentMonth(), 14) + '-01', monthlyContribution: 30000, accountId: accounts[1].id, priority: 1, expectedReturn: 0.041, notes: 'Six months of essentials for both of us.', archived: false },
    { id: uid('g'), name: 'Japan, spring 2027', kind: 'vacation', target: 950000, saved: 210000, targetDate: addMonths(currentMonth(), 15) + '-01', monthlyContribution: 25000, priority: 4, expectedReturn: 0.02, notes: 'Three weeks, shoulder season, business class one way.', archived: false },
    { id: uid('g'), name: 'Replace the Civic', kind: 'car', target: 2200000, saved: 380000, targetDate: addMonths(currentMonth(), 30) + '-01', monthlyContribution: 40000, priority: 3, expectedReturn: 0.04, notes: 'Buy used, pay cash, no new loan.', archived: false },
  ];

  const budget: BudgetLine[] = [];
  const plan: Record<string, number> = {
    'Rent / Mortgage': 268000, Utilities: 26000, 'Internet & Phone': 21000, Groceries: 72000,
    Restaurants: 45000, Coffee: 12000, 'Car payment': 43800, Fuel: 16000,
    'Transit & rideshare': 9000, 'Car insurance': 18400, 'Health insurance': 32000,
    'Pharmacy & care': 8000, Fitness: 5900, Shopping: 45000, Entertainment: 12000,
    'Personal care': 9000, Pets: 14000, 'Gifts & giving': 8000, 'Streaming & apps': 9000,
    'Debt payments': 55000, 'Savings transfer': 125000, Investments: 60000, Miscellaneous: 6000,
  };
  for (const month of [addMonths(currentMonth(), -1), currentMonth()]) {
    for (const [name, planned] of Object.entries(plan)) {
      budget.push({ month, categoryId: catId(name), planned, rollover: name === 'Home maintenance' });
    }
  }

  const netWorth = months.map((month, i) => ({
    month,
    assets: 30500000 + i * 420000,
    liabilities: 4600000 - i * 60000,
  }));

  return {
    ...base,
    settings: {
      ...base.settings,
      householdName: 'Alex & Jordan',
      onboarded: true,
      activePersonId: people[0].id,
    },
    rates: { EUR: { rate: EUR_RATE, updated: todayISO() } },
    people,
    accounts,
    transactions,
    goals,
    debts,
    budget,
    netWorth,
    retirement: {
      currentAge: { [people[0].id]: 34, [people[1].id]: 33 },
      retireAge: { [people[0].id]: 62, [people[1].id]: 62 },
      currentSavings: 23430000,
      monthlyContribution: 210000,
      expectedReturn: 0.065,
      inflation: 0.025,
      desiredAnnualSpend: 9600000,
      safeWithdrawalRate: 0.04,
    },
  };
}
