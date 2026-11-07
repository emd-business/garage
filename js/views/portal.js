// Public customer page: no login, opened from the link the garage sends on WhatsApp.
import { db } from '../api.js';
import { esc, money, num, idn, round3, STATUS, carName, plate, dateTime, date, waLink } from '../format.js';
import { toast } from '../ui.js';
import { langButton } from '../i18n.js';

const STEPS = ['received', 'inspection', 'approval', 'repair', 'qc', 'ready', 'delivered'];
const COND = { good: ['سليم', 'success'], attention: ['يحتاج انتباه', 'warning'], urgent: ['عاجل', 'danger'] };
const STATE = { pending: ['بانتظار قرارك', 'warning'], approved: ['وافقت', 'success'], declined: ['رفضت', 'neutral'] };

export default async function portal([token]) {
  const d = await db.rpc('portal_job', { p_token: token });
  if (!d) {
    return { html: `<div class="portal"><div class="portal-head"><img src="assets/icon.svg" alt=""><div class="g">EMD Garage</div></div>
      <section class="card empty"><p>هذا الرابط غير صالح أو انتهى.</p><p class="subtle">تواصل مع الكراج ليرسل لك رابطاً جديداً.</p></section></div>` };
  }
  const { garage: g, job: j, vehicle: v, lines, inspection, invoice } = d;
  const vat = Number(g.vat_rate);
  const counted = lines.filter((l) => l.state === 'na' || l.state === 'approved');
  const pendingL = lines.filter((l) => l.state === 'pending');
  const sum = (ls) => round3(ls.reduce((a, l) => a + Number(l.qty) * Number(l.unit_price), 0));
  const sub = sum(counted), pendSub = sum(pendingL);
  const step = Math.max(0, STEPS.indexOf(j.status));
  const cancelled = j.status === 'cancelled';
  document.title = `${g.name} · متابعة سيارتك`;

  const lineHtml = (l) => `<div class="list-item" style="align-items:flex-start">
      <div class="stack" style="gap:2px;min-width:0">
        <strong style="${l.state === 'declined' ? 'text-decoration:line-through;color:var(--ink-subtle)' : ''}">${esc(l.description)}</strong>
        <span class="subtle">${l.type === 'part' ? 'قطعة' : 'عمالة'}${Number(l.qty) !== 1 ? ` · ${num(l.qty)} × ${money(l.unit_price)}` : ''}${Number(l.warranty_days) ? ` · ضمان ${num(l.warranty_days)} يوماً` : ''}</span>
        ${STATE[l.state] ? `<span><span class="badge ${STATE[l.state][1]}">${STATE[l.state][0]}</span></span>` : ''}
        ${!d.locked && l.state !== 'na' ? `<div class="decide">
            ${l.state !== 'approved' ? `<button class="btn small teal" data-line="${l.id}" data-ok="1">أوافق</button>` : ''}
            ${l.state !== 'declined' ? `<button class="btn small" data-line="${l.id}" data-ok="0">${l.state === 'approved' ? 'تراجع عن الموافقة' : 'لا أريد'}</button>` : ''}
          </div>` : ''}
      </div>
      <strong class="num" style="white-space:nowrap">${money(Number(l.qty) * Number(l.unit_price))}</strong></div>`;

  return {
    html: `<div class="portal">
      <header class="portal-head">${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="">` : '<img src="assets/icon.svg" alt="">'}
        <div style="flex:1"><div class="g">${esc(g.name)}</div><div class="s">أمر عمل ${idn(j.job_no)}${g.phone ? ` · <bdi class="ltr">${esc(g.phone)}</bdi>` : ''}</div></div>${langButton('btn small ghost lang-btn')}</header>

      <section class="card stack">
        <p>${d.customer ? `أهلاً ${esc(d.customer)}،` : 'أهلاً،'} هذه حالة سيارتك:</p>
        <h1 style="font-size:20px">${esc(carName(v))} ${plate(v) ? `<span class="plate ${esc(v.plate_type || 'private')}" style="margin-inline-start:6px"><bdi>${esc(plate(v))}</bdi></span>` : ''}</h1>
        ${cancelled ? '<div class="notice error">أُلغي أمر العمل.</div>' : `
          <div class="track" aria-hidden="true">${STEPS.map((s, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
          <p><strong style="font-size:18px">${esc(STATUS[j.status].label)}</strong>${j.status === 'ready' ? ' · سيارتك جاهزة للاستلام' : ''}</p>
          ${j.promised_at && !['ready', 'delivered'].includes(j.status) ? `<p class="subtle">موعد التسليم المتوقع: ${esc(dateTime(j.promised_at))}</p>` : ''}`}
        ${j.complaint ? `<p class="subtle">طلبك: ${esc(j.complaint)}</p>` : ''}
        ${j.diagnosis ? `<p><strong>التشخيص:</strong> ${esc(j.diagnosis)}</p>` : ''}
      </section>

      ${pendingL.length && !d.locked ? `<div class="notice warn" style="margin:0 16px" role="status">نحتاج موافقتك على ${num(pendingL.length)} بند بقيمة ${money(round3(pendSub * (1 + vat / 100)))} شاملة الضريبة. لن نبدأ إلا بما توافق عليه.</div>` : ''}

      ${inspection.length ? `<section class="card stack"><h2>ما وجدناه في الفحص</h2>
        <div class="list">${inspection.map((it) => `<div class="list-item" style="align-items:flex-start"><div class="stack" style="gap:6px">
          <span><span class="badge ${COND[it.condition][1]}">${COND[it.condition][0]}</span> <strong>${esc(it.area)}</strong></span>
          ${it.note ? `<span>${esc(it.note)}</span>` : ''}
          ${(it.photos || []).length ? `<div class="photos">${it.photos.map((u) => `<a class="ph" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(it.area)}" loading="lazy"></a>`).join('')}</div>` : ''}
        </div></div>`).join('')}</div></section>` : ''}

      ${lines.length ? `<section class="card stack"><h2>الأعمال والقطع</h2>
        <div class="list">${lines.map(lineHtml).join('')}</div>
        <div class="totals">
          <span>المجموع قبل الضريبة</span><span class="num">${money(invoice ? invoice.subtotal : sub)}</span>
          <span>ضريبة القيمة المضافة ${num(vat)}٪</span><span class="num">${money(invoice ? invoice.vat : round3(sub * vat / 100))}</span>
          <span class="grand">${invoice ? 'إجمالي الفاتورة' : 'الإجمالي التقديري'}</span><span class="num grand">${money(invoice ? invoice.total : round3(sub * (1 + vat / 100)))}</span>
          ${invoice ? `<span>المدفوع</span><span class="num">${money(invoice.paid)}</span><span><strong>المتبقي</strong></span><span class="num"><strong>${money(invoice.balance)}</strong></span>` : ''}
        </div>
        ${!invoice && pendingL.length ? '<p class="subtle">الإجمالي يشمل ما وافقت عليه فقط.</p>' : ''}
      </section>` : ''}

      ${invoice && Number(invoice.balance) > 0.0005 && g.bank_details ? `<section class="card stack"><h2>الدفع بالتحويل البنكي</h2><p style="white-space:pre-line">${esc(g.bank_details)}</p><p class="subtle">اذكر رقم الفاتورة ${idn(invoice.invoice_no)} في التحويل.</p></section>` : ''}

      ${(j.photos || []).length ? `<section class="card stack"><h2>صور سيارتك عند الاستلام</h2><div class="photos">${j.photos.map((u) => `<a class="ph" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join('')}</div></section>` : ''}

      ${j.status === 'delivered' && (j.next_service_km || j.next_service_date) ? `<section class="card"><p>موعد صيانتك القادمة: ${j.next_service_km ? `عند ${num(j.next_service_km)} كم` : ''}${j.next_service_km && j.next_service_date ? ' أو ' : ''}${j.next_service_date ? esc(date(j.next_service_date)) : ''}</p></section>` : ''}

      ${g.phone ? `<div class="row" style="margin:0 16px"><a class="btn" href="tel:${esc(g.phone)}">اتصل بالكراج</a><a class="btn wa" href="${esc(waLink(g.phone, `بخصوص أمر العمل ${j.job_no}`))}" target="_blank" rel="noopener">واتساب</a></div>` : ''}
      <footer class="portal-foot">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></footer>
    </div>`,
    bind(el) {
      el.querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await db.rpc('portal_decide', { p_token: token, p_line: b.dataset.line, p_approve: b.dataset.ok === '1' });
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (e) {
          b.disabled = false;
          toast(e.message, 'error');
        }
      }));
    },
  };
}
