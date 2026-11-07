import { db } from '../api.js';
import { idn, esc, money, num, METHODS, carName, plate, date, amountWords } from '../format.js';
import { icon } from '../ui.js';
import { ctx } from '../state.js';
import { computeTotals } from './job.js';

// Tax invoice when issued, otherwise a quotation for the customer's approval.
// [id, format]: format is 'a4', '80mm' or 'card' (workshop card for the technician, no prices);
// without it the garage's chosen paper is used.
export default async function printDoc([id, fmt]) {
  const mode = ['a4', '80mm', 'card'].includes(fmt) ? fmt : (ctx.garage.print_paper || 'a4');
  if (mode !== 'card' && !ctx.can('owner', 'manager', 'reception', 'accountant')) throw new Error('ليس لديك صلاحية على الفواتير');
  const j = await db.one('job_orders', { id: `eq.${id}`, select: '*,vehicles(*),customers(*)' });
  if (!j) throw new Error('أمر العمل غير موجود');
  const [lines, inv] = await Promise.all([
    mode === 'card' && ctx.isTech ? db.rpc('job_lines_for_tech', { p_job: id }).then((ls) => (ls || []).filter((l) => !['pending', 'declined'].includes(l.approval_state)))
      : db.get('job_lines', { job_id: `eq.${id}`, order: 'type.desc,created_at' }).then((ls) => ls.filter((l) => l.approved !== false)),
    mode === 'card' ? null : db.one('invoice_balances', { job_id: `eq.${id}` }),
  ]);
  const payments = inv ? await db.get('payments', { invoice_id: `eq.${inv.id}`, order: 'paid_at' }) : [];
  const g = ctx.garage, v = j.vehicles || {}, c = j.customers || {};
  const t = inv ? { labor: inv.labor_total, parts: inv.parts_total, discount: inv.discount, subtotal: inv.subtotal, vat: inv.vat, total: inv.total } : computeTotals(lines, g.vat_rate);
  const isInvoice = !!inv;
  const br = ctx.allBranches.find((b) => b.id === j.branch_id);

  const bar = `<div class="print-bar">
      <button class="btn primary" id="do-print">${icon('print')} اطبع أو احفظ PDF</button>
      <span class="seg" role="group" aria-label="نوع الورق">
        ${mode === 'card' ? '' : [['a4', 'A4'], ['80mm', 'إيصال ٨٠ مم']].map(([k, t]) => `<a class="btn small ${mode === k ? 'teal' : ''}" href="#/print/${j.id}/${k}" ${mode === k ? 'aria-current="true"' : ''}>${t}</a>`).join('')}
      </span>
      <a class="btn" href="#/job/${j.id}">رجوع لأمر العمل</a>
    </div>`;
  const bind = (el) => {
    el.querySelector('#do-print').addEventListener('click', () => window.print());
    // a receipt roll has no fixed length: size the page to the receipt itself
    const r = el.querySelector('.receipt');
    if (r) {
      const fit = () => { el.querySelector('#receipt-page').textContent = `@media print { @page { size: 80mm ${Math.ceil(r.offsetHeight * 25.4 / 96) + 4}mm; margin: 0; } }`; };
      fit(); r.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit));
    }
  };
  const branchLine = br && ctx.multiBranch ? br.name : '';

  if (mode === 'card') {
    const ck = j.checklist || {};
    return { bind, html: `${bar}<article class="doc card-doc">
      <header class="doc-head"><div><div class="g-name">كرت الورشة</div><div class="g-meta">${esc(g.name)}${branchLine ? ` · ${esc(branchLine)}` : ''}</div></div>
        <div style="text-align:center"><div class="big-no">${idn(j.job_no)}</div><div class="g-meta">أمر العمل</div></div></header>
      <div class="doc-grid">
        <div><strong>المركبة:</strong> ${esc(carName(v))}</div>
        <div><strong>اللوحة:</strong> ${esc(plate(v))}</div>
        ${v.vin ? `<div><strong>الشاصي:</strong> <bdi class="ltr">${esc(v.vin)}</bdi></div>` : ''}
        ${j.odometer ? `<div><strong>العداد:</strong> ${num(j.odometer)} كم</div>` : ''}
        <div><strong>الاستلام:</strong> ${esc(date(j.received_at))}</div>
        ${j.promised_at ? `<div><strong>التسليم المتوقع:</strong> ${esc(date(j.promised_at))}</div>` : ''}
        ${j.technician_id ? `<div><strong>الفني:</strong> ${esc(ctx.staffName(j.technician_id))}</div>` : ''}
        ${j.fuel_level != null && j.fuel_level !== '' ? `<div><strong>الوقود:</strong> ${esc(String(j.fuel_level))}</div>` : ''}
      </div>
      ${j.complaint ? `<div><strong>شكوى العميل:</strong> ${esc(j.complaint)}</div>` : ''}
      ${j.diagnosis ? `<div><strong>التشخيص:</strong> ${esc(j.diagnosis)}</div>` : ''}
      <table>
        <thead><tr><th>#</th><th>العمل أو القطعة</th><th>النوع</th><th class="num">الكمية</th><th style="width:22mm">تم</th></tr></thead>
        <tbody>${lines.map((l, i) => `<tr><td>${num(i + 1)}</td><td>${esc(l.description)}</td><td>${l.type === 'part' ? 'قطعة' : 'عمالة'}</td><td class="num">${num(l.qty)}</td><td><span class="tick"></span></td></tr>`).join('')}
          ${Array.from({ length: Math.max(3, 8 - lines.length) }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td><span class="tick"></span></td></tr>').join('')}</tbody>
      </table>
      ${Object.keys(ck).length ? `<div style="font-size:10.5pt"><strong>عند الاستلام:</strong> ${Object.entries(ck).filter(([, val]) => val).map(([k]) => esc(k)).join(' · ') || '—'}</div>` : ''}
      <div><strong>ملاحظات الفني:</strong><div class="write-lines"><span></span><span></span><span></span></div></div>
      <div class="sign"><div>الفني</div><div>فحص الجودة</div></div>
    </article>` };
  }

  if (mode === '80mm') {
    return { bind, html: `${bar}<style id="receipt-page">@media print { @page { size: 80mm 200mm; margin: 0; } }</style><article class="receipt">
      <header>
        ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="">` : ''}
        <div class="r-name">${esc(g.name)}</div>
        ${branchLine ? `<div>${esc(branchLine)}</div>` : ''}
        ${(br?.address || g.address) ? `<div>${esc(br?.address || g.address)}</div>` : ''}
        ${(br?.phone || g.phone) ? `<div>هاتف <bdi class="ltr">${esc(br?.phone || g.phone)}</bdi></div>` : ''}
        ${g.vat_number ? `<div>الرقم الضريبي <bdi class="ltr">${esc(g.vat_number)}</bdi></div>` : ''}
      </header>
      <div class="r-title">${isInvoice ? 'فاتورة ضريبية مبسطة' : 'عرض سعر'}</div>
      <div class="r-meta">
        <span>${isInvoice ? 'رقم الفاتورة' : 'أمر العمل'}</span><span>${idn(isInvoice ? inv.invoice_no : j.job_no)}</span>
        <span>التاريخ</span><span>${esc(date(isInvoice ? inv.issued_at : new Date()))}</span>
        ${c.name ? `<span>العميل</span><span>${esc(c.name)}</span>` : ''}
        ${plate(v) ? `<span>اللوحة</span><span>${esc(plate(v))}</span>` : ''}
        ${isInvoice ? `<span>أمر العمل</span><span>${idn(j.job_no)}</span>` : ''}
      </div>
      <div class="r-lines">${lines.map((l) => `<div class="r-line"><div>${esc(l.description)}</div><div class="r-row"><span>${num(l.qty)} × ${money(l.unit_price)}</span><span>${money(Number(l.qty) * Number(l.unit_price))}</span></div></div>`).join('')}</div>
      <div class="r-meta r-tot">
        ${Number(t.discount) ? `<span>الخصم</span><span>− ${money(t.discount)}</span>` : ''}
        <span>قبل الضريبة</span><span>${money(t.subtotal)}</span>
        <span>الضريبة ${num(isInvoice ? inv.vat_rate : g.vat_rate)}٪</span><span>${money(t.vat)}</span>
        <strong>الإجمالي</strong><strong>${money(t.total)}</strong>
        ${isInvoice ? `<span>المدفوع</span><span>${money(inv.paid)}</span><strong>المتبقي</strong><strong>${money(inv.balance)}</strong>` : ''}
      </div>
      ${payments.length ? `<div class="r-small">${payments.map((p) => `سند ${idn(p.receipt_no)} · ${esc(METHODS[p.method])} · ${money(p.amount)}`).join('<br>')}</div>` : ''}
      <footer>شكراً لثقتكم<br><img src="assets/logo.svg" alt="EMD Garage"></footer>
    </article>` };
  }

  const html = `${bar}
    <article class="doc">
      <header class="doc-head">
        <div>
          ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="" style="height:56px;margin-bottom:6px">` : ''}
          <div class="g-name">${esc(g.name)}</div>
          ${g.name_en ? `<div class="g-meta" dir="ltr" style="text-align:right">${esc(g.name_en)}</div>` : ''}
        </div>
        <div class="g-meta" style="text-align:left">
          ${br && ctx.multiBranch ? `<div><strong>${esc(br.name)}</strong></div>` : ''}
          ${(br?.address || g.address) ? `<div>${esc(br?.address || g.address)}</div>` : ''}
          ${(br?.phone || g.phone) ? `<div>هاتف: <bdi class="ltr">${esc(br?.phone || g.phone)}</bdi></div>` : ''}
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

  return { html, bind };
}
