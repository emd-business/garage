import { db, like } from '../api.js';
import { idn, esc, num, carName, fromLocalInput, MAKES } from '../format.js';
import { icon, toast, field, options, formData, busy } from '../ui.js';
import { ctx } from '../state.js';
import { plateTag } from './dashboard.js';

const CHECKS = ['الإطار الاحتياطي', 'الرافعة والعدة', 'المفتاح الاحتياطي', 'المسجل والشاشة', 'خدوش ظاهرة', 'أغراض شخصية في السيارة'];

export function vehicleFields(v = {}) {
  return `
    ${field('رقم اللوحة', `<input name="plate_number" inputmode="numeric" dir="ltr" value="${esc(v.plate_number || '')}">`)}
    ${field('حروف اللوحة', `<input name="plate_letters" value="${esc(v.plate_letters || '')}" placeholder="مثال: ا ب">`)}
    ${field('نوع اللوحة', `<select name="plate_type">${options([['private', 'خصوصي'], ['commercial', 'تجاري'], ['other', 'أخرى']], v.plate_type || 'private')}</select>`)}
    ${field('الشركة المصنعة', `<input name="make" list="makes" value="${esc(v.make || '')}" required>`, { req: true })}
    ${field('الطراز', `<input name="model" value="${esc(v.model || '')}">`)}
    ${field('سنة الصنع', `<input name="year" type="number" inputmode="numeric" min="1960" max="2030" value="${esc(v.year || '')}">`)}
    ${field('رقم الشاصي (VIN)', `<input name="vin" dir="ltr" maxlength="17" autocapitalize="characters" value="${esc(v.vin || '')}">`)}
    ${field('اللون', `<input name="color" value="${esc(v.color || '')}">`)}
    <datalist id="makes">${MAKES.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`;
}

export function vehicleRow(d) {
  return {
    plate_number: d.plate_number, plate_letters: d.plate_letters, plate_type: d.plate_type || 'private',
    make: d.make, model: d.model, year: d.year ? Number(d.year) : null, vin: d.vin ? d.vin.toUpperCase() : null, color: d.color,
  };
}

