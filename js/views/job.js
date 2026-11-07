import { db } from '../api.js';
import { idn, esc, money, num, round3, badge, STATUS, FLOW, METHODS, carName, plate, dateTime, toLocalInput, fromLocalInput, waLink } from '../format.js';
import { icon, toast, field, options, formData, busy, openDialog } from '../ui.js';
import { ctx } from '../state.js';
import { plateTag, isLate } from './dashboard.js';
import { uploadMany, photoGrid, photoPicker } from '../media.js';

const APPROVAL = { pending: ['بانتظار العميل', 'warning'], approved: ['وافق العميل', 'success'], declined: ['رفضه العميل', 'danger'] };
const CONDITION = { good: ['سليم', 'success'], attention: ['يحتاج انتباه', 'warning'], urgent: ['عاجل', 'danger'] };
const AREAS = ['الفرامل الأمامية', 'الفرامل الخلفية', 'الإطارات', 'زيت المحرك', 'سائل التبريد', 'البطارية', 'المساعدات', 'الأضواء', 'المكيف', 'ناقل الحركة', 'العادم', 'هيكل السيارة'];
export const portalUrl = (token) => `${location.origin}${location.pathname}#/t/${token}`;
const fmtMin = (m) => { m = Math.max(0, Math.round(Number(m) || 0)); const h = Math.floor(m / 60); return h ? `${num(h)} س ${num(m % 60)} د` : `${num(m)} دقيقة`; };

const TECH_CAN = ['inspection', 'repair', 'qc', 'ready'];

export function computeTotals(lines, vatRate, discount = 0) {
  const sum = (t) => round3(lines.filter((l) => l.type === t && l.approved !== false && !['pending', 'declined'].includes(l.approval_state)).reduce((a, l) => a + Number(l.qty) * Number(l.unit_price), 0));
  const labor = sum('labor'), parts = sum('part');
  const subtotal = round3(labor + parts - discount);
  const vat = round3((subtotal * Number(vatRate)) / 100);
  return { labor, parts, discount, subtotal, vat, total: round3(subtotal + vat) };
}

