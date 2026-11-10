// Owner controls in Settings: documents, permissions, intake & service, WhatsApp texts.
import { db } from '../api.js';
import { esc, num } from '../format.js';
import { toast, field, formData, busy, openDialog } from '../ui.js';
import { ctx, refreshGarage } from '../state.js';
import { uploadImage } from '../media.js';
import { WA, VAR_HINT } from '../templates.js';
import { DEFAULT_CHECKS } from './intake.js';

const check = (name, on, label, hint) => `<label class="toggle-row"><input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''}>
  <span><strong>${label}</strong>${hint ? `<span class="subtle">${hint}</span>` : ''}</span></label>`;

export function ownerCards(g) {
  const isOwner = ctx.can('owner');
  const checks = Array.isArray(g.intake_checks) && g.intake_checks.length ? g.intake_checks : DEFAULT_CHECKS;
  const tpl = g.wa_templates || {};
  return `
      <form class="card stack" id="docs" novalidate>
        <h2>الفواتير والمستندات</h2>
        ${field('الشروط والأحكام أسفل الفاتورة وعرض السعر', `<textarea name="invoice_terms" rows="4" placeholder="مثال:\nالقطع المستبدلة لا تُرد بعد ٧ أيام.\nالكراج غير مسؤول عن المتعلقات الشخصية داخل السيارة.\nالسيارات غير المستلمة بعد ٣٠ يوماً من الإشعار تُفرض عليها رسوم مواقف.">${esc(g.invoice_terms || '')}</textarea>`, { hint: 'سطر لكل شرط. تُطبع على الفاتورة وعرض السعر والإيصال الحراري.' })}
        <div class="grid form">
          ${field('صلاحية عرض السعر (يوم)', `<input name="quote_valid_days" type="number" min="0" max="365" step="1" inputmode="numeric" value="${esc(g.quote_valid_days ?? 15)}">`, { hint: 'تُكتب على العرض «صالح حتى…». اكتب ٠ لإخفائها.' })}
        </div>
        <div class="row" style="gap:16px;align-items:center">
          ${g.stamp_url ? `<img src="${esc(g.stamp_url)}" alt="ختم الكراج" style="height:72px;width:72px;object-fit:contain;border:1px solid var(--border);border-radius:10px;background:#fff">` : ''}
          <label class="btn small" style="cursor:pointer">${g.stamp_url ? 'غيّر الختم' : 'ارفع صورة الختم أو التوقيع'}<input type="file" id="stamp-file" accept="image/*" class="hidden"></label>
          ${g.stamp_url ? '<button type="button" class="btn small ghost" id="stamp-rm">احذف الختم</button>' : ''}
          <span class="subtle">يظهر فوق خانة «الختم والتوقيع» في الفاتورة. الأفضل صورة بخلفية شفافة.</span>
        </div>
        <div><button class="btn primary">احفظ</button></div>
        <div class="notice info stack" style="gap:6px">
          <span><strong>الترقيم:</strong> أمر العمل التالي ${num(g.next_job_no)} · الفاتورة التالية ${num(g.next_invoice_no)}</span>
          <span class="subtle">إن كنت تنتقل من دفتر أو نظام قديم، اجعل الترقيم يكمل من آخر رقم عندك. الأرقام تتقدم فقط ولا ترجع.</span>
          ${isOwner ? '<div><button type="button" class="btn small" id="numbering">غيّر الترقيم</button></div>' : '<span class="subtle">تغيير الترقيم للمالك فقط.</span>'}
        </div>
      </form>

      <form class="card stack" id="controls" novalidate>
        <h2>الصلاحيات والرقابة</h2>
        <div class="grid form">
          ${field('أقصى خصم لموظف الاستقبال ٪', `<input name="max_discount_pct" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${esc(g.max_discount_pct ?? '')}" placeholder="بلا حد">`, { hint: 'من مجموع العمالة والقطع. ما فوقه يعطيه المالك أو المدير فقط.' })}
          ${field('حد موافقة العميل (ر.ع)', `<input name="approval_threshold" type="number" min="0" step="0.001" inputmode="decimal" value="${esc(g.approval_threshold ?? '')}" placeholder="بلا حد">`, { hint: 'إذا زادت التكلفة عليه لا يبدأ الإصلاح حتى يوافق العميل على البنود.' })}
        </div>
        ${check('reception_refunds', g.reception_refunds, 'يردّ موظف الاستقبال العربون', 'إن أُطفئ يبقى الرد للمالك والمدير والمحاسب.')}
        ${check('allow_negative_stock', g.allow_negative_stock !== false, 'السماح بصرف قطعة نفدت كميتها', 'إن أُطفئ لا تُضاف قطعة لأمر العمل إلا إن كانت متوفرة في الفرع.')}
        ${check('cash_close_alert', g.cash_close_alert !== false, 'تنبيه إقفال الصندوق', 'يظهر في صفحة «اليوم» إذا بقي نقد من يوم سابق لم يُقفل.')}
        <div><button class="btn primary">احفظ</button></div>
      </form>

      <form class="card stack" id="service" novalidate>
        <h2>الاستلام والصيانة</h2>
        ${field('قائمة فحص الاستلام', `<textarea name="intake_checks" rows="6">${esc(checks.join('\n'))}</textarea>`, { hint: 'بند في كل سطر. تظهر خانات يؤشّر عليها موظف الاستلام وتُطبع في كرت الورشة.' })}
        <div class="grid form">
          ${field('الصيانة القادمة بعد (كم)', `<input name="service_interval_km" type="number" min="1" step="1" inputmode="numeric" value="${esc(g.service_interval_km ?? '')}" placeholder="مثال: ٥٠٠٠">`)}
          ${field('أو بعد (أشهر)', `<input name="service_interval_months" type="number" min="1" max="36" step="1" inputmode="numeric" value="${esc(g.service_interval_months ?? '')}" placeholder="مثال: ٣">`)}
        </div>
        <p class="subtle">تُعبّأ الصيانة القادمة تلقائياً عند فتح أمر العمل من قراءة العداد وتاريخ اليوم، وتستطيع تعديلها في الأمر. اتركها فارغة لتكتبها يدوياً.</p>
        <div><button class="btn primary">احفظ</button></div>
      </form>

      ${isOwner ? `<section class="card stack" id="backup">
        <h2>نسخة من بياناتك</h2>
        <p class="muted">بياناتك ملكك. نزّل نسخة منها متى شئت واحفظها عندك. ننصح بنسخة كل شهر.</p>
        <div class="row" style="gap:8px">
          <button type="button" class="btn primary" data-export="json">نسخة كاملة (ملف واحد)</button>
          <button type="button" class="btn" data-export="customers">العملاء (Excel)</button>
          <button type="button" class="btn" data-export="vehicles">السيارات (Excel)</button>
          <button type="button" class="btn" data-export="items">المخزون (Excel)</button>
          <button type="button" class="btn" data-export="invoices">الفواتير (Excel)</button>
        </div>
        <p class="subtle">النسخة الكاملة تحوي كل شيء: العملاء والسيارات وأوامر العمل والفواتير والمدفوعات والمخزون والمشتريات والمصروفات والقيود. الصور تبقى على الخادم وروابطها داخل النسخة.</p>
      </section>` : ''}

      <form class="card stack" id="wa" novalidate>
        <h2>رسائل واتساب</h2>
        <p class="subtle">اكتب الرسائل بأسلوبك. اضغط على أي متغيّر لإضافته في مكان المؤشر، ويُستبدل عند الإرسال ببيانات العميل والسيارة.</p>
        ${Object.entries(WA).map(([k, t]) => `<div class="field wa-tpl">
          <div class="row" style="justify-content:space-between"><label for="wa-${k}">${esc(t.label)}</label>
            <button type="button" class="btn small ghost" data-wa-reset="${k}">الأصلي</button></div>
          <textarea id="wa-${k}" name="wa_${k}" rows="3">${esc(tpl[k] || t.def)}</textarea>
          <div class="chips" data-raw>${t.vars.map((x) => `<button type="button" class="chip" data-var="${esc(x)}" data-for="wa-${k}" title="${esc(VAR_HINT[x] || '')}">{${esc(x)}}</button>`).join('')}</div>
        </div>`).join('')}
        <div><button class="btn primary">احفظ الرسائل</button></div>
      </form>`;
}

export function bindOwner(el, g) {
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const save = (form, patch, msg) => form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    busy(ev.submitter, async () => {
      await db.update('garages', { id: `eq.${g.id}` }, patch(formData(form)));
      await refreshGarage();
      toast(msg);
    });
  });
  const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

  save(el.querySelector('#docs'), (d) => ({ invoice_terms: d.invoice_terms, quote_valid_days: Number(d.quote_valid_days || 0) }), 'حُفظت إعدادات المستندات');
  save(el.querySelector('#controls'), (d) => ({
    max_discount_pct: numOrNull(d.max_discount_pct), approval_threshold: numOrNull(d.approval_threshold),
    reception_refunds: !!d.reception_refunds, allow_negative_stock: !!d.allow_negative_stock, cash_close_alert: !!d.cash_close_alert,
  }), 'حُفظت الصلاحيات');
  save(el.querySelector('#service'), (d) => {
    const list = [...new Set(String(d.intake_checks || '').split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 30);
    return { intake_checks: list.length ? list : null, service_interval_km: numOrNull(d.service_interval_km), service_interval_months: numOrNull(d.service_interval_months) };
  }, 'حُفظت إعدادات الاستلام');
  save(el.querySelector('#wa'), (d) => {
    const out = {};
    Object.entries(WA).forEach(([k, t]) => { const v = (d[`wa_${k}`] || '').trim(); if (v && v !== t.def) out[k] = v; });
    return { wa_templates: out };
  }, 'حُفظت الرسائل');

  el.querySelectorAll('[data-wa-reset]').forEach((b) => b.addEventListener('click', () => {
    el.querySelector(`#wa-${b.dataset.waReset}`).value = WA[b.dataset.waReset].def;
  }));
  el.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
    const ta = el.querySelector(`#${b.dataset.for}`);
    const ins = `{${b.dataset.var}}`;
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length;
  }));

  el.querySelector('#stamp-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast('جارٍ رفع الختم…');
    try {
      const url = await uploadImage(f, 'logo');
      await db.update('garages', { id: `eq.${g.id}` }, { stamp_url: url });
      await refreshGarage(); toast('حُفظ الختم'); reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#stamp-rm')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await db.update('garages', { id: `eq.${g.id}` }, { stamp_url: null }); await refreshGarage(); reload();
  }));

  // ---- data export ----
  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const csv = (rows, cols) => '\uFEFF' + [cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => (typeof c[1] === 'function' ? c[1](r) : r[c[1]])))]
    .map((line) => line.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  el.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const d = await db.rpc('export_garage');
    const kind = b.dataset.export;
    const cust = Object.fromEntries((d.customers || []).map((c) => [c.id, c]));
    if (kind === 'json') download(`emd-garage-backup-${stamp}.json`, JSON.stringify(d, null, 1), 'application/json');
    else if (kind === 'customers') download(`العملاء ${stamp}.csv`, csv(d.customers, [['الاسم', 'name'], ['الهاتف', 'phone'], ['البريد', 'email'], ['النوع', 'customer_type'], ['الرقم الضريبي', 'vat_number'], ['ملاحظات', 'notes']]), 'text/csv;charset=utf-8');
    else if (kind === 'vehicles') download(`السيارات ${stamp}.csv`, csv(d.vehicles, [['اللوحة', (r) => `${r.plate_number || ''} ${r.plate_letters || ''}`.trim()], ['الشركة', 'make'], ['الطراز', 'model'], ['السنة', 'year'], ['اللون', 'color'], ['الشاصي', 'vin'], ['العداد', 'odometer'], ['المالك', (r) => cust[r.customer_id]?.name], ['هاتف المالك', (r) => cust[r.customer_id]?.phone]]), 'text/csv;charset=utf-8');
    else if (kind === 'items') download(`المخزون ${stamp}.csv`, csv(d.items, [['الصنف', 'name'], ['الرمز', 'sku'], ['الفئة', 'category'], ['المكان', 'location'], ['الكمية', 'qty'], ['التكلفة', 'unit_cost'], ['سعر البيع', 'sell_price'], ['حد إعادة الطلب', 'reorder_level']]), 'text/csv;charset=utf-8');
    else download(`الفواتير ${stamp}.csv`, csv(d.invoices, [['رقم الفاتورة', 'invoice_no'], ['التاريخ', (r) => String(r.issued_at || '').slice(0, 10)], ['العميل', (r) => cust[r.customer_id]?.name], ['العمالة', 'labor_total'], ['القطع', 'parts_total'], ['الخصم', 'discount'], ['قبل الضريبة', 'subtotal'], ['الضريبة', 'vat'], ['الإجمالي', 'total']]), 'text/csv;charset=utf-8');
    toast('نُزّل الملف');
  })));

  el.querySelector('#numbering')?.addEventListener('click', () => openDialog('تغيير الترقيم', `
    <p class="muted">اكتب الرقم الذي يبدأ منه الترقيم القادم. لا يمكن إرجاعه لرقم أصغر، فتسلسل الفواتير يجب ألا ينقص.</p>
    <div class="grid form" style="grid-template-columns:1fr 1fr">
      ${field('أمر العمل التالي', `<input name="job" type="number" min="${g.next_job_no}" step="1" inputmode="numeric" required value="${g.next_job_no}">`, { req: true })}
      ${field('الفاتورة التالية', `<input name="inv" type="number" min="${g.next_invoice_no}" step="1" inputmode="numeric" required value="${g.next_invoice_no}">`, { req: true })}
    </div>`, async (d) => {
    await db.rpc('set_numbering', { p_next_job: Number(d.job), p_next_invoice: Number(d.inv) });
    await refreshGarage(); toast('حُفظ الترقيم'); reload();
  }));
}
