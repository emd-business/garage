import { LOCALE, langButton } from './i18n.js';
// EMD Garage — app entry: auth, onboarding, shell and hash router.
import { auth, db } from './api.js';
import { esc, ROLES } from './format.js';
import { icon, toast, errMsg, formData, busy, field, passwordInput } from './ui.js';
import { ctx, loadContext } from './state.js';

import dashboard from './views/dashboard.js';
import board from './views/board.js';
import intake from './views/intake.js';
import job from './views/job.js';
import printDoc from './views/print.js';
import customers, { customerView } from './views/customers.js';
import inventory, { itemView } from './views/inventory.js';
import appointments from './views/appointments.js';
import purchases from './views/purchases.js';
import expenses from './views/expenses.js';
import reports from './views/reports.js';
import pricing from './views/pricing.js';
import accounting, { ledger, statement } from './views/accounting.js';
import portal from './views/portal.js';
import admin from './views/admin.js';
import settings from './views/settings.js';

const root = document.getElementById('app');

const NAV = [
  { href: '#/', key: '', label: 'اليوم', icon: 'home', roles: ['owner', 'manager', 'reception', 'accountant'] },
  { href: '#/board', key: 'board', label: 'الورشة', icon: 'board', roles: ['owner', 'manager', 'reception', 'accountant', 'technician'] },
  { href: '#/intake', key: 'intake', label: 'استلام', icon: 'intake', roles: ['owner', 'manager', 'reception'] },
  { href: '#/appointments', key: 'appointments', label: 'المواعيد', icon: 'calendar', roles: ['owner', 'manager', 'reception'] },
  { href: '#/customers', key: 'customers', label: 'العملاء', icon: 'users', roles: ['owner', 'manager', 'reception', 'accountant'] },
  { href: '#/inventory', key: 'inventory', label: 'المخزون', icon: 'box', roles: ['owner', 'manager', 'reception', 'accountant', 'storekeeper'] },
  { href: '#/purchases', key: 'purchases', label: 'المشتريات', icon: 'cart', roles: ['owner', 'manager', 'accountant', 'storekeeper'] },
  { href: '#/expenses', key: 'expenses', label: 'المصروفات', icon: 'receipt', roles: ['owner', 'manager', 'accountant'] },
  { href: '#/reports', key: 'reports', label: 'التقارير', icon: 'chart', roles: ['owner', 'manager', 'accountant'] },
  { href: '#/accounting', key: 'accounting', label: 'المحاسبة', icon: 'book', roles: ['owner', 'manager', 'accountant'] },
  { href: '#/pricing', key: 'pricing', label: 'التسعير', icon: 'calc', roles: ['owner', 'manager'] },
  { href: '#/settings', key: 'settings', label: 'الإعدادات', icon: 'settings', roles: ['owner', 'manager'] },
  { href: '#/admin', key: 'admin', label: 'إدارة EMD', icon: 'chart', roles: [], admin: true },
];
const canSee = (n) => (n.admin ? ctx.isAdmin : n.roles.includes(ctx.role));

const ROUTES = {
  '': dashboard, board, intake, job, print: printDoc, customers, customer: customerView, inventory, item: itemView, settings,
  appointments, purchases, expenses, reports, pricing, more: moreView, accounting, ledger, statement, admin,
};

