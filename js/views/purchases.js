import { db } from '../api.js';
import { esc, money, num, idn, date, round3, METHODS } from '../format.js';
import { icon, toast, field, options, openDialog } from '../ui.js';
import { ctx } from '../state.js';

const todayStr = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

const supplierFields = (s = {}) => `
  ${field('اسم المورد', `<input name="name" required value="${esc(s.name || '')}">`, { req: true })}
  ${field('الهاتف', `<input name="phone" type="tel" dir="ltr" value="${esc(s.phone || '')}">`)}
  ${field('الرقم الضريبي', `<input name="vat_number" dir="ltr" value="${esc(s.vat_number || '')}">`)}
  ${field('ملاحظات', `<textarea name="notes">${esc(s.notes || '')}</textarea>`)}`;

export default async function purchases([tab]) {
  const canPay = ctx.can('owner', 'manager', 'accountant');
  const [list, suppliers, items] = await Promise.all([
    db.get('purchases', { select: '*,suppliers(name)', order: 'purchase_date.desc,purchase_no.desc', limit: 100 }),
    db.get('supplier_balances', { order: 'name' }),
    db.get('items', { active: 'eq.true', order: 'name', select: 'id,name,sku,qty,unit_cost' }),
  ]);
  const isSup = tab === 'suppliers';
  const owed = suppliers.reduce((a, s) => a + Math.max(0, Number(s.balance)), 0);

  const purchasesTable = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>رقم</th><th>التاريخ</th><th>المورد</th><th>فاتورة المورد</th><th class="num">قبل الضريبة</th><th class="num">الضريبة</th><th class="num">الإجمالي</th></tr></thead>
      <tbody>${list.map((p) => `<tr class="click" data-view="${p.id}"><td>${idn(p.purchase_no)}</td><td>${esc(date(p.purchase_date))}</td><td>${esc(p.suppliers?.name || '')}</td>
        <td><bdi class="ltr">${esc(p.supplier_invoice_no || '')}</bdi></td><td class="num">${money(p.subtotal)}</td><td class="num">${money(p.vat)}</td><td class="num"><strong>${money(p.total)}</strong></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><p>لا توجد فواتير شراء بعد.</p><p class="subtle">سجّل فاتورة المورد فتزيد كميات الأصناف ويُحدَّث متوسط تكلفتها تلقائياً.</p></div>';

  const suppliersTable = suppliers.length ? `<div class="table-wrap"><table>
      <thead><tr><th>المورد</th><th>الهاتف</th><th class="num">المشتريات</th><th class="num">المدفوع</th><th class="num">المستحق له</th><th><span class="hidden">إجراءات</span></th></tr></thead>
      <tbody>${suppliers.map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td><bdi class="ltr">${esc(s.phone || '')}</bdi></td>
        <td class="num">${money(s.purchased)}</td><td class="num">${money(s.paid)}</td>
        <td class="num">${Number(s.balance) > 0.0005 ? `<span class="badge warning">${money(s.balance)}</span>` : '—'}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">${canPay ? `<button class="btn small teal" data-pay="${s.id}">سداد</button>` : ''}<button class="btn small ghost" data-edit-sup="${s.id}">تعديل</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><p>لا يوجد موردون بعد.</p></div>';

  return {
    title: 'المشتريات',
    html: `<div class="page-head"><div><h1>المشتريات والموردون</h1><p class="lead">${owed > 0.0005 ? `مستحق للموردين ${money(owed)}` : 'لا توجد مبالغ مستحقة للموردين'}</p></div>
        <div class="row"><button class="btn" id="new-sup">${icon('plus')} مورد</button><button class="btn primary" id="new-pur" ${suppliers.length ? '' : 'disabled title="أضف مورداً أولاً"'}>${icon('plus')} فاتورة شراء</button></div></div>
      <div class="tabs" role="tablist" style="max-width:360px">
        <button role="tab" aria-selected="${!isSup}" data-tab="">فواتير الشراء</button>
        <button role="tab" aria-selected="${isSup}" data-tab="suppliers">الموردون</button>
      </div>
      <section class="card pad-0">${isSup ? suppliersTable : purchasesTable}</section>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/purchases${b.dataset.tab ? `/${b.dataset.tab}` : ''}`; }));

      el.querySelector('#new-sup').addEventListener('click', () => openDialog('مورد جديد', supplierFields(), async (d) => {
        await db.insert('suppliers', d); toast('أُضيف المورد'); reload();
      }));
      el.querySelectorAll('[data-edit-sup]').forEach((b) => b.addEventListener('click', async () => {
        const s = await db.one('suppliers', { id: `eq.${b.dataset.editSup}` });
        openDialog('تعديل المورد', supplierFields(s), async (d) => { await db.update('suppliers', { id: `eq.${s.id}` }, d); toast('حُفظ'); reload(); });
      }));
      el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
        const s = suppliers.find((x) => x.id === b.dataset.pay);
        openDialog(`سداد للمورد: ${s.name}`, `<p class="muted">المستحق ${money(s.balance)}</p>
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field('المبلغ', `<input name="amount" type="number" step="0.001" min="0.001" inputmode="decimal" required value="${esc(Math.max(0, Number(s.balance)).toFixed(3))}">`, { req: true })}
            ${field('الطريقة', `<select name="method">${options(Object.entries(METHODS), 'transfer')}</select>`)}
          </div>${field('مرجع', '<input name="reference">')}`, async (d) => {
          await db.insert('supplier_payments', { supplier_id: s.id, amount: Number(d.amount), method: d.method, reference: d.reference });
          toast('سُجّل السداد'); reload();
        }, { submitLabel: 'سجّل' });
      }));

      el.querySelectorAll('[data-view]').forEach((tr) => tr.addEventListener('click', async () => {
        const p = list.find((x) => x.id === tr.dataset.view);
        const lines = await db.get('purchase_lines', { purchase_id: `eq.${p.id}`, select: 'qty,unit_cost,items(name,sku)' });
        openDialog(`فاتورة شراء ${idn(p.purchase_no)}`, `<p class="muted">${esc(p.suppliers?.name || '')} · ${esc(date(p.purchase_date))}${p.supplier_invoice_no ? ` · فاتورة المورد <bdi class="ltr">${esc(p.supplier_invoice_no)}</bdi>` : ''}</p>
          <div class="table-wrap"><table><thead><tr><th>الصنف</th><th class="num">الكمية</th><th class="num">التكلفة</th><th class="num">المجموع</th></tr></thead>
          <tbody>${lines.map((l) => `<tr><td>${esc(l.items?.name || '')}</td><td class="num">${num(l.qty)}</td><td class="num">${money(l.unit_cost)}</td><td class="num">${money(l.qty * l.unit_cost)}</td></tr>`).join('')}</tbody></table></div>
          <div class="totals"><span>قبل الضريبة</span><span class="num">${money(p.subtotal)}</span><span>ضريبة المدخلات</span><span class="num">${money(p.vat)}</span><span class="grand">الإجمالي</span><span class="num grand">${money(p.total)}</span></div>
          ${p.notes ? `<p>${esc(p.notes)}</p>` : ''}`, async () => true, { submitLabel: 'إغلاق' });
      }));

      el.querySelector('#new-pur').addEventListener('click', () => {
        if (!items.length) { toast('أضف الأصناف في المخزون أولاً', 'error'); return; }
        const itemOpts = options(items.map((it) => [it.id, `${it.name}${it.sku ? ` (${it.sku})` : ''}`]), '', { empty: 'اختر الصنف' });
        const lineHtml = () => `<div class="pline grid" style="grid-template-columns:minmax(0,2fr) 90px 110px 44px;gap:8px;align-items:end">
            <label class="field"><span>الصنف</span><select data-l="item" required>${itemOpts}</select></label>
            <label class="field"><span>الكمية</span><input data-l="qty" type="number" min="0.01" step="0.01" value="1" inputmode="decimal" required></label>
            <label class="field"><span>تكلفة الوحدة</span><input data-l="cost" type="number" min="0" step="0.001" inputmode="decimal" required></label>
            <button type="button" class="btn ghost icon-btn" data-rm aria-label="احذف السطر">${icon('trash')}</button></div>`;
        const d = openDialog('فاتورة شراء جديدة', `
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field('المورد', `<select name="supplier" required>${options(suppliers.map((s) => [s.id, s.name]), '', { empty: 'اختر المورد' })}</select>`, { req: true })}
            ${field('رقم فاتورة المورد', '<input name="invoice_no" dir="ltr">')}
            ${field('التاريخ', `<input name="date" type="date" value="${todayStr()}">`)}
          </div>
          <div id="plines" class="stack" style="gap:10px">${lineHtml()}</div>
          <button type="button" class="btn small" id="add-line" style="align-self:flex-start">${icon('plus')} سطر</button>
          <div class="totals"><span>قبل الضريبة</span><span class="num" id="p-sub">${money(0)}</span></div>
          <label class="field"><span>ضريبة المدخلات (ر.ع)</span><span class="row" style="flex-wrap:nowrap"><input name="vat" type="number" step="0.001" min="0" inputmode="decimal" value="0"><button type="button" class="btn small" id="vat5">${num(ctx.garage.vat_rate)}٪</button></span></label>
          ${field('ملاحظات', '<input name="notes">')}`, async (data, form) => {
          const lines = [...form.querySelectorAll('.pline')].map((r) => ({
            item_id: r.querySelector('[data-l=item]').value, qty: Number(r.querySelector('[data-l=qty]').value), unit_cost: Number(r.querySelector('[data-l=cost]').value),
          })).filter((l) => l.item_id);
          if (!lines.length) throw new Error('أضف صنفاً واحداً على الأقل');
          const p = await db.rpc('post_purchase', { p_supplier: data.supplier, p_invoice_no: data.invoice_no, p_date: data.date, p_vat: Number(data.vat || 0), p_lines: lines, p_notes: data.notes });
          toast(`سُجّلت فاتورة الشراء ${idn(p.purchase_no)} وأُضيفت الكميات للمخزون`);
          reload();
        }, { submitLabel: 'سجّل الفاتورة' });
        const box = d.querySelector('#plines');
        const subtotal = () => round3([...box.querySelectorAll('.pline')].reduce((a, r) => a + Number(r.querySelector('[data-l=qty]').value || 0) * Number(r.querySelector('[data-l=cost]').value || 0), 0));
        const recalc = () => { d.querySelector('#p-sub').textContent = money(subtotal()); };
        box.addEventListener('input', recalc);
        box.addEventListener('change', (e) => {
          if (e.target.matches('[data-l=item]')) {
            const it = items.find((x) => x.id === e.target.value);
            const cost = e.target.closest('.pline').querySelector('[data-l=cost]');
            if (it && !cost.value) cost.value = Number(it.unit_cost).toFixed(3);
            recalc();
          }
        });
        box.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && box.children.length > 1) { e.target.closest('.pline').remove(); recalc(); } });
        d.querySelector('#add-line').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', lineHtml()); });
        d.querySelector('#vat5').addEventListener('click', () => { d.querySelector('[name=vat]').value = round3(subtotal() * Number(ctx.garage.vat_rate) / 100).toFixed(3); });
        d.style.maxWidth = '720px';
      });
    },
  };
}
