import { db } from '../api.js';
import { esc, money, num, idn, date, round3, METHODS } from '../format.js';
import { icon, toast, busy } from '../ui.js';
import { ctx } from '../state.js';

const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
function preset(key) {
  const t = today(), [y, m] = t.split('-').map(Number);
  const iso = (d) => d.toISOString().slice(0, 10);
  switch (key) {
    case 'today': return [t, t];
    case 'last-month': return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))];
    case 'year': return [`${y}-01-01`, t];
    default: return [`${t.slice(0, 7)}-01`, t];
  }
}
const PRESETS = [['today', 'اليوم'], ['month', 'هذا الشهر'], ['last-month', 'الشهر الماضي'], ['year', 'هذه السنة']];

// Simple horizontal bars drawn with CSS widths, relative to the largest value
const bars = (rows, label, value, fmt = money) => {
  const max = Math.max(...rows.map((r) => Number(r[value]) || 0), 0.0001);
  return `<div class="stack" style="gap:10px">${rows.map((r) => `<div>
      <div class="row" style="justify-content:space-between;gap:8px;font-size:14px"><span>${esc(r[label])}</span><strong>${fmt(r[value])}</strong></div>
      <div style="height:8px;border-radius:4px;background:var(--surface-sunken)"><div style="height:8px;border-radius:4px;background:var(--brand-teal);width:${Math.max(2, (Number(r[value]) / max) * 100)}%"></div></div>
    </div>`).join('')}</div>`;
};