function parseRoute() {
  const [key = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { key, params: rest.map(decodeURIComponent) };
}

function homeFor(role) {
  if (role === 'technician') return 'board';
  if (role === 'storekeeper') return 'inventory';
  return '';
}

function shell(activeKey) {
  const items = NAV.filter(canSee);
  const link = (n, cls = '') => `<a href="${n.href}" class="${cls}" ${n.key === activeKey ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${esc(n.label)}</span></a>`;
  const left = ctx.garage.trial_ends_at ? Math.ceil((new Date(ctx.garage.trial_ends_at) - Date.now()) / 864e5) : null;
  const trial = ctx.garage.status === 'trial' ? `<div class="notice ${left !== null && left <= 7 ? 'warn' : 'info'}">${left === null ? 'نسخة تجريبية' : left > 0 ? `التجربة تنتهي بعد ${new Intl.NumberFormat(LOCALE).format(left)} يوماً` : 'انتهت الفترة التجريبية'}</div>` : '';
  return `<div class="shell">
    <aside class="side" aria-label="القائمة الرئيسية">
      <div class="brand"><img src="assets/logo-on-dark.svg" alt="EMD Garage"></div>
      <div class="garage-name">${esc(ctx.garage.name)}</div>
      <nav class="nav">${items.map((n) => link(n)).join('')}</nav>
      <div class="foot">
        ${trial}
        <span>${esc(ctx.profile.full_name || '')} · ${esc(ROLES[ctx.role] || '')}</span>
        ${langButton('btn small ghost lang-btn')}
        <button type="button" data-signout>${icon('out')} تسجيل الخروج</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <img src="assets/logo-on-dark.svg" alt="EMD Garage">
        <span class="garage-name">${esc(ctx.garage.name)}</span>
        <span class="row" style="gap:4px;flex-wrap:nowrap">${langButton('btn small ghost lang-btn')}<button type="button" class="btn ghost icon-btn" data-signout aria-label="تسجيل الخروج" style="color:#fff">${icon('out')}</button></span>
      </header>
      <main class="content" id="view" tabindex="-1"><div class="skeleton"></div></main>
      <nav class="bottomnav" aria-label="القائمة">${(items.length > 5 ? items.slice(0, 4) : items).map((n) => link(n)).join('')}${items.length > 5 ? `<a href="#/more" ${activeKey === 'more' || !items.slice(0, 4).some((n) => n.key === activeKey) ? 'aria-current="page"' : ''}>${icon('more')}<span>المزيد</span></a>` : ''}</nav>
    </div>
  </div>`;
}

let renderSeq = 0;
async function renderPortal(params) {
  delete root.dataset.active;
  root.innerHTML = '<div class="skeleton" style="margin:24px"></div>';
  try {
    const out = await portal(params);
    root.innerHTML = out.html;
    out.bind && out.bind(root);
  } catch (e) { root.innerHTML = `<div class="content"><div class="notice error">${esc(errMsg(e))}</div></div>`; }
  window.scrollTo(0, 0);
}

async function route() {
  const r0 = parseRoute();
  if (r0.key === 't') return renderPortal(r0.params);
  if (!auth.session) return renderAuth();
  if (ctx.garage && !ctx.role && ctx.garage.status === 'suspended') return renderSuspended();
  if (!ctx.garage || !ctx.role) return renderOnboarding();
  const { key, params } = parseRoute();
  const view = ROUTES[key];
  const navKey = { item: 'inventory', customer: 'customers', ledger: 'accounting' }[key] || key;
  const navItem = NAV.find((n) => n.key === navKey);
  const allowed = key === 'print' || key === 'statement' || key === 'job' || key === 'more' || (navItem && canSee(navItem));
  if (!view || !allowed) { location.hash = `#/${homeFor(ctx.role)}`; return; }
  const seq = ++renderSeq;

  if (key === 'print' || key === 'statement') {
    root.innerHTML = '<div class="skeleton" style="margin:24px"></div>';
    try {
      const out = await view(params);
      if (seq !== renderSeq) return;
      root.innerHTML = out.html;
      out.bind && out.bind(root);
    } catch (e) { root.innerHTML = `<div class="content"><div class="notice error">${esc(errMsg(e))}</div></div>`; }
    return;
  }

  const activeKey = key === 'job' ? 'board' : navKey;
  if (!document.querySelector('.shell') || root.dataset.active !== activeKey) {
    root.innerHTML = shell(activeKey);
    root.dataset.active = activeKey;
  }
  const el = document.getElementById('view');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const out = await view(params);
    if (seq !== renderSeq) return;
    el.innerHTML = out.html;
    out.bind && out.bind(el);
    document.title = `${out.title ? `${out.title} · ` : ''}EMD Garage`;
  } catch (e) {
    if (seq !== renderSeq) return;
    el.innerHTML = `<div class="notice error" role="alert">${esc(errMsg(e))}</div>`;
  }
  window.scrollTo(0, 0);
}

export function rerender() { delete root.dataset.active; route(); }

