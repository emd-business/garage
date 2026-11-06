import { db } from '../api.js';
import { idn, esc, money, num, METHODS, carName, plate, date, amountWords } from '../format.js';
import { icon } from '../ui.js';
import { ctx } from '../state.js';
import { computeTotals } from './job.js';

// Tax invoice when issued, otherwise a quotation for the customer's approval.
export default async function printDoc([id]) {
  if (!ctx.can('owner', 'manager', 'reception', 'accountant')) throw new Error('ليس لديك صلاحية على الفواتير');
  const j = await db.one('job_orders', { id: `eq.${id}`, select: '*,vehicles(*),customers(*)' });
  if (!j) throw new Error('أمر العمل غير موجود');
  const [lines, inv] = await Promise.all([
    db.get('job_lines', { job_id: `eq.${id}`, order: 'type.desc,created_at' }).then((ls) => ls.filter((l) => l.approved !== false)),
    db.one('invoice_balances', { job_id: `eq.${id}` }),
  ]);
  const payments = inv ? await db.get('payments', { invoice_id: `eq.${inv.id}`, order: 'paid_at' }) : [];
  const g = ctx.garage, v = j.vehicles || {}, c = j.customers || {};
  const t = inv ? { labor: inv.labor_total, parts: inv.parts_total, discount: inv.discount, subtotal: inv.subtotal, vat: inv.vat, total: inv.total } : computeTotals(lines, g.vat_rate);
  const isInvoice = !!inv;

  const html = `<div class="print-bar">
      <button class="btn primary" id="do-print">${icon('print')} اطبع أو احفظ PDF</button>
      <a class="btn" href="#/job/${j.id}">رجوع لأمر العمل</a>
    </div>
    <article class="doc" dir="rtl" lang="ar">
      <header class="doc-head">
        <div>
          ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="" style="height:56px;margin-bottom:6px">` : ''}
          <div class="g-name">${esc(g.name)}</div>
          ${g.name_en ? `<div class="g-meta" dir="ltr" style="text-align:right">${esc(g.name_en)}</div>` : ''}
        </div>
        <div class="g-meta" style="text-align:left">
          ${g.address ? `<div>${esc(g.address)}</div>` : ''}
          ${g.phone ? `<div>هاتف: <bdi class="ltr">${esc(g.phone)}</bdi></div>` : ''}
          ${g.cr_number ? `<div>س.ت: <bdi class="ltr">${esc(g.cr_number)}</bdi></div>` : ''}
          ${g.vat_number ? `<div>الرقم الضريبي: <bdi class="ltr">${esc(g.vat_number)}</bdi></div>` : ''}
        </div>
      </header>

      <div class="doc-title">${isInvoice ? 'فاتورة ضريبية' : 'عرض سعر'}<small>${isInvoice ? 'Tax Invoice' : 'Quotation'}</small></div>

      <div class="doc-grid">
        <div><strong>${isInvoice ? 'رقم الفاتورة' : 'أمر العمل'}:</strong> ${idn(isInvoice ? inv.invoice_no : j.job_no)}</div>
        <div><strong>التاريخ:</strong> ${esc(date(isInvoice ? inv.issued_at : new Date()))}</div>
        <div><strong>العميل:</strong> ${esc(c.name || '')}</div>
        <div><strong>الهاتف:</strong> <bdi class="ltr">${esc(c.phone || '')}</bdi></div>
        ${c.vat_number ? `<div><strong>الرقم الضريبي للعميل:</strong> <bdi class="ltr">${esc(c.vat_number)}</bdi></div>` : ''}
        <div><strong>المركبة:</strong> ${esc(carName(v))}</div>
        <div><strong>اللوحة:</strong> ${esc(plate(v))}</div>
        ${v.vin ? `<div><strong>الشاصي:</strong> <bdi class="ltr">${esc(v.vin)}</bdi></div>` : ''}
        ${j.odometer ? `<div><strong>العداد:</strong> ${num(j.odometer)} كم</div>` : ''}
        ${isInvoice ? `<div><strong>أمر العمل:</strong> ${idn(j.job_no)}</div>` : ''}
      </div>

      ${!isInvoice && j.diagnosis ? `<div><strong>التشخيص:</strong> ${esc(j.diagnosis)}</div>` : ''}

      <table>
        <thead><tr><th>#</th><th>البيان</th><th>النوع</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">المجموع</th></tr></thead>
        <tbody>${lines.map((l, i) => `<tr><td>${num(i + 1)}</td><td>${esc(l.description)}</td><td>${l.type === 'part' ? 'قطع غيار' : 'عمالة'}</td>
          <td class="num">${num(l.qty)}</td><td class="num">${money(l.unit_price)}</td><td class="num">${money(Number(l.qty) * Number(l.unit_price))}</td></tr>`).join('')}</tbody>
      </table>

      <div class="totals">
        <span>العمالة</span><span class="num">${money(t.labor)}</span>
        <span>قطع الغيار</span><span class="num">${money(t.parts)}</span>
        ${Number(t.discount) ? `<span>الخصم</span><span class="num">− ${money(t.discount)}</span>` : ''}
        <span>المجموع قبل الضريبة</span><span class="num">${money(t.subtotal)}</span>
        <span>ضريبة القيمة المضافة ${num(isInvoice ? inv.vat_rate : g.vat_rate)}٪</span><span class="num">${money(t.vat)}</span>
        <span class="grand">الإجمالي</span><span class="num grand">${money(t.total)}</span>
        ${isInvoice ? `<span>المدفوع</span><span class="num">${money(inv.paid)}</span><span><strong>المتبقي</strong></span><span class="num"><strong>${money(inv.balance)}</strong></span>` : ''}
      </div>
      <div class="words"><strong>المبلغ كتابةً:</strong> ${esc(amountWords(t.total))}</div>

      ${payments.length ? `<div style="font-size:10.5pt"><strong>الدفعات:</strong> ${payments.map((p) => `سند ${idn(p.receipt_no)} · ${esc(METHODS[p.method])} · ${money(p.amount)} · ${esc(date(p.paid_at))}`).join(' — ')}</div>` : ''}
      ${!isInvoice ? '<div style="font-size:10.5pt">هذا العرض تقديري، وقد تتغير التكلفة إن ظهرت أعمال إضافية بعد الفحص، ولن تُنفَّذ إلا بموافقتك.</div>' : ''}

      <div class="sign"><div>توقيع العميل</div><div>الختم والتوقيع</div></div>

      <footer class="doc-foot">
        <span>شكراً لثقتكم بـ ${esc(g.name)}</span>
        <span class="row" style="gap:6px">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></span>
      </footer>
    </article>`;

  return { html, bind(el) { el.querySelector('#do-print').addEventListener('click', () => window.print()); } };
}
