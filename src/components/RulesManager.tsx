import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { ID, Rule, SplitRule } from '../store/types';
import { blankRule, previewRule, runRules } from '../lib/rules';
import { Card, ConfirmButton, Empty, Field, Modal, MoneyInput, useToast } from './ui';

const SPLIT_LABEL: Record<SplitRule, string> = {
  even: 'Split evenly',
  income: 'Split by income',
  custom: 'Custom split',
  personal: 'One of us only',
};

export default function RulesManager() {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | null>(null);

  const rules = [...state.rules].sort((a, b) => a.order - b.order);

  const runAll = () => {
    const { changed, hits } = runRules(state.rules, state.transactions, state.people);
    if (!changed.length) {
      toast('Every transaction already matches your rules');
      return;
    }
    dispatch({ type: 'rule/apply', txs: changed });
    const busiest = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
    const name = state.rules.find((r) => r.id === busiest?.[0])?.name;
    toast(`Updated ${changed.length} transactions${name ? ` — "${name}" did the most work` : ''}`);
  };

  return (
    <Card
      title="Rules"
      hint="Rules run on import and on anything you type in. Later rules override earlier ones, so a broad rule plus a narrow exception works the way you would expect."
      actions={
        <div className="row gap-6">
          <button className="btn sm" onClick={runAll} disabled={!rules.length}>
            Apply to all history
          </button>
          <button
            className="btn primary sm"
            onClick={() => setEditing(blankRule(rules.length + 1))}
          >
            + Add rule
          </button>
        </div>
      }
    >
      {rules.length === 0 ? (
        <Empty
          icon="⚡"
          title="No rules yet"
          hint="A rule files transactions for you: anything from SAFEWAY becomes Groceries, split by income, tagged weekly. You can also make one straight from a transaction."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>On</th>
                <th>Rule</th>
                <th>When</th>
                <th>Then</th>
                <th className="right" style={{ width: 90 }}>Matches</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const hits = previewRule(rule, state).length;
                const cat = state.categories.find((c) => c.id === rule.set.categoryId);
                return (
                  <tr key={rule.id} style={rule.enabled ? undefined : { opacity: 0.5 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) =>
                          dispatch({ type: 'rule/update', id: rule.id, patch: { enabled: e.target.checked } })
                        }
                      />
                    </td>
                    <td className="small bold truncate">{rule.name}</td>
                    <td className="tiny faint">{describeMatch(rule, state.accounts, money)}</td>
                    <td className="tiny faint">
                      {[
                        cat && `→ ${cat.icon} ${cat.name}`,
                        rule.set.splitRule && SPLIT_LABEL[rule.set.splitRule],
                        rule.set.renamePayee && `rename to "${rule.set.renamePayee}"`,
                        rule.set.addTags?.length && `tag ${rule.set.addTags.join(' ')}`,
                        rule.set.private && 'mark private',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'does nothing yet'}
                    </td>
                    <td className="right num small">{hits}</td>
                    <td className="right">
                      <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn ghost sm"
                          title="Move up"
                          disabled={i === 0}
                          onClick={() => {
                            const above = rules[i - 1];
                            dispatch({ type: 'rule/update', id: rule.id, patch: { order: above.order } });
                            dispatch({ type: 'rule/update', id: above.id, patch: { order: rule.order } });
                          }}
                        >
                          ↑
                        </button>
                        <button className="btn ghost sm" onClick={() => setEditing(rule)}>
                          Edit
                        </button>
                        <ConfirmButton onConfirm={() => dispatch({ type: 'rule/remove', id: rule.id })}>
                          ✕
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RuleModal
          rule={editing}
          isNew={!state.rules.some((r) => r.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function describeMatch(
  rule: Rule,
  accounts: { id: ID; name: string }[],
  money: (c: number) => string,
): string {
  const parts: string[] = [];
  if (rule.match.payeeContains) parts.push(`payee has "${rule.match.payeeContains}"`);
  if (rule.match.payeeRegex) parts.push(`payee ~ /${rule.match.payeeRegex}/`);
  if (rule.match.noteContains) parts.push(`note has "${rule.match.noteContains}"`);
  if (rule.match.accountId)
    parts.push(`in ${accounts.find((a) => a.id === rule.match.accountId)?.name ?? 'account'}`);
  if (rule.match.minAmount !== undefined) parts.push(`≥ ${money(rule.match.minAmount)}`);
  if (rule.match.maxAmount !== undefined) parts.push(`≤ ${money(rule.match.maxAmount)}`);
  if (rule.match.direction) parts.push(rule.match.direction === 'in' ? 'money in' : 'money out');
  return parts.join(', ') || 'nothing — add a condition';
}

export function RuleModal({
  rule,
  isNew,
  onClose,
}: {
  rule: Rule;
  isNew: boolean;
  onClose: () => void;
}) {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<Rule>(rule);

  const setMatch = <K extends keyof Rule['match']>(k: K, v: Rule['match'][K]) =>
    setDraft((d) => ({ ...d, match: { ...d.match, [k]: v } }));
  const setAction = <K extends keyof Rule['set']>(k: K, v: Rule['set'][K]) =>
    setDraft((d) => ({ ...d, set: { ...d.set, [k]: v } }));

  const preview = useMemo(() => previewRule(draft, state), [draft, state]);

  return (
    <Modal
      title={isNew ? 'New rule' : draft.name}
      wide
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (isNew) dispatch({ type: 'rule/add', rule: draft });
              else dispatch({ type: 'rule/update', id: draft.id, patch: draft });
              toast(`Rule saved — it matches ${preview.length} existing transactions`);
              onClose();
            }}
          >
            Save rule
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      </Field>

      <div className="card-title">When a transaction…</div>
      <div className="field-row">
        <Field label="Payee contains">
          <input
            className="input"
            value={draft.match.payeeContains ?? ''}
            onChange={(e) => setMatch('payeeContains', e.target.value || undefined)}
          />
        </Field>
        <Field label="Payee matches regex" hint="Optional, case-insensitive">
          <input
            className="input"
            value={draft.match.payeeRegex ?? ''}
            onChange={(e) => setMatch('payeeRegex', e.target.value || undefined)}
          />
        </Field>
      </div>
      <div className="field-row three">
        <Field label="In account">
          <select
            className="select"
            value={draft.match.accountId ?? ''}
            onChange={(e) => setMatch('accountId', e.target.value || undefined)}
          >
            <option value="">Any account</option>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="At least">
          <MoneyInput
            value={draft.match.minAmount ?? 0}
            onChange={(c) => setMatch('minAmount', c || undefined)}
          />
        </Field>
        <Field label="At most">
          <MoneyInput
            value={draft.match.maxAmount ?? 0}
            onChange={(c) => setMatch('maxAmount', c || undefined)}
          />
        </Field>
      </div>
      <Field label="Direction">
        <select
          className="select"
          value={draft.match.direction ?? ''}
          onChange={(e) => setMatch('direction', (e.target.value || undefined) as 'in' | 'out' | undefined)}
        >
          <option value="">Either</option>
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </select>
      </Field>

      <div className="divider" />
      <div className="card-title">…do this</div>
      <div className="field-row">
        <Field label="Set category">
          <select
            className="select"
            value={draft.set.categoryId ?? ''}
            onChange={(e) => setAction('categoryId', e.target.value || undefined)}
          >
            <option value="">Leave alone</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Set split">
          <select
            className="select"
            value={draft.set.splitRule ?? ''}
            onChange={(e) => setAction('splitRule', (e.target.value || undefined) as SplitRule | undefined)}
          >
            <option value="">Leave alone</option>
            {(Object.keys(SPLIT_LABEL) as SplitRule[]).map((r) => (
              <option key={r} value={r}>
                {SPLIT_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row three">
        <Field label="Set payer">
          <select
            className="select"
            value={draft.set.paidBy ?? ''}
            onChange={(e) => setAction('paidBy', (e.target.value || undefined) as ID | 'joint' | undefined)}
          >
            <option value="">Leave alone</option>
            <option value="joint">Joint</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rename payee to" hint="Tidies up messy bank descriptions">
          <input
            className="input"
            value={draft.set.renamePayee ?? ''}
            onChange={(e) => setAction('renamePayee', e.target.value || undefined)}
          />
        </Field>
        <Field label="Add tags" hint="Space separated">
          <input
            className="input"
            value={draft.set.addTags?.join(' ') ?? ''}
            onChange={(e) =>
              setAction('addTags', e.target.value.split(/\s+/).filter(Boolean))
            }
          />
        </Field>
      </div>

      <div className={`callout ${preview.length ? '' : 'warn'}`}>
        Matches <span className="bold">{preview.length}</span> existing transactions
        {preview.length > 0 &&
          ` worth ${money(preview.reduce((a, t) => a + Math.abs(t.amount), 0))}`}
        .
      </div>

      {preview.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table className="table">
            <tbody>
              {preview.slice(0, 20).map((t) => (
                <tr key={t.id}>
                  <td className="small faint">{t.date}</td>
                  <td className="small truncate">{t.payee}</td>
                  <td className="right num small">{money(t.amount, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
