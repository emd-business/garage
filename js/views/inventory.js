import { db, like } from '../api.js';
import { esc, money, num } from '../format.js';
import { icon, toast, field, openDialog } from '../ui.js';
import { ctx } from '../state.js';

const stockBadge = (it) => {
  if (Number(it.qty) <= 0) return '<span class="badge danger">نفد</span>';
  if (Number(it.qty) <= Number(it.reorder_level)) return '<span class="badge warning">منخفض</span>';
  return '<span class="badge success">متوفر</span>';
};

const itemFields = (it = {}) => `
  ${field('اسم الصنف', `<input name="name" required value="${esc(it.name || '')}">`, { req: true, cls: 'span-all' })}
  ${field('رمز الصنف', `<input name="sku" dir="ltr" value="${esc(it.sku || '')}">`)}
  ${field('الفئة', `<input name="category" list="cats" value="${esc(it.category || '')}">`)}
  ${field('مكان التخزين', `<input name="location" value="${esc(it.location || '')}" placeholder="مثال: رف A2">`)}
  ${field('التكلفة (ر.ع)', `<input name="unit_cost" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(it.unit_cost ?? 0)}">`)}
  ${field('سعر البيع (ر.ع)', `<input name="sell_price" type="number" step="0.001" min="0" inputmode="decimal" required value="${esc(it.sell_price ?? '')}">`, { req: true })}
  ${it.id ? '' : field('الكمية الحالية', '<input name="qty" type="number" step="1" min="0" inputmode="numeric" value="0">')}
  ${field('حد إعادة الطلب', `<input name="reorder_level" type="number" step="1" min="0" inputmode="numeric" value="${esc(it.reorder_level ?? 0)}">`, { hint: 'ينبّهك النظام عند الوصول إليه' })}
  <datalist id="cats">${['زيوت', 'فلاتر', 'فرامل', 'كهرباء', 'تعليق', 'إطارات', 'تبريد', 'محرك', 'إكسسوارات'].map((c) => `<option value="${c}">`).join('')}</datalist>`;

const toRow = (d) => ({
  name: d.name, sku: d.sku, category: d.category, location: d.location,
  unit_cost: Number(d.unit_cost || 0), sell_price: Number(d.sell_price || 0), reorder_level: Number(d.reorder_level || 0),
});

export default async function inventory() {
  const canEdit = ctx.can('owner', 'manager', 'storekeeper');
  const seeCost = ctx.can('owner', 'manager', 'storekeeper', 'accountant');
  const items = await db.get('items', { active: 'eq.true', order: 'name' });
  const value = items.reduce((a, it) => a + Math.max(0, Number(it.qty)) * Number(it.unit_cost), 0);
  const low = items.filter((it) => Number(it.qty) <= Number(it.reorder_level));

  return {
    title: 'المخزون',
    html: `<div class="page-head"><div><h1>المخزون وقطع الغيار</h1><p class="lead">${num(items.length)} صنف${low.length ? ` · ${num(low.length)} تحتاج إعادة طلب` : ''}</p></div>
        ${canEdit ? `<button class="btn primary" id="add">${icon('plus')} صنف جديد</button>` : ''}</div>
      <div class="kpis">
        <div class="kpi"><span class="label">الأصناف</span><span class="value">${num(items.length)}</span></div>
        <div class="kpi ${low.length ? 'alert' : ''}"><span class="label">منخفضة أو نافدة</span><span class="value">${num(low.length)}</span></div>
        ${seeCost ? `<div class="kpi"><span class="label">قيمة المخزون بالتكلفة</span><span class="value">${money(value)}</span></div>` : ''}
      </div>
      <input id="q" type="search" placeholder="ابحث باسم الصنف أو رمزه" aria-label="بحث في المخزون">
      <section class="card pad-0">${items.length ? `<div class="table-wrap"><table>
        <thead><tr><th>الصنف</th><th>الفئة</th><th>المكان</th><th class="num">الكمية</th><th>الحالة</th>${seeCost ? '<th class="num">التكلفة</th>' : ''}<th class="num">سعر البيع</th>${canEdit ? '<th><span class="hidden">إجراءات</span></th>' : ''}</tr></thead>
        <tbody>${items.map((it) => `<tr data-name="${esc(`${it.name} ${it.sku || ''}`.toLowerCase())}"><td><strong>${esc(it.name)}</strong>${it.sku ? `<br><bdi class="subtle ltr">${esc(it.sku)}</bdi>` : ''}</td>
          <td>${esc(it.category || '')}</td><td>${esc(it.location || '')}</td><td class="num">${num(it.qty)}</td><td>${stockBadge(it)}</td>
          ${seeCost ? `<td class="num">${money(it.unit_cost)}</td>` : ''}<td class="num">${money(it.sell_price)}</td>
          ${canEdit ? `<td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small" data-adjust="${it.id}">الكمية</button><button class="btn small ghost" data-edit="${it.id}">تعديل</button></div></td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><p>لا توجد أصناف بعد.</p>${canEdit ? '<p class="subtle">أضف قطع الغيار التي تبيعها، فتُخصم تلقائياً عند صرفها لأمر عمل.</p>' : ''}</div>`}</section>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelector('#q').addEventListener('input', (e) => {
        const t = e.target.value.trim().toLowerCase();
        el.querySelectorAll('tr[data-name]').forEach((tr) => tr.classList.toggle('hidden', !!t && !tr.dataset.name.includes(t)));
      });
      el.querySelector('#add')?.addEventListener('click', () => openDialog('صنف جديد', `<div class="grid form">${itemFields()}</div>`, async (d) => {
        const it = await db.insert('items', { ...toRow(d), qty: Number(d.qty || 0) });
        if (Number(d.qty) > 0) await db.insert('stock_movements', { item_id: it.id, qty: Number(d.qty), reason: 'رصيد افتتاحي' });
        toast('أُضيف الصنف'); reload();
      }));
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const it = items.find((x) => x.id === b.dataset.edit);
        openDialog('تعديل الصنف', `<div class="grid form">${itemFields(it)}</div>`, async (d) => {
          await db.update('items', { id: `eq.${it.id}` }, toRow(d));
          toast('حُفظ الصنف'); reload();
        });
      }));
      el.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', () => {
        const it = items.find((x) => x.id === b.dataset.adjust);
        openDialog(`تعديل كمية: ${it.name}`, `<p class="muted">الكمية الحالية ${num(it.qty)}</p>
          ${field('الكمية بعد الجرد أو الشراء', `<input name="qty" type="number" step="1" min="0" inputmode="numeric" required value="${esc(it.qty)}">`, { req: true })}
          ${field('السبب', '<select name="reason"><option>شراء من مورد</option><option>جرد</option><option>تالف</option><option>تصحيح</option></select>')}`, async (d) => {
          const diff = Number(d.qty) - Number(it.qty);
          if (!diff) return true;
          await db.update('items', { id: `eq.${it.id}` }, { qty: Number(d.qty) });
          await db.insert('stock_movements', { item_id: it.id, qty: diff, reason: d.reason });
          toast('عُدّلت الكمية'); reload();
          return true;
        });
      }));
    },
  };
}
