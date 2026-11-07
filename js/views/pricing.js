import { db } from '../api.js';
import { esc, money, num, round3 } from '../format.js';
import { icon, toast, field, busy, openDialog } from '../ui.js';
import { ctx, refreshGarage } from '../state.js';
import { EXPENSE_CATS } from './expenses.js';

// Hourly cost = monthly costs ÷ sold hours; sold hours = technicians × days × hours × utilization.
export default async function pricing() {
  const g = ctx.garage;
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  const from30 = new Date(Date.now() + 4 * 3600e3 - 30 * 864e5).toISOString().slice(0, 10);
  const [costs, rep] = await Promise.all([
    db.rpc('monthly_costs', { p_months: 3 }),
    db.rpc('report_summary', { p_from: from30, p_to: today }),
  ]);
  const techs = ctx.staff.filter((s) => s.active && s.role === 'technician').length || 1;
  const rows = costs.length ? costs : EXPENSE_CATS.slice(0, 4).map((c) => ({ category: c, monthly: 0 }));
  const soldHours30 = (rep.technicians || []).reduce((a, x) => a + Number(x.hours), 0);

  const costRow = (c) => `<div class="crow grid" style="grid-template-columns:minmax(0,1fr) 140px 44px;gap:8px;align-items:center">
      <input data-c="name" value="${esc(c.category)}" aria-label="البند">
      <input data-c="amount" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(Number(c.monthly).toFixed(3))}" aria-label="المبلغ الشهري">
      <button type="button" class="btn ghost icon-btn" data-rm aria-label="احذف">${icon('trash')}</button></div>`;

  return {
    title: 'التسعير',
    html: `<div class="page-head"><div><h1>التسعير ونسبة التشغيل</h1><p class="lead">اعرف كم يجب أن تبيع ساعة العمل حتى تربح.</p></div></div>
      <div class="cols">
        <div class="stack">
          <section class="card stack">
            <div class="card-head" style="margin:0"><h2>التكاليف الشهرية</h2><button type="button" class="btn small" id="add-cost">${icon('plus')} بند</button></div>
            <p class="subtle">${costs.length ? 'عُبّئت من متوسط مصروفاتك المسجلة في آخر ٣ أشهر. عدّلها إن لزم.' : 'لم تُسجَّل مصروفات بعد، فأدخل تكاليفك الشهرية تقديرياً، أو سجّلها في صفحة المصروفات.'}</p>
            <div id="costs" class="stack" style="gap:8px">${rows.map(costRow).join('')}</div>
            <div class="totals"><span><strong>مجموع التكاليف الشهرية</strong></span><span class="num"><strong id="c-total"></strong></span></div>
          </section>
          <form class="card stack" id="params" novalidate>
            <h2>الطاقة الإنتاجية</h2>
            <div class="grid form">
              ${field('عدد الفنيين', `<input name="techs" type="number" min="1" step="1" value="${techs}">`)}
              ${field('أيام العمل في الشهر', `<input name="work_days" type="number" min="1" max="31" value="${esc(g.work_days ?? 26)}">`)}
              ${field('ساعات العمل في اليوم', `<input name="hours_per_day" type="number" min="1" max="24" step="0.5" value="${esc(g.hours_per_day ?? 9)}">`)}
              ${field('نسبة التشغيل المستهدفة ٪', `<input name="utilization_pct" type="number" min="1" max="100" value="${esc(g.utilization_pct ?? 70)}">`, { hint: 'نسبة الساعات التي تُباع فعلاً للعملاء' })}
              ${field('هامش الربح على العمالة ٪', `<input name="labor_margin_pct" type="number" min="0" max="500" value="${esc(g.labor_margin_pct ?? 25)}">`)}
            </div>
            <div><button class="btn">احفظ هذه الإعدادات</button></div>
          </form>
        </div>
        <div class="stack">
          <section class="card stack">
            <h2>سعر الساعة</h2>
            <div class="totals">
              <span>الساعات المباعة شهرياً</span><span class="num" id="r-hours"></span>
              <span>تكلفة الساعة</span><span class="num" id="r-cost"></span>
              <span class="grand">السعر المقترح</span><span class="num grand" id="r-rate"></span>
              <span>سعرك الحالي</span><span class="num">${money(g.labor_rate)}</span>
            </div>
            <p class="subtle" id="r-formula"></p>
            <label class="row" style="gap:8px"><input type="checkbox" id="reprice" checked style="width:auto;min-height:0"> أعِد تسعير كل الخدمات حسب ساعاتها المعيارية</label>
            <button class="btn primary" id="apply-rate">طبّق السعر المقترح</button>
          </section>
          <section class="card stack">
            <h2>نسبة التشغيل الفعلية</h2>
            <p>في آخر ٣٠ يوماً بِعت <strong>${num(soldHours30)}</strong> ساعة عمل من أصل <strong id="avail30"></strong> ساعة متاحة.</p>
            <p style="font-size:24px;font-weight:700" id="util30"></p>
            <p class="subtle">محسوبة من بنود العمالة في الفواتير.</p>
          </section>
          <section class="card stack">
            <h2>هامش قطع الغيار</h2>
            ${field('نسبة الربح فوق التكلفة ٪', `<input id="markup" type="number" min="0" max="500" value="${esc(g.parts_markup_pct ?? 30)}">`)}
            <p class="subtle">سيُحدَّث سعر بيع كل صنف له تكلفة = التكلفة × (١ + النسبة).</p>
            <button class="btn" id="apply-markup">طبّق على كل الأصناف</button>
          </section>
        </div>
      </div>`,
    bind(el) {
      const costsBox = el.querySelector('#costs'), form = el.querySelector('#params');
      const val = (n) => Number(form.querySelector(`[name=${n}]`).value || 0);
      let suggested = 0;
      const calc = () => {
        const total = [...costsBox.querySelectorAll('[data-c=amount]')].reduce((a, i) => a + Number(i.value || 0), 0);
        const hours = val('techs') * val('work_days') * val('hours_per_day') * (val('utilization_pct') / 100);
        const cost = hours > 0 ? total / hours : 0;
        suggested = round3(cost * (1 + val('labor_margin_pct') / 100));
        el.querySelector('#c-total').textContent = money(total);
        el.querySelector('#r-hours').textContent = num(round3(hours));
        el.querySelector('#r-cost').textContent = money(cost);
        el.querySelector('#r-rate').textContent = money(suggested);
        el.querySelector('#r-formula').textContent = `${num(total)} ر.ع ÷ (${num(val('techs'))} فني × ${num(val('work_days'))} يوماً × ${num(val('hours_per_day'))} ساعات × ${num(val('utilization_pct'))}٪) = ${money(cost)} للساعة، وبهامش ${num(val('labor_margin_pct'))}٪ = ${money(suggested)}`;
        const avail = val('techs') * val('work_days') * val('hours_per_day');
        el.querySelector('#avail30').textContent = num(avail);
        el.querySelector('#util30').textContent = avail ? `${num(Math.round((soldHours30 / avail) * 100))}٪` : '—';
      };
      costsBox.addEventListener('input', calc);
      form.addEventListener('input', calc);
      costsBox.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('.crow').remove(); calc(); } });
      el.querySelector('#add-cost').addEventListener('click', () => { costsBox.insertAdjacentHTML('beforeend', costRow({ category: '', monthly: 0 })); calc(); });
      calc();

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        busy(ev.submitter, async () => {
          await db.update('garages', { id: `eq.${g.id}` }, { work_days: val('work_days'), hours_per_day: val('hours_per_day'), utilization_pct: val('utilization_pct'), labor_margin_pct: val('labor_margin_pct') });
          await refreshGarage(); toast('حُفظت الإعدادات');
        });
      });
      el.querySelector('#apply-rate').addEventListener('click', () => {
        if (!suggested) { toast('أدخل التكاليف وعدد الساعات أولاً', 'error'); return; }
        const reprice = el.querySelector('#reprice').checked;
        openDialog('تطبيق سعر الساعة', `<p>سيصبح سعر ساعة العمل <strong>${money(suggested)}</strong>${reprice ? '، وسيُعاد تسعير كل خدمة = ساعاتها المعيارية × هذا السعر' : ''}. أوامر العمل والفواتير السابقة لا تتغير.</p>`, async () => {
          const n = await db.rpc('apply_labor_rate', { p_rate: suggested, p_reprice_services: reprice });
          await refreshGarage();
          toast(reprice ? `طُبّق السعر وأُعيد تسعير ${num(n)} خدمة` : 'طُبّق السعر');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }, { submitLabel: 'طبّق' });
      });
      el.querySelector('#apply-markup').addEventListener('click', () => {
        const pct = Number(el.querySelector('#markup').value || 0);
        openDialog('تطبيق هامش القطع', `<p>سيتغير سعر بيع كل صنف إلى تكلفته + ${num(pct)}٪. القطع المصروفة سابقاً لا تتغير.</p>`, async () => {
          const n = await db.rpc('apply_parts_markup', { p_pct: pct });
          await refreshGarage(); toast(`حُدّث سعر ${num(n)} صنف`);
        }, { submitLabel: 'طبّق' });
      });
    },
  };
}
