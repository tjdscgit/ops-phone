// Domain identity colours — a port of apps/web/src/lib/domain-colors.ts.
// Client-side only, keyed by normalised name; no DB column backs this.

const COLORS = {
  growing: '#3B6A52',
  market: '#8A6A2F',
  'books & compliance': '#2F5D8A',
  property: '#4A6B70',
  brewing: '#8A4B3C',
  personal: '#6B5B95',
};

export const DOMAIN_COLOR_FALLBACK = '#B6AFA4';

export function domainColor(name) {
  const key = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return COLORS[key] ?? DOMAIN_COLOR_FALLBACK;
}
