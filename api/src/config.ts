function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

export const config = {
  port: int('PORT', 47814),
  appUrl: str('APP_URL', 'http://localhost:47813').replace(/\/$/, ''),
  appSecret: str('APP_SECRET', 'dev-secret-change-me'),
  databaseUrl: str('DATABASE_URL'),
  appDatabaseUrl: str('APP_DATABASE_URL', str('DATABASE_URL')),
  uploadDir: str('UPLOAD_DIR', './uploads'),
  backupDir: str('BACKUP_DIR', ''),
  timezone: str('TZ', 'Europe/Stockholm'),
  secureCookies: str('APP_URL', '').startsWith('https://'),
  operatorEmail: str('OPERATOR_EMAIL').toLowerCase(),
  operatorPassword: str('OPERATOR_PASSWORD'),
  operatorRequireMfa: str('OPERATOR_REQUIRE_MFA', 'true') !== 'false',
  opsNotifyEmail: str('OPS_NOTIFY_EMAIL'),
  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    secure: str('SMTP_SECURE', 'false') === 'true',
    from: str('MAIL_FROM', 'Lockred <no-reply@lockred.app>'),
  },
  stripe: {
    secretKey: str('STRIPE_SECRET_KEY'),
    webhookSecret: str('STRIPE_WEBHOOK_SECRET'),
    prices: {
      STARTER: str('STRIPE_PRICE_STARTER'),
      TEAM: str('STRIPE_PRICE_TEAM'),
      BUSINESS: str('STRIPE_PRICE_BUSINESS'),
    } as Record<'STARTER' | 'TEAM' | 'BUSINESS', string>,
  },
  trialDays: int('TRIAL_DAYS', 14),
  trialSeats: int('TRIAL_SEATS', 10),
  affiliate: {
    commissionPercent: int('AFFILIATE_COMMISSION_PERCENT', 20),
    commissionMonths: int('AFFILIATE_COMMISSION_MONTHS', 12),
    cookieDays: int('AFFILIATE_COOKIE_DAYS', 60),
  },
  sessionCookie: 'lr_session',
  refCookie: 'lr_ref',
  uploadMaxBytes: int('UPLOAD_MAX_BYTES', 25 * 1024 * 1024),
  disableCron: str('DISABLE_CRON', 'false') === 'true',
};

export const stripeEnabled = () => !!config.stripe.secretKey;
