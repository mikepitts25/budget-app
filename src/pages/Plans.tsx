import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { averageSurplus, categoryMap, liquidCash, monthSeries, runwayMonths, txInMonths } from '../store/selectors';
import { monthRange } from '../lib/date';
import { affordHouse, futureValue, loanPayment, monthsToTarget } from '../lib/projections';
import { totalMinimums } from '../lib/debt';
import { formatPercent, sum } from '../lib/money';
import { Card, Field, MoneyInput, PercentInput, Progress, Stat } from '../components/ui';
import { StackedBar, SERIES_COLORS } from '../components/charts';

export default function Plans() {
  const { state, money, month } = useApp();
  const grossIncome = sum(state.people.map((p) => p.annualIncome));
  const houseGoal = state.goals.find((g) => g.kind === 'house' && !g.archived);
  const surplus = averageSurplus(state, month, 3);

  return (
    <div className="col gap-16">
      <HouseScenario grossIncome={grossIncome} savedForHouse={houseGoal?.saved ?? 0} money={money} />
      <CarScenario money={money} />
      <LifeShock surplus={surplus} money={money} />
      <div className="tiny faint">
        Every scenario here starts from your real numbers: {money(grossIncome, { compact: true })} of household
        income, {money(surplus)} of average monthly surplus, {money(totalMinimums(state.debts))} of debt minimums.
      </div>
    </div>
  );
}

type Money = (cents: number, opts?: { compact?: boolean; sign?: boolean }) => string;

