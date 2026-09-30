const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n: number | null | undefined, currency = 'SEK'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const s = Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sym = currency === 'SEK' || currency === 'NOK' || currency === 'DKK' ? 'kr' : currency;
  return `${s} ${sym}`;
}

export function compactMoney(n: number | null | undefined, currency = 'SEK'): string {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace('.', ',')} M ${currency === 'SEK' ? 'kr' : currency}`;
  return money(n, currency);
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n)}%`;
}

/** 'YYYY-MM-DD' or ISO → '14 Oct' (adds year if not this year) */
export function shortDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s.length === 10 ? `${s}T12:00:00Z` : s) : s;
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${sameYear ? '' : ` ${d.getUTCFullYear()}`}`;
}

export function longDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s.length === 10 ? `${s}T12:00:00Z` : s) : s;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const target = new Date(`${s.slice(0, 10)}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function relDays(s: string | null | undefined): string {
  const n = daysUntil(s);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function timeAgo(s: string | Date | null | undefined): string {
  if (!s) return 'never';
  const d = typeof s === 'string' ? new Date(s) : s;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `today ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${hm}`;
  if (sec < 30 * 86400) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const HEALTH: Record<string, { label: string; cls: string }> = {
  ON_TRACK: { label: 'On track', cls: 'ok' },
  AT_RISK: { label: 'At risk', cls: 'warn' },
  BEHIND: { label: 'Behind', cls: 'bad' },
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  COLEAD: 'Co-lead',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
  ADMIN: 'Admin',
  MANAGER: 'Portfolio manager',
  MEMBER: 'Member',
};

/** Hours-weighted average used for live "what if" previews (mirrors the API). */
export function weighted(items: { progress: number; hours: number | null }[]): number {
  const w = (h: number | null) => (h && h > 0 ? h : 1);
  const total = items.reduce((s, i) => s + w(i.hours), 0);
  if (!total) return 0;
  return Math.round((items.reduce((s, i) => s + i.progress * w(i.hours), 0) / total) * 10) / 10;
}
