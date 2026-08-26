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
npm test         # 154 tests over the domain logic
```

It installs as an app (service worker + manifest) and works fully offline —
appropriate for something whose data never leaves your device anyway.

The app opens on a demo household so every screen has something in it. When you
are ready, **Settings → Start from scratch** clears it and gives you an empty
ledger.

---

## What it does

### Track
- **Transactions** — add, edit, tag, search, filter and bulk-recategorize. Every
  entry records who paid, how the cost is shared, and whether it is pending,
  cleared or reconciled.
- **Import** — CSV, or better, **OFX/QFX/QIF**, which carry the bank's own
  transaction id so re-importing an overlapping statement is exact rather than
  guessed. Columns are detected automatically, payees you have categorized before
  are matched again, and your rules run over everything on the way in.
- **Rules** — match on payee text or regex, note, account, amount range or
  direction; set category, split, payer, tags, privacy, or rewrite a messy bank
  description into a readable payee. The editor previews exactly which existing
  transactions a rule would touch before you save it, and any transaction can
  seed a rule in one click.
- **Accounts, transfers and reconciliation** — balances are *derived* (opening
  balance plus every transaction), so the ledger and the balance can never
  disagree. Transfers are two mirrored legs that net to zero and are excluded
  from income and spending. Reconcile against a statement and the difference
  becomes one visible adjusting entry rather than a quietly rewritten balance.
- **Reports** — 6/12/24-month trends, every category with its own sparkline and
  trend percentage, biggest payees, spending by person, totals by tag.
- **Undo/redo** — 50 steps, Ctrl/Cmd+Z, with a transfer undoing as one step.

### Forecast
The question people actually open a budgeting app to ask: *will we make it to
payday?*

- Scheduled commitments carry a cadence (weekly through annual, including
  semimonthly) and are **proposed automatically** from detected recurring charges
  and from the pay pattern in your real income — accepted, not typed.
- The balance is projected **day by day** from what is in your spending accounts
  now, future-dated entries already recorded, and every scheduled item.
- Everyday spending is subtracted as a **daily drip** from your own three-month
  average, because a forecast built only from fixed bills is always too
  optimistic.
- **Safe-to-spend** is measured against the trough of the next 30 days, not the
  next payday — with a paycheck landing tomorrow, the payday measure would tell
  you to spend the rent.

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
- **Comment threads** on any transaction, attributed to whichever partner is
  using the app. "What was this?" belongs next to the transaction, not
  remembered wrong three weeks later.
- **Sign-offs** on discretionary purchases above a threshold you agree. Essential
  categories and scheduled bills are excluded — a queue full of rent would train
  you both to ignore it.
- **Private spending** hides its detail, not its total. Your partner still sees
  the amount, since it is shared money, but not the merchant. Hiding the amount
  would quietly corrupt every total in the app.
- **Money date** — a monthly review assembled from every engine in the app: three
  wins, three leaks, three things to decide together, one line each to read out
  loud. Copies to text, prints.

### Insights
Nine analyses of your own history, each stated as something to act on:

- **Fixed vs variable costs** — the share of income already spoken for is the
  real measure of how much room you have if an income stops.
- **Income volatility** sets your emergency-fund target: steady salaries need
  three months, lumpy income nine.
- **Anomalies** — category spikes against each category's own distribution,
  probable double charges, first-time merchants, trials that converted to full
  price.
- **Seasonality** — annual lumps turned into monthly sinking funds, creatable as
  rollover envelopes in one click.
- **Lifestyle creep** — compares halves of the year using medians, so one bonus
  cannot read as a pay rise then a pay cut.
- **Freedom metrics** — at a 4% withdrawal rate, this month's surplus bought you
  a countable number of days of not needing to work.
- **Net-worth attribution** — saved vs debt paid vs market, so a bad market month
  does not read as a personal failure.
- **Basket inflation** — paying more per visit is prices; going more often is
  habit. They need different responses.
- **Heatmaps** — when money leaves, by weekday and day of month.

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
  compounded projection for both partners, with a sensitivity table, plus a
  **Monte Carlo simulation**: a thousand runs with random annual returns, a
  success rate, percentile bands and the single worst run, because the order good
  and bad years arrive in matters more than the average.
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
- **Trends** always anchor on the last complete month. A window ending mid-month
  would otherwise read as a collapse in both income and spending.
- **Deduplication** prefers the source's own id (OFX FITID) and falls back to
  date, amount and payee — which is why Quicken formats are worth preferring over
  CSV.
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
    montecarlo.ts  seeded retirement simulation
    debt.ts        snowball / avalanche simulation
    analysis.ts    cost structure, volatility, anomalies, creep, freedom metrics
    forecast.ts    daily balance projection and safe-to-spend
    schedule.ts    cadences, occurrences, auto-proposed commitments
    rules.ts       matching and applying filing rules
    couples.ts     privacy, sign-offs, the money date report
    csv.ts         import parsing, column guessing, payee learning
    ofx.ts         OFX / QFX / QIF parsing
    sources.ts     provider-agnostic ingestion (files today, banks later)
  store/         types, reducer + undo history, migrations, selectors, demo data
  components/    UI primitives and hand-rolled SVG charts (no chart library)
  pages/         one file per screen
```

`src/lib` is pure TypeScript with no React import anywhere, which is why it can
be tested directly — 154 tests covering allocation, splits and settlement,
recurrence detection, debt strategies, projections, forecast cadences, rules
precedence, OFX/QIF parsing, statistics, Monte Carlo properties, and the reducer
including its v1→v2 migration.

Built with React, TypeScript and Vite. The only runtime dependencies are React
and React DOM — the charts, the mind-map canvas and the CSV parser are all local
code, so there is nothing to keep patched and nothing phoning home.

```bash
npm run dev        # dev server
npm run build      # typecheck + production build to dist/
npm run typecheck  # types only
npm test           # run the suite
npm run test:watch # watch mode
npm run preview    # serve the production build
```

## Connecting your banks

Short answer: you cannot do it from a browser, and for two people using this
privately you probably should not bother — file import plus SimpleFIN gets ~95%
of the value for about $18/year and no server.

[**BANKING.md**](./BANKING.md) covers the whole picture: why a backend is
unavoidable, the token-exchange flow, provider comparison, the operational
burden (expect 5–15% of connections to need reconnecting monthly), the PSD2 and
Section 1033 compliance position, and how `src/lib/sources.ts` is already
structured so adding a provider means writing one adapter rather than touching
the app.