export default async function job([id]) {
  const office = ctx.can('owner', 'manager', 'reception', 'accountant');
  const editLines = ctx.can('owner', 'manager', 'reception');
  const j = await db.one('job_orders', { id: `eq.${id}`, select: '*,vehicles(*),customers(*)' });
  if (!j) throw new Error('أمر العمل غير موجود أو ليس لديك صلاحية عليه');

  const canInspect = ctx.can('owner', 'manager', 'reception') || j.technician_id === ctx.uid;
  const canTime = ctx.can('owner', 'manager') || j.technician_id === ctx.uid;
  const [lines, services, items, inv, inspection, time] = await Promise.all([
    office ? db.get('job_lines', { job_id: `eq.${id}`, order: 'created_at' }) : db.rpc('job_lines_for_tech', { p_job: id }),
    editLines ? db.get('services', { active: 'eq.true', order: 'name' }) : [],
    editLines ? db.get('items', { active: 'eq.true', order: 'name', select: 'id,name,sku,qty,sell_price,unit_cost,item_stock(branch_id,qty)' })
      .then((its) => its.map((it) => (ctx.multiBranch ? { ...it, qty: (it.item_stock || []).find((s) => s.branch_id === j.branch_id)?.qty ?? 0 } : it))) : [],
    office ? db.one('invoice_balances', { job_id: `eq.${id}` }) : null,
    db.get('inspection_items', { job_id: `eq.${id}`, order: 'created_at' }).catch(() => []),
    db.rpc('job_time', { p_job: id }).catch(() => null),
  ]);
  const payments = inv ? await db.get('payments', { invoice_id: `eq.${inv.id}`, order: 'paid_at' }) : [];
  const v = j.vehicles || {}, c = j.customers || {};
  const g = ctx.garage;
  const est = computeTotals(lines, g.vat_rate, inv ? Number(inv.discount) : 0);
  const stale = inv && payments.length === 0 && Math.abs(est.total - Number(inv.total)) > 0.0005;
  const locked = payments.length > 0;

  // ---- sections ----
  const stepper = `<div class="stepper" role="group" aria-label="مرحلة السيارة">${FLOW.map((s, i) => {
    const cur = FLOW.indexOf(j.status);
    const allowed = j.status !== 'cancelled' && (ctx.can('owner', 'manager', 'reception') || (ctx.isTech && TECH_CAN.includes(s)));
    return `<button type="button" data-status="${s}" aria-pressed="${s === j.status}" class="${i < cur ? 'done' : ''}" ${allowed && s !== j.status ? '' : 'disabled'}>${esc(STATUS[s].label)}</button>`;
  }).join('')}</div>`;

  const lineRow = (l) => `<tr>
      <td><span class="badge ${l.type === 'part' ? 'info' : 'neutral'}">${l.type === 'part' ? 'قطعة' : 'عمالة'}</span></td>
      <td>${esc(l.description)}${l.technician_id && ctx.staffName(l.technician_id) ? `<br><span class="subtle">${esc(ctx.staffName(l.technician_id))}</span>` : ''}
        ${APPROVAL[l.approval_state] ? ` <span class="badge ${APPROVAL[l.approval_state][1]}">${APPROVAL[l.approval_state][0]}</span>` : ''}
        ${Number(l.warranty_days) ? ` <span class="subtle">· ضمان ${num(l.warranty_days)} يوماً</span>` : ''}
        ${editLines && !locked && l.approval_state === 'pending' ? `<br><span class="row" style="gap:6px;margin-top:4px"><button class="btn small ghost" data-decide="${l.id}" data-to="approved">وافق هاتفياً</button><button class="btn small ghost" data-decide="${l.id}" data-to="declined">رفض</button></span>` : ''}</td>
      <td class="num" style="${l.approval_state === 'declined' ? 'text-decoration:line-through;color:var(--ink-subtle)' : ''}">${num(l.qty)}</td>
      ${office ? `<td class="num">${money(l.unit_price)}</td><td class="num">${money(Number(l.qty) * Number(l.unit_price))}</td>` : ''}
      ${editLines && !locked ? `<td><button class="btn small ghost icon-btn" data-del-line="${l.id}" aria-label="احذف البند">${icon('trash')}</button></td>` : ''}
    </tr>`;

  const linesCard = `<section class="card pad-0">
      <div class="card-head" style="padding:16px 20px 0"><h2>الأعمال والقطع</h2>
        ${editLines && !locked ? `<div class="row"><button class="btn small" data-add="labor">${icon('plus')} عمالة</button><button class="btn small" data-add="part">${icon('plus')} قطعة</button></div>` : ''}</div>
      ${locked ? '<div class="notice info" style="margin:12px 20px 0">على الفاتورة دفعات، فالبنود مقفلة.</div>' : ''}
      ${lines.length ? `<div class="table-wrap"><table>
        <thead><tr><th>النوع</th><th>الوصف</th><th class="num">الكمية</th>${office ? '<th class="num">السعر</th><th class="num">المجموع</th>' : ''}${editLines && !locked ? '<th><span class="hidden">حذف</span></th>' : ''}</tr></thead>
        <tbody>${lines.map(lineRow).join('')}</tbody></table></div>`
    : '<div class="empty"><p>لم تُضف أعمال أو قطع بعد.</p></div>'}
    </section>`;

  const inspectionCard = `<section class="card stack">
      <div class="card-head" style="margin:0"><h2>الفحص الرقمي</h2>${canInspect && !['delivered', 'cancelled'].includes(j.status) ? `<button class="btn small" id="add-insp">${icon('plus')} ملاحظة فحص</button>` : ''}</div>
      ${inspection.length ? `<div class="list">${inspection.map((it) => `<div class="list-item" style="align-items:flex-start">
          <div class="stack" style="gap:6px;min-width:0"><span><span class="badge ${CONDITION[it.condition][1]}">${CONDITION[it.condition][0]}</span> <strong>${esc(it.area)}</strong></span>
            ${it.note ? `<span>${esc(it.note)}</span>` : ''}${photoGrid(it.photos)}</div>
          ${canInspect ? `<button class="btn small ghost icon-btn" data-del-insp="${it.id}" aria-label="احذف الملاحظة">${icon('trash')}</button>` : ''}</div>`).join('')}</div>`
    : '<p class="muted">لا توجد ملاحظات فحص. صوّر ما يجده الفني، فيراه العميل في رابط المتابعة.</p>'}
    </section>`;

  const photosCard = `<section class="card stack">
      <div class="card-head" style="margin:0"><h2>صور الاستلام</h2>${ctx.can('owner', 'manager', 'reception') ? photoPicker('job-photos', 'صوّر') : ''}</div>
      ${(j.photos || []).length ? photoGrid(j.photos, { removable: ctx.can('owner', 'manager', 'reception') }) : '<p class="muted">لا توجد صور. صوّر السيارة من الجهات الأربع عند استلامها.</p>'}
    </section>`;

  const timerCard = canTime && !['delivered', 'cancelled'].includes(j.status) || (time && time.total_min > 0) ? `<section class="card stack">
      <h2>وقت العمل</h2>
      <p>الوقت المسجّل: <strong>${fmtMin(time?.total_min)}</strong>${time?.mine_running ? ` · <span class="badge success">يعمل منذ ${esc(dateTime(time.running_since))}</span>` : ''}</p>
      ${(time?.by_user || []).length > 1 ? `<p class="subtle">${time.by_user.map((u) => `${esc(u.name)}: ${fmtMin(u.min)}`).join(' · ')}</p>` : ''}
      ${canTime && !['delivered', 'cancelled'].includes(j.status) ? `<button class="btn ${time?.mine_running ? 'danger' : 'teal'}" id="timer">${time?.mine_running ? 'أوقف العمل' : 'ابدأ العمل'}</button>` : ''}
    </section>` : '';

  const pending = lines.filter((l) => l.approval_state === 'pending').length;
  const linkCard = office && j.public_token ? `<section class="card stack">
      <h2>رابط العميل</h2>
      <p class="subtle">يرى منه العميل مرحلة سيارته وصور الفحص والأسعار، ويوافق على البنود أو يرفضها بنفسه.</p>
      ${pending ? `<div class="notice warn">${num(pending)} بند بانتظار موافقة العميل</div>` : ''}
      <div class="row">
        ${editLines && !locked && lines.some((l) => l.approval_state === 'na') && !['delivered', 'cancelled'].includes(j.status) ? `<button class="btn primary" id="req-approval">${icon('wa')} اطلب موافقة العميل</button>` : ''}
        ${c.phone ? `<a class="btn small wa" target="_blank" rel="noopener" href="${esc(waLink(c.phone, `${c.name ? `مرحباً ${c.name}، ` : ''}تابع سيارتك ${carName(v)} في ${g.name} من هذا الرابط:\n${portalUrl(j.public_token)}`))}">${icon('wa')} أرسل الرابط</a>` : ''}
        <button class="btn small" id="copy-link">انسخ الرابط</button>
        <a class="btn small ghost" href="#/t/${esc(j.public_token)}" target="_blank" rel="noopener">معاينة</a>
      </div>
    </section>` : '';

  const notesCard = `<form class="card stack" id="notes" novalidate>
      <h2>التشخيص والملاحظات</h2>
      ${field('شكوى العميل', `<textarea disabled>${esc(j.complaint || '')}</textarea>`)}
      ${field('تشخيص الفني', `<textarea name="diagnosis" placeholder="ماذا وجد الفني؟">${esc(j.diagnosis || '')}</textarea>`)}
      ${field('ملاحظات داخلية', `<textarea name="notes">${esc(j.notes || '')}</textarea>`)}
      <div><button class="btn">احفظ الملاحظات</button></div>
    </form>`;

  const detailsCard = ctx.can('owner', 'manager', 'reception') ? `<form class="card stack" id="details" novalidate>
      <h2>تفاصيل الأمر</h2>
      <div class="grid form">
        ${field('الفني المسؤول', `<select name="technician_id">${options(ctx.technicians.map((s) => [s.user_id, s.full_name]), j.technician_id, { empty: 'غير محدد' })}</select>`)}
        ${field('موعد التسليم', `<input name="promised_at" type="datetime-local" value="${esc(toLocalInput(j.promised_at))}">`)}
        ${field('الصيانة القادمة (كم)', `<input name="next_service_km" type="number" inputmode="numeric" value="${esc(j.next_service_km || '')}">`)}
        ${field('الصيانة القادمة (تاريخ)', `<input name="next_service_date" type="date" value="${esc(j.next_service_date || '')}">`)}
      </div>
      <div class="row"><button class="btn">احفظ</button>${j.status !== 'cancelled' && j.status !== 'delivered' ? '<button type="button" class="btn danger" id="cancel-job">ألغِ الأمر</button>' : ''}</div>
    </form>` : '';

  const totalsHtml = (t, paid, balance) => `<div class="totals">
      <span>العمالة</span><span class="num">${money(t.labor_total ?? t.labor)}</span>
      <span>القطع</span><span class="num">${money(t.parts_total ?? t.parts)}</span>
      ${Number(t.discount) ? `<span>الخصم</span><span class="num">− ${money(t.discount)}</span>` : ''}
      <span>قبل الضريبة</span><span class="num">${money(t.subtotal)}</span>
      <span>ضريبة القيمة المضافة ${num(g.vat_rate)}٪</span><span class="num">${money(t.vat)}</span>
      <span class="grand">الإجمالي</span><span class="num grand">${money(t.total)}</span>
      ${paid !== undefined ? `<span>المدفوع</span><span class="num">${money(paid)}</span><span><strong>المتبقي</strong></span><span class="num"><strong>${money(balance)}</strong></span>` : ''}
    </div>`;

  const invoiceCard = !office ? '' : `<section class="card stack">
      <div class="card-head" style="margin:0"><h2>${inv ? `فاتورة رقم ${idn(inv.invoice_no)}` : 'التكلفة التقديرية'}</h2>
        <a class="btn small" href="#/print/${j.id}" target="_blank" rel="noopener">${icon('print')} ${inv ? 'الفاتورة' : 'عرض السعر'}</a></div>
      ${inv ? totalsHtml(inv, inv.paid, inv.balance) : totalsHtml(est)}
      ${stale ? '<div class="notice warn">تغيّرت البنود بعد إصدار الفاتورة. حدّثها قبل التحصيل.</div>' : ''}
      ${!inv || stale ? `<form id="issue" class="row" novalidate style="align-items:flex-end">
          ${field('الخصم (ر.ع)', `<input name="discount" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(inv ? inv.discount : 0)}" style="max-width:140px">`)}
          <button class="btn primary" ${lines.length ? '' : 'disabled'}>${inv ? 'حدّث الفاتورة' : 'أصدر الفاتورة'}</button>
        </form>` : ''}
      ${inv && Number(inv.balance) > 0.0005 && !stale ? `<form id="pay" class="stack" novalidate>
          <h3>تسجيل دفعة</h3>
          <div class="grid form" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
            ${field('المبلغ', `<input name="amount" type="number" step="0.001" min="0.001" max="${esc(inv.balance)}" inputmode="decimal" required value="${esc(Number(inv.balance).toFixed(3))}">`, { req: true })}
            ${field('الطريقة', `<select name="method">${options(Object.entries(METHODS), 'cash')}</select>`)}
            ${field('مرجع', '<input name="reference" placeholder="اختياري">')}
          </div>
          <div><button class="btn teal">سجّل الدفعة</button></div>
        </form>` : ''}
      ${payments.length ? `<div><h3>الدفعات</h3><div class="list">${payments.map((p) => `<div class="list-item"><span>سند ${idn(p.receipt_no)} · ${esc(METHODS[p.method])}<br><span class="subtle">${esc(dateTime(p.paid_at))}</span></span><strong>${money(p.amount)}</strong></div>`).join('')}</div></div>` : ''}
      ${j.status === 'ready' && ctx.can('owner', 'manager', 'reception') ? `<button class="btn ${inv && Number(inv.balance) <= 0.0005 ? 'primary' : ''}" data-status="delivered">سلّم السيارة للعميل</button>` : ''}
    </section>`;

  // WhatsApp templates
  const total = inv ? inv.total : est.total;
  const who = c.name ? `مرحباً ${c.name}،` : 'مرحباً،';
  const car = `${carName(v)}${plate(v) ? ` (${plate(v)})` : ''}`;
  const msgs = [
    ['تم الاستلام', `${who} استلمنا سيارتك ${car} في ${g.name}. رقم أمر العمل ${j.job_no}.${j.promised_at ? ` موعد التسليم المتوقع ${dateTime(j.promised_at)}.` : ''}`],
    ['طلب موافقة', `${who} انتهينا من فحص سيارتك ${car}.${j.diagnosis ? `\nالتشخيص: ${j.diagnosis}` : ''}\nالتكلفة التقديرية ${money(total)} شاملة الضريبة.\nهل توافق على البدء في الإصلاح؟`],
    ['السيارة جاهزة', `${who} سيارتك ${car} جاهزة للاستلام من ${g.name}.${inv ? ` المبلغ المستحق ${money(inv.balance)}.` : ''}`],
    ...(inv ? [['الفاتورة', `${who} فاتورة رقم ${inv.invoice_no} من ${g.name} بمبلغ ${money(inv.total)}. المدفوع ${money(inv.paid)}، والمتبقي ${money(inv.balance)}. شكراً لثقتك.`]] : []),
    ...(j.next_service_km || j.next_service_date ? [['تذكير الصيانة', `${who} نذكّرك بموعد الصيانة القادمة لسيارتك ${car}${j.next_service_km ? ` عند ${j.next_service_km} كم` : ''}${j.next_service_date ? ` أو بتاريخ ${j.next_service_date}` : ''}. يسعدنا خدمتك في ${g.name}.`]] : []),
  ];
  const waCard = office && c.phone ? `<section class="card stack"><h2>رسائل واتساب</h2>
      <div class="row">${msgs.map(([l, t]) => `<a class="btn small wa" href="${esc(waLink(c.phone, t))}" target="_blank" rel="noopener">${icon('wa')} ${esc(l)}</a>`).join('')}</div></section>` : '';

  const checklist = Object.entries(j.checklist || {});
  const infoCard = `<section class="card stack">
      <h2>الاستلام</h2>
      <div class="totals" style="font-size:14px">
        <span class="muted">الاستلام</span><span>${esc(dateTime(j.received_at))}</span>
        ${j.odometer ? `<span class="muted">العداد</span><span>${num(j.odometer)} كم</span>` : ''}
        ${j.fuel_level !== null && j.fuel_level !== undefined ? `<span class="muted">الوقود</span><span>${num(j.fuel_level)}٪</span>` : ''}
        ${j.promised_at ? `<span class="muted">التسليم المتوقع</span><span>${esc(dateTime(j.promised_at))}</span>` : ''}
        ${v.vin ? `<span class="muted">الشاصي</span><bdi class="ltr">${esc(v.vin)}</bdi>` : ''}
      </div>
      ${checklist.length ? `<div class="row" style="gap:6px">${checklist.map(([k, ok]) => `<span class="badge ${ok ? 'success' : 'neutral'}">${ok ? '✓' : '—'} ${esc(k)}</span>`).join('')}</div>` : ''}
    </section>`;

  return {
    title: `أمر ${j.job_no}`,
    html: `<div class="page-head">
        <div class="stack" style="gap:6px">
          <a href="#/board" class="subtle">${icon('back').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} لوحة الورشة</a>
          <h1 class="row" style="gap:10px">أمر عمل ${idn(j.job_no)} ${badge(j.status)} ${isLate(j) ? '<span class="badge danger">متأخرة</span>' : ''}${ctx.multiBranch ? ` <span class="badge neutral">${esc(ctx.branchName(j.branch_id))}</span>` : ''}${j.comeback_of ? ` <a class="badge warning" href="#/job/${j.comeback_of}">عودة ضمن الضمان</a>` : ''}</h1>
          <p class="row" style="gap:10px">${plateTag(v)} <strong>${esc(carName(v))}</strong>${office ? ` · <a href="#/customer/${c.id}">${esc(c.name || '')}</a> ${c.phone ? `<a href="tel:${esc(c.phone)}"><bdi class="ltr">${esc(c.phone)}</bdi></a>` : ''}` : ''}</p>
        </div>
        <a class="btn small" href="#/print/${j.id}/card" target="_blank" rel="noopener">${icon('print')} كرت الورشة</a>
      </div>
      ${stepper}
      <div class="cols">
        <div class="stack">${linesCard}${inspectionCard}${notesCard}${detailsCard}</div>
        <div class="stack">${invoiceCard}${linkCard}${timerCard}${waCard}${photosCard}${infoCard}</div>
      </div>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

      el.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.update('job_lines', { id: `eq.${b.dataset.decide}` }, { approval_state: b.dataset.to });
        toast(b.dataset.to === 'approved' ? 'سُجّلت الموافقة' : 'سُجّل الرفض، ولن يدخل البند الفاتورة'); reload();
      })));
      el.querySelector('#timer')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const r = await db.rpc('timer_toggle', { p_job: j.id });
        toast(r.running ? 'بدأ احتساب الوقت' : 'توقف احتساب الوقت'); reload();
      }));
      el.querySelector('#req-approval')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const token = await db.rpc('request_approval', { p_job: j.id });
        const msg = `${c.name ? `مرحباً ${c.name}، ` : ''}انتهينا من فحص سيارتك ${carName(v)} في ${g.name}. راجع ما وجدناه والأسعار، ووافق على ما تريد إصلاحه من هذا الرابط:\n${portalUrl(token)}`;
        if (c.phone) window.open(waLink(c.phone, msg), '_blank', 'noopener');
        toast('أُرسل طلب الموافقة'); reload();
      }));
      el.querySelector('#copy-link')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(portalUrl(j.public_token)); toast('نُسخ الرابط'); } catch { toast(portalUrl(j.public_token)); }
      });
      el.querySelector('[name="job-photos"]')?.addEventListener('change', async (ev) => {
        const files = [...ev.target.files]; if (!files.length) return;
        toast('جارٍ رفع الصور…');
        try {
          const urls = await uploadMany(files, `jobs/${j.id}`);
          await db.update('job_orders', { id: `eq.${j.id}` }, { photos: [...(j.photos || []), ...urls] });
          toast(`رُفعت ${num(urls.length)} صورة`); reload();
        } catch (e) { toast(e.message, 'error'); }
      });
      el.querySelectorAll('[data-rm-photo]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        const photos = [...(j.photos || [])]; photos.splice(Number(b.dataset.rmPhoto), 1);
        await db.update('job_orders', { id: `eq.${j.id}` }, { photos }); reload();
      })));
      el.querySelectorAll('[data-del-insp]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.remove('inspection_items', { id: `eq.${b.dataset.delInsp}` }); reload();
      })));
      el.querySelector('#add-insp')?.addEventListener('click', () => {
        const d = openDialog('ملاحظة فحص', `
          ${field('الجزء', `<input name="area" list="areas" required>`, { req: true })}
          <datalist id="areas">${AREAS.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
          <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:14px;margin-bottom:6px">الحالة</legend>
            <div class="choice">${Object.entries(CONDITION).map(([k, [l]], i) => `<label><input type="radio" name="condition" value="${k}" ${k === 'attention' ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>
          ${field('ملاحظة الفني', '<textarea name="note" placeholder="مثال: سماكة الفحمات ٢ مم"></textarea>')}
          <div class="stack" style="gap:8px">${photoPicker('insp-photos', 'صوّر الجزء')}<div id="insp-preview" class="photos"></div></div>`, async (data, form) => {
          const files = [...(form.querySelector('[name="insp-photos"]').files || [])];
          const photos = files.length ? await uploadMany(files, `jobs/${j.id}`) : [];
          await db.insert('inspection_items', { job_id: j.id, area: data.area, condition: data.condition || 'attention', note: data.note, photos });
          toast('أُضيفت ملاحظة الفحص'); reload();
        }, { submitLabel: 'أضف' });
        d.querySelector('[name="insp-photos"]').addEventListener('change', (e) => {
          d.querySelector('#insp-preview').innerHTML = [...e.target.files].map((f) => `<span class="ph"><img src="${URL.createObjectURL(f)}" alt=""></span>`).join('');
        });
      });

      el.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.rpc('set_job_status', { p_job: j.id, p_status: b.dataset.status });
        toast(`المرحلة الآن: ${STATUS[b.dataset.status].label}`);
        reload();
      })));

      el.querySelector('#notes')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const d = formData(ev.target);
        busy(ev.submitter, async () => {
          await db.rpc('set_job_notes', { p_job: j.id, p_diagnosis: d.diagnosis, p_notes: d.notes });
          toast('حُفظت الملاحظات');
        });
      });

      el.querySelector('#details')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const d = formData(ev.target);
        busy(ev.submitter, async () => {
          await db.update('job_orders', { id: `eq.${j.id}` }, {
            technician_id: d.technician_id, promised_at: fromLocalInput(d.promised_at),
            next_service_km: d.next_service_km ? Number(d.next_service_km) : null, next_service_date: d.next_service_date,
          });
          toast('حُفظت التفاصيل');
          reload();
        });
      });

      el.querySelector('#cancel-job')?.addEventListener('click', () => openDialog('إلغاء أمر العمل', '<p>سيُنقل الأمر إلى «ملغاة». القطع المصروفة تبقى مسجلة على الأمر إلى أن تحذفها.</p>', async () => {
        await db.rpc('set_job_status', { p_job: j.id, p_status: 'cancelled' });
        reload();
      }, { submitLabel: 'ألغِ الأمر', danger: true }));

      el.querySelectorAll('[data-del-line]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.remove('job_lines', { id: `eq.${b.dataset.delLine}` });
        toast('حُذف البند');
        reload();
      })));

      el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
        const type = b.dataset.add;
        const list = type === 'labor' ? services : items;
        const pick = type === 'labor'
          ? field('من قائمة الخدمات', `<select name="ref">${options(services.map((s) => [s.id, `${s.name} · ${num(s.std_hours)} ساعة`]), '', { empty: 'خدمة أخرى' })}</select>`)
          : field('الصنف من المخزون', `<select name="ref">${options(items.map((it) => [it.id, `${it.name}${it.sku ? ` (${it.sku})` : ''} · متوفر ${num(it.qty)}`]), '', { empty: 'قطعة من خارج المخزون' })}</select>`);
        const d = openDialog(type === 'labor' ? 'إضافة عمالة' : 'إضافة قطعة', `
          ${pick}
          ${field('الوصف', '<input name="description" required>', { req: true })}
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field(type === 'labor' ? 'الساعات / الكمية' : 'الكمية', '<input name="qty" type="number" step="0.25" min="0.25" value="1" inputmode="decimal" required>', { req: true })}
            ${field('سعر الوحدة (ر.ع)', '<input name="unit_price" type="number" step="0.001" min="0" inputmode="decimal" required>', { req: true })}
          </div>
          ${type === 'labor' ? field('الفني', `<select name="technician_id">${options(ctx.technicians.map((s) => [s.user_id, s.full_name]), j.technician_id, { empty: 'غير محدد' })}</select>`) : ''}
          <p class="subtle" id="stock-hint"></p>`, async (data) => {
          const row = {
            job_id: j.id, type, description: data.description, qty: Number(data.qty), unit_price: Number(data.unit_price),
            technician_id: data.technician_id || null,
          };
          if (type === 'labor' && data.ref) row.service_id = data.ref;
          if (type === 'part' && data.ref) {
            row.item_id = data.ref;
            row.unit_cost = Number(items.find((x) => x.id === data.ref)?.unit_cost || 0);
          }
          await db.insert('job_lines', row);
          toast('أُضيف البند');
          reload();
        }, { submitLabel: 'أضف' });
        const sel = d.querySelector('[name="ref"]');
        sel.addEventListener('change', () => {
          const x = list.find((r) => r.id === sel.value);
          if (!x) return;
          d.querySelector('[name="description"]').value = x.name;
          if (type === 'labor') {
            const price = Number(x.price) > 0 ? Number(x.price) : Number(x.std_hours) * Number(g.labor_rate);
            d.querySelector('[name="unit_price"]').value = price.toFixed(3);
          } else {
            d.querySelector('[name="unit_price"]').value = Number(x.sell_price).toFixed(3);
            d.querySelector('#stock-hint').textContent = Number(x.qty) <= 0 ? 'تنبيه: الصنف نافد في المخزون، وستصبح الكمية بالسالب.' : `المتوفر ${num(x.qty)}`;
          }
        });
      }));

      el.querySelector('#issue')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const d = formData(ev.target);
        busy(ev.submitter, async () => {
          const r = await db.rpc('create_invoice', { p_job: j.id, p_discount: Number(d.discount || 0) });
          toast(`صدرت الفاتورة رقم ${idn(r.invoice_no)}`);
          reload();
        });
      });

      el.querySelector('#pay')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (!f.reportValidity()) return;
        const d = formData(f);
        busy(ev.submitter, async () => {
          const p = await db.insert('payments', { invoice_id: inv.id, amount: Number(d.amount), method: d.method, reference: d.reference });
          toast(`سُجّلت الدفعة، سند قبض ${idn(p.receipt_no)}`);
          reload();
        });
      });
    },
  };
}
