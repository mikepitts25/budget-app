import { useMemo } from 'react';
import { useApp } from '../store/store';
import { buildMoneyDate, moneyDateText } from '../lib/couples';
import { monthLabel } from '../lib/date';
import { Card, Stat, useToast } from '../components/ui';
import { monthSummary } from '../store/selectors';

export default function MoneyDate() {
  const { state, money, month } = useApp();
  const toast = useToast();
  const report = useMemo(() => buildMoneyDate(state, month), [state, month]);
  const summary = monthSummary(state, month);

  return (
    <div className="col gap-16">
      <Card
        title={`Money date — ${monthLabel(month, 'long')}`}
        hint="Twenty minutes, once a month, both of you. Three things that went well, three that leaked, three to decide together."
        actions={
          <div className="row gap-6">
            <button
              className="btn sm"
              onClick={() => {
                navigator.clipboard?.writeText(moneyDateText(state, report));
                toast('Report copied');
              }}
            >
              Copy
            </button>
            <button className="btn sm" onClick={() => window.print()}>
              Print
            </button>
          </div>
        }
      >
        <div className="stat-value" style={{ fontSize: 28 }}>
          {report.headline}
        </div>
        <div className="grid cols-4 mt-16">
          <Stat label="Came in" value={money(summary.income, { compact: true })} icon="💰" />
          <Stat label="Went out" value={money(summary.expense, { compact: true })} icon="🧾" />
          <Stat
            label="Moved to savings"
            value={money(summary.transfers, { compact: true })}
            tone="pos"
            icon="🐖"
          />
          <Stat
            label="Savings rate"
            value={`${Math.round(summary.savingsRate * 100)}%`}
            tone={summary.savingsRate >= state.settings.savingsRateTarget ? 'pos' : 'neg'}
            icon="🎯"
          />
        </div>
      </Card>

      <div className="grid cols-3">
        <Section
          title="What went well"
          icon="✅"
          tone="good"
          items={report.wins}
          empty="Nothing stood out this month — which is not the same as nothing going right."
          money={money}
        />
        <Section
          title="Where it leaked"
          icon="🕳️"
          tone="warn"
          items={report.leaks}
          empty="No leaks found. Enjoy it."
          money={money}
        />
        <Section
          title="Decide together"
          icon="🤝"
          tone="accent"
          items={report.decisions}
          empty="Nothing needs a joint decision this month."
          money={money}
        />
      </div>

      <Card title="Read these out loud" hint="One line each, so neither of you is guessing">
        {report.perPerson.map((p) => {
          const person = state.people.find((x) => x.id === p.personId);
          return (
            <div key={p.personId} className="list-row">
              <span className="dot" style={{ background: person?.color }} />
              <span className="small">{p.line}</span>
            </div>
          );
        })}
        <div className="callout mt-16 small">
          The point of doing this together is that neither of you is the household accountant. Both of you
          having seen the same numbers is worth more than either of you having optimised them.
        </div>
      </Card>
    </div>
  );
}

function Section({
  title,
  icon,
  tone,
  items,
  empty,
  money,
}: {
  title: string;
  icon: string;
  tone: 'good' | 'warn' | 'accent';
  items: { title: string; detail: string; amount?: number }[];
  empty: string;
  money: (c: number, o?: { compact?: boolean }) => string;
}) {
  return (
    <Card title={`${icon} ${title}`}>
      {items.length === 0 ? (
        <div className="small faint">{empty}</div>
      ) : (
        <div className="col gap-16">
          {items.map((item, i) => (
            <div key={i} className={`callout ${tone === 'accent' ? '' : tone}`}>
              <div className="bold small">{item.title}</div>
              <div className="tiny muted mt-8">{item.detail}</div>
              {item.amount !== undefined && item.amount > 0 && (
                <div className="tiny bold mt-8">{money(item.amount)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
