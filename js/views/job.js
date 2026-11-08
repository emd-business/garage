import { db } from '../api.js';
import { idn, esc, money, num, round3, badge, STATUS, FLOW, METHODS, carName, plate, dateTime, toLocalInput, fromLocalInput, waLink, CONDITION as PART_COND, fitsVehicle, fitsText } from '../format.js';
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
    editLines ? db.get('items', { active: 'eq.true', order: 'name', select: 'id,name,sku,qty,sell_price,unit_cost,condition,fits,item_stock(branch_id,qty)' })
      .then((its) => its.map((it) => (ctx.multiBranch ? { ...it, qty: (it.item_stock || []).find((s) => s.branch_id === j.branch_id)?.qty ?? 0 } : it))) : [],
    office ? db.one('invoice_balances', { job_id: `eq.${id}` }) : null,
    db.get('inspection_items', { job_id: `eq.${id}`, order: 'created_at' }).catch(() => []),
    db.rpc('job_time', { p_job: id }).catch(() => null),
  ]);
  const [payments, credits] = inv ? await Promise.all([
    db.get('payments', { invoice_id: `eq.${inv.id}`, order: 'paid_at' }),
    db.get('credit_notes', { invoice_id: `eq.${inv.id}`, order: 'issued_at' }).catch(() => []),
  ]) : [[], []];
  const office0 = ctx.can('owner', 'manager', 'reception', 'accountant');
  const [deposits, insurers] = await Promise.all([
    office0 ? db.get('deposit_balances', { job_id: `eq.${id}`, order: 'paid_at' }).catch(() => []) : [],
    office0 && inv ? db.get('customers', { customer_type: 'eq.insurance', select: 'id,name', order: 'name' }).catch(() => []) : [],
  ]);
  const realPayments = payments.filter((p) => !p.deposit_id);
  const v = j.vehicles || {}, c = j.customers || {};
  const g = ctx.garage;
  const est = computeTotals(lines, g.vat_rate, inv ? Number(inv.discount) : 0);
  const stale = inv && realPayments.length === 0 && !credits.length && Math.abs(est.total - Number(inv.total)) > 0.0005;
  const locked = realPayments.length > 0 || credits.length > 0;
  const canCredit = inv && ctx.can('owner', 'manager', 'accountant');
  const creditLeft = inv ? round3(Number(inv.subtotal) - credits.reduce((a, x) => a + Number(x.subtotal), 0)) : 0;

  // ---- sections ----
  const stepper = `<div class="stepper" role="group" aria-label="مرحلة السيارة">${FLOW.map((s, i) => {
    const cur = FLOW.indexOf(j.status);
    // a delivered or cancelled job is closed; only the owner or a manager reopens it
    const closed = ['delivered', 'cancelled'].includes(j.status);
    const allowed = closed ? ctx.can('owner', 'manager') : (ctx.can('owner', 'manager', 'reception') || (ctx.isTech && TECH_CAN.includes(s)));
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
      ${t.credited && Number(t.credited) ? `<span>إشعارات دائنة</span><span class="num">− ${money(t.credited)}</span>` : ''}
      ${t.insurer_id && Number(t.insurer_amount) ? `<span>حصة التأمين${t.claim_no ? ` · مطالبة <bdi class="ltr">${esc(t.claim_no)}</bdi>` : ''}</span><span class="num">${money(t.insurer_amount)}</span>
        <span>حصة العميل</span><span class="num">${money(Number(t.total) - Number(t.insurer_amount))}</span>` : ''}
      ${paid !== undefined ? `<span>المدفوع</span><span class="num">${money(paid)}</span><span><strong>المتبقي</strong></span><span class="num"><strong>${money(balance)}</strong></span>` : ''}
      ${t.insurer_id && Number(t.insurer_amount) && paid !== undefined ? `<span class="subtle">منها على العميل</span><span class="num subtle">${money(t.customer_balance)}</span><span class="subtle">ومنها على التأمين</span><span class="num subtle">${money(t.insurer_balance)}</span>` : ''}
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
            ${inv.insurer_id ? field('الدافع', `<select name="payer">${options([['customer', 'العميل'], ['insurer', 'شركة التأمين']], Number(inv.customer_balance) > 0.0005 ? 'customer' : 'insurer')}</select>`) : ''}
            ${field('المبلغ', `<input name="amount" type="number" step="0.001" min="0.001" max="${esc(inv.balance)}" inputmode="decimal" required value="${esc(Number(inv.insurer_id ? (Number(inv.customer_balance) > 0.0005 ? inv.customer_balance : inv.insurer_balance) : inv.balance).toFixed(3))}">`, { req: true })}
            ${field('الطريقة', `<select name="method">${options(Object.entries(METHODS), 'cash')}</select>`)}
            ${field('مرجع', '<input name="reference" placeholder="اختياري">')}
          </div>
          <div><button class="btn teal">سجّل الدفعة</button></div>
        </form>` : ''}
      ${credits.length ? `<div><h3>الإشعارات الدائنة</h3><div class="list">${credits.map((x) => `<div class="list-item" style="flex-wrap:wrap;row-gap:6px"><span style="flex:1 1 160px">إشعار ${idn(x.credit_no)} · ${esc(x.reason)}<br><span class="subtle">${esc(dateTime(x.issued_at))}${Number(x.refund_amount) ? ` · رُدّ للعميل ${money(x.refund_amount)} ${esc(METHODS[x.refund_method] || '')}` : ''}</span></span>
          <span class="row" style="gap:6px;flex-wrap:nowrap"><strong>− ${money(x.total)}</strong><a class="btn small ghost" href="#/print/${j.id}/credit/${x.id}" target="_blank" rel="noopener" aria-label="اطبع الإشعار ${idn(x.credit_no)}">${icon('print')}</a><button type="button" class="btn small ghost" data-xml-cn="${x.id}" aria-label="ملف XML للإشعار ${idn(x.credit_no)}">XML</button></span></div>`).join('')}</div></div>` : ''}
      ${deposits.length ? `<div><h3>العربون</h3><div class="list">${deposits.map((x) => `<div class="list-item" style="flex-wrap:wrap;row-gap:6px"><span style="flex:1 1 160px">سند ${idn(x.receipt_no)} · ${esc(METHODS[x.method])}<br><span class="subtle">${esc(dateTime(x.paid_at))}${Number(x.applied) ? ` · خُصم من الفاتورة ${money(x.applied)}` : ''}${Number(x.refunded) ? ` · رُدّ ${money(x.refunded)}` : ''}</span></span>
          <span class="row" style="gap:6px;flex-wrap:nowrap"><strong>${money(x.amount)}</strong>${Number(x.remaining) > 0.0005 && ctx.can('owner', 'manager', 'accountant') ? `<button type="button" class="btn small ghost" data-refund-dep="${x.id}">ردّ ${money(x.remaining)}</button>` : ''}</span></div>`).join('')}</div>
          ${!inv && deposits.some((x) => Number(x.remaining) > 0.0005) ? '<p class="subtle">يُخصم العربون تلقائياً عند إصدار الفاتورة.</p>' : ''}</div>` : ''}
      ${!['delivered', 'cancelled'].includes(j.status) && (!inv || Number(inv.balance) > 0.0005) ? '<div><button type="button" class="btn small" id="deposit">عربون مقدّم</button></div>' : ''}
      ${inv ? `<div class="row" style="gap:8px">
          ${canCredit && creditLeft > 0.0005 ? '<button type="button" class="btn small" id="credit">إشعار دائن</button>' : ''}
          ${!credits.length ? `<button type="button" class="btn small" id="insurance">${inv.insurer_id ? 'تعديل التأمين' : 'مطالبة تأمين'}</button>` : ''}
          <button type="button" class="btn small ghost" id="xml-inv" title="ملف الفاتورة الإلكترونية بصيغة UBL لمزوّد فوترة">ملف XML للفوترة</button>
        </div>` : ''}
      ${payments.length ? `<div><h3>الدفعات</h3><div class="list">${payments.map((p) => `<div class="list-item"><span>سند ${idn(p.receipt_no)} · ${p.deposit_id ? 'من العربون' : esc(METHODS[p.method])}${p.payer === 'insurer' ? ' · شركة التأمين' : ''}<br><span class="subtle">${esc(dateTime(p.paid_at))}</span></span><strong>${money(p.amount)}</strong></div>`).join('')}</div></div>` : ''}
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
          : (() => {
            // parts listed for this car first, then parts for any car; parts for other cars last
            const rank = (it) => (fitsVehicle(it.fits, v) ? 0 : (it.fits || []).length ? 2 : 1);
            const label = (it) => `${it.name}${it.condition && it.condition !== 'new' ? ` (${PART_COND[it.condition][0]})` : ''}${it.sku ? ` · ${it.sku}` : ''} · متوفر ${num(it.qty)}`;
            const grp = (r, t) => { const l = items.filter((it) => rank(it) === r); return l.length ? `<optgroup label="${t}">${l.map((it) => `<option value="${it.id}">${esc(label(it))}</option>`).join('')}</optgroup>` : ''; };
            return field('الصنف من المخزون', `<select name="ref"><option value="">قطعة من خارج المخزون</option>
              ${grp(0, `تناسب ${carName(v)}`)}${grp(1, 'تناسب كل السيارات')}${grp(2, 'لسيارات أخرى')}</select>`);
          })();
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
          d.querySelector('[name="description"]').value = x.condition && x.condition !== 'new' ? `${x.name} (${PART_COND[x.condition][0]})` : x.name;
          if (type === 'labor') {
            const price = Number(x.price) > 0 ? Number(x.price) : Number(x.std_hours) * Number(g.labor_rate);
            d.querySelector('[name="unit_price"]').value = price.toFixed(3);
          } else {
            d.querySelector('[name="unit_price"]').value = Number(x.sell_price).toFixed(3);
            const fitNote = (x.fits || []).length && !fitsVehicle(x.fits, v) ? ` · تنبيه: هذه القطعة مسجّلة لـ ${fitsText(x.fits)}` : '';
            d.querySelector('#stock-hint').textContent = (Number(x.qty) <= 0 ? 'تنبيه: الصنف نافد في المخزون، وستصبح الكمية بالسالب.' : `المتوفر ${num(x.qty)}`) + fitNote;
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

      el.querySelector('#credit')?.addEventListener('click', () => {
        const d = openDialog(`إشعار دائن على الفاتورة ${idn(inv.invoice_no)}`, `
          <p class="muted">الفاتورة الصادرة لا تُعدَّل، ويُخفَّض مبلغها بإشعار دائن يُسجَّل في الحسابات ويظهر في كشف العميل.</p>
          ${field('المبلغ قبل الضريبة (ر.ع)', `<input name="subtotal" type="number" step="0.001" min="0.001" max="${creditLeft}" inputmode="decimal" required value="${creditLeft.toFixed(3)}">`, { req: true, hint: `أقصى مبلغ ${money(creditLeft)}، وتُضاف إليه الضريبة ${num(inv.vat_rate)}٪` })}
          ${field('السبب', '<input name="reason" required placeholder="مثال: خصم بعد الإصدار، إرجاع قطعة، خطأ في السعر">', { req: true })}
          <p id="cn-total" class="subtle"></p>
          <div id="refund-box" class="stack">
            ${field('المبلغ المردود للعميل (ر.ع)', '<input name="refund" type="number" step="0.001" min="0" inputmode="decimal" value="0">', { hint: 'إن كان العميل قد دفع أكثر مما عليه بعد الإشعار' })}
            ${field('طريقة الرد', `<select name="method">${options(Object.entries(METHODS), 'cash')}</select>`)}
          </div>`, async (v) => {
          const r = await db.rpc('issue_credit_note', { p_invoice: inv.id, p_subtotal: Number(v.subtotal), p_reason: v.reason, p_refund: Number(v.refund || 0), p_method: v.method });
          toast(`صدر الإشعار الدائن رقم ${idn(r.credit_no)}`);
          reload();
        }, { submitLabel: 'أصدر الإشعار' });
        const upd = () => {
          const sub = Number(d.querySelector('[name=subtotal]').value || 0), tot = round3(sub * (1 + Number(inv.vat_rate) / 100));
          const canRefund = round3(Math.max(0, tot - Number(inv.balance)));
          d.querySelector('#cn-total').textContent = `إجمالي الإشعار شامل الضريبة ${money(tot)}`;
          d.querySelector('#refund-box').classList.toggle('hidden', canRefund <= 0.0005);
          const rf = d.querySelector('[name=refund]'); rf.max = canRefund; if (Number(rf.value) > canRefund) rf.value = canRefund.toFixed(3);
        };
        d.querySelector('[name=subtotal]').addEventListener('input', upd); upd();
      });
      const download = async (kind, rec) => {
        const { invoiceXml } = await import('../einvoice.js');
        const xml = invoiceXml({ kind, garage: g, branch: ctx.allBranches.find((b) => b.id === j.branch_id), customer: c, vehicle: v, invoice: inv, lines: lines.filter((l) => l.approved !== false && !['pending', 'declined'].includes(l.approval_state)), credit: rec });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
        a.download = kind === 'credit' ? `credit-note-${rec.credit_no}.xml` : `invoice-${inv.invoice_no}.xml`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      el.querySelector('#xml-inv')?.addEventListener('click', () => download('invoice'));
      el.querySelectorAll('[data-xml-cn]').forEach((b) => b.addEventListener('click', () => download('credit', credits.find((x) => x.id === b.dataset.xmlCn))));

      el.querySelector('#pay [name="payer"]')?.addEventListener('change', (e) => {
        el.querySelector('#pay [name="amount"]').value = Number(e.target.value === 'insurer' ? inv.insurer_balance : inv.customer_balance).toFixed(3);
      });
      el.querySelector('#deposit')?.addEventListener('click', () => openDialog('عربون مقدّم', `
        <p class="muted">مبلغ يدفعه العميل قبل الفاتورة، مثل ثمن قطع تُطلب من الوكالة. يصدر له سند قبض الآن، ويُخصم تلقائياً من الفاتورة عند إصدارها.</p>
        <div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('المبلغ (ر.ع)', '<input name="amount" type="number" step="0.001" min="0.001" inputmode="decimal" required>', { req: true })}
          ${field('الطريقة', `<select name="method">${options(Object.entries(METHODS), 'cash')}</select>`)}
        </div>
        ${field('مرجع', '<input name="reference" placeholder="اختياري">')}`, async (d) => {
        const r = await db.rpc('add_deposit', { p_job: j.id, p_amount: Number(d.amount), p_method: d.method, p_reference: d.reference });
        toast(`سُجّل العربون، سند قبض ${idn(r.receipt_no)}`); reload();
      }, { submitLabel: 'سجّل العربون' }));
      el.querySelectorAll('[data-refund-dep]').forEach((b) => b.addEventListener('click', () => {
        const x = deposits.find((y) => y.id === b.dataset.refundDep);
        openDialog('ردّ العربون', `<p>يُردّ للعميل ${money(x.remaining)} من العربون رقم ${idn(x.receipt_no)}.</p>${field('طريقة الرد', `<select name="method">${options(Object.entries(METHODS), x.method)}</select>`)}`, async (d) => {
          await db.rpc('refund_deposit', { p_deposit: x.id, p_method: d.method });
          toast('رُدّ العربون'); reload();
        }, { submitLabel: 'ردّ المبلغ' });
      }));
      el.querySelector('#insurance')?.addEventListener('click', () => openDialog('مطالبة تأمين', insurers.length ? `
        <p class="muted">تُقسم الفاتورة: حصة على شركة التأمين، والباقي (التحمّل) على العميل. يظهر كل جزء في كشف حسابه.</p>
        ${field('شركة التأمين', `<select name="insurer" required>${options(insurers.map((x) => [x.id, x.name]), inv.insurer_id || '', { empty: 'بلا تأمين' })}</select>`)}
        <div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('رقم المطالبة', `<input name="claim_no" dir="ltr" value="${esc(inv.claim_no || '')}">`)}
          ${field('حصة التأمين (ر.ع)', `<input name="amount" type="number" step="0.001" min="0" max="${esc(inv.total)}" inputmode="decimal" value="${esc(Number(inv.insurer_amount) ? inv.insurer_amount : '')}">`, { hint: `الإجمالي ${money(inv.total)}` })}
        </div>` : '<p>لا توجد شركات تأمين بعد. أضفها من «العملاء» بنوع «شركة تأمين»، ثم ارجع هنا.</p>', async (d) => {
        if (!insurers.length) return true;
        await db.rpc('set_invoice_insurance', { p_invoice: inv.id, p_insurer: d.insurer || null, p_claim_no: d.claim_no, p_amount: Number(d.amount || 0) });
        toast(d.insurer ? 'قُسمت الفاتورة مع التأمين' : 'أُزيل التأمين'); reload();
      }));
      el.querySelector('#pay')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (!f.reportValidity()) return;
        const d = formData(f);
        busy(ev.submitter, async () => {
          const p = await db.insert('payments', { invoice_id: inv.id, amount: Number(d.amount), method: d.method, reference: d.reference, payer: d.payer || 'customer' });
          toast(`سُجّلت الدفعة، سند قبض ${idn(p.receipt_no)}`);
          reload();
        });
      });
    },
  };
}
