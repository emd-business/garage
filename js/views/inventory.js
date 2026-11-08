import { db } from '../api.js';
import { esc, money, num, idn, dateTime, date, MAKES, CONDITION, fitsText } from '../format.js';
import { icon, toast, field, openDialog } from '../ui.js';
import { ctx } from '../state.js';

const stockBadge = (it) => {
  if (Number(it.qty) <= 0) return '<span class="badge danger">نفد</span>';
  if (Number(it.qty) <= Number(it.reorder_level)) return '<span class="badge warning">منخفض</span>';
  return '<span class="badge success">متوفر</span>';
};

const fitRow = (f = {}) => `<div class="fit-row">
    <input data-fit="make" list="makes" value="${esc(f.make || '')}" placeholder="الشركة" aria-label="الشركة">
    <input data-fit="model" value="${esc(f.model || '')}" placeholder="الموديل" aria-label="الموديل">
    <input data-fit="year_from" type="number" min="1950" max="2100" inputmode="numeric" value="${esc(f.year_from || '')}" placeholder="من سنة" aria-label="من سنة">
    <input data-fit="year_to" type="number" min="1950" max="2100" inputmode="numeric" value="${esc(f.year_to || '')}" placeholder="إلى سنة" aria-label="إلى سنة">
    <button type="button" class="btn small ghost" data-fit-del aria-label="احذف السيارة">${icon('trash')}</button>
  </div>`;

