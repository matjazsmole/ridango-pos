/** Formatting helpers (currency, clock). */

/** Minor units (öre/cents) → localised currency string, e.g. 3300 SEK → "33,00 kr". */
export function formatPrice(amount, currency = 'SEK', locale = 'sv-SE') {
  if (amount == null || Number.isNaN(amount)) return '';
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** "13:01 · 5 Mar 2026" */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatClock(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
