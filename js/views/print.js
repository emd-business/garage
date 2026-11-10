import { db } from '../api.js';
import { idn, esc, money, num, METHODS, carName, plate, date, dateTime, amountWords } from '../format.js';
import { icon } from '../ui.js';
import { ctx } from '../state.js';
import { isEn, translate } from '../i18n.js';
import { computeTotals } from './job.js';

// Tax invoice when issued, otherwise a quotation for the customer's approval.
// [id, format]: format is 'a4', '80mm' or 'card' (workshop card for the technician, no prices);
// without it the garage's chosen paper is used.
export default async function printDoc([id, fmt, cnId]) {
  const mode = ['a4', '80mm', 'card', 'credit', 'intake'].includes(fmt) ? fmt : (ctx.garage.print_paper || 'a4');
  if (mode !== 'card' && !ctx.can('owner', 'manager', 'reception', 'accountant')) throw new Error('ليس لديك صلاحية على الفواتير');
  const j = await db.one('job_orders', { id: `eq.${id}`, select: '*,vehicles(*),customers(*)' });
  if (!j) throw new Error('أمر العمل غير موجود');
  const [lines, inv] = await Promise.all([
    mode === 'card' && ctx.isTech ? db.rpc('job_lines_for_tech', { p_job: id }).then((ls) => (ls || []).filter((l) => !['pending', 'declined'].includes(l.approval_state)))
      : db.get('job_lines', { job_id: `eq.${id}`, order: 'type.desc,created_at' }).then((ls) => ls.filter((l) => l.approved !== false)),
    mode === 'card' || mode === 'intake' ? null : db.one('invoice_balances', { job_id: `eq.${id}` }),
  ]);
  const payments = inv ? await db.get('payments', { invoice_id: `eq.${inv.id}`, order: 'paid_at' }) : [];
  const g = ctx.garage, v = j.vehicles || {}, c = j.customers || {};
  const t = inv ? { labor: inv.labor_total, parts: inv.parts_total, discount: inv.discount, subtotal: inv.subtotal, vat: inv.vat, total: inv.total } : computeTotals(lines, g.vat_rate);
  const isInvoice = !!inv;
  const cn = mode === 'credit' && inv ? await db.one('credit_notes', { id: `eq.${cnId}`, invoice_id: `eq.${inv.id}` }) : null;
  if (mode === 'credit' && !cn) throw new Error('الإشعار الدائن غير موجود');
  const br = ctx.allBranches.find((b) => b.id === j.branch_id);

  const bar = `<div class="print-bar">
      <button class="btn primary" id="do-print">${icon('print')} اطبع أو احفظ PDF</button>
      <span class="seg" role="group" aria-label="نوع الورق">
        ${mode === 'card' || mode === 'credit' || mode === 'intake' ? '' : [['a4', 'A4'], ['80mm', 'إيصال ٨٠ مم']].map(([k, t]) => `<a class="btn small ${mode === k ? 'teal' : ''}" href="#/print/${j.id}/${k}" ${mode === k ? 'aria-current="true"' : ''}>${t}</a>`).join('')}
      </span>
      <a class="btn" href="#/job/${j.id}">رجوع لأمر العمل</a>
    </div>`;
  const bind = (el) => {
    el.querySelector('#do-print').addEventListener('click', () => window.print());
    // the garage chooses the language of documents handed to customers, whatever language the screen is in
    const docEl = el.querySelector('.doc, .receipt');
    if (docEl && mode !== 'card') {
      if (g.doc_lang === 'en' && !isEn) {
        translate(docEl, true); docEl.dir = 'ltr'; docEl.lang = 'en'; docEl.classList.add('doc-en');
        // dates were written for an Arabic screen, and the garage may have an English name
        const MONTHS = { يناير: 'January', فبراير: 'February', مارس: 'March', أبريل: 'April', مايو: 'May', يونيو: 'June', يوليو: 'July', أغسطس: 'August', سبتمبر: 'September', أكتوبر: 'October', نوفمبر: 'November', ديسمبر: 'December' };
        const w = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
        for (let nd = w.nextNode(); nd; nd = w.nextNode()) {
          if (nd.parentElement.closest('[data-raw]')) continue;
          let tx = nd.nodeValue;
          if (g.name_en && tx.includes(g.name)) tx = tx.split(g.name).join(g.name_en);
          tx = tx.replace(/يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/g, (m) => MONTHS[m]).replace(/(\d:\d\d)\s?م/g, '$1 pm').replace(/(\d:\d\d)\s?ص/g, '$1 am');
          if (tx !== nd.nodeValue) nd.nodeValue = tx;
        }
        docEl.querySelectorAll('[style*="text-align:left"]').forEach((e) => { e.style.textAlign = 'right'; });
      } else if (g.doc_lang !== 'en' && isEn) { docEl.setAttribute('data-raw', ''); docEl.dir = 'rtl'; docEl.lang = 'ar'; }
    }
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
        <div><strong>المركبة:</strong> <span data-raw>${esc(carName(v))}</span></div>
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

  if (mode === 'intake') {
    const ck = j.checklist || {};
    const fuel = Number(j.fuel_level);
    return { bind, html: `${bar}<article class="doc">
      <header class="doc-head">
        <div>
          ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="" style="height:56px;margin-bottom:6px">` : ''}
          <div class="g-name">${esc(g.name)}</div>
          ${branchLine ? `<div class="g-meta">${esc(branchLine)}</div>` : ''}
        </div>
        <div class="g-meta" style="text-align:left">
          ${(br?.address || g.address) ? `<div>${esc(br?.address || g.address)}</div>` : ''}
          ${(br?.phone || g.phone) ? `<div>هاتف: <bdi class="ltr">${esc(br?.phone || g.phone)}</bdi></div>` : ''}
          ${g.cr_number ? `<div>س.ت: <bdi class="ltr">${esc(g.cr_number)}</bdi></div>` : ''}
        </div>
      </header>
      <div class="doc-title">إيصال استلام سيارة<small>Vehicle Receipt</small></div>
      <div class="doc-grid">
        <div><strong>أمر العمل:</strong> ${idn(j.job_no)}</div>
        <div><strong>وقت الاستلام:</strong> ${esc(dateTime(j.received_at))}</div>
        <div><strong>العميل:</strong> ${esc(c.name || '')}</div>
        <div><strong>الهاتف:</strong> <bdi class="ltr">${esc(c.phone || '')}</bdi></div>
        <div><strong>المركبة:</strong> <span data-raw>${esc(carName(v))}</span>${v.color ? ` · ${esc(v.color)}` : ''}</div>
        <div><strong>اللوحة:</strong> ${esc(plate(v))}</div>
        ${v.vin ? `<div><strong>الشاصي:</strong> <bdi class="ltr">${esc(v.vin)}</bdi></div>` : ''}
        ${j.odometer ? `<div><strong>العداد:</strong> ${num(j.odometer)} كم</div>` : ''}
        ${j.promised_at ? `<div><strong>التسليم المتوقع:</strong> ${esc(dateTime(j.promised_at))}</div>` : ''}
      </div>
      ${Number.isFinite(fuel) && j.fuel_level != null ? `<div class="fuel-gauge"><strong>مستوى الوقود</strong><span class="gauge"><span style="width:${Math.max(0, Math.min(100, fuel))}%"></span></span><span>${num(fuel)}٪</span></div>` : ''}
      ${j.complaint ? `<div><strong>طلب العميل:</strong> ${esc(j.complaint)}</div>` : ''}
      ${Object.keys(ck).length ? `<div class="check-grid">${Object.entries(ck).map(([k, val]) => `<span class="${val ? 'yes' : 'no'}">${val ? '✓' : '✗'} ${esc(k)}</span>`).join('')}</div>` : ''}
      ${(j.photos || []).length ? `<div class="doc-photos">${j.photos.slice(0, 4).map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}
      <div class="terms">أقرّ بتسليم السيارة الموصوفة أعلاه إلى ${esc(g.name)} بالحالة المبيّنة في هذا الإيصال، ولا تُنفَّذ أي أعمال إضافية إلا بموافقتي.${g.invoice_terms ? `<br><span data-raw>${esc(g.invoice_terms).replace(/\n/g, '<br>')}</span>` : ''}</div>
      <div class="sign"><div>${j.intake_signature_url ? `<img class="stamp" src="${esc(j.intake_signature_url)}" alt="توقيع العميل">` : ''}توقيع العميل${j.intake_signed_at ? `<br><span style="font-size:9pt;color:#5B6576">${esc(dateTime(j.intake_signed_at))}</span>` : ''}</div><div>${g.stamp_url ? `<img class="stamp" src="${esc(g.stamp_url)}" alt="">` : ''}الختم والمستلم</div></div>
      <footer class="doc-foot"><span>احتفظ بهذا الإيصال لاستلام سيارتك</span><span class="row" style="gap:6px">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></span></footer>
    </article>` };
  }

  if (mode === 'credit') {
    return { bind, html: `${bar}<article class="doc">
      <header class="doc-head">
        <div>${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="" style="height:56px;margin-bottom:6px">` : ''}<div class="g-name">${esc(g.name)}</div>${branchLine ? `<div class="g-meta">${esc(branchLine)}</div>` : ''}</div>
        <div class="g-meta" style="text-align:left">
          ${(br?.address || g.address) ? `<div>${esc(br?.address || g.address)}</div>` : ''}
          ${(br?.phone || g.phone) ? `<div>هاتف: <bdi class="ltr">${esc(br?.phone || g.phone)}</bdi></div>` : ''}
          ${g.cr_number ? `<div>س.ت: <bdi class="ltr">${esc(g.cr_number)}</bdi></div>` : ''}
          ${g.vat_number ? `<div>الرقم الضريبي: <bdi class="ltr">${esc(g.vat_number)}</bdi></div>` : ''}
        </div>
      </header>
      <div class="doc-title">إشعار دائن<small>Credit Note</small></div>
      <div class="doc-grid">
        <div><strong>رقم الإشعار:</strong> ${idn(cn.credit_no)}</div>
        <div><strong>التاريخ:</strong> ${esc(date(cn.issued_at))}</div>
        <div><strong>عن الفاتورة رقم:</strong> ${idn(inv.invoice_no)}</div>
        <div><strong>تاريخ الفاتورة:</strong> ${esc(date(inv.issued_at))}</div>
        <div><strong>العميل:</strong> ${esc(c.name || '')}</div>
        ${c.vat_number ? `<div><strong>الرقم الضريبي للعميل:</strong> <bdi class="ltr">${esc(c.vat_number)}</bdi></div>` : `<div><strong>الهاتف:</strong> <bdi class="ltr">${esc(c.phone || '')}</bdi></div>`}
        <div><strong>المركبة:</strong> <span data-raw>${esc(carName(v))}</span> ${esc(plate(v))}</div>
      </div>
      <div><strong>السبب:</strong> ${esc(cn.reason)}</div>
      <div class="totals">
        <span>المبلغ قبل الضريبة</span><span class="num">${money(cn.subtotal)}</span>
        <span>ضريبة القيمة المضافة ${num(cn.vat_rate)}٪</span><span class="num">${money(cn.vat)}</span>
        <span class="grand">إجمالي الإشعار</span><span class="num grand">${money(cn.total)}</span>
        ${Number(cn.refund_amount) ? `<span>رُدّ للعميل (${esc(METHODS[cn.refund_method] || '')})</span><span class="num">${money(cn.refund_amount)}</span>` : ''}
      </div>
      <div class="words"><strong>المبلغ كتابةً:</strong> <span data-raw>${esc(amountWords(cn.total, g.doc_lang === 'en'))}</span></div>
      <div class="sign"><div>توقيع العميل</div><div>الختم والتوقيع</div></div>
      <footer class="doc-foot"><span>${esc(g.name)}</span><span class="row" style="gap:6px">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></span></footer>
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
        ${isInvoice && inv.insurer_id && Number(inv.insurer_amount) ? `<span>حصة التأمين</span><span>${money(inv.insurer_amount)}</span>` : ''}
        ${isInvoice ? `<span>المدفوع</span><span>${money(inv.paid)}</span><strong>المتبقي</strong><strong>${money(inv.balance)}</strong>` : ''}
      </div>
      ${payments.length ? `<div class="r-small">${payments.map((p) => `سند ${idn(p.receipt_no)} · ${esc(METHODS[p.method])} · ${money(p.amount)}`).join('<br>')}</div>` : ''}
      ${g.invoice_terms ? `<div class="r-small" data-raw>${esc(g.invoice_terms).replace(/\n/g, '<br>')}</div>` : ''}
      <footer>شكراً لثقتكم<br><img src="assets/logo.svg" alt="EMD Garage"></footer>
    </article>` };
  }

  const terms = g.invoice_terms ? `<div class="terms"><strong>الشروط والأحكام</strong><br><span data-raw>${esc(g.invoice_terms).replace(/\n/g, '<br>')}</span></div>` : '';
  const html = `${bar}
    <article class="doc">
      <header class="doc-head">
        <div>
          ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="" style="height:56px;margin-bottom:6px">` : ''}
          <div class="g-name">${esc(g.name)}</div>
          ${g.name_en ? `<div class="g-meta g-en" dir="ltr" style="text-align:right">${esc(g.name_en)}</div>` : ''}
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
        <div><strong>المركبة:</strong> <span data-raw>${esc(carName(v))}</span></div>
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
        ${isInvoice && Number(inv.credited) ? `<span>إشعارات دائنة</span><span class="num">− ${money(inv.credited)}</span>` : ''}
        ${isInvoice && inv.insurer_id && Number(inv.insurer_amount) ? `<span>حصة شركة التأمين${inv.claim_no ? ` (مطالبة <bdi class="ltr">${esc(inv.claim_no)}</bdi>)` : ''}</span><span class="num">${money(inv.insurer_amount)}</span><span>حصة العميل (التحمّل)</span><span class="num">${money(Number(inv.total) - Number(inv.insurer_amount))}</span>` : ''}
        ${isInvoice ? `<span>المدفوع</span><span class="num">${money(inv.paid)}</span><span><strong>المتبقي</strong></span><span class="num"><strong>${money(inv.balance)}</strong></span>` : ''}
      </div>
      <div class="words"><strong>المبلغ كتابةً:</strong> <span data-raw>${esc(amountWords(t.total, g.doc_lang === 'en'))}</span></div>

      ${payments.length ? `<div style="font-size:10.5pt"><strong>الدفعات:</strong> ${payments.map((p) => `سند ${idn(p.receipt_no)} · ${p.deposit_id ? 'عربون' : esc(METHODS[p.method])}${p.payer === 'insurer' ? ' · التأمين' : ''} · ${money(p.amount)} · ${esc(date(p.paid_at))}`).join(' — ')}</div>` : ''}
      ${!isInvoice ? `<div style="font-size:10.5pt">هذا العرض تقديري، وقد تتغير التكلفة إن ظهرت أعمال إضافية بعد الفحص، ولن تُنفَّذ إلا بموافقتك.${Number(g.quote_valid_days) > 0 ? ` العرض صالح حتى ${esc(date(new Date(Date.now() + Number(g.quote_valid_days) * 864e5)))}.` : ''}</div>` : ''}
      ${terms}

      <div class="sign"><div>توقيع العميل</div><div>${g.stamp_url ? `<img class="stamp" src="${esc(g.stamp_url)}" alt="">` : ''}الختم والتوقيع</div></div>

      <footer class="doc-foot">
        <span>شكراً لثقتكم بـ ${esc(g.name)}</span>
        <span class="row" style="gap:6px">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></span>
      </footer>
    </article>`;

  return { html, bind };
}
