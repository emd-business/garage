import { db, like } from '../api.js';
import { esc, num, idn, carName, dateTime, date, toLocalInput, fromLocalInput, waLink } from '../format.js';
import { icon, toast, field, options, openDialog, busy } from '../ui.js';
import { ctx } from '../state.js';
import { plateTag } from './dashboard.js';
import { vehicleFields, vehicleRow } from './intake.js';

const APPT = {
  booked: ['محجوز', 'info'], confirmed: ['مؤكَّد', 'success'], arrived: ['وصل', 'neutral'],
  no_show: ['لم يحضر', 'warning'], cancelled: ['ملغى', 'danger'],
};
const apptBadge = (s) => `<span class="badge ${APPT[s][1]}">${APPT[s][0]}</span>`;

// Muscat calendar day helpers (UTC+4, no DST)
const dayStr = (d) => new Date(new Date(d).getTime() + 4 * 3600e3).toISOString().slice(0, 10);
const dayStart = (s) => new Date(`${s}T00:00:00+04:00`).toISOString();
const addDays = (s, n) => dayStr(new Date(`${s}T12:00:00+04:00`).getTime() + n * 864e5);
const timeOnly = new Intl.DateTimeFormat('ar-OM', { timeZone: 'Asia/Muscat', hour: 'numeric', minute: '2-digit' });

function apptForm(a = {}, services = []) {
  return `<div class="grid form">
    ${field('اسم العميل', `<input name="name" required value="${esc(a.name || '')}">`, { req: true })}
    ${field('الهاتف', `<input name="phone" type="tel" dir="ltr" value="${esc(a.phone || '')}">`)}
    ${field('السيارة', `<input name="car" value="${esc(a.car || '')}" placeholder="مثال: تويوتا كامري">`)}
    ${field('الموعد', `<input name="starts_at" type="datetime-local" required value="${esc(toLocalInput(a.starts_at))}">`, { req: true })}
    ${field('المدة (دقيقة)', `<input name="duration_min" type="number" min="15" step="15" value="${esc(a.duration_min || 60)}">`)}
    ${field('الخدمة', `<input name="service" list="svc-list" value="${esc(a.service || '')}">`)}
    ${field('ملاحظات', `<textarea name="notes">${esc(a.notes || '')}</textarea>`, { cls: 'span-all' })}
    <datalist id="svc-list">${services.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
  </div>`;
}
const apptRow = (d) => ({
  name: d.name, phone: d.phone, car: d.car, starts_at: fromLocalInput(d.starts_at),
  duration_min: Number(d.duration_min || 60), service: d.service, notes: d.notes,
});

