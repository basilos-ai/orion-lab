/** Shared, dependency-free locale state. Do not translate user or model content. */
export type Locale = 'zh-CN' | 'en-US';
export const localeStorageKey = 'orion-locale-v1';
const listeners = new Set<() => void>();
export function validLocale(value: unknown): value is Locale { return value === 'zh-CN' || value === 'en-US'; }
export function resolveLocale(query: unknown, saved: unknown, browser: unknown): Locale {
  if (validLocale(query)) return query;
  if (validLocale(saved)) return saved;
  return typeof browser === 'string' && /^zh(?:-|$)/i.test(browser) ? 'zh-CN' : 'en-US';
}
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  let saved: unknown;
  try { saved = JSON.parse(localStorage.getItem(localeStorageKey) || 'null'); } catch { /* Storage may be unavailable. */ }
  return resolveLocale(new URL(location.href).searchParams.get('lang'), saved, navigator.language);
}
let current: Locale = initialLocale();
export function getLocale() { return current; }
export function subscribeLocale(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function applyLocale() {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
function updateLocaleUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(location.href); url.searchParams.set('lang', current); history.replaceState(null, '', url);
}
export function setLocale(value: Locale) {
  if (!validLocale(value)) return;
  current = value; applyLocale();
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(localeStorageKey, JSON.stringify(value)); } catch { /* The in-memory choice still applies. */ }
    updateLocaleUrl();
  }
  listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') {
  applyLocale();
  window.addEventListener('storage', event => {
    if (event.key !== localeStorageKey) return;
    let next: unknown; try { next = JSON.parse(event.newValue || 'null'); } catch { return; }
    if (validLocale(next) && current !== next) { current = next; applyLocale(); updateLocaleUrl(); listeners.forEach(listener => listener()); }
  });
}
