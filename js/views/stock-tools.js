// Full stock count and reorder suggestions.
import { db } from '../api.js';
import { esc, money, num, date, waLink } from '../format.js';
import { icon, toast, busy } from '../ui.js';
import { ctx } from '../state.js';

const draftKey = () => `emd-count-${ctx.garage.id}-${ctx.branch?.id || 'main'}`;
const readDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch { return {}; } };
const writeDraft = (d) => { try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch { /* storage off */ } };

async function branchItems() {
  const [all, stock] = await Promise.all([
    db.get('items', { active: 'eq.true', order: 'location.nullslast,name', select: 'id,name,sku,category,location,qty,unit_cost' }),
    ctx.multiBranch ? db.get('item_stock', { select: 'item_id,branch_id,qty' }).catch(() => []) : [],
  ]);
  return all.map((it) => (ctx.multiBranch ? { ...it, qty: (stock.find((s) => s.item_id === it.id && s.branch_id === ctx.branch?.id) || {}).qty || 0 } : it));
}

// ---------- #/stocktake ----------
export async function stocktake() {
  if (!ctx.can('owner', 'manager', 'storekeeper')) throw new Error('الجرد لمالك الكراج والمدير وأمين المخزن');
  const items = await branchItems();
  const draft = readDraft();
  const cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const locs = [...new Set(items.map((i) => i.location).filter(Boolean))].sort();
  return {
    title: 'الجرد',
    html: `<div class="page-head"><div><a href="#/inventory" class="subtle">${icon('back').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} المخزون</a>
        <h1>الجرد الشامل</h1><p class="lead">${ctx.multiBranch ? `${esc(ctx.branch?.name || '')} · ` : ''}${num(items.length)} صنف</p></div>
        <div class="row"><a class="btn" href="#/countsheet" target="_blank" rel="noopener">${icon('print')} اطبع ورقة الجرد</a></div></div>
      <div class="notice info">اطبع الورقة وعُدّ الرفوف، ثم اكتب هنا ما عددته. الأصناف التي تتركها فارغة لا تتغير. عند الترحيل تُصحَّح الكميات ويُقيَّد الفرق في الحسابات.</div>
      <div class="row" style="gap:10px">
        <input id="q" type="search" placeholder="ابحث باسم الصنف أو رمزه" aria-label="بحث" style="flex:1 1 220px">
        ${cats.length ? `<select id="cat" aria-label="الفئة" style="width:auto"><option value="">كل الفئات</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
        ${locs.length ? `<select id="loc" aria-label="المكان" style="width:auto"><option value="">كل الأماكن</option>${locs.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
        <label class="row" style="gap:8px"><input type="checkbox" id="blind" style="width:auto;min-height:0"> أخفِ كمية النظام</label>
      </div>
      <section class="card pad-0"><div class="table-wrap"><table class="count-table">
        <thead><tr><th>الصنف</th><th>المكان</th><th class="num sys">في النظام</th><th class="num">المعدود</th><th class="num sys">الفرق</th></tr></thead>
        <tbody>${items.map((it) => `<tr data-id="${it.id}" data-cat="${esc(it.category || '')}" data-loc="${esc(it.location || '')}" data-name="${esc(`${it.name} ${it.sku || ''}`.toLowerCase())}">
          <td><strong>${esc(it.name)}</strong>${it.sku ? `<br><bdi class="subtle ltr">${esc(it.sku)}</bdi>` : ''}</td><td>${esc(it.location || '')}</td>
          <td class="num sys">${num(it.qty)}</td>
          <td class="num"><input class="count-in" type="number" min="0" step="1" inputmode="numeric" aria-label="المعدود من ${esc(it.name)}" value="${esc(draft[it.id] ?? '')}"></td>
          <td class="num sys diff"></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card stack count-foot">
        <div class="row" style="justify-content:space-between"><span id="sum" class="subtle"></span>
          <span class="row" style="gap:8px"><button type="button" class="btn ghost" id="clear">امسح المعدود</button><button type="button" class="btn primary" id="post">رحّل الجرد</button></span></div>
        <input id="note" placeholder="ملاحظة على الجرد (اختياري)" aria-label="ملاحظة">
      </section>`,
    bind(el) {
      const rows = [...el.querySelectorAll('tr[data-id]')];
      const byId = Object.fromEntries(items.map((i) => [i.id, i]));
      const refresh = () => {
        let n = 0, changed = 0, plus = 0, minus = 0;
        const d = {};
        rows.forEach((tr) => {
          const inp = tr.querySelector('input'), cell = tr.querySelector('.diff'), it = byId[tr.dataset.id];
          if (inp.value === '') { cell.textContent = ''; tr.classList.remove('diff-plus', 'diff-minus'); return; }
          n++; d[it.id] = inp.value;
          const df = Number(inp.value) - Number(it.qty);
          cell.textContent = df ? `${df > 0 ? '+' : '−'}${num(Math.abs(df))}` : '✓';
          tr.classList.toggle('diff-plus', df > 0); tr.classList.toggle('diff-minus', df < 0);
          if (df) { changed++; if (df > 0) plus += df * it.unit_cost; else minus -= df * it.unit_cost; }
        });
        writeDraft(d);
        el.querySelector('#sum').textContent = n ? `عُدّ ${num(n)} صنف · بفرق ${num(changed)}${ctx.can('owner', 'manager') ? ` · زيادة ${money(plus)} · نقص ${money(minus)}` : ''}` : 'لم يُعدّ شيء بعد';
        return { n, changed };
      };
      const filter = () => {
        const t = el.querySelector('#q').value.trim().toLowerCase(), c = el.querySelector('#cat')?.value, l = el.querySelector('#loc')?.value;
        rows.forEach((tr) => tr.classList.toggle('hidden', (!!t && !tr.dataset.name.includes(t)) || (!!c && tr.dataset.cat !== c) || (!!l && tr.dataset.loc !== l)));
      };
      el.querySelector('#q').addEventListener('input', filter);
      el.querySelector('#cat')?.addEventListener('change', filter);
      el.querySelector('#loc')?.addEventListener('change', filter);
      el.querySelector('#blind').addEventListener('change', (e) => el.querySelector('.count-table').classList.toggle('blind', e.target.checked));
      el.querySelector('tbody').addEventListener('input', refresh);
      // Enter moves to the next count box, like a paper sheet
      el.querySelector('tbody').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('.count-in')) return;
        e.preventDefault();
        const vis = rows.filter((r) => !r.classList.contains('hidden'));
        const i = vis.indexOf(e.target.closest('tr'));
        vis[i + 1]?.querySelector('input').focus();
      });
      el.querySelector('#clear').addEventListener('click', () => { rows.forEach((tr) => { tr.querySelector('input').value = ''; }); refresh(); });
      el.querySelector('#post').addEventListener('click', (ev) => {
        const counts = rows.map((tr) => [tr.dataset.id, tr.querySelector('input').value]).filter(([, v]) => v !== '').map(([id, v]) => ({ item_id: id, counted: Number(v) }));
        if (!counts.length) { toast('اكتب الكمية المعدودة لصنف واحد على الأقل', 'error'); return; }
        if (counts.some((c) => !(c.counted >= 0))) { toast('توجد كمية معدودة غير صحيحة', 'error'); return; }
        busy(ev.currentTarget, async () => {
          const r = await db.rpc('post_stocktake', { p_counts: counts, p_note: el.querySelector('#note').value || null });
          writeDraft({});
          toast(r.changed ? `رُحّل الجرد. عدد الأصناف المصحّحة: ${num(r.changed)}` : 'رُحّل الجرد، ولا توجد فروق');
          location.hash = '#/inventory';
        });
      });
      refresh();
    },
  };
}

// ---------- #/countsheet (printable, no app shell) ----------
export async function countsheet() {
  if (!ctx.can('owner', 'manager', 'storekeeper')) throw new Error('الجرد لمالك الكراج والمدير وأمين المخزن');
  const items = await branchItems();
  return {
    html: `<div class="print-bar"><button class="btn primary" id="do-print">${icon('print')} اطبع</button><a class="btn" href="#/stocktake">رجوع للجرد</a></div>
      <article class="doc">
        <header class="doc-head"><div><div class="g-name">ورقة الجرد</div><div class="g-meta">${esc(ctx.garage.name)}${ctx.multiBranch ? ` · ${esc(ctx.branch?.name || '')}` : ''}</div></div>
          <div class="g-meta" style="text-align:left">${esc(date(new Date()))}<br>${num(items.length)} صنف</div></header>
        <table><thead><tr><th>#</th><th>الصنف</th><th>الرمز</th><th>المكان</th><th style="width:28mm">المعدود</th><th style="width:30mm">ملاحظة</th></tr></thead>
          <tbody>${items.map((it, i) => `<tr><td>${num(i + 1)}</td><td>${esc(it.name)}</td><td><bdi class="ltr">${esc(it.sku || '')}</bdi></td><td>${esc(it.location || '')}</td><td></td><td></td></tr>`).join('')}</tbody></table>
        <div class="sign"><div>القائم بالعد</div><div>المراجع</div></div>
      </article>`,
    bind(el) { el.querySelector('#do-print').addEventListener('click', () => window.print()); },
  };
}

// ---------- #/reorder ----------
export async function reorder() {
  if (!ctx.can('owner', 'manager', 'storekeeper', 'accountant')) throw new Error('غير مصرح');
  const rows = await db.rpc('reorder_suggestions');
  const groups = [];
  rows.forEach((r) => {
    const k = r.supplier_id || '';
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push(g = { k, name: r.supplier_name || 'بلا مورد سابق', phone: r.supplier_phone, rows: [] });
    g.rows.push(r);
  });
  const canBuy = ctx.can('owner', 'manager', 'accountant', 'storekeeper');
  return {
    title: 'إعادة الطلب',
    html: `<div class="page-head"><div><a href="#/inventory" class="subtle">${icon('back').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} المخزون</a>
        <h1>ما يجب طلبه</h1><p class="lead">${num(rows.length)} صنف وصل إلى حد إعادة الطلب أو أقل</p></div></div>
      ${rows.length ? `<p class="subtle">الكمية المقترحة تكفي شهراً حسب الاستهلاك في آخر ٩٠ يوماً، مع إبقاء حد إعادة الطلب احتياطاً. عدّلها كما تريد.</p>
        ${groups.map((g, gi) => `<section class="card pad-0 order-group" data-g="${gi}">
          <div class="card-head" style="padding:16px 20px 0"><h2>${esc(g.name)}</h2>
            <div class="row" style="gap:6px">${g.phone ? `<button type="button" class="btn small wa" data-wa="${gi}">${icon('wa')} أرسل الطلب</button>` : ''}${canBuy && g.k ? `<button type="button" class="btn small primary" data-po="${gi}">فاتورة شراء</button>` : ''}</div></div>
          <div class="table-wrap"><table><thead><tr><th><span class="sr-only">اختيار</span></th><th>الصنف</th><th class="num">المتوفر</th><th class="num">الحد</th><th class="num">استُهلك (٩٠ يوماً)</th><th class="num">اطلب</th>${ctx.can('owner', 'manager', 'accountant', 'storekeeper') ? '<th class="num">التكلفة التقديرية</th>' : ''}</tr></thead>
          <tbody>${g.rows.map((r) => `<tr data-item="${r.item_id}"><td><input type="checkbox" checked aria-label="اطلب ${esc(r.name)}" style="width:auto;min-height:0"></td>
            <td><a href="#/item/${r.item_id}"><strong>${esc(r.name)}</strong></a>${r.sku ? `<br><bdi class="subtle ltr">${esc(r.sku)}</bdi>` : ''}</td>
            <td class="num">${Number(r.qty) <= 0 ? '<span class="badge danger">نفد</span>' : num(r.qty)}</td><td class="num">${num(r.reorder_level)}</td><td class="num">${num(r.used_90)}</td>
            <td class="num"><input class="order-qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(r.suggest)}" data-cost="${esc(r.unit_cost)}" style="max-width:90px"></td>
            <td class="num est">${money(Number(r.suggest) * Number(r.unit_cost))}</td></tr>`).join('')}</tbody></table></div>
          ${g.k ? '' : '<p class="subtle" style="padding:0 20px 16px">هذه الأصناف لم تُشترَ من قبل في النظام. سجّل فاتورة شرائها من «المشتريات» مع المورد الذي تختاره.</p>'}
        </section>`).join('')}`
    : '<div class="card empty"><p>كل الأصناف فوق حد إعادة الطلب.</p><p class="subtle">ضع «حد إعادة الطلب» لكل صنف من صفحة المخزون، فيظهر هنا عندما تقل كميته.</p></div>'}`,
    bind(el) {
      const picked = (gi) => [...el.querySelectorAll(`[data-g="${gi}"] tr[data-item]`)].filter((tr) => tr.querySelector('[type=checkbox]').checked)
        .map((tr) => ({ ...groups[gi].rows.find((r) => r.item_id === tr.dataset.item), qty: Number(tr.querySelector('.order-qty').value || 0) })).filter((r) => r.qty > 0);
      el.addEventListener('input', (e) => {
        if (!e.target.matches('.order-qty')) return;
        e.target.closest('tr').querySelector('.est').textContent = money(Number(e.target.value || 0) * Number(e.target.dataset.cost));
      });
      el.querySelectorAll('[data-wa]').forEach((b) => b.addEventListener('click', () => {
        const g = groups[b.dataset.wa], list = picked(b.dataset.wa);
        if (!list.length) { toast('اختر صنفاً واحداً على الأقل', 'error'); return; }
        const msg = `مرحباً ${g.name}،\nنرغب بطلب ما يلي لـ ${ctx.garage.name}:\n${list.map((r) => `- ${r.name}${r.sku ? ` (${r.sku})` : ''}: ${r.qty}`).join('\n')}\nنرجو تأكيد التوفر والسعر. شكراً.`;
        window.open(waLink(g.phone, msg), '_blank', 'noopener');
      }));
      el.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', () => {
        const g = groups[b.dataset.po], list = picked(b.dataset.po);
        if (!list.length) { toast('اختر صنفاً واحداً على الأقل', 'error'); return; }
        try { sessionStorage.setItem('emd-po-draft', JSON.stringify({ supplier: g.k, lines: list.map((r) => ({ item_id: r.item_id, qty: r.qty, unit_cost: Number(r.unit_cost) })) })); } catch { /* storage off */ }
        location.hash = '#/purchases';
      }));
    },
  };
}
