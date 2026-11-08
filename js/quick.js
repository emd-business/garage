// Global search palette, the quick-action button and per-page help.
import { db } from './api.js';
import { esc, idn, money, STATUS } from './format.js';
import { icon, errMsg } from './ui.js';
import { ctx } from './state.js';
import { HELP } from './help.js';

// ---- quick actions: navigate, then open the page's "new" dialog once it renders ----
const QUICK_KEY = 'emd-quick';
export const QUICK = [
  { label: 'استلام سيارة', icon: 'intake', href: '#/intake', roles: ['owner', 'manager', 'reception'] },
  { label: 'موعد جديد', icon: 'calendar', href: '#/appointments', open: '#new', roles: ['owner', 'manager', 'reception'] },
  { label: 'عميل جديد', icon: 'users', href: '#/customers', open: '#add', roles: ['owner', 'manager', 'reception'] },
  { label: 'مصروف', icon: 'receipt', href: '#/expenses', open: '#add', roles: ['owner', 'manager', 'accountant'] },
  { label: 'إقفال الصندوق', icon: 'cash', href: '#/cash', open: '#close [name=counted]', roles: ['owner', 'manager', 'accountant', 'reception'] },
];
const quickFor = () => QUICK.filter((q) => q.roles.includes(ctx.role));

export function fabHtml() {
  if (!quickFor().length) return '';
  return `<div class="fab-wrap"><button type="button" class="fab" aria-expanded="false" aria-haspopup="menu" aria-label="إجراء سريع" data-fab>${icon('plus')}</button>
    <div class="fab-menu" role="menu" hidden>${quickFor().map((q, i) => `<button type="button" role="menuitem" data-quick="${i}">${icon(q.icon)}<span>${esc(q.label)}</span></button>`).join('')}</div></div>`;
}

// called by the router after a page renders
export function runPendingQuick(el) {
  let sel = null;
  try { sel = sessionStorage.getItem(QUICK_KEY); sessionStorage.removeItem(QUICK_KEY); } catch { /* storage off */ }
  if (!sel) return;
  const t = el.querySelector(sel);
  if (!t) return;
  if (t.matches('input,textarea,select')) { t.scrollIntoView({ block: 'center' }); t.focus(); } else t.click();
}

function goQuick(q) {
  try { if (q.open) sessionStorage.setItem(QUICK_KEY, q.open); } catch { /* storage off */ }
  if (location.hash === q.href) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = q.href;
}

// ---- search palette ----
const hrefOf = (r) => {
  if (r.k === 'job' || r.k === 'invoice') return `#/job/${r.id}`;
  if (r.k === 'vehicle') return r.job ? `#/job/${r.job}` : `#/customer/${r.customer}`;
  return `#/customer/${r.id}`;
};
const rowOf = (r) => {
  if (r.k === 'job') return [`أمر عمل ${idn(r.no)}`, [r.car, r.plate, r.name].filter(Boolean).join(' · '), STATUS[r.status]?.label];
  if (r.k === 'invoice') return [`فاتورة ${idn(r.no)}`, [r.name, money(r.total)].filter(Boolean).join(' · '), 'فاتورة'];
  if (r.k === 'vehicle') return [r.plate || r.car, [r.car, r.name].filter(Boolean).join(' · '), r.job ? 'في الورشة' : 'سيارة'];
  return [r.name, r.phone || '', 'عميل'];
};

export function openSearch() {
  if (document.querySelector('dialog.search')) return;
  const d = document.createElement('dialog');
  d.className = 'search';
  d.innerHTML = `<div class="search-box">${icon('search')}<input type="search" placeholder="رقم اللوحة، الهاتف، الاسم، رقم الأمر أو الفاتورة" aria-label="بحث" autocomplete="off" enterkeyhint="search">
      <button type="button" class="btn small ghost" data-close>إغلاق</button></div>
    <div class="search-results" role="listbox" aria-live="polite"><p class="subtle">اكتب حرفين على الأقل، أو رقماً.</p></div>`;
  document.body.append(d);
  const input = d.querySelector('input'), out = d.querySelector('.search-results');
  let seq = 0, timer, results = [], active = 0;
  const paint = () => {
    out.innerHTML = results.length ? results.map((r, i) => { const [t, s, tag] = rowOf(r); return `<a role="option" class="search-item ${i === active ? 'on' : ''}" href="${hrefOf(r)}" aria-selected="${i === active}">
        <span><strong>${esc(t)}</strong>${s ? `<br><span class="subtle">${esc(s)}</span>` : ''}</span>${tag ? `<span class="badge neutral">${esc(tag)}</span>` : ''}</a>`; }).join('')
      : `<p class="subtle">${input.value.trim() ? 'لا توجد نتائج.' : 'اكتب حرفين على الأقل، أو رقماً.'}</p>`;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q || (q.length < 2 && !/^\d+$/.test(q))) { results = []; paint(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await db.rpc('global_search', { p_q: q });
        if (my !== seq) return;
        // drop a vehicle row when its open job is already listed
        const jobs = new Set((r || []).filter((x) => x.k === 'job').map((x) => x.id));
        results = (r || []).filter((x) => !(x.k === 'vehicle' && x.job && jobs.has(x.job))).slice(0, 12); active = 0; paint();
      } catch (e) { out.innerHTML = `<p class="notice error">${esc(errMsg(e))}</p>`; }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!results.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; paint(); }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); location.hash = hrefOf(results[active]); d.close(); }
  });
  out.addEventListener('click', (e) => { if (e.target.closest('a')) d.close(); });
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  input.focus();
}

// ---- help ----
export function helpButton(key) {
  return HELP[key] ? `<button type="button" class="btn small ghost help-btn" data-help="${esc(key)}" aria-label="شرح الصفحة">${icon('help')}<span>شرح</span></button>` : '';
}
export function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${esc(h[0])}</h2><p class="muted">${esc(h[1])}</p>
    <ol class="help-list">${h[2].map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="dialog-actions"><button class="btn primary" value="ok">فهمت</button></div></form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// ---- one-time wiring of document-level handlers ----
let wired = false;
export function wireQuick() {
  if (wired) return; wired = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-search]')) { openSearch(); return; }
    const h = e.target.closest('[data-help]'); if (h) { openHelp(h.dataset.help); return; }
    const fab = e.target.closest('[data-fab]');
    const menu = document.querySelector('.fab-menu');
    if (fab) { const open = menu.hidden; menu.hidden = !open; fab.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button')?.focus(); return; }
    const q = e.target.closest('[data-quick]');
    if (menu && !menu.hidden) { menu.hidden = true; document.querySelector('[data-fab]')?.setAttribute('aria-expanded', 'false'); }
    if (q) goQuick(quickFor()[Number(q.dataset.quick)]);
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (!document.querySelector('.shell')) return;
      e.preventDefault(); openSearch();
    }
    if (e.key === 'Escape') { const menu = document.querySelector('.fab-menu'); if (menu && !menu.hidden) { menu.hidden = true; document.querySelector('[data-fab]')?.focus(); } }
  });
}
