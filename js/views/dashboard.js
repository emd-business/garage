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
  const [k, jobs] = await Promise.all([
    db.rpc('dashboard_today'),
    db.get('job_orders', { select: JOB_SELECT, status: 'not.in.(delivered,cancelled)', order: 'promised_at.asc.nullslast', limit: 50 }),
  ]);
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
      <div><h1>اليوم في ${esc(ctx.garage.name)}</h1><p class="lead">${esc(new Intl.DateTimeFormat('ar-OM', { timeZone: 'Asia/Muscat', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</p></div>
      ${ctx.can('owner', 'manager', 'reception') ? `<a class="btn primary" href="#/intake">${icon('plus')} استلام سيارة</a>` : ''}
    </div>
    <div class="kpis">
      ${tile('في الورشة', num(inShop), '#/board')}
      ${tile('متأخرة عن الموعد', num(k?.overdue || 0), '#/board', (k?.overdue || 0) > 0)}
      ${tile('جاهزة للتسليم', num(by.ready || 0), '#/board')}
      ${tile('استُلمت اليوم', num(k?.received_today || 0), '#/board')}
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
  };
}
