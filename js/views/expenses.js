import { LOCALE } from '../i18n.js';
import { db } from '../api.js';
import { esc, money, num, date, METHODS } from '../format.js';
import { icon, toast, field, options, openDialog, busy } from '../ui.js';
import { ctx } from '../state.js';
import { uploadDoc, attachLink } from '../media.js';

export const EXPENSE_CATS = ['إيجار', 'رواتب', 'كهرباء وماء', 'اتصالات وإنترنت', 'وقود', 'صيانة المعدات', 'مستهلكات الورشة', 'تسويق', 'رسوم حكومية', 'تأمين', 'أخرى'];

const monthNow = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };

const expenseFields = (e = {}) => `<div class="grid form">
  ${field('البند', `<input name="category" list="exp-cats" required value="${esc(e.category || '')}">`, { req: true })}
  ${field('الوصف', `<input name="description" value="${esc(e.description || '')}">`)}
  ${field('المبلغ قبل الضريبة (ر.ع)', `<input name="amount" type="number" step="0.001" min="0.001" inputmode="decimal" required value="${esc(e.amount ?? '')}">`, { req: true })}
  ${field('ضريبة المدخلات (ر.ع)', `<input name="vat" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(e.vat ?? 0)}">`, { hint: 'إن كانت الفاتورة ضريبية' })}
  ${field('التاريخ', `<input name="expense_date" type="date" required value="${esc(e.expense_date || new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10))}">`, { req: true })}
  ${field('طريقة الدفع', `<select name="method">${options(Object.entries(METHODS), e.method || 'cash')}</select>`)}
  ${field(e.attachment_url ? 'استبدل الإيصال' : 'صورة الإيصال أو PDF', '<input name="file" type="file" accept="image/*,application/pdf">', { hint: e.attachment_url ? 'يوجد إيصال مرفق. اختر ملفاً لاستبداله.' : 'اختياري، للرجوع إليه وللمراجعة الضريبية.' })}
  <datalist id="exp-cats">${EXPENSE_CATS.map((c) => `<option value="${c}">`).join('')}</datalist></div>`;
const withFile = async (row, form) => {
  const f = form.querySelector('[name=file]')?.files[0];
  if (f) row.attachment_url = await uploadDoc(f, 'expenses');
  return row;
};
const toRow = (d) => ({ category: d.category, description: d.description, amount: Number(d.amount), vat: Number(d.vat || 0), expense_date: d.expense_date, method: d.method });

export default async function expenses([month]) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : monthNow();
  const list = await db.get('expenses', { ...ctx.here, expense_date: `gte.${m}-01`, and: `(expense_date.lte.${lastDay(m)})`, order: 'expense_date.desc,created_at.desc' });
  const total = list.reduce((a, e) => a + Number(e.amount), 0);
  const vat = list.reduce((a, e) => a + Number(e.vat), 0);
  const byCat = {};
  list.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T00:00:00Z`));

  return {
    title: 'المصروفات',
    html: `<div class="page-head"><div><h1>المصروفات</h1><p class="lead">${esc(monthName)}</p></div>
        <button class="btn primary" id="add">${icon('plus')} مصروف</button></div>
      <div class="row"><a class="btn small" href="#/expenses/${shiftMonth(m, -1)}">الشهر السابق</a>${m !== monthNow() ? '<a class="btn small" href="#/expenses">هذا الشهر</a>' : ''}<a class="btn small" href="#/expenses/${shiftMonth(m, 1)}">الشهر التالي</a></div>
      <div class="kpis">
        <div class="kpi"><span class="label">مصروفات الشهر</span><span class="value">${money(total)}</span></div>
        <div class="kpi"><span class="label">ضريبة المدخلات</span><span class="value">${money(vat)}</span></div>
        <div class="kpi"><span class="label">عدد القيود</span><span class="value">${num(list.length)}</span></div>
      </div>
      <div class="cols">
        <section class="card pad-0">${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>التاريخ</th><th>البند</th><th>الوصف</th><th>الدفع</th><th><span class="sr-only">الإيصال</span></th><th class="num">المبلغ</th><th class="num">الضريبة</th><th><span class="hidden">إجراءات</span></th></tr></thead>
          <tbody>${list.map((e) => `<tr><td>${esc(date(e.expense_date))}</td><td>${esc(e.category)}</td><td>${esc(e.description || '')}</td><td>${esc(METHODS[e.method])}</td><td>${attachLink(e.attachment_url)}</td>
            <td class="num">${money(e.amount)}</td><td class="num">${Number(e.vat) ? money(e.vat) : '—'}</td>
            <td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn small ghost" data-edit="${e.id}">تعديل</button><button class="btn small ghost icon-btn" data-del="${e.id}" aria-label="احذف">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><p>لا توجد مصروفات مسجلة في هذا الشهر.</p><p class="subtle">سجّل الإيجار والرواتب والكهرباء وغيرها، فتظهر في التقارير وتُحسب منها تكلفة ساعة العمل.</p></div>'}</section>
        <section class="card"><h2 style="margin-bottom:10px">حسب البند</h2>
          ${cats.length ? `<div class="list">${cats.map(([c, v]) => `<div class="list-item"><span>${esc(c)}</span><strong>${money(v)}</strong></div>`).join('')}</div>` : '<p class="muted">—</p>'}</section>
      </div>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelector('#add').addEventListener('click', () => openDialog('مصروف جديد', expenseFields(), async (d, form) => {
        await db.insert('expenses', await withFile(toRow(d), form)); toast('سُجّل المصروف'); reload();
      }));
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const e = list.find((x) => x.id === b.dataset.edit);
        openDialog('تعديل مصروف', expenseFields(e), async (d, form) => { await db.update('expenses', { id: `eq.${e.id}` }, await withFile(toRow(d), form)); toast('حُفظ'); reload(); });
      }));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => openDialog('حذف المصروف', '<p>سيُحذف هذا المصروف نهائياً.</p>', async () => {
        await db.remove('expenses', { id: `eq.${b.dataset.del}` }); reload();
      }, { submitLabel: 'احذف', danger: true })));
    },
  };
}
