import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export function Card({
  title,
  hint,
  actions,
  children,
  className = '',
  style,
}: {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <div className="card-title">{title}</div>}
            {hint && <div className="card-hint">{hint}</div>}
          </div>
          <div className="spacer" />
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'pos' | 'neg' | 'none';
  icon?: string;
}) {
  return (
    <section className="card">
      <div className="row">
        <div className="stat-label">{label}</div>
        <div className="spacer" />
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      </div>
      <div className={`stat-value ${tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="tiny faint">{hint}</span>}
    </label>
  );
}

/** Text input bound to a cents value, edited in whole currency units. */
export function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (cents: number) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(() => (value ? (value / 100).toFixed(2) : ''));
  const [focused, setFocused] = useState(false);
  // While the field is not focused it mirrors the store; while focused the user owns it.
  React.useEffect(() => {
    if (!focused) setText(value ? (value / 100).toFixed(2) : '');
  }, [value, focused]);

  return (
    <input
      className="input num"
      inputMode="decimal"
      placeholder={placeholder ?? '0.00'}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(value ? (value / 100).toFixed(2) : '');
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseFloat(raw.replace(/[^0-9.-]/g, ''));
        onChange(isFinite(n) ? Math.round(n * 100) : 0);
      }}
    />
  );
}

/** Percentage input that stores a decimal (0.065) and shows a percent (6.5). */
export function PercentInput({
  value,
  onChange,
  step = 0.1,
}: {
  value: number;
  onChange: (decimal: number) => void;
  step?: number;
}) {
  return (
    <input
      className="input num"
      type="number"
      step={step}
      value={Number((value * 100).toFixed(2))}
      onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(940px, 100%)' } : undefined} role="dialog">
        <header className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Progress({
  value,
  tone,
  thin,
}: {
  value: number;
  tone?: 'good' | 'warn' | 'bad';
  thin?: boolean;
}) {
  return (
    <div className={`bar ${thin ? 'thin' : ''}`}>
      <span className={tone ?? ''} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Empty({
  icon = '🗂️',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="bold">{title}</div>
      {hint && <div className="small mt-8">{hint}</div>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  );
}

export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="avatar" style={{ background: color }} title={name}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ------------------------------- toasts --------------------------------- */

interface Toast {
  id: number;
  message: string;
}
const ToastCtx = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Confirm-once destructive button: the second click within 3s commits. */
export function ConfirmButton({
  onConfirm,
  children,
  className = 'btn danger sm',
  confirmLabel = 'Sure?',
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  className?: string;
  confirmLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