function HouseScenario({
  grossIncome,
  savedForHouse,
  money,
}: {
  grossIncome: number;
  savedForHouse: number;
  money: Money;
}) {
  const { state } = useApp();
  const [downPayment, setDown] = useState(savedForHouse || 5000000);
  const [apr, setApr] = useState(0.0625);
  const [termYears, setTerm] = useState(30);
  const [taxRate, setTaxRate] = useState(0.011);
  const [insurance, setInsurance] = useState(180000);
  const [hoa, setHoa] = useState(0);
  const [frontRatio, setFrontRatio] = useState(0.28);

  const otherDebt = totalMinimums(state.debts);
  const result = useMemo(
    () =>
      affordHouse({
        grossAnnualIncome: grossIncome,
        downPayment,
        apr,
        termYears,
        propertyTaxRate: taxRate,
        insuranceAnnual: insurance,
        hoaMonthly: hoa,
        otherDebtMonthly: otherDebt,
        maxHousingRatio: frontRatio,
        maxTotalDebtRatio: 0.36,
      }),
    [grossIncome, downPayment, apr, termYears, taxRate, insurance, hoa, otherDebt, frontRatio],
  );

  const tax = Math.round((result.maxPrice * taxRate) / 12);
  const ins = Math.round(insurance / 12);
  const goal = state.goals.find((g) => g.kind === 'house' && !g.archived);
  const eta = goal
    ? monthsToTarget(goal.saved, goal.monthlyContribution, goal.expectedReturn, downPayment)
    : null;

  return (
    <Card
      title="Can we afford a house?"
      hint="Back-solved from your income, your debts and the down payment you have — not from a listing price."
    >
      <div className="grid side">
        <div className="col gap-16">
          <div className="grid cols-3">
            <Stat label="Price you can carry" value={money(result.maxPrice, { compact: true })} icon="🏠" />
            <Stat label="Monthly, all in" value={money(result.monthlyTotal, { compact: true })} sub="P&I, tax, insurance, HOA" icon="📆" />
            <Stat
              label="Loan needed"
              value={money(result.loanAmount, { compact: true })}
              sub={`${formatPercent(result.maxPrice ? downPayment / result.maxPrice : 0, 0)} down`}
              icon="🏦"
            />
          </div>

          <div>
            <div className="row small mb-8">
              <span>Where the monthly payment goes</span>
              <span className="spacer" />
              <span className="num">{money(result.monthlyTotal)}</span>
            </div>
            <StackedBar
              parts={[
                { label: 'Principal & interest', value: result.monthlyPI, color: SERIES_COLORS[0] },
                { label: 'Property tax', value: tax, color: SERIES_COLORS[2] },
                { label: 'Insurance', value: ins, color: SERIES_COLORS[1] },
                { label: 'HOA', value: hoa, color: SERIES_COLORS[4] },
              ]}
              format={(n) => money(n)}
              height={18}
            />
            <div className="legend mt-8">
              {[
                ['Principal & interest', result.monthlyPI, SERIES_COLORS[0]],
                ['Property tax', tax, SERIES_COLORS[2]],
                ['Insurance', ins, SERIES_COLORS[1]],
                ['HOA', hoa, SERIES_COLORS[4]],
              ].map(([label, value, color]) => (
                <span className="legend-item" key={String(label)}>
                  <span className="dot" style={{ background: String(color) }} />
                  {String(label)} · {money(Number(value))}
                </span>
              ))}
            </div>
          </div>

          <div className="callout">
            That payment is {formatPercent(result.frontRatio, 0)} of gross income; with your existing debt
            minimums of {money(otherDebt)} the total debt load is {formatPercent(result.backRatio, 0)}.
            Lenders usually stop around 28% and 36%.
            {downPayment / Math.max(1, result.maxPrice) < 0.2 &&
              ' Below 20% down you will also be paying mortgage insurance, which is not modelled here.'}
          </div>

          {goal && (
            <div className={`callout ${eta === 0 ? 'good' : ''}`}>
              Your house fund holds {money(goal.saved)} and grows by {money(goal.monthlyContribution)} a month.{' '}
              {eta === null
                ? 'At that rate it never reaches this down payment — raise the contribution or lower the target.'
                : eta === 0
                  ? 'You already have this down payment saved.'
                  : `You reach ${money(downPayment)} in about ${Math.floor(eta / 12)}y ${eta % 12}m.`}
            </div>
          )}
        </div>

        <div className="col gap-6">
          <Field label="Down payment">
            <MoneyInput value={downPayment} onChange={setDown} />
          </Field>
          <div className="field-row">
            <Field label="Mortgage rate">
              <PercentInput value={apr} onChange={setApr} step={0.05} />
            </Field>
            <Field label="Term (years)">
              <input
                className="input num"
                type="number"
                value={termYears}
                onChange={(e) => setTerm(Number(e.target.value) || 30)}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Property tax rate">
              <PercentInput value={taxRate} onChange={setTaxRate} step={0.05} />
            </Field>
            <Field label="Insurance / year">
              <MoneyInput value={insurance} onChange={setInsurance} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="HOA / month">
              <MoneyInput value={hoa} onChange={setHoa} />
            </Field>
            <Field label="Max housing ratio" hint="Share of gross income">
              <PercentInput value={frontRatio} onChange={setFrontRatio} step={1} />
            </Field>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CarScenario({ money }: { money: Money }) {
  const [price, setPrice] = useState(2800000);
  const [down, setDown] = useState(500000);
  const [apr, setApr] = useState(0.069);
  const [years, setYears] = useState(5);
  const [investReturn, setInvestReturn] = useState(0.065);

  const loan = Math.max(0, price - down);
  const payment = loanPayment(loan, apr, years);
  const totalPaid = payment * years * 12 + down;
  const interest = totalPaid - price;
  // Paying cash frees the payment for investing; financing frees the cash instead.
  const investedIfCash = futureValue(0, payment, investReturn, years * 12);
  const investedIfFinanced = futureValue(price - down, 0, investReturn, years * 12);

  return (
    <Card title="Finance the car, or pay cash?" hint="The honest comparison is against what the money would otherwise earn.">
      <div className="grid side">
        <div className="col gap-16">
          <div className="grid cols-3">
            <Stat label="Monthly payment" value={money(payment)} sub={`${years} years at ${formatPercent(apr)}`} icon="🚗" />
            <Stat label="Interest cost" value={money(interest, { compact: true })} tone="neg" sub={`${money(totalPaid, { compact: true })} paid in total`} icon="💸" />
            <Stat
              label="Better option"
              value={investedIfCash >= investedIfFinanced ? 'Pay cash' : 'Finance'}
              tone={investedIfCash >= investedIfFinanced ? 'pos' : 'none'}
              sub={`by ${money(Math.abs(investedIfCash - investedIfFinanced), { compact: true })} after ${years} years`}
              icon="⚖️"
            />
          </div>
          <div className="callout">
            Pay cash and you invest the {money(payment)} payment instead — {money(investedIfCash, { compact: true })}{' '}
            after {years} years. Finance and you keep {money(price - down)} invested —{' '}
            {money(investedIfFinanced, { compact: true })}. Financing only wins when your return beats the
            loan rate, and here the loan costs {formatPercent(apr)} against a {formatPercent(investReturn)} return.
          </div>
        </div>
        <div className="col gap-6">
          <Field label="Car price">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Down payment">
            <MoneyInput value={down} onChange={setDown} />
          </Field>
          <div className="field-row">
            <Field label="Loan rate">
              <PercentInput value={apr} onChange={setApr} step={0.1} />
            </Field>
            <Field label="Term (years)">
              <input className="input num" type="number" value={years} onChange={(e) => setYears(Number(e.target.value) || 1)} />
            </Field>
          </div>
          <Field label="If invested instead">
            <PercentInput value={investReturn} onChange={setInvestReturn} step={0.1} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function LifeShock({ surplus, money }: { surplus: number; money: Money }) {
  const { state, month } = useApp();
  const cats = categoryMap(state);
  const [incomeDrop, setIncomeDrop] = useState(0.3);
  const [newCost, setNewCost] = useState(140000);
  const [dropMonths, setDropMonths] = useState(6);

  const recent = monthSeries(state, month, 3);
  const avgIncome = Math.round(sum(recent.map((r) => r.income)) / 3);
  const essential = Math.round(
    sum(
      txInMonths(state, monthRange(month, 3))
        .filter((t) => t.amount < 0 && cats[t.categoryId]?.essential)
        .map((t) => Math.abs(t.amount)),
    ) / 3,
  );

  const lostIncome = Math.round(avgIncome * incomeDrop);
  const newSurplus = surplus - lostIncome - newCost;
  const runway = runwayMonths(state, month);
  const liquid = liquidCash(state);
  const burn = Math.max(0, -newSurplus);
  const newRunway = burn > 0 ? liquid / burn : Infinity;
  const totalCost = (lostIncome + newCost) * dropMonths;

  return (
    <Card
      title="What if life changes?"
      hint="A baby, a career break, one income pausing — model it before it happens, not after."
    >
      <div className="grid side">
        <div className="col gap-16">
          <div className="grid cols-3">
            <Stat
              label="Monthly surplus after"
              value={money(newSurplus)}
              tone={newSurplus >= 0 ? 'pos' : 'neg'}
              sub={`Today it is ${money(surplus)}`}
              icon="🌊"
            />
            <Stat
              label="Cost of the change"
              value={money(totalCost, { compact: true })}
              sub={`Over ${dropMonths} months`}
              icon="🧮"
            />
            <Stat
              label="Savings runway"
              value={newRunway === Infinity ? 'Sustainable' : `${newRunway.toFixed(1)} mo`}
              tone={newRunway >= 6 ? 'pos' : 'neg'}
              sub={`Today ${runway.toFixed(1)} months of essentials`}
              icon="🛟"
            />
          </div>

          <div>
            <div className="row small mb-8">
              <span>Cushion against the new burn rate</span>
              <span className="spacer" />
              <span className="num">{money(liquid, { compact: true })} liquid</span>
            </div>
            <Progress
              value={newRunway === Infinity ? 1 : newRunway / 12}
              tone={newRunway >= 6 ? 'good' : newRunway >= 3 ? 'warn' : 'bad'}
            />
          </div>

          <div className={`callout ${newSurplus >= 0 ? 'good' : 'warn'}`}>
            {newSurplus >= 0
              ? `You would still clear ${money(newSurplus)} a month. This change is affordable as things stand.`
              : `You would run ${money(-newSurplus)} short every month, drawing down savings. Covering ${dropMonths} months needs ${money(-newSurplus * dropMonths)} set aside, on top of your emergency fund of ${money(essential * 3)}.`}
          </div>
        </div>

        <div className="col gap-6">
          <Field label={`Income drops by ${formatPercent(incomeDrop, 0)}`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(incomeDrop * 100)}
              onChange={(e) => setIncomeDrop(Number(e.target.value) / 100)}
            />
          </Field>
          <Field label="New recurring cost" hint="Childcare, a bigger mortgage, care for a parent">
            <MoneyInput value={newCost} onChange={setNewCost} />
          </Field>
          <Field label="For how many months">
            <input
              className="input num"
              type="number"
              min={1}
              value={dropMonths}
              onChange={(e) => setDropMonths(Number(e.target.value) || 1)}
            />
          </Field>
          <p className="tiny faint">
            Based on {money(avgIncome)} average monthly income and {money(essential)} of essential spending.
          </p>
        </div>
      </div>
    </Card>
  );
}
