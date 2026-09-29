export const RESERVED_SLUGS = new Set([
  'api', 'login', 'logout', 'signup', 'forgot', 'reset', 'invite', 'select', 'account', 't', 'demo',
  'r', 'ops', 'partners', 'partner', '_next', 'static', 'assets', 'favicon.ico', 'robots.txt', 'health',
  'admin', 'www', 'app', 'help', 'support', 'billing', 'settings', 'about', 'pricing', 'terms', 'privacy',
  'status', 'docs', 'lockred', 'new',
]);

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}
