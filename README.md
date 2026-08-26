# Two Ledgers

A budgeting and life-planning app built for **two people**, not one. It tracks
what you spend and earn, keeps the money side of a relationship honest, finds
savings in your own transaction history, and lets you plan out loud — a house, a
car, a baby, a trip, retirement — on a mind map that is wired to your actual
goals.

Everything runs in the browser. There is no account, no server, and no bank
connection: your financial history stays on your machine.

```bash
npm install
npm run dev      # http://localhost:5173
```

The app opens on a demo household so every screen has something in it. When you
are ready, **Settings → Start from scratch** clears it and gives you an empty
ledger.

---

## What it does

### Track
- **Transactions** — add, edit, tag, search, filter and bulk-recategorize. Every
  entry records who paid and how the cost is shared.
- **CSV import** — drop in a bank export. Columns are detected automatically,
  duplicates are skipped, and payees you have categorized before are matched to
  the same category again.
- **Accounts and net worth** — checking, savings, cards, investments, retirement,
  property and loans, with monthly snapshots and a net-worth chart.
- **Reports** — 6/12/24-month trends, every category with its own sparkline and
  trend percentage, biggest payees, spending by person, totals by tag.

### Budget
- **Envelopes per month**, grouped by category, with planned vs actual, pace
  colouring, optional rollover, and a to-assign figure for zero-based budgeting.
- **Copy last month** or **suggest from history** — envelopes filled from your own
  three-month averages rather than a generic template.

### Together — the couples half
- **Who paid what** against **what each of you owed**, under the split rule on each
  transaction: evenly, in proportion to income, custom percentages, or personal.
- **Settle up** in the fewest possible transfers, with a copyable summary.
- Balance-between-you tracked over time, contribution history, who carries which
  category, and a personal-spending comparison for couples who run an allowance.

### Find savings
Every finding is derived from your own data and carries a number:
- **Subscriptions** detected from repeated payees at a steady cadence and price —
  including price creep, lapsed series, and overlapping services in one category.
- **Habits** — small frequent purchases, categories running hot against their own
  average, weekend spending skew, discretionary share of income.
- **Rates** — idle cash beyond your buffer, cash sitting still while high-APR debt
  compounds, balance-transfer candidates, bank fees.
- **Structure** — thin emergency runway, envelopes that never get used, surplus
  that is not pointed at any goal.

Each suggestion can be redirected straight into a goal, or dismissed. The page
also shows what the freed-up money becomes if it is invested instead of spent.

### Plan
- **Goals** — house, car, travel, emergency fund, wedding, baby, whatever. Each one
  gets a required monthly contribution, a projection, an ETA at the current pace,
  and a one-click "fund to target". A priority waterfall shows where surplus goes.
- **Mind map** — a pan/zoom canvas for thinking about the life you are building.
  Drag nodes, connect them, attach cost estimates, and link a node to a goal so
  live progress shows on the canvas. Templates for buying a house, starting a
  family, retiring early and the big trip.
- **Scenarios** — what house price your income and debts actually support (back-
  solved, not guessed); financing a car versus paying cash including the
  opportunity cost; and a life-shock model for an income drop plus a new recurring
  cost, against your real runway.
- **Retirement** — your number, inflated to your retirement year, against a
  compounded projection for both partners, with a sensitivity table.
- **Debt payoff** — snowball against avalanche, month by month, with the interest
  each one costs and the interest both save against paying minimums.

---

## How the numbers work

No black boxes — the same notes are in the app, at the bottom of Settings.

- **Money** is stored as whole cents. Splits use largest-remainder allocation, so a
  three-way split of a penny still adds up.
- **Splitting.** Even splits halve shared costs; income splits divide them in
  proportion to gross income. Joint-account spending is treated as funded by both
  partners in that same proportion. Settlements match the largest debtor to the
  largest creditor, so nobody makes more than one payment.
- **Savings transfers are not spending.** Money moved into savings or investments
  is excluded from consumption, so a disciplined month does not read as an
  expensive one.
- **Subscriptions.** A payee is recurring when it has charged at least three times,
  with 70% of gaps within 25% of the median gap and 80% of amounts within 15% of
  the median amount.
- **Goals and retirement** compound monthly at the return you set. "Needs" is the
  contribution that lands exactly on the target on the target date.
- **Debt.** Interest accrues monthly before payments land. Freed-up minimums roll
  into the next debt under both strategies.

Projections are straight-line arithmetic, not forecasts. Real markets are lumpy —
revisit the assumptions once a year rather than trusting a number to the dollar.

---

## Your data

State lives in `localStorage` under `two-ledgers:v1` and is written a quarter of a
second after every change. Nothing is transmitted anywhere.

That also means clearing your browser clears your budget, so **Settings → Download
backup** writes the whole household to a JSON file you can restore on any machine.
Transactions also export to CSV from the Transactions page.

---

## Layout

```
src/
  lib/           domain logic, no React
    money.ts       cents, formatting, largest-remainder allocation
    date.ts        month arithmetic
    split.ts       share weights, fairness, settlement matching
    recurring.ts   subscription detection
    savings.ts     the savings finder
    projections.ts compounding, goals, retirement, affordability
    debt.ts        snowball / avalanche simulation
    csv.ts         import parsing, column guessing, payee learning
  store/         types, reducer, persistence, selectors, demo data
  components/    UI primitives and hand-rolled SVG charts (no chart library)
  pages/         one file per screen
```

Built with React, TypeScript and Vite. The only runtime dependencies are React
and React DOM — the charts, the mind-map canvas and the CSV parser are all local
code, so there is nothing to keep patched and nothing phoning home.

```bash
npm run dev        # dev server
npm run build      # typecheck + production build to dist/
npm run typecheck  # types only
npm run preview    # serve the production build
```