export default async function intake() {
  let picked = null; // { customer, vehicle } ; vehicle null = new vehicle for that customer ; customer null = all new

  const searchHtml = `<section class="card stack">
      <h2>ابحث عن السيارة أو العميل</h2>
      <div class="row" style="flex-wrap:nowrap">
        <input id="q" type="search" placeholder="رقم اللوحة، أو الشاصي، أو هاتف العميل، أو اسمه" aria-label="بحث" autocomplete="off">
      </div>
      <div id="results" aria-live="polite"></div>
      <div><button class="btn" id="new-all">${icon('plus')} عميل وسيارة جديدان</button></div>
    </section>`;

  const jobForm = () => {
    const c = picked.customer, v = picked.vehicle;
    return `<form id="intake-form" class="stack" novalidate>
      <section class="card stack">
        <div class="card-head"><h2>العميل</h2><button type="button" class="btn small ghost" id="change">${icon('back')} تغيير</button></div>
        ${c ? `<p><strong>${esc(c.name)}</strong> · <bdi class="ltr">${esc(c.phone || '')}</bdi></p>`
    : `<div class="grid form">
            ${field('اسم العميل', '<input name="c_name" required autocomplete="off">', { req: true })}
            ${field('الهاتف', '<input name="c_phone" type="tel" inputmode="tel" dir="ltr" required>', { req: true, hint: 'للتواصل عبر واتساب' })}
            ${field('النوع', `<select name="c_type">${options([['individual', 'فرد'], ['company', 'شركة']], 'individual')}</select>`)}
          </div>`}
      </section>
      <section class="card stack">
        <h2>المركبة</h2>
        ${v ? `<p class="row">${plateTag(v)} <strong>${esc(carName(v))}</strong> ${v.vin ? `<bdi class="subtle ltr">${esc(v.vin)}</bdi>` : ''}</p>`
    : `<div class="grid form">${vehicleFields()}</div>`}
      </section>
      <section class="card stack">
        <h2>الاستلام</h2>
        <div class="grid form">
          ${field('شكوى العميل', '<textarea name="complaint" required placeholder="ماذا يشكو منه العميل؟"></textarea>', { req: true, cls: 'span-all' })}
          ${field('قراءة العداد (كم)', `<input name="odometer" type="number" inputmode="numeric" min="0" value="${esc(v?.odometer || '')}">`)}
          <label class="field"><span>مستوى الوقود</span><span class="fuel"><input name="fuel_level" type="range" min="0" max="100" step="25" value="50" aria-label="مستوى الوقود"><output>٥٠٪</output></span></label>
          ${field('موعد التسليم المتوقع', '<input name="promised_at" type="datetime-local">')}
          ${field('الفني المسؤول', `<select name="technician_id">${options(ctx.technicians.map((s) => [s.user_id, s.full_name]), '', { empty: 'لاحقاً' })}</select>`)}
          <fieldset class="span-all" style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:14px;margin-bottom:6px">فحص الاستلام</legend>
            <div class="choice">${CHECKS.map((c2, i) => `<label><input type="checkbox" name="chk_${i}" value="${esc(c2)}"> ${esc(c2)}</label>`).join('')}</div>
          </fieldset>
        </div>
      </section>
      <div class="row"><button class="btn primary">افتح أمر العمل</button></div>
    </form>`;
  };

  return {
    title: 'استلام سيارة',
    html: `<div class="page-head"><div><h1>استلام سيارة</h1><p class="lead">ابحث أولاً، فإن كانت السيارة مسجلة ظهرت مع صاحبها.</p></div></div><div id="stage">${searchHtml}</div>`,
    bind(el) {
      const stage = el.querySelector('#stage');
      let timer;

      const showForm = () => {
        stage.innerHTML = jobForm();
        const form = stage.querySelector('#intake-form');
        const range = form.querySelector('[name="fuel_level"]');
        range.addEventListener('input', () => { range.nextElementSibling.value = `${num(range.value)}٪`; });
        stage.querySelector('#change').addEventListener('click', () => { picked = null; stage.innerHTML = searchHtml; wireSearch(); });
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!form.reportValidity()) return;
          const d = formData(form);
          await busy(ev.submitter, async () => {
            let customer = picked.customer;
            if (!customer) customer = await db.insert('customers', { name: d.c_name, phone: d.c_phone, customer_type: d.c_type });
            let vehicle = picked.vehicle;
            if (!vehicle) vehicle = await db.insert('vehicles', { customer_id: customer.id, ...vehicleRow(d), odometer: d.odometer ? Number(d.odometer) : null });
            else if (d.odometer) await db.update('vehicles', { id: `eq.${vehicle.id}` }, { odometer: Number(d.odometer) });
            const checklist = {};
            CHECKS.forEach((c2, i) => { checklist[c2] = !!d[`chk_${i}`]; });
            const job = await db.insert('job_orders', {
              vehicle_id: vehicle.id, customer_id: customer.id, complaint: d.complaint,
              odometer: d.odometer ? Number(d.odometer) : null, fuel_level: Number(d.fuel_level),
              promised_at: fromLocalInput(d.promised_at), technician_id: d.technician_id, checklist,
            });
            toast(`فُتح أمر العمل رقم ${idn(job.job_no)}`);
            location.hash = `#/job/${job.id}`;
          });
        });
        form.querySelector('input,textarea')?.focus();
      };

      const wireSearch = () => {
        const q = stage.querySelector('#q');
        const results = stage.querySelector('#results');
        q.focus();
        stage.querySelector('#new-all').addEventListener('click', () => { picked = { customer: null, vehicle: null }; showForm(); });
        q.addEventListener('input', () => {
          clearTimeout(timer);
          const term = q.value.trim();
          if (term.length < 2) { results.innerHTML = ''; return; }
          timer = setTimeout(async () => {
            results.innerHTML = '<p class="subtle">جارٍ البحث…</p>';
            try {
              const l = like(term);
              const [vs, cs] = await Promise.all([
                db.get('vehicles', { select: '*,customers(id,name,phone)', or: `(plate_number.ilike.${l},vin.ilike.${l},plate_letters.ilike.${l})`, limit: 10 }),
                db.get('customers', { select: 'id,name,phone,vehicles(*)', or: `(phone.ilike.${l},name.ilike.${l})`, limit: 10 }),
              ]);
              if (q.value.trim() !== term) return;
              const rows = [];
              vs.forEach((v) => rows.push({ c: v.customers, v }));
              cs.forEach((c) => {
                (c.vehicles || []).forEach((v) => { if (!rows.some((r) => r.v && r.v.id === v.id)) rows.push({ c, v }); });
                rows.push({ c, v: null });
              });
              results.innerHTML = rows.length
                ? `<div class="list">${rows.map((r, i) => `<div class="list-item">
                    <span class="row" style="gap:10px">${r.v ? `${plateTag(r.v)} <strong>${esc(carName(r.v))}</strong>` : '<strong>مركبة جديدة</strong>'}
                      <span class="subtle">${esc(r.c?.name || '')} <bdi class="ltr">${esc(r.c?.phone || '')}</bdi></span></span>
                    <button class="btn small teal" data-pick="${i}">${r.v ? 'استلم هذه السيارة' : 'أضف مركبة لهذا العميل'}</button></div>`).join('')}</div>`
                : '<div class="notice info">لا توجد نتائج. أضفه عميلاً جديداً.</div>';
              results.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
                const r = rows[Number(b.dataset.pick)];
                picked = { customer: r.c, vehicle: r.v };
                showForm();
              }));
            } catch (e) { results.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
          }, 300);
        });
      };
      wireSearch();
    },
  };
}