export default async function reports([from, to, bq]) {
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const [f, t] = valid(from) && valid(to) ? [from, to] : preset('month');
  // one branch or the whole company; a user tied to one branch always sees that branch
  const branch = ctx.branchLocked ? ctx.branch?.id : (ctx.allBranches.some((b) => b.id === bq) ? bq : null);
  const [r, actual] = await Promise.all([db.rpc('report_summary', { p_from: f, p_to: t, p_branch: branch }), db.rpc('tech_time', { p_from: f, p_to: t }).catch(() => [])]);
  const actualBy = Object.fromEntries((actual || []).map((x) => [x.name, Number(x.hours)]));
  const gross = round3(Number(r.revenue) - Number(r.cogs));
  const net = round3(gross - Number(r.expenses));
  const vatNet = round3(Number(r.vat_out) - Number(r.vat_in));
  const active = PRESETS.find(([k]) => preset(k)[0] === f && preset(k)[1] === t)?.[0];
  const recTotal = r.receivables.reduce((a, x) => a + Number(x.balance), 0);

  return {
    title: 'التقارير',
    html: `<div class="page-head"><div><h1>التقارير</h1><p class="lead">${ctx.multiBranch ? `${esc(branch ? ctx.branchName(branch) : 'كل الفروع')} · ` : ''}من ${esc(date(f))} إلى ${esc(date(t))}</p></div>
        <button class="btn" id="csv">تصدير الفواتير إلى Excel</button></div>
      <div class="row">
        ${PRESETS.map(([k, l]) => `<button class="btn small ${active === k ? 'teal' : ''}" data-preset="${k}">${l}</button>`).join('')}
        <input type="date" id="from" value="${f}" aria-label="من" style="max-width:170px">
        <input type="date" id="to" value="${t}" aria-label="إلى" style="max-width:170px">
        ${ctx.multiBranch && !ctx.branchLocked ? `<select id="branch" aria-label="الفرع" style="max-width:200px"><option value="">كل الفروع</option>${ctx.allBranches.map((b) => `<option value="${b.id}" ${b.id === branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
        <button class="btn small" id="apply">عرض</button>
      </div>

      <div class="kpis">
        <div class="kpi"><span class="label">الإيرادات قبل الضريبة</span><span class="value">${money(r.revenue)}</span></div>
        <div class="kpi"><span class="label">مجمل الربح</span><span class="value">${money(gross)}</span></div>
        <div class="kpi ${net < 0 ? 'alert' : ''}"><span class="label">صافي الربح</span><span class="value">${money(net)}</span></div>
        <div class="kpi"><span class="label">المحصَّل</span><span class="value">${money(r.collected)}</span></div>
        <div class="kpi"><span class="label">الفواتير</span><span class="value">${num(r.invoices)}</span></div>
        <div class="kpi ${recTotal > 0.0005 ? 'alert' : ''}"><span class="label">على العملاء الآن</span><span class="value">${money(recTotal)}</span></div>
      </div>

      <div class="grid two">
        ${ctx.multiBranch && !branch && (r.by_branch || []).length ? `<section class="card"><h2 style="margin-bottom:12px">المبيعات حسب الفرع</h2>
          ${bars(r.by_branch.map((x) => ({ ...x, label: `${x.name} · ${num(x.invoices)} فاتورة` })), 'label', 'amount')}</section>` : ''}
        <section class="card"><h2 style="margin-bottom:12px">قائمة الدخل</h2>
          <div class="totals">
            <span>إيراد العمالة</span><span class="num">${money(r.labor)}</span>
            <span>إيراد القطع</span><span class="num">${money(r.parts)}</span>
            ${Number(r.discount) ? `<span>الخصومات</span><span class="num">− ${money(r.discount)}</span>` : ''}
            <span><strong>صافي الإيرادات</strong></span><span class="num"><strong>${money(r.revenue)}</strong></span>
            <span>تكلفة القطع المباعة</span><span class="num">− ${money(r.cogs)}</span>
            <span><strong>مجمل الربح</strong></span><span class="num"><strong>${money(gross)}</strong></span>
            <span>المصروفات</span><span class="num">− ${money(r.expenses)}</span>
            <span class="grand">صافي الربح</span><span class="num grand" style="color:${net < 0 ? 'var(--danger-ink)' : 'inherit'}">${money(net)}</span>
          </div>
          <p class="subtle" style="margin-top:10px">الإيرادات من الفواتير الصادرة في الفترة، وتكلفة القطع بمتوسط تكلفتها وقت صرفها.</p>
        </section>
        <section class="card"><h2 style="margin-bottom:12px">ضريبة القيمة المضافة</h2>
          <div class="totals">
            <span>ضريبة المخرجات (المبيعات)</span><span class="num">${money(r.vat_out)}</span>
            <span>ضريبة المدخلات (المشتريات والمصروفات)</span><span class="num">− ${money(r.vat_in)}</span>
            <span class="grand">${vatNet >= 0 ? 'صافي المستحق للهيئة' : 'رصيد مسترد'}</span><span class="num grand">${money(Math.abs(vatNet))}</span>
          </div>
          <h3 style="margin:18px 0 8px">التحصيل حسب الطريقة</h3>
          ${Object.keys(r.by_method).length ? `<div class="list">${Object.entries(r.by_method).map(([k, v]) => `<div class="list-item"><span>${esc(METHODS[k] || k)}</span><strong>${money(v)}</strong></div>`).join('')}</div>` : '<p class="muted">لا يوجد تحصيل في الفترة.</p>'}
        </section>

        <section class="card"><h2 style="margin-bottom:12px">أداء الفنيين</h2>
          <p class="subtle" style="margin-bottom:8px">الكفاءة = الساعات المباعة ÷ الساعات الفعلية المسجّلة بزر «ابدأ العمل».</p>
          ${r.technicians.length ? `<div class="table-wrap"><table><thead><tr><th>الفني</th><th class="num">السيارات</th><th class="num">الساعات المباعة</th><th class="num">الساعات الفعلية</th><th class="num">الكفاءة</th><th class="num">العمالة</th><th class="num">العمولة</th></tr></thead>
          <tbody>${r.technicians.map((x) => `<tr><td>${esc(x.name === '—' ? 'غير محدد' : x.name)}</td><td class="num">${num(x.jobs)}</td><td class="num">${num(x.hours)}</td><td class="num">${actualBy[x.name] ? num(Math.round(actualBy[x.name] * 10) / 10) : '—'}</td>
            <td class="num">${actualBy[x.name] ? `<span class="badge ${x.hours / actualBy[x.name] >= 1 ? 'success' : 'warning'}">${num(Math.round((x.hours / actualBy[x.name]) * 100))}٪</span>` : '—'}</td><td class="num">${money(x.amount)}</td><td class="num">${money(x.commission)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد أعمال مفوترة في الفترة.</p>'}
        </section>
        <section class="card"><h2 style="margin-bottom:12px">الشركات المصنعة الأكثر دخلاً</h2>
          ${r.by_make.length ? bars(r.by_make.map((x) => ({ ...x, label: `${x.make} · ${num(x.jobs)} سيارة` })), 'label', 'amount') : '<p class="muted">—</p>'}
        </section>
        <section class="card"><h2 style="margin-bottom:12px">الخدمات الأعلى دخلاً</h2>
          ${r.top_services.length ? bars(r.top_services.map((x) => ({ ...x, label: `${x.name} · ${num(x.times)} مرة` })), 'label', 'amount') : '<p class="muted">—</p>'}
        </section>
        <section class="card"><h2 style="margin-bottom:12px">القطع الأعلى مبيعاً</h2>
          ${r.top_parts.length ? `<div class="table-wrap"><table><thead><tr><th>القطعة</th><th class="num">الكمية</th><th class="num">المبيعات</th><th class="num">الربح</th></tr></thead>
          <tbody>${r.top_parts.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${num(x.qty)}</td><td class="num">${money(x.amount)}</td><td class="num">${money(x.profit)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">—</p>'}
        </section>
        <section class="card"><h2 style="margin-bottom:12px">المصروفات حسب البند</h2>
          ${r.expense_by_cat.length ? bars(r.expense_by_cat, 'category', 'amount') : '<p class="muted">لا توجد مصروفات في الفترة. <a href="#/expenses">سجّلها</a></p>'}
        </section>
        <section class="card"><h2 style="margin-bottom:12px">الذمم المدينة الآن</h2>
          ${r.receivables.length ? `<div class="list">${r.receivables.map((x) => `<a class="list-item" href="#/job/${x.job_id}"><span>فاتورة ${idn(x.invoice_no)} · ${esc(x.name)}<br><span class="subtle">منذ ${num(x.days)} يوماً</span></span><span class="badge ${x.days > 30 ? 'danger' : 'warning'}">${money(x.balance)}</span></a>`).join('')}</div>` : '<p class="muted">لا توجد مبالغ على العملاء.</p>'}
        </section>
      </div>`,
    bind(el) {
      const br = () => { const v = el.querySelector('#branch')?.value; return v ? `/${v}` : ''; };
      el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { const [a, z] = preset(b.dataset.preset); location.hash = `#/reports/${a}/${z}${br()}`; }));
      el.querySelector('#apply').addEventListener('click', () => {
        const a = el.querySelector('#from').value, z = el.querySelector('#to').value;
        if (a && z) location.hash = `#/reports/${a <= z ? a : z}/${a <= z ? z : a}${br()}`;
      });
      el.querySelector('#branch')?.addEventListener('change', () => el.querySelector('#apply').click());
      el.querySelector('#csv').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const fISO = new Date(`${f}T00:00:00+04:00`).toISOString(), tISO = new Date(`${t}T00:00:00+04:00`).getTime() + 864e5;
        const rows = await db.get('invoice_balances', { select: 'invoice_no,issued_at,labor_total,parts_total,discount,subtotal,vat,total,paid,balance,customer_id,branch_id', ...(branch ? { branch_id: `eq.${branch}` } : {}), issued_at: `gte.${fISO}`, and: `(issued_at.lt.${new Date(tISO).toISOString()})`, order: 'invoice_no' });
        const ids = [...new Set(rows.map((x) => x.customer_id))];
        const custs = ids.length ? await db.get('customers', { select: 'id,name,phone,vat_number', id: `in.(${ids.join(',')})` }) : [];
        const cmap = Object.fromEntries(custs.map((c) => [c.id, c]));
        const head = ['رقم الفاتورة', 'التاريخ', ...(ctx.multiBranch ? ['الفرع'] : []), 'العميل', 'الهاتف', 'الرقم الضريبي للعميل', 'العمالة', 'القطع', 'الخصم', 'قبل الضريبة', 'الضريبة', 'الإجمالي', 'المدفوع', 'المتبقي'];
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [head.map(q).join(',')].concat(rows.map((x) => {
          const c = cmap[x.customer_id] || {};
          return [x.invoice_no, new Date(new Date(x.issued_at).getTime() + 4 * 3600e3).toISOString().slice(0, 10), ...(ctx.multiBranch ? [ctx.branchName(x.branch_id)] : []), c.name, c.phone, c.vat_number,
            x.labor_total, x.parts_total, x.discount, x.subtotal, x.vat, x.total, x.paid, x.balance].map(q).join(',');
        }));
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `فواتير ${f} إلى ${t}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast(`صُدّرت ${num(rows.length)} فاتورة`);
      }));
    },
  };
}
