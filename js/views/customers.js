import { db, like } from '../api.js';
import { idn, esc, money, num, badge, carName, date } from '../format.js';
import { icon, toast, field, options, openDialog } from '../ui.js';
import { ctx } from '../state.js';
import { plateTag } from './dashboard.js';
import { vehicleFields, vehicleRow } from './intake.js';

const customerFields = (c = {}) => `
  ${field('الاسم', `<input name="name" required value="${esc(c.name || '')}">`, { req: true })}
  ${field('الهاتف', `<input name="phone" type="tel" dir="ltr" value="${esc(c.phone || '')}">`)}
  ${field('البريد', `<input name="email" type="email" dir="ltr" value="${esc(c.email || '')}">`)}
  ${field('النوع', `<select name="customer_type">${options([['individual', 'فرد'], ['company', 'شركة']], c.customer_type || 'individual')}</select>`)}
  ${field('الرقم الضريبي', `<input name="vat_number" dir="ltr" value="${esc(c.vat_number || '')}">`, { hint: 'للشركات المسجلة في الضريبة' })}
  ${field('ملاحظات', `<textarea name="notes">${esc(c.notes || '')}</textarea>`)}`;

export default async function customers() {
  const canEdit = ctx.can('owner', 'manager', 'reception');
  return {
    title: 'العملاء',
    html: `<div class="page-head"><div><h1>العملاء</h1><p class="lead">ابحث بالاسم أو الهاتف.</p></div>
        ${canEdit ? `<button class="btn primary" id="add">${icon('plus')} عميل جديد</button>` : ''}</div>
      <input id="q" type="search" placeholder="اسم العميل أو رقم هاتفه" aria-label="بحث في العملاء">
      <section class="card pad-0"><div id="list"><div class="skeleton" style="margin:16px"></div></div></section>`,
    bind(el) {
      const list = el.querySelector('#list');
      let timer;
      const load = async (term = '') => {
        const params = { select: 'id,name,phone,customer_type,vehicles(count)', order: 'created_at.desc', limit: 100 };
        if (term) params.or = `(name.ilike.${like(term)},phone.ilike.${like(term)})`;
        try {
          const [rows, bal] = await Promise.all([
            db.get('customers', params),
            db.get('invoice_balances', { select: 'customer_id,balance', balance: 'gt.0' }),
          ]);
          const owed = {};
          bal.forEach((b) => { owed[b.customer_id] = (owed[b.customer_id] || 0) + Number(b.balance); });
          list.innerHTML = rows.length ? `<div class="table-wrap"><table>
              <thead><tr><th>العميل</th><th>الهاتف</th><th class="num">المركبات</th><th class="num">عليه</th></tr></thead>
              <tbody>${rows.map((c) => `<tr class="click" data-href="#/customer/${c.id}"><td><a href="#/customer/${c.id}">${esc(c.name)}</a>${c.customer_type === 'company' ? ' <span class="badge neutral">شركة</span>' : ''}</td>
                <td><bdi class="ltr">${esc(c.phone || '')}</bdi></td><td class="num">${num(c.vehicles?.[0]?.count || 0)}</td>
                <td class="num">${owed[c.id] ? `<span class="badge warning">${money(owed[c.id])}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="empty"><p>${term ? 'لا يوجد عميل بهذا الاسم أو الرقم.' : 'لا يوجد عملاء بعد. يُضاف العميل تلقائياً عند استلام سيارته.'}</p></div>`;
          list.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
        } catch (e) { list.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
      };
      el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value.trim()), 300); });
      el.querySelector('#add')?.addEventListener('click', () => openDialog('عميل جديد', `<div class="grid form">${customerFields()}</div>`, async (d) => {
        const c = await db.insert('customers', d);
        location.hash = `#/customer/${c.id}`;
      }));
      load();
    },
  };
}

export async function customerView([id]) {
  const canEdit = ctx.can('owner', 'manager', 'reception');
  const c = await db.one('customers', { id: `eq.${id}`, select: '*' });
  if (!c) throw new Error('العميل غير موجود');
  const [vehicles, jobs, bal] = await Promise.all([
    db.get('vehicles', { customer_id: `eq.${id}`, order: 'created_at' }),
    db.get('job_orders', { customer_id: `eq.${id}`, select: 'id,job_no,status,received_at,complaint,vehicles(make,model,plate_number,plate_letters,plate_type)', order: 'received_at.desc' }),
    db.get('invoice_balances', { customer_id: `eq.${id}`, select: 'total,paid,balance' }),
  ]);
  const spent = bal.reduce((a, b) => a + Number(b.paid), 0);
  const owed = bal.reduce((a, b) => a + Number(b.balance), 0);

  return {
    title: c.name,
    html: `<div class="page-head"><div class="stack" style="gap:4px"><a href="#/customers" class="subtle">العملاء</a><h1>${esc(c.name)}</h1>
        <p class="muted">${c.phone ? `<a href="tel:${esc(c.phone)}"><bdi class="ltr">${esc(c.phone)}</bdi></a>` : ''} ${c.customer_type === 'company' ? '· شركة' : ''}</p></div>
        <div class="row">${canEdit ? `<button class="btn" id="edit">عدّل البيانات</button><a class="btn primary" href="#/intake">${icon('plus')} استلام سيارة</a>` : ''}</div></div>
      <div class="kpis">
        <div class="kpi"><span class="label">الزيارات</span><span class="value">${num(jobs.length)}</span></div>
        <div class="kpi"><span class="label">ما دفعه</span><span class="value">${money(spent)}</span></div>
        <div class="kpi ${owed > 0.0005 ? 'alert' : ''}"><span class="label">ما عليه</span><span class="value">${money(owed)}</span></div>
      </div>
      <div class="grid two">
        <section class="card"><div class="card-head"><h2>المركبات</h2>${canEdit ? `<button class="btn small" id="add-v">${icon('plus')} مركبة</button>` : ''}</div>
          ${vehicles.length ? `<div class="list">${vehicles.map((v) => `<div class="list-item"><span class="row" style="gap:10px">${plateTag(v)} <strong>${esc(carName(v))}</strong></span>${v.vin ? `<bdi class="subtle ltr">${esc(v.vin)}</bdi>` : ''}</div>`).join('')}</div>` : '<p class="muted">لا توجد مركبات.</p>'}
        </section>
        <section class="card"><div class="card-head"><h2>سجل الزيارات</h2></div>
          ${jobs.length ? `<div class="list">${jobs.map((j) => `<a class="list-item" href="#/job/${j.id}"><span>أمر ${idn(j.job_no)} · ${esc(carName(j.vehicles))}<br><span class="subtle">${esc(date(j.received_at))} · ${esc((j.complaint || '').slice(0, 60))}</span></span>${badge(j.status)}</a>`).join('')}</div>` : '<p class="muted">لا توجد زيارات بعد.</p>'}
        </section>
      </div>
      ${c.notes ? `<section class="card"><h2>ملاحظات</h2><p>${esc(c.notes)}</p></section>` : ''}`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelector('#edit')?.addEventListener('click', () => openDialog('بيانات العميل', `<div class="grid form">${customerFields(c)}</div>`, async (d) => {
        await db.update('customers', { id: `eq.${c.id}` }, d);
        toast('حُفظت البيانات'); reload();
      }));
      el.querySelector('#add-v')?.addEventListener('click', () => openDialog('مركبة جديدة', `<div class="grid form">${vehicleFields()}</div>`, async (d) => {
        await db.insert('vehicles', { customer_id: c.id, ...vehicleRow(d) });
        toast('أُضيفت المركبة'); reload();
      }));
    },
  };
}
