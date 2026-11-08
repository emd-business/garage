import { LOCALE } from '../i18n.js';
import { db } from '../api.js';
import { idn, esc, money, num, badge, plate, carName, dateTime } from '../format.js';
import { icon } from '../ui.js';
import { ctx } from '../state.js';

export const JOB_SELECT = 'id,job_no,status,complaint,promised_at,received_at,technician_id,vehicle_id,customer_id,vehicles(plate_number,plate_letters,plate_type,make,model,year),customers(name,phone)';

export function plateTag(v) {
  if (!v || !v.plate_number) return '';
  return `<span class="plate ${esc(v.plate_type || 'private')}"><bdi>${esc(plate(v))}</bdi></span>`;
}

export const isLate = (j) => j.promised_at && !['ready', 'delivered', 'cancelled'].includes(j.status) && new Date(j.promised_at) < new Date();

export default async function dashboard() {
  const dayStart = new Date(`${new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10)}T00:00:00+04:00`);
  const cashAlert = ctx.garage.cash_close_alert !== false && ctx.can('owner', 'manager', 'accountant', 'reception');
  const [k, jobs, appts, cash] = await Promise.all([
    db.rpc('dashboard_today'),
    db.get('job_orders', { ...ctx.here, select: JOB_SELECT, status: 'not.in.(delivered,cancelled)', order: 'promised_at.asc.nullslast', limit: 50 }),
    ctx.can('owner', 'manager', 'reception') ? db.get('appointments', { ...ctx.here, select: 'id', status: 'in.(booked,confirmed)', starts_at: `gte.${dayStart.toISOString()}`, and: `(starts_at.lt.${new Date(dayStart.getTime() + 864e5).toISOString()})` }).catch(() => []) : [],
    cashAlert ? db.rpc('cash_status', {}).catch(() => null) : null,
  ]);
  let setup = null;
  try { if (ctx.can('owner', 'manager') && localStorage.getItem(`emd-setup-done-${ctx.garage.id}`) !== '1') setup = await db.rpc('setup_progress').catch(() => null); } catch { /* storage off */ }
  const STEPS = [['details', 'أكمل بيانات الكراج', 'الهاتف والعنوان والسجل أو الرقم الضريبي، لتظهر على الفواتير', '#/settings'],
    ['logo', 'ارفع شعار الكراج', 'يظهر على الفاتورة ورابط العميل', '#/settings'],
    ['services', 'أضف خدماتك وأسعارها', 'تغيير الزيت، الفحص، الفرامل… فتختارها بضغطة في أمر العمل', '#/settings'],
    ['items', 'أدخل قطع المخزون', 'بالكمية الحالية والتكلفة وسعر البيع', '#/inventory'],
    ['team', 'ادعُ موظفيك', 'لكل موظف دوره وصلاحياته', '#/settings'],
    ['job', 'استلم أول سيارة', 'من «استلام» أو زر + في الأسفل', '#/intake']];
  const doneN = setup ? STEPS.filter(([k]) => setup[k]).length : 0;
  const setupCard = setup && doneN < STEPS.length ? `<section class="card stack setup" id="setup">
      <div class="card-head" style="margin:0"><h2>ابدأ من هنا</h2><span class="badge info">${num(doneN)} من ${num(STEPS.length)}</span></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${STEPS.length}" aria-valuenow="${doneN}"><span style="width:${Math.round((doneN / STEPS.length) * 100)}%"></span></div>
      <ol class="steps">${STEPS.map(([k, t, d, href]) => `<li class="${setup[k] ? 'done' : ''}"><a href="${href}"><span class="tick" aria-hidden="true">${setup[k] ? '✓' : ''}</span><span><strong>${t}</strong><br><span class="subtle">${d}</span></span></a></li>`).join('')}</ol>
      <div><button type="button" class="btn small ghost" id="setup-hide">أخفِ هذه القائمة</button></div></section>` : '';
  // cash taken before today and still not closed
  const openCash = cash && cash.first_move && new Date(cash.first_move) < dayStart;
  const by = (k && k.by_status) || {};
  const inShop = Object.values(by).reduce((a, b) => a + Number(b), 0);
  const late = jobs.filter(isLate);
  const ready = jobs.filter((j) => j.status === 'ready');
  const approval = jobs.filter((j) => j.status === 'approval');

  const tile = (label, value, href, alert) => `<a class="kpi ${alert ? 'alert' : ''}" href="${href}"><span class="label">${esc(label)}</span><span class="value">${value}</span></a>`;
  const row = (j) => `<a class="list-item" href="#/job/${j.id}">
      <span class="row" style="gap:10px">${plateTag(j.vehicles)}<span><strong>${esc(carName(j.vehicles))}</strong><br><span class="subtle">${esc(j.customers?.name || '')} · أمر ${idn(j.job_no)}</span></span></span>
      <span class="row" style="gap:8px">${isLate(j) ? '<span class="badge danger">متأخرة</span>' : ''}${badge(j.status)}</span></a>`;
  const block = (title, list, emptyText) => `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><span class="subtle">${num(list.length)}</span></div>
      ${list.length ? `<div class="list">${list.slice(0, 8).map(row).join('')}</div>` : `<p class="muted">${esc(emptyText)}</p>`}</section>`;

  return {
    title: 'اليوم',
    html: `
    <div class="page-head">
      <div><h1>اليوم في ${esc(ctx.garage.name)}</h1><p class="lead">${esc(new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</p></div>
      ${ctx.can('owner', 'manager', 'reception') ? `<a class="btn primary" href="#/intake">${icon('plus')} استلام سيارة</a>` : ''}
    </div>
    ${setupCard}
    ${openCash ? `<a class="notice warn" href="#/cash" style="display:block">لم يُقفَل الصندوق منذ ${esc(dateTime(cash.first_move))}. اعدد النقد وأقفله.</a>` : ''}
    <div class="kpis">
      ${tile('في الورشة', num(inShop), '#/board')}
      ${tile('متأخرة عن الموعد', num(k?.overdue || 0), '#/board', (k?.overdue || 0) > 0)}
      ${tile('جاهزة للتسليم', num(by.ready || 0), '#/board')}
      ${tile('استُلمت اليوم', num(k?.received_today || 0), '#/board')}
      ${ctx.can('owner', 'manager', 'reception') ? tile('مواعيد اليوم', num(appts.length), '#/appointments') : ''}
      ${tile('المحصَّل اليوم', money(k?.collected_today || 0), '#/')}
      ${tile('على العملاء', money(k?.receivables || 0), '#/customers')}
      ${tile('أصناف ناقصة', num(k?.low_stock || 0), '#/inventory', (k?.low_stock || 0) > 0)}
    </div>
    <div class="grid two">
      ${block('متأخرة عن موعد التسليم', late, 'لا توجد سيارات متأخرة.')}
      ${block('جاهزة، بانتظار العميل', ready, 'لا توجد سيارات جاهزة الآن.')}
      ${block('بانتظار موافقة العميل', approval, 'لا يوجد ما ينتظر الموافقة.')}
      <section class="card"><div class="card-head"><h2>آخر الاستلامات</h2></div>
        ${jobs.length ? `<div class="list">${[...jobs].sort((a, b) => new Date(b.received_at) - new Date(a.received_at)).slice(0, 6).map((j) => `<a class="list-item" href="#/job/${j.id}"><span>${plateTag(j.vehicles)} ${esc(carName(j.vehicles))}</span><span class="subtle">${esc(dateTime(j.received_at))}</span></a>`).join('')}</div>`
        : `<div class="empty"><p>لا توجد سيارات في الورشة بعد.</p>${ctx.can('owner', 'manager', 'reception') ? '<a class="btn primary" href="#/intake">استلم أول سيارة</a>' : ''}</div>`}
      </section>
    </div>`,
    bind(el) {
      el.querySelector('#setup-hide')?.addEventListener('click', () => {
        try { localStorage.setItem(`emd-setup-done-${ctx.garage.id}`, '1'); } catch { /* storage off */ }
        el.querySelector('#setup')?.remove();
      });
    },
  };
}
