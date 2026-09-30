export const TENANT_STATUS: Record<string, [string, string]> = {
  TRIAL: ['Trial', 'warn'], ACTIVE: ['Active', 'ok'], PAST_DUE: ['Payment failed', 'bad'], SUSPENDED: ['Suspended', 'neutral'], CANCELLED: ['Cancelled', 'neutral'],
};

export const TICKET_STATUS: Record<string, [string, string]> = {
  OPEN: ['Open', 'info'], WAITING_ON_CUSTOMER: ['Waiting on customer', 'warn'], PLANNED: ['Planned', 'info'], RESOLVED: ['Resolved', 'ok'], CLOSED: ['Closed', 'neutral'],
};

export const TYPE_LABEL: Record<string, string> = { PROBLEM: 'Problem', QUESTION: 'Question', FEATURE: 'Feature idea', BILLING: 'Billing' };
export const SEVERITY_LABEL: Record<string, string> = { BLOCKING: 'can’t work', SLOWS_DOWN: 'slows down', MINOR: 'minor' };