const itemFields = (it = {}) => `
  ${field('اسم الصنف', `<input name="name" required value="${esc(it.name || '')}">`, { req: true, cls: 'span-all' })}
  ${field('حالة القطعة', `<select name="condition">${Object.entries(CONDITION).map(([k, [t]]) => `<option value="${k}" ${(it.condition || 'new') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
  ${field('رمز الصنف', `<input name="sku" dir="ltr" value="${esc(it.sku || '')}">`)}
  ${field('الفئة', `<input name="category" list="cats" value="${esc(it.category || '')}">`)}
  ${field('مكان التخزين', `<input name="location" value="${esc(it.location || '')}" placeholder="مثال: رف A2">`)}
  ${field('التكلفة (ر.ع)', `<input name="unit_cost" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(it.unit_cost ?? 0)}">`)}
  ${field('سعر البيع (ر.ع)', `<input name="sell_price" type="number" step="0.001" min="0" inputmode="decimal" required value="${esc(it.sell_price ?? '')}">`, { req: true })}
  ${it.id ? '' : field('الكمية الحالية', '<input name="qty" type="number" step="1" min="0" inputmode="numeric" value="0">')}
  ${field('الضمان (يوم)', `<input name="warranty_days" type="number" step="1" min="0" inputmode="numeric" value="${esc(it.warranty_days ?? 0)}">`)}
  ${field('رمز التصنيف الجمركي HS', `<input name="hs_code" dir="ltr" inputmode="numeric" pattern="[0-9]{6,12}" value="${esc(it.hs_code || '')}" placeholder="870830">`, { hint: 'للفوترة الإلكترونية، من ٦ إلى ١٢ رقماً' })}
  ${field('حد إعادة الطلب', `<input name="reorder_level" type="number" step="1" min="0" inputmode="numeric" value="${esc(it.reorder_level ?? 0)}">`, { hint: 'ينبّهك النظام عند الوصول إليه' })}
  <fieldset class="span-all fits"><legend>السيارات المناسبة لهذه القطعة</legend>
    <p class="subtle">اتركها فارغة إن كانت القطعة تناسب كل السيارات. الموديل والسنوات اختيارية.</p>
    <div id="fit-rows">${(it.fits && it.fits.length ? it.fits : [{}]).map(fitRow).join('')}</div>
    <button type="button" class="btn small" id="fit-add">${icon('plus')} سيارة أخرى</button>
  </fieldset>
  <datalist id="makes">${MAKES.map((m) => `<option value="${m}">`).join('')}</datalist>
  <datalist id="cats">${['زيوت', 'فلاتر', 'فرامل', 'كهرباء', 'تعليق', 'إطارات', 'تبريد', 'محرك', 'إكسسوارات'].map((c) => `<option value="${c}">`).join('')}</datalist>`;

// the vehicle rows typed in the dialog
const readFits = (dlg) => [...dlg.querySelectorAll('.fit-row')].map((r) => {
  const v = (k) => r.querySelector(`[data-fit="${k}"]`).value.trim();
  const f = { make: v('make'), model: v('model'), year_from: Number(v('year_from')) || null, year_to: Number(v('year_to')) || null };
  if (f.year_from && f.year_to && f.year_from > f.year_to) [f.year_from, f.year_to] = [f.year_to, f.year_from];
  return f;
}).filter((f) => f.make);
const bindFits = (dlg) => {
  dlg.querySelector('#fit-add').addEventListener('click', () => {
    dlg.querySelector('#fit-rows').insertAdjacentHTML('beforeend', fitRow());
    dlg.querySelector('.fit-row:last-child [data-fit="make"]').focus();
  });
  dlg.querySelector('#fit-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fit-del]'); if (!b) return;
    const rows = dlg.querySelectorAll('.fit-row');
    if (rows.length > 1) b.closest('.fit-row').remove(); else rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
  });
};

const toRow = (d, dlg) => ({
  condition: d.condition || 'new', fits: readFits(dlg),
  name: d.name, sku: d.sku, category: d.category, location: d.location,
  unit_cost: Number(d.unit_cost || 0), sell_price: Number(d.sell_price || 0), reorder_level: Number(d.reorder_level || 0), warranty_days: Number(d.warranty_days || 0),
  hs_code: (d.hs_code || '').replace(/\D/g, '') || null,
});

export default async function inventory() {
  const canEdit = ctx.can('owner', 'manager', 'storekeeper');
  const seeCost = ctx.can('owner', 'manager', 'storekeeper', 'accountant');
  const [all, stock] = await Promise.all([
    db.get('items', { active: 'eq.true', order: 'name' }),
    ctx.multiBranch ? db.get('item_stock', { select: 'item_id,branch_id,qty' }).catch(() => []) : [],
  ]);
  // quantities shown are for the branch the user is working in; the total across branches is kept on the item
  const items = all.map((it) => {
    if (!ctx.multiBranch) return it;
    const here = stock.find((s) => s.item_id === it.id && s.branch_id === ctx.branch?.id);
    return { ...it, total: it.qty, qty: here ? here.qty : 0 };
  });
  const value = items.reduce((a, it) => a + Math.max(0, Number(it.qty)) * Number(it.unit_cost), 0);
  const low = items.filter((it) => Number(it.qty) <= Number(it.reorder_level));

  return {
    title: 'المخزون',
    html: `<div class="page-head"><div><h1>المخزون وقطع الغيار</h1><p class="lead">${ctx.multiBranch ? `${esc(ctx.branch?.name || '')} · ` : ''}${num(items.length)} صنف${low.length ? ` · ${num(low.length)} تحتاج إعادة طلب` : ''}</p></div>
        ${canEdit ? `<button class="btn primary" id="add">${icon('plus')} صنف جديد</button>` : ''}</div>
      <div class="kpis">
        <div class="kpi"><span class="label">الأصناف</span><span class="value">${num(items.length)}</span></div>
        <div class="kpi ${low.length ? 'alert' : ''}"><span class="label">منخفضة أو نافدة</span><span class="value">${num(low.length)}</span></div>
        ${seeCost ? `<div class="kpi"><span class="label">قيمة المخزون بالتكلفة</span><span class="value">${money(value)}</span></div>` : ''}
      </div>
      <div class="row" style="gap:10px">
        <input id="q" type="search" placeholder="ابحث باسم الصنف أو رمزه أو السيارة" aria-label="بحث في المخزون" style="flex:1 1 240px">
        <select id="cond" aria-label="حالة القطعة" style="flex:0 0 auto;width:auto"><option value="">كل القطع</option>${Object.entries(CONDITION).map(([k, [t]]) => `<option value="${k}">${t} فقط</option>`).join('')}</select>
      </div>
      <section class="card pad-0">${items.length ? `<div class="table-wrap"><table>
        <thead><tr><th>الصنف</th><th>الفئة</th><th>المكان</th><th class="num">${ctx.multiBranch ? 'في هذا الفرع' : 'الكمية'}</th>${ctx.multiBranch ? '<th class="num">كل الفروع</th>' : ''}<th>الحالة</th>${seeCost ? '<th class="num">التكلفة</th>' : ''}<th class="num">سعر البيع</th>${canEdit ? '<th><span class="hidden">إجراءات</span></th>' : ''}</tr></thead>
        <tbody>${items.map((it) => `<tr data-cond="${esc(it.condition || 'new')}" data-name="${esc(`${it.name} ${it.sku || ''} ${fitsText(it.fits)}`.toLowerCase())}"><td><a href="#/item/${it.id}"><strong>${esc(it.name)}</strong></a>${it.condition && it.condition !== 'new' ? ` <span class="badge ${CONDITION[it.condition][1]}">${CONDITION[it.condition][0]}</span>` : ''}${it.sku ? `<br><bdi class="subtle ltr">${esc(it.sku)}</bdi>` : ''}${(it.fits || []).length ? `<br><span class="subtle fit-line">${icon('car')} ${esc(fitsText(it.fits))}</span>` : ''}</td>
          <td>${esc(it.category || '')}</td><td>${esc(it.location || '')}</td><td class="num">${num(it.qty)}</td>${ctx.multiBranch ? `<td class="num subtle">${num(it.total)}</td>` : ''}<td>${stockBadge(it)}</td>
          ${seeCost ? `<td class="num">${money(it.unit_cost)}</td>` : ''}<td class="num">${money(it.sell_price)}</td>
          ${canEdit ? `<td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small" data-adjust="${it.id}">الكمية</button>${ctx.multiBranch && !ctx.branchLocked ? `<button class="btn small" data-move="${it.id}">تحويل</button>` : ''}<button class="btn small ghost" data-edit="${it.id}">تعديل</button></div></td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><p>لا توجد أصناف بعد.</p>${canEdit ? '<p class="subtle">أضف قطع الغيار التي تبيعها، فتُخصم تلقائياً عند صرفها لأمر عمل.</p>' : ''}</div>`}</section>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      const filter = () => {
        const t = el.querySelector('#q').value.trim().toLowerCase(), c = el.querySelector('#cond').value;
        el.querySelectorAll('tr[data-name]').forEach((tr) => tr.classList.toggle('hidden', (!!t && !tr.dataset.name.includes(t)) || (!!c && tr.dataset.cond !== c)));
      };
      el.querySelector('#q').addEventListener('input', filter);
      el.querySelector('#cond').addEventListener('change', filter);
      el.querySelector('#add')?.addEventListener('click', () => {
        const dlg = openDialog('صنف جديد', `<div class="grid form">${itemFields()}</div>`, async (d) => {
          const it = await db.insert('items', { ...toRow(d, dlg), qty: Number(d.qty || 0) });
          if (Number(d.qty) > 0) await db.insert('stock_movements', { item_id: it.id, qty: Number(d.qty), reason: 'رصيد افتتاحي' });
          toast('أُضيف الصنف'); reload();
        });
        bindFits(dlg);
      });
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const it = items.find((x) => x.id === b.dataset.edit);
        const dlg = openDialog('تعديل الصنف', `<div class="grid form">${itemFields(it)}</div>`, async (d) => {
          await db.update('items', { id: `eq.${it.id}` }, toRow(d, dlg));
          toast('حُفظ الصنف'); reload();
        });
        bindFits(dlg);
      }));
      el.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', () => {
        const it = items.find((x) => x.id === b.dataset.adjust);
        openDialog(`تعديل كمية: ${it.name}`, `<p class="muted">الكمية الحالية ${num(it.qty)}</p>
          ${field('الكمية بعد الجرد أو الشراء', `<input name="qty" type="number" step="1" min="0" inputmode="numeric" required value="${esc(it.qty)}">`, { req: true })}
          ${field('السبب', '<select name="reason"><option>شراء من مورد</option><option>جرد</option><option>تالف</option><option>تصحيح</option></select>')}`, async (d) => {
          if (Number(d.qty) === Number(it.qty)) return true;
          await db.rpc('adjust_stock', { p_item: it.id, p_new_qty: Number(d.qty), p_reason: d.reason });
          toast('عُدّلت الكمية'); reload();
          return true;
        });
      }));
      el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
        const it = items.find((x) => x.id === b.dataset.move);
        const per = (bid) => Number((stock.find((s) => s.item_id === it.id && s.branch_id === bid) || {}).qty || 0);
        const opts = (sel) => ctx.branches.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} (${num(per(x.id))})</option>`).join('');
        const other = ctx.branches.find((x) => x.id !== ctx.branch?.id);
        openDialog(`تحويل بين الفروع: ${it.name}`, `<p class="muted">ينقل الكمية من فرع إلى آخر دون أن يغيّر قيمة المخزون في الحسابات.</p>
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field('من فرع', `<select name="from">${opts(ctx.branch?.id)}</select>`)}
            ${field('إلى فرع', `<select name="to">${opts(other?.id)}</select>`)}
          </div>
          ${field('الكمية', '<input name="qty" type="number" step="1" min="1" inputmode="numeric" required>', { req: true })}`, async (d) => {
          if (d.from === d.to) { toast('اختر فرعين مختلفين', 'error'); return false; }
          await db.rpc('transfer_stock', { p_item: it.id, p_from: d.from, p_to: d.to, p_qty: Number(d.qty) });
          toast('حُوّلت الكمية'); reload();
          return true;
        });
      }));
    },
  };
}

// Item card: every movement, purchases, monthly consumption and days of cover.
export async function itemView([id]) {
  const it = await db.one('items', { id: `eq.${id}` });
  if (!it) throw new Error('الصنف غير موجود');
  const seeCost = ctx.can('owner', 'manager', 'storekeeper', 'accountant');
  const [moves, buys, stock] = await Promise.all([
    db.get('stock_movements', { item_id: `eq.${id}`, order: 'created_at.desc', limit: 200, select: 'qty,reason,created_at,job_id,branch_id,job_orders(job_no)' }).catch(() => []),
    seeCost ? db.get('purchase_lines', { item_id: `eq.${id}`, select: 'qty,unit_cost,purchases(purchase_no,purchase_date,suppliers(name))' }).catch(() => []) : [],
    ctx.multiBranch ? db.get('item_stock', { item_id: `eq.${id}`, select: 'branch_id,qty' }).catch(() => []) : [],
  ]);
  const since = Date.now() - 90 * 864e5;
  const used90 = moves.filter((m) => Number(m.qty) < 0 && m.job_id && new Date(m.created_at) >= since).reduce((a, m) => a - Number(m.qty), 0)
    - moves.filter((m) => Number(m.qty) > 0 && m.job_id && new Date(m.created_at) >= since).reduce((a, m) => a + Number(m.qty), 0);
  const monthly = Math.max(0, used90) / 3;
  const cover = monthly > 0 ? Math.floor(Number(it.qty) / (monthly / 30)) : null;
  return {
    title: it.name,
    html: `<div class="page-head"><div class="stack" style="gap:4px"><a href="#/inventory" class="subtle">المخزون</a><h1>${esc(it.name)}</h1>
        <p class="muted">${[CONDITION[it.condition || 'new'] && `<span class="badge ${CONDITION[it.condition || 'new'][1]}">${CONDITION[it.condition || 'new'][0]}</span>`, it.sku && `<bdi class="ltr">${esc(it.sku)}</bdi>`, it.category && esc(it.category), it.location && `المكان: ${esc(it.location)}`].filter(Boolean).join(' · ')}</p>
        <p>${icon('car')} ${(it.fits || []).length ? `تناسب: ${esc(fitsText(it.fits))}` : '<span class="subtle">تناسب كل السيارات</span>'}</p></div>${stockBadge(it)}</div>
      <div class="kpis">
        <div class="kpi"><span class="label">${ctx.multiBranch ? 'الكمية في كل الفروع' : 'الكمية الحالية'}</span><span class="value">${num(it.qty)}</span></div>
        ${stock.map((s) => `<div class="kpi"><span class="label">${esc(ctx.branchName(s.branch_id))}</span><span class="value">${num(s.qty)}</span></div>`).join('')}
        <div class="kpi"><span class="label">الاستهلاك الشهري</span><span class="value">${num(Math.round(monthly * 10) / 10)}</span></div>
        <div class="kpi ${cover !== null && cover < 14 ? 'alert' : ''}"><span class="label">يكفي لمدة</span><span class="value">${cover === null ? '—' : `${num(cover)} يوماً`}</span></div>
        ${seeCost ? `<div class="kpi"><span class="label">متوسط التكلفة</span><span class="value">${money(it.unit_cost)}</span></div>` : ''}
        <div class="kpi"><span class="label">سعر البيع</span><span class="value">${money(it.sell_price)}</span></div>
      </div>
      <div class="grid two">
        <section class="card"><h2 style="margin-bottom:10px">حركة الصنف</h2>
          ${moves.length ? `<div class="list">${moves.map((m) => `<div class="list-item"><span>${esc(m.reason)}${ctx.multiBranch ? ` · ${esc(ctx.branchName(m.branch_id))}` : ''}${m.job_id ? ` · <a href="#/job/${m.job_id}">أمر ${idn(m.job_orders?.job_no)}</a>` : ''}<br><span class="subtle">${esc(dateTime(m.created_at))}</span></span>
            <strong style="color:${Number(m.qty) < 0 ? 'var(--danger-ink)' : 'var(--success-ink)'}"><bdi>${Number(m.qty) > 0 ? '+' : ''}${num(m.qty)}</bdi></strong></div>`).join('')}</div>` : '<p class="muted">لا توجد حركات.</p>'}
        </section>
        ${seeCost ? `<section class="card"><h2 style="margin-bottom:10px">آخر المشتريات</h2>
          ${buys.length ? `<div class="list">${buys.sort((a, b) => String(b.purchases?.purchase_date).localeCompare(String(a.purchases?.purchase_date))).map((b) => `<div class="list-item"><span>${esc(b.purchases?.suppliers?.name || '')} · شراء ${idn(b.purchases?.purchase_no)}<br><span class="subtle">${esc(date(b.purchases?.purchase_date))}</span></span><span>${num(b.qty)} × ${money(b.unit_cost)}</span></div>`).join('')}</div>` : '<p class="muted">لم يُشترَ هذا الصنف عبر فواتير الشراء بعد.</p>'}
        </section>` : ''}
      </div>`,
  };
}
