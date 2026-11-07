// EMD platform admin: subscribed garages, plans, trials and subscription payments.
import { db } from '../api.js';
import { esc, money, num, date, waLink } from '../format.js';
import { icon, toast, field, options, openDialog, busy } from '../ui.js';

const GSTATUS = { trial: ['تجربة', 'info'], active: ['مشترك', 'success'], past_due: ['متأخر السداد', 'warning'], suspended: ['موقوف', 'danger'] };
const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export default async function admin() {
  const [garages, plans, ps] = await Promise.all([
    db.rpc('admin_garages'),
    db.get('plans', { order: 'price.asc.nullsfirst' }),
    db.one('platform_settings', { id: 'eq.1' }),
  ]);
  if (!garages) throw new Error('هذه الصفحة لإدارة EMD فقط');
  const soon = (d) => d && new Date(d) - Date.now() < 7 * 864e5;
  const count = (s) => garages.filter((g) => g.status === s).length;
  const endingSoon = garages.filter((g) => g.status === 'trial' && soon(g.trial_ends_at)).length;

  const endCell = (g) => {
    if (g.status === 'trial') return g.trial_ends_at ? `<span class="${new Date(g.trial_ends_at) < new Date() ? 'badge danger' : soon(g.trial_ends_at) ? 'badge warning' : ''}">تنتهي ${esc(date(g.trial_ends_at))}</span>` : '<span class="subtle">بلا نهاية</span>';
    if (g.paid_until) return `<span class="${new Date(g.paid_until) < new Date() ? 'badge danger' : ''}">حتى ${esc(date(g.paid_until))}</span>`;
    return '—';
  };

  return {
    title: 'إدارة EMD',
    html: `<div class="page-head"><div><h1>إدارة EMD Garage</h1><p class="lead">الكراجات المشتركة واشتراكاتها. هذه الصفحة تظهر لفريق EMD فقط، ولا تعرض بيانات عملاء الكراجات.</p></div></div>
      <div class="kpis">
        <div class="kpi"><span class="label">الكراجات</span><span class="value">${num(garages.length)}</span></div>
        <div class="kpi"><span class="label">مشتركة</span><span class="value">${num(count('active'))}</span></div>
        <div class="kpi"><span class="label">في التجربة</span><span class="value">${num(count('trial'))}</span></div>
        <div class="kpi ${endingSoon ? 'alert' : ''}"><span class="label">تجارب تنتهي خلال أسبوع</span><span class="value">${num(endingSoon)}</span></div>
        <div class="kpi"><span class="label">موقوفة</span><span class="value">${num(count('suspended'))}</span></div>
        <div class="kpi"><span class="label">إيرادات الاشتراكات</span><span class="value">${money(garages.reduce((a, g) => a + Number(g.paid_total), 0))}</span></div>
      </div>

      <section class="card pad-0"><div class="card-head" style="padding:16px 20px 0"><h2>الكراجات</h2></div>
        ${garages.length ? `<div class="table-wrap"><table>
          <thead><tr><th>الكراج</th><th>المالك</th><th>الحالة</th><th>المدة</th><th>الخطة</th><th class="num">المستخدمون</th><th class="num">الفروع</th><th class="num">سيارات ٣٠ يوماً</th><th>آخر نشاط</th><th><span class="hidden">إجراءات</span></th></tr></thead>
          <tbody>${garages.map((g) => `<tr>
            <td><strong>${esc(g.name)}</strong><br><span class="subtle">منذ ${esc(date(g.created_at))}</span></td>
            <td>${esc(g.owner_name || '')}<br><bdi class="subtle ltr">${esc(g.owner_email || '')}</bdi>${g.owner_phone || g.phone ? ` · <a href="${esc(waLink(g.owner_phone || g.phone, `مرحباً ${g.owner_name || ''}، معك فريق EMD Garage بخصوص اشتراك ${g.name}.`))}" target="_blank" rel="noopener">واتساب</a>` : ''}</td>
            <td><span class="badge ${GSTATUS[g.status][1]}">${GSTATUS[g.status][0]}</span></td>
            <td>${endCell(g)}</td>
            <td>${esc(g.plan_name || '—')}</td>
            <td class="num">${num(g.users)}${g.max_users ? `<span class="subtle"> / ${num(g.max_users)}</span>` : ''}</td>
            <td class="num">${num(g.branches ?? 1)}${g.max_branches ? `<span class="subtle"> / ${num(g.max_branches)}</span>` : ''}</td>
            <td class="num">${num(g.jobs_30d)}</td>
            <td>${g.last_job ? esc(date(g.last_job)) : '<span class="subtle">لا نشاط</span>'}</td>
            <td><div class="row" style="gap:6px;flex-wrap:nowrap">
              <button class="btn small teal" data-sub="${g.id}">اشتراك</button>
              <button class="btn small" data-limits="${g.id}">الحدود</button>
              ${g.status === 'trial' ? `<button class="btn small" data-extend="${g.id}">مدّد التجربة</button>` : ''}
              ${g.status === 'suspended' ? `<button class="btn small" data-status="${g.id}" data-to="active">فعّل</button>` : `<button class="btn small ghost" data-status="${g.id}" data-to="suspended">أوقف</button>`}
            </div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>لا توجد كراجات بعد.</p></div>'}
      </section>

      <div class="grid two">
        <section class="card"><div class="card-head"><h2>خطط الاشتراك</h2><button class="btn small" id="add-plan">${icon('plus')} خطة</button></div>
          ${plans.length ? `<div class="list">${plans.map((p) => `<div class="list-item"><span><strong>${esc(p.name)}</strong>${p.active ? '' : ' <span class="badge neutral">موقوفة</span>'}<br>
            <span class="subtle">${p.price != null ? `${money(p.price)} ${p.period === 'yearly' ? 'سنوياً' : 'شهرياً'}` : 'السعر لم يُحدَّد'}${p.max_users ? ` · حتى ${num(p.max_users)} مستخدمين` : ''}${p.max_branches ? ` · حتى ${num(p.max_branches)} فروع` : ''}</span></span>
            <button class="btn small ghost" data-plan="${p.id}">تعديل</button></div>`).join('')}</div>`
    : '<p class="muted">لم تُضف خطط بعد. أضفها حين تقرر الأسعار.</p>'}
        </section>
        <form class="card stack" id="psettings" novalidate><h2>إعدادات المنصة</h2>
          ${field('مدة التجربة المجانية للكراجات الجديدة (يوم)', `<input name="trial_days" type="number" min="0" step="1" value="${esc(ps?.trial_days ?? 30)}">`, { hint: '٠ يعني تجربة بلا تاريخ انتهاء' })}
          <div><button class="btn">احفظ</button></div>
        </form>
      </div>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      const g = (id) => garages.find((x) => x.id === id);
      el.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
        const x = g(b.dataset.status), to = b.dataset.to;
        openDialog(to === 'suspended' ? `إيقاف ${x.name}` : `تفعيل ${x.name}`,
          `<p>${to === 'suspended' ? 'لن يستطيع موظفو هذا الكراج الدخول إلى بياناته حتى تعيد تفعيله. البيانات تبقى محفوظة.' : 'سيعود موظفو الكراج إلى العمل فوراً.'}</p>`, async () => {
            await db.rpc('admin_set_garage', { p_garage: x.id, p_status: to }); toast('تغيّرت حالة الكراج'); reload();
          }, { submitLabel: to === 'suspended' ? 'أوقف' : 'فعّل', danger: to === 'suspended' });
      }));
      el.querySelectorAll('[data-extend]').forEach((b) => b.addEventListener('click', () => {
        const x = g(b.dataset.extend);
        const base = x.trial_ends_at && new Date(x.trial_ends_at) > new Date() ? x.trial_ends_at.slice(0, 10) : today();
        openDialog(`تمديد تجربة ${x.name}`, field('تنتهي التجربة في', `<input name="until" type="date" required value="${addDays(base, 14)}">`, { req: true }), async (d) => {
          await db.rpc('admin_set_garage', { p_garage: x.id, p_status: 'trial', p_trial_ends: new Date(`${d.until}T23:59:00+04:00`).toISOString() });
          toast('مُدّدت التجربة'); reload();
        }, { submitLabel: 'مدّد' });
      }));
      el.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
        const x = g(b.dataset.sub);
        const from = x.paid_until && new Date(x.paid_until) > new Date() ? addDays(x.paid_until, 1) : today();
        const d = openDialog(`تسجيل اشتراك: ${x.name}`, `
          ${field('الخطة', `<select name="plan">${options(plans.map((p) => [p.id, p.name]), x.plan_id || '', { empty: 'بدون خطة' })}</select>`)}
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field('من', `<input name="from" type="date" required value="${from}">`, { req: true })}
            ${field('إلى', `<input name="to" type="date" required value="${addDays(from, 30)}">`, { req: true })}
            ${field('المبلغ المدفوع (ر.ع)', '<input name="amount" type="number" step="0.001" min="0" inputmode="decimal" required>', { req: true })}
            ${field('مرجع الدفع', '<input name="reference" placeholder="رقم التحويل مثلاً">')}
          </div>`, async (v) => {
          await db.rpc('admin_add_subscription', { p_garage: x.id, p_plan: v.plan || null, p_amount: Number(v.amount), p_from: v.from, p_to: v.to, p_reference: v.reference });
          toast('سُجّل الاشتراك وفُعّل الكراج'); reload();
        }, { submitLabel: 'سجّل' });
        d.querySelector('[name=plan]').addEventListener('change', (e) => {
          const p = plans.find((y) => y.id === e.target.value); if (!p) return;
          if (p.price != null) d.querySelector('[name=amount]').value = Number(p.price).toFixed(3);
          d.querySelector('[name=to]').value = addDays(d.querySelector('[name=from]').value, p.period === 'yearly' ? 365 : 30);
        });
      }));
      el.querySelectorAll('[data-limits]').forEach((b) => b.addEventListener('click', () => {
        const x = g(b.dataset.limits);
        openDialog(`حدود ${x.name}`, `<p class="muted">حدود خاصة بهذا الكراج تتقدّم على حدود خطته${x.plan_name ? ` (${esc(x.plan_name)})` : ''}. اتركها فارغة ليتبع حدود الخطة.</p>
          <div class="grid form" style="grid-template-columns:1fr 1fr">
            ${field('أقصى عدد مستخدمين', `<input name="max_users" type="number" min="1" step="1" value="${esc(x.own_max_users ?? '')}">`, { hint: `يستخدم الآن ${num(x.users)}` })}
            ${field('أقصى عدد فروع', `<input name="max_branches" type="number" min="1" step="1" value="${esc(x.own_max_branches ?? '')}">`, { hint: `لديه الآن ${num(x.branches ?? 1)}` })}
          </div>`, async (d) => {
          await db.rpc('admin_set_limits', { p_garage: x.id, p_max_users: d.max_users ? Number(d.max_users) : null, p_max_branches: d.max_branches ? Number(d.max_branches) : null });
          toast('حُفظت الحدود'); reload();
        });
      }));
      const planDialog = (p = {}) => openDialog(p.id ? 'تعديل الخطة' : 'خطة جديدة', `
        ${field('اسم الخطة', `<input name="name" required value="${esc(p.name || '')}">`, { req: true })}
        <div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('السعر (ر.ع)', `<input name="price" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(p.price ?? '')}">`, { hint: 'اتركه فارغاً إن لم تقرره بعد' })}
          ${field('الدورة', `<select name="period">${options([['monthly', 'شهري'], ['yearly', 'سنوي']], p.period || 'monthly')}</select>`)}
          ${field('أقصى عدد مستخدمين', `<input name="max_users" type="number" min="1" step="1" value="${esc(p.max_users ?? '')}">`, { hint: 'فارغ يعني بلا حد' })}
          ${field('أقصى عدد فروع', `<input name="max_branches" type="number" min="1" step="1" value="${esc(p.max_branches ?? '')}">`, { hint: 'فارغ يعني بلا حد' })}
        </div>
        ${p.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''} style="width:auto;min-height:0"> متاحة</label>` : ''}`, async (d) => {
        const row = { name: d.name, price: d.price === null ? null : Number(d.price), period: d.period, max_users: d.max_users ? Number(d.max_users) : null, max_branches: d.max_branches ? Number(d.max_branches) : null };
        if (p.id) await db.update('plans', { id: `eq.${p.id}` }, { ...row, active: !!d.active }); else await db.insert('plans', row);
        toast('حُفظت الخطة'); reload();
      });
      el.querySelector('#add-plan').addEventListener('click', () => planDialog());
      el.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => planDialog(plans.find((p) => p.id === b.dataset.plan))));
      el.querySelector('#psettings').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const v = Number(new FormData(ev.target).get('trial_days') || 0);
        busy(ev.submitter, async () => { await db.update('platform_settings', { id: 'eq.1' }, { trial_days: v }); toast('حُفظت الإعدادات'); });
      });
    },
  };
}