export default async function appointments([day]) {
  const today = dayStr(Date.now());
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : today;
  const [list, services, due] = await Promise.all([
    db.get('appointments', { starts_at: `gte.${dayStart(sel)}`, and: `(starts_at.lt.${dayStart(addDays(sel, 1))})`, order: 'starts_at' }),
    db.get('services', { active: 'eq.true', order: 'name', select: 'name' }),
    db.rpc('service_due', { p_days: 14 }),
  ]);
  const horizon = new Date(Date.now() + 14 * 864e5);
  const dueSoon = due.filter((r) => !r.reminder_sent_at && (!r.next_service_date || new Date(r.next_service_date) <= horizon))
    .sort((a, b) => String(a.next_service_date || '9').localeCompare(String(b.next_service_date || '9')));
  const g = ctx.garage;

  const row = (a) => {
    const confirmMsg = `مرحباً ${a.name}، نؤكد موعدك في ${g.name} ${dateTime(a.starts_at)}${a.service ? ` لـ${a.service}` : ''}. نتشرف بزيارتك.`;
    const open = ['booked', 'confirmed'].includes(a.status);
    return `<div class="list-item" style="align-items:flex-start">
      <div class="stack" style="gap:2px">
        <strong>${esc(timeOnly.format(new Date(a.starts_at)))} · ${esc(a.name)}</strong>
        <span class="subtle">${[a.car, a.service, a.phone && `<bdi class="ltr">${esc(a.phone)}</bdi>`].filter(Boolean).map((x) => (x.startsWith('<bdi') ? x : esc(x))).join(' · ')}</span>
        ${a.notes ? `<span class="subtle">${esc(a.notes)}</span>` : ''}
        ${a.job_id ? `<a href="#/job/${a.job_id}" class="subtle">فتح أمر العمل</a>` : ''}
      </div>
      <div class="row" style="gap:6px;justify-content:flex-end">
        ${apptBadge(a.status)}
        ${open && a.phone ? `<a class="btn small wa" target="_blank" rel="noopener" data-confirm="${a.id}" href="${esc(waLink(a.phone, confirmMsg))}">${icon('wa')} تأكيد</a>` : ''}
        ${open ? `<button class="btn small teal" data-arrive="${a.id}">وصل</button>` : ''}
        ${open ? `<button class="btn small ghost" data-edit="${a.id}">تعديل</button>` : ''}
        ${open ? `<button class="btn small ghost" data-set="${a.id}" data-to="no_show">لم يحضر</button><button class="btn small ghost" data-set="${a.id}" data-to="cancelled">إلغاء</button>` : ''}
      </div></div>`;
  };

  const dueRow = (r, i) => {
    const late = r.next_service_date && new Date(r.next_service_date) < new Date();
    const msg = `مرحباً ${r.customer_name}، حان موعد الصيانة القادمة لسيارتك ${[r.make, r.model].filter(Boolean).join(' ')}${r.next_service_km ? ` (عند ${r.next_service_km} كم)` : ''}. يسعدنا حجز موعد لك في ${g.name}.`;
    return `<div class="list-item">
      <span class="row" style="gap:10px">${plateTag(r)} <span><strong>${esc(carName(r))}</strong> · ${esc(r.customer_name)}<br>
        <span class="subtle">${r.next_service_date ? `${late ? '<span class="badge danger">متأخرة</span> ' : ''}${esc(date(r.next_service_date))}` : ''}${r.next_service_km ? ` · عند ${num(r.next_service_km)} كم` : ''}</span></span></span>
      <span class="row" style="gap:6px">
        ${r.phone ? `<a class="btn small wa" target="_blank" rel="noopener" href="${esc(waLink(r.phone, msg))}" data-reminded="${r.job_id}">${icon('wa')} ذكّره</a>` : ''}
        <button class="btn small" data-book="${i}">احجز موعداً</button>
      </span></div>`;
  };

  return {
    title: 'المواعيد',
    html: `<div class="page-head"><div><h1>المواعيد</h1><p class="lead">${esc(new Intl.DateTimeFormat('ar-OM', { timeZone: 'Asia/Muscat', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${sel}T12:00:00+04:00`)))}</p></div>
        <button class="btn primary" id="new">${icon('plus')} موعد جديد</button></div>
      <div class="row">
        <a class="btn small" href="#/appointments/${addDays(sel, -1)}">اليوم السابق</a>
        ${sel !== today ? '<a class="btn small" href="#/appointments">اليوم</a>' : ''}
        <a class="btn small" href="#/appointments/${addDays(sel, 1)}">اليوم التالي</a>
        <input type="date" id="pick" value="${sel}" aria-label="اختر يوماً" style="max-width:180px">
      </div>
      <div class="cols">
        <section class="card"><div class="card-head"><h2>مواعيد اليوم</h2><span class="subtle">${num(list.filter((a) => a.status !== 'cancelled').length)}</span></div>
          ${list.length ? `<div class="list">${list.map(row).join('')}</div>` : '<div class="empty"><p>لا توجد مواعيد في هذا اليوم.</p></div>'}
        </section>
        <section class="card"><div class="card-head"><h2>تذكير الصيانة</h2><span class="subtle">${num(dueSoon.length)}</span></div>
          <p class="subtle" style="margin-bottom:8px">سيارات حان موعد صيانتها أو يحين خلال أسبوعين، حسب ما سجّلته عند تسليمها.</p>
          ${dueSoon.length ? `<div class="list">${dueSoon.map(dueRow).join('')}</div>` : '<p class="muted">لا يوجد عملاء يحتاجون تذكيراً الآن.</p>'}
        </section>
      </div>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelector('#pick').addEventListener('change', (e) => { location.hash = `#/appointments/${e.target.value}`; });
      const newAppt = (prefill = {}) => openDialog('موعد جديد', apptForm({ starts_at: `${sel}T09:00:00+04:00`, ...prefill }, services), async (d) => {
        await db.insert('appointments', { ...apptRow(d), customer_id: prefill.customer_id || null, vehicle_id: prefill.vehicle_id || null });
        toast('حُجز الموعد');
        const day2 = d.starts_at.slice(0, 10);
        if (day2 !== sel) location.hash = `#/appointments/${day2}`; else reload();
      }, { submitLabel: 'احجز' });
      el.querySelector('#new').addEventListener('click', () => newAppt());
      el.querySelectorAll('[data-book]').forEach((b) => b.addEventListener('click', () => {
        const r = dueSoon[Number(b.dataset.book)];
        newAppt({ name: r.customer_name, phone: r.phone, car: [r.make, r.model].filter(Boolean).join(' '), service: 'صيانة دورية', customer_id: r.customer_id, vehicle_id: r.vehicle_id });
      }));
      el.querySelectorAll('[data-reminded]').forEach((a) => a.addEventListener('click', () => {
        db.update('job_orders', { id: `eq.${a.dataset.reminded}` }, { reminder_sent_at: new Date().toISOString() }).then(() => setTimeout(reload, 400)).catch(() => {});
      }));
      el.querySelectorAll('[data-confirm]').forEach((a) => a.addEventListener('click', () => {
        db.update('appointments', { id: `eq.${a.dataset.confirm}` }, { status: 'confirmed' }).then(() => setTimeout(reload, 400)).catch(() => {});
      }));
      el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.update('appointments', { id: `eq.${b.dataset.set}` }, { status: b.dataset.to });
        reload();
      })));
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const a = list.find((x) => x.id === b.dataset.edit);
        openDialog('تعديل الموعد', apptForm(a, services), async (d) => {
          await db.update('appointments', { id: `eq.${a.id}` }, apptRow(d));
          toast('حُفظ الموعد'); reload();
        });
      }));

      // Arrival: link to an existing customer/vehicle or create them, then open a job order
      el.querySelectorAll('[data-arrive]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        const a = list.find((x) => x.id === b.dataset.arrive);
        const go = async (customerId, vehicleId) => {
          const jobId = await db.rpc('appointment_arrived', { p_appt: a.id, p_customer: customerId, p_vehicle: vehicleId });
          toast('فُتح أمر العمل');
          location.hash = `#/job/${jobId}`;
        };
        if (a.customer_id && a.vehicle_id) return go(a.customer_id, a.vehicle_id);
        const matches = a.phone ? await db.get('customers', { select: 'id,name,phone,vehicles(*)', phone: `ilike.${like(a.phone.replace(/\D/g, '').slice(-8))}`, limit: 5 }) : [];
        const choices = [];
        matches.forEach((c) => (c.vehicles || []).forEach((v) => choices.push({ c, v })));
        openDialog(`وصول ${a.name}`, `
          ${choices.length ? field('سيارة مسجلة', `<select name="pick">${options(choices.map((x, i) => [i, `${x.c.name} · ${carName(x.v)} ${x.v.plate_number || ''}`]), '0', { empty: 'عميل أو سيارة جديدة' })}</select>`) : '<p class="muted">لم نجد هذا العميل في السجلات. أدخل بيانات سيارته.</p>'}
          <div id="new-car" class="${choices.length ? 'hidden' : ''} stack">
            <div class="grid form">
              ${field('اسم العميل', `<input name="c_name" value="${esc(a.name)}">`)}
              ${field('الهاتف', `<input name="c_phone" type="tel" dir="ltr" value="${esc(a.phone || '')}">`)}
              ${vehicleFields({ make: (a.car || '').split(' ')[0], model: (a.car || '').split(' ').slice(1).join(' ') }).replace('required', '')}
            </div>
          </div>`, async (d) => {
          if (d.pick !== null && d.pick !== undefined && choices[Number(d.pick)]) {
            const x = choices[Number(d.pick)];
            return go(x.c.id, x.v.id);
          }
          if (!d.c_name || !d.make) throw new Error('أدخل اسم العميل والشركة المصنعة');
          const existing = matches[0];
          const c = existing || await db.insert('customers', { name: d.c_name, phone: d.c_phone });
          const v = await db.insert('vehicles', { customer_id: c.id, ...vehicleRow(d) });
          return go(c.id, v.id);
        }, { submitLabel: 'افتح أمر العمل' });
        const sel2 = document.querySelector('dialog [name="pick"]');
        sel2?.addEventListener('change', () => document.querySelector('dialog #new-car').classList.toggle('hidden', sel2.value !== ''));
      })));
    },
  };
}
