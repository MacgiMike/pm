'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { HEALTH, initials } from '@/lib/format';
import { I } from './icons';

// ---------------- Toasts ----------------
interface ToastMsg { id: number; text: string; error?: boolean }
const ToastCtx = createContext<{ show: (text: string, error?: boolean) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const show = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, error }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), error ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Wraps an async action: shows errors as toasts, optional success text, tracks busy state. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast.show(success);
        return r;
      } catch (e) {
        toast.show(errorText(e), true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

// ---------------- Dialogs ----------------
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ title, subtitle, onClose, children, footer, narrow }: {
  title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean;
}) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    el?.focus();
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <div className="row between top">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><I.X /></button>
          </div>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, kicker, onClose, children, footer }: {
  title: string; kicker?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="overlay drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <div className="row between top">
            <div className="col gap4">
              {kicker && <span className="small muted">{kicker}</span>}
              <h2>{title}</h2>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><I.X /></button>
          </div>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </aside>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel, danger, onConfirm, onClose }: {
  title: string; text: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? 'danger solid' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onClose(); } finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ lineHeight: 1.5, color: 'var(--text2)' }}>{text}</p>
    </Modal>
  );
}

// ---------------- Bits ----------------
export function HealthBadge({ health }: { health: string }) {
  const h = HEALTH[health] ?? { label: health, cls: 'neutral' };
  return <span className={`badge ${h.cls}`}>{h.label}</span>;
}

export function Bar({ value, mark, color, size }: { value: number; mark?: number | null; color?: string; size?: 'thin' | 'thick' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <span className={`bar ${size ?? ''}`} role="img" aria-label={`${Math.round(v)}%${mark != null ? `, plan ${Math.round(mark)}%` : ''}`}>
      <span className="fill" style={{ width: `${v}%`, background: color }} />
      {mark != null && <span className="mark" style={{ left: `calc(${Math.max(0, Math.min(100, mark))}% - 1px)` }} />}
    </span>
  );
}

export function Avatar({ name, guest, small, red }: { name?: string | null; guest?: boolean; small?: boolean; red?: boolean }) {
  return (
    <span className={`avatar ${small ? 'sm' : ''} ${guest ? 'guest' : ''} ${red ? 'red' : ''}`} title={name ?? undefined}>
      {initials(name)}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty" aria-busy="true">{label}</div>;
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="card pad col" role="alert">
      <strong>Couldn’t load this page</strong>
      <span className="muted">{errorText(error)}</span>
      {retry && <div><button className="btn sm" onClick={retry}>Try again</button></div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div style={{ maxWidth: 440, lineHeight: 1.5 }}>{children}</div>}
      {action}
    </div>
  );
}

/** Text that saves itself when you leave the field. */
export function InlineText({ value, onSave, placeholder, multiline, className, disabled, ariaLabel }: {
  value: string; onSave: (v: string) => Promise<unknown>; placeholder?: string; multiline?: boolean; className?: string; disabled?: boolean; ariaLabel: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const toast = useToast();
  const commit = async () => {
    if (v === value) return;
    try { await onSave(v); } catch (e) { toast.show(errorText(e), true); setV(value); }
  };
  if (multiline) {
    return <textarea className={`textarea ${className ?? ''}`} value={v} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={3} />;
  }
  return (
    <input className={`input ${className ?? ''}`} value={v} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

/** Number field that shows "2 100 000 kr" until focused, then the plain number. Saves on blur. */
export function MoneyInput({ value, onSave, currency, disabled, ariaLabel, className }: {
  value: number; onSave: (v: number) => Promise<unknown>; currency: string; disabled?: boolean; ariaLabel: string; className?: string;
}) {
  const [focus, setFocus] = useState(false);
  const [v, setV] = useState(String(value));
  useEffect(() => { if (!focus) setV(String(value)); }, [value, focus]);
  const toast = useToast();
  const fmt = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} ${currency === 'SEK' || currency === 'NOK' || currency === 'DKK' ? 'kr' : currency}`;
  return (
    <input className={`input money ${className ?? ''}`} aria-label={ariaLabel} disabled={disabled} inputMode="decimal"
      value={focus ? v : fmt(value)}
      onFocus={(e) => { setFocus(true); setV(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={async () => {
        setFocus(false);
        const n = Number(v.replace(/[\s\u202f]/g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) { toast.show('Enter an amount', true); return; }
        if (n === value) return;
        try { await onSave(n); } catch (err) { toast.show(errorText(err), true); }
      }} />
  );
}

export function download(path: string) {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function logout() {
  try { await api.post('/auth/logout'); } finally { window.location.href = '/login'; }
}