// Phone-size menu with every section the role can open
async function moreView() {
  const items = NAV.filter(canSee);
  return {
    title: 'المزيد',
    html: `<div class="page-head"><div><h1>القائمة</h1><p class="lead">${esc(ctx.garage.name)} · ${esc(ROLES[ctx.role])}</p></div></div>
      <section class="card"><div class="list"><div class="list-item"><span>Language · اللغة</span>${langButton('btn small')}</div>${items.map((n) => `<a class="list-item" href="${n.href}"><span class="row" style="gap:12px">${icon(n.icon).replace('<svg', '<svg style="width:22px;height:22px"')} ${esc(n.label)}</span>${icon('arrow').replace('<svg', '<svg style="width:18px;height:18px"')}</a>`).join('')}
        <button type="button" class="list-item" data-signout style="width:100%;border:0;background:none;font:inherit;color:var(--danger-ink);cursor:pointer;min-height:48px">${esc('تسجيل الخروج')}</button></div></section>`,
  };
}

// ---------- Auth ----------
function renderAuth(mode = 'in', note = '') {
  delete root.dataset.active;
  document.title = 'EMD Garage · تسجيل الدخول';
  const tabs = [['in', 'دخول'], ['up', 'حساب جديد']];
  const body = {
    in: `${field('البريد الإلكتروني', '<input name="email" type="email" required autocomplete="email" dir="ltr">', { req: true })}
         ${field('كلمة المرور', passwordInput('current-password'), { req: true })}
         <button class="btn primary">ادخل</button>
         <button type="button" class="btn ghost" data-mode="forgot">نسيت كلمة المرور</button>`,
    up: `${field('الاسم الكامل', '<input name="full_name" required autocomplete="name">', { req: true })}
         ${field('رقم الهاتف (اختياري)', '<input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr">')}
         ${field('البريد الإلكتروني', '<input name="email" type="email" required autocomplete="email" dir="ltr">', { req: true })}
         ${field('كلمة المرور', passwordInput('new-password', 8), { req: true, hint: '٨ أحرف على الأقل' })}
         <button class="btn primary">أنشئ الحساب</button>`,
    forgot: `${field('البريد الإلكتروني', '<input name="email" type="email" required autocomplete="email" dir="ltr">', { req: true })}
         <button class="btn primary">أرسل رابط الاستعادة</button>
         <button type="button" class="btn ghost" data-mode="in">رجوع للدخول</button>`,
    reset: `${field('كلمة المرور الجديدة', passwordInput('new-password', 8), { req: true })}
         <button class="btn primary">احفظ كلمة المرور</button>`,
  };
  root.innerHTML = `<div class="auth">
    <section class="auth-brand">
      <img src="assets/logo-on-dark.svg" alt="EMD Garage">
      <div class="stack">
        <h1>أدِر كراجك كاملاً من الاستلام إلى الفاتورة</h1>
        <ul>
          <li>استلام السيارات ولوحة الورشة</li>
          <li>أوامر العمل والقطع والمخزون</li>
          <li>فواتير ضريبية وسندات قبض</li>
          <li>رسائل واتساب جاهزة لعملائك</li>
        </ul>
      </div>
      <p class="row subtle" style="color:var(--chrome-muted);justify-content:space-between">EMD Garage · عُمان ${langButton('btn small ghost lang-btn')}</p>
    </section>
    <section class="auth-form">
      <form class="card" novalidate>
        ${mode === 'in' || mode === 'up' ? `<div class="tabs" role="tablist">${tabs.map(([m, l]) => `<button type="button" role="tab" data-mode="${m}" aria-selected="${m === mode}">${l}</button>`).join('')}</div>` : `<h2>${mode === 'reset' ? 'كلمة مرور جديدة' : 'استعادة كلمة المرور'}</h2>`}
        ${note ? `<div class="notice ${note.kind}" role="status">${esc(note.text)}</div>` : ''}
        ${body[mode]}
      </form>
    </section>
  </div>`;
  const form = root.querySelector('form');
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const d = formData(form);
    await busy(ev.submitter, async () => {
      if (mode === 'in') { await auth.signIn(d.email, d.password); await start(); }
      else if (mode === 'up') {
        const r = await auth.signUp(d.email, d.password, d.full_name, d.phone);
        if (r.needsConfirm) renderAuth('in', { kind: 'ok', text: 'أرسلنا رسالة تأكيد إلى بريدك. افتحها ثم سجّل الدخول.' });
        else await start();
      } else if (mode === 'forgot') {
        await auth.recover(d.email);
        renderAuth('in', { kind: 'ok', text: 'إن كان البريد مسجلاً فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة.' });
      } else if (mode === 'reset') {
        await auth.updatePassword(d.password);
        toast('تم تغيير كلمة المرور');
        await start();
      }
    });
  });
  form.querySelector('input')?.focus();
}

