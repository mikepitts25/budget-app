import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { Transaction } from '../store/types';
import { acceptLabel, correctLabel, explainLabel, reviewQueue, similarTransactions } from '../lib/labels';
import { ruleFromTransaction } from '../lib/rules';
import { dateLabel, monthLabel } from '../lib/date';
import { Card, Progress, useToast } from './ui';
import { RuleModal } from './RulesManager';

/**
 * The queue of things the app decided on its own. Correcting one has to be a
 * single click, or nobody will ever do it and the guesses quietly become the
 * record.
 */
export default function LabelReview() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [makingRule, setMakingRule] = useState<import('../store/types').Rule | null>(null);

  const queue = useMemo(() => reviewQueue(state, month), [state, month]);
  const items = queue.items.filter((t) => !dismissed.has(t.id)).slice(0, 8);

  if (queue.automatic === 0) return null;

  const accept = (tx: Transaction) => {
    dispatch({ type: 'tx/update', id: tx.id, patch: acceptLabel(tx) });
    setDismissed((d) => new Set(d).add(tx.id));
  };

  const correct = (tx: Transaction, categoryId: string) => {
    const others = similarTransactions(state, tx, categoryId);
    dispatch({ type: 'tx/update', id: tx.id, patch: correctLabel(tx, categoryId) });
    setDismissed((d) => new Set(d).add(tx.id));

    if (others.length) {
      dispatch({
        type: 'rule/apply',
        txs: others.map((t) => correctLabel(t, categoryId)),
      });
      toast(
        `Fixed ${tx.payee} and ${others.length} other ${
          others.length === 1 ? 'transaction' : 'transactions'
        } from the same payee`,
      );
    } else {
      toast(`${tx.payee} recategorized`);
    }
  };

  const accuracy = queue.automatic ? queue.byCertainty.high / queue.automatic : 0;

  return (
    <Card
      title="Check what was filed automatically"
      hint={`${queue.automatic} transactions in ${monthLabel(month, 'long')} were categorized by the app rather than by either of you. These are the ones it was least sure about.`}
      actions={
        items.length > 0 && (
          <button
            className="btn sm"
            onClick={() => {
              for (const tx of items) accept(tx);
              toast(`Accepted ${items.length} categories`);
            }}
          >
            Accept all shown
          </button>
        )
      }
    >
      <div className="row small mb-8">
        <span className="faint">Confident matches</span>
        <span className="spacer" />
        <span className="num">
          {queue.byCertainty.high} of {queue.automatic}
        </span>
      </div>
      <Progress value={accuracy} tone={accuracy > 0.8 ? 'good' : accuracy > 0.5 ? 'warn' : 'bad'} thin />

      {items.length === 0 ? (
        <div className="callout good mt-16 small">
          Nothing left to review this month. {queue.byCertainty.high} categories were matched confidently
          and are being taken on trust — open any transaction to see why it was filed the way it was.
        </div>
      ) : (
        <div className="col gap-6 mt-16">
          {items.map((tx) => {
            const why = explainLabel(state, tx);
            const others = state.transactions.filter(
              (t) => t.id !== tx.id && t.payee.toLowerCase() === tx.payee.toLowerCase(),
            ).length;
            return (
              <div key={tx.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row gap-6">
                    <span className="small bold truncate">{tx.payee}</span>
                    <span className="tiny faint">{dateLabel(tx.date)}</span>
                    <span className="small num">
                      {money(tx.amount, { sign: true, currency: tx.currency })}
                    </span>
                  </div>
                  <div className="tiny faint">
                    {why.label} · {why.detail}
                    {others > 0 && ` · ${others} others from this payee`}
                  </div>
                </div>
                <select
                  className="select"
                  style={{ maxWidth: 190 }}
                  value={tx.categoryId}
                  onChange={(e) => correct(tx, e.target.value)}
                >
                  {state.categories
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                </select>
                <button className="btn sm" onClick={() => accept(tx)} title="Confirm this is right">
                  ✓
                </button>
                <button
                  className="btn ghost sm"
                  title="Always file this payee this way"
                  onClick={() => setMakingRule(ruleFromTransaction(tx, state.rules.length + 1))}
                >
                  ⚡
                </button>
              </div>
            );
          })}
        </div>
      )}

      {makingRule && <RuleModal rule={makingRule} isNew onClose={() => setMakingRule(null)} />}
    </Card>
  );
}
