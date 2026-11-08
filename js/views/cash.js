import { db } from '../api.js';
import { esc, money, dateTime, round3 } from '../format.js';
import { toast, field, busy, formData } from '../ui.js';
import { ctx } from '../state.js';

const IN = { payments: 'مقبوضات الفواتير', deposits: 'العرابين', deposit_refunds: 'ردّ العرابين', credit_refunds: 'ردّ الإشعارات الدائنة' };
const OUT = { expenses: 'المصروفات النقدية', suppliers: 'السداد للموردين' };

export default async function cash() {
  const [s, history] = await Promise.all([
    db.rpc('cash_status', {}),
    db.get('cash_closings', { ...ctx.here, order: 'period_to.desc', limit: 30 }),
  ]);
  const row = (label, v, neg) => `<div class="list-item"><span>${esc(label)}</span><strong class="num">${neg && Number(v) ? '−' : ''}${money(Math.abs(Number(v) || 0))}</strong></div>`;
  const diffBadge = (d) => (Math.abs(Number(d)) < 0.0005 ? '<span class="badge success">مطابق</span>'
    : Number(d) < 0 ? `<span class="badge danger">عجز ${money(-Number(d))}</span>` : `<span class="badge warning">زيادة ${money(d)}</span>`);

  return {
    title: 'الصندوق',
    html: `<div class="page-head"><div><h1>الصندوق</h1>
        <p class="lead">${s.since ? `منذ آخر إقفال: ${esc(dateTime(s.since))}` : 'لم يُقفَل الصندوق من قبل'}${ctx.multiBranch ? ` · ${esc(ctx.branchName(s.branch_id))}` : ''}</p></div></div>
      <div class="kpis">
        <div class="kpi"><span class="label">الرصيد الافتتاحي</span><span class="value">${money(s.opening)}</span></div>
        <div class="kpi"><span class="label">الداخل نقداً</span><span class="value">${money(s.cash_in)}</span></div>
        <div class="kpi"><span class="label">الخارج نقداً</span><span class="value">${money(s.cash_out)}</span></div>
        <div class="kpi"><span class="label">المفترض في الصندوق</span><span class="value">${money(s.expected)}</span></div>
      </div>
      <div class="cols">
        <section class="card stack"><h2>حركة النقد منذ آخر إقفال</h2>
          <div class="list">${Object.entries(IN).map(([k, l]) => row(l, s.in?.[k], Number(s.in?.[k]) < 0)).join('')}
          ${Object.entries(OUT).map(([k, l]) => row(l, s.out?.[k], true)).join('')}</div>
          <p class="subtle">تُحسب الدفعات النقدية فقط. البطاقة والتحويل تذهب إلى البنك مباشرة.</p></section>
        <form class="card stack" id="close" novalidate><h2>إقفال الصندوق</h2>
          ${field('المبلغ المعدود فعلاً (ر.ع)', '<input name="counted" type="number" step="0.001" min="0" inputmode="decimal" required>', { req: true })}
          <p id="diff" class="subtle" aria-live="polite"></p>
          ${field('المودَع في البنك (ر.ع)', '<input name="to_bank" type="number" step="0.001" min="0" inputmode="decimal" value="0">', { hint: 'ما يُسحب من الصندوق ويُودَع في البنك. الباقي يصبح رصيد بداية الإقفال القادم.' })}
          ${field('ملاحظات', '<textarea name="notes" placeholder="سبب الفرق إن وُجد"></textarea>')}
          <div><button class="btn primary">أقفل الصندوق</button></div></form>
      </div>
      <section class="card pad-0"><div class="card-head" style="padding:16px 20px 0"><h2>الإقفالات السابقة</h2></div>
        ${history.length ? `<div class="table-wrap"><table>
          <thead><tr><th>وقت الإقفال</th>${ctx.multiBranch ? '<th>الفرع</th>' : ''}<th class="num">المفترض</th><th class="num">المعدود</th><th>الفرق</th><th class="num">للبنك</th><th>القائم بالإقفال</th><th>ملاحظات</th></tr></thead>
          <tbody>${history.map((h) => `<tr><td>${esc(dateTime(h.period_to))}</td>${ctx.multiBranch ? `<td>${esc(ctx.branchName(h.branch_id))}</td>` : ''}
            <td class="num">${money(h.expected)}</td><td class="num">${money(h.counted)}</td><td>${diffBadge(h.difference)}</td>
            <td class="num">${Number(h.to_bank) ? money(h.to_bank) : '—'}</td><td>${esc(ctx.staffName(h.closed_by) || '')}</td><td>${esc(h.notes || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><p>لا توجد إقفالات بعد.</p><p class="subtle">اعدد النقد آخر كل يوم وسجّله هنا، فيظهر أي عجز أو زيادة فوراً.</p></div>'}</section>`,
    bind(el) {
      const f = el.querySelector('#close');
      const counted = f.querySelector('[name="counted"]');
      const hint = f.querySelector('#diff');
      counted.addEventListener('input', () => {
        if (counted.value === '') { hint.textContent = ''; return; }
        const d = round3(Number(counted.value) - Number(s.expected));
        hint.textContent = Math.abs(d) < 0.0005 ? 'مطابق للمفترض' : d < 0 ? `عجز ${money(-d)}` : `زيادة ${money(d)}`;
        hint.className = Math.abs(d) < 0.0005 ? 'subtle' : 'notice warn';
      });
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const d = formData(f);
        if (d.counted === '' || d.counted == null) { toast('اكتب المبلغ المعدود', 'error'); return; }
        busy(ev.submitter, async () => {
          const r = await db.rpc('close_cash', { p_counted: Number(d.counted), p_to_bank: Number(d.to_bank || 0), p_notes: d.notes || null });
          const df = Number(r.difference);
          toast(Math.abs(df) < 0.0005 ? 'أُقفل الصندوق' : `أُقفل الصندوق: ${df < 0 ? 'عجز' : 'زيادة'} ${money(Math.abs(df))}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      });
    },
  };
}