function renderSuspended() {
  delete root.dataset.active;
  root.innerHTML = `<div class="auth"><section class="auth-brand"><img src="assets/logo-on-dark.svg" alt="EMD Garage">
      <div class="stack"><h1>اشتراك ${esc(ctx.garage.name)} موقوف</h1><p style="color:var(--chrome-muted)">بياناتك محفوظة كاملة. تواصل مع فريق EMD لتجديد الاشتراك، ويعود كل شيء كما كان.</p></div>
      <button class="btn ghost" data-signout style="color:#fff;align-self:flex-start">${icon('out')} تسجيل الخروج</button></section>
    <section class="auth-form"><div class="card stack" style="max-width:420px"><h2>تجديد الاشتراك</h2><p class="muted">أرسل لنا رسالة وسنفعّل حسابك بعد السداد.</p>
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(`أرغب بتجديد اشتراك ${ctx.garage.name} في EMD Garage`)}" target="_blank" rel="noopener">واتساب</a></div></section></div>`;
}

// ---------- Onboarding: create a garage or join one ----------
function renderOnboarding() {
  delete root.dataset.active;
  document.title = 'EMD Garage · ابدأ';
  root.innerHTML = `<div class="auth">
    <section class="auth-brand">
      <img src="assets/logo-on-dark.svg" alt="EMD Garage">
      <div class="stack"><h1>أهلاً ${esc(ctx.profile?.full_name || '')}</h1>
      <p style="color:var(--chrome-muted)">أنشئ كراجك إن كنت صاحبه، أو انضم إلى كراج برمز الدعوة الذي أرسله لك المدير.</p></div>
      <button class="btn ghost" data-signout style="color:#fff;align-self:flex-start">${icon('out')} تسجيل الخروج</button>
    </section>
    <section class="auth-form"><div class="stack" style="width:100%;max-width:420px">
      <form class="card" id="create" novalidate>
        <h2>أنشئ كراجك</h2>
        ${field('اسم الكراج', '<input name="name" required>', { req: true })}
        ${field('الاسم بالإنجليزية (اختياري)', '<input name="name_en" dir="ltr">')}
        ${field('هاتف الكراج (اختياري)', '<input name="phone" type="tel" dir="ltr">')}
        <button class="btn primary">أنشئ الكراج</button>
      </form>
      <form class="card" id="join" novalidate>
        <h2>انضم بدعوة</h2>
        ${field('رمز الدعوة', '<input name="code" required dir="ltr" autocapitalize="characters" style="letter-spacing:.2em">', { req: true })}
        <button class="btn">انضم</button>
      </form>
    </div></section>
  </div>`;
  root.querySelector('#create').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target; if (!f.reportValidity()) return;
    const d = formData(f);
    await busy(ev.submitter, async () => {
      await db.rpc('create_garage', { p_name: d.name, p_name_en: d.name_en, p_phone: d.phone });
      await start('#/settings');
      toast('أُنشئ الكراج. أكمل بياناته وأسعارك');
    });
  });
  root.querySelector('#join').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target; if (!f.reportValidity()) return;
    await busy(ev.submitter, async () => {
      await db.rpc('accept_invite', { p_code: formData(f).code });
      await start('#/');
    });
  });
}

// ---------- Boot ----------
async function start(hash) {
  try {
    await loadContext();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { await auth.signOut(); return renderAuth('in', { kind: 'error', text: 'انتهت الجلسة، سجّل الدخول مجدداً' }); }
    root.innerHTML = `<div class="content"><div class="notice error" role="alert">تعذّر الاتصال: ${esc(errMsg(e))}</div><button class="btn" onclick="location.reload()">أعد المحاولة</button></div>`;
    return;
  }
  if (hash && location.hash !== hash) { location.hash = hash; return; }
  route();
}

document.addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-signout]')) {
    await auth.signOut();
    ctx.garage = null; ctx.role = null;
    location.hash = '';
    renderAuth();
  }
});
window.addEventListener('hashchange', route);

(async () => {
  try {
    const r = await auth.fromUrl();
    if (r && r.type === 'recovery') return renderAuth('reset');
  } catch (e) { toast(errMsg(e), 'error'); }
  if (parseRoute().key === 't') return route();
  if (!auth.session) return renderAuth();
  start();
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
