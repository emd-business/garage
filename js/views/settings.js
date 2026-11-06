import { db } from '../api.js';
import { esc, money, num, ROLES, dateTime, waLink } from '../format.js';
import { icon, toast, field, options, formData, busy, openDialog } from '../ui.js';
import { ctx, refreshGarage } from '../state.js';

export default async function settings() {
  const g = ctx.garage;
  const [services, invites] = await Promise.all([
    db.get('services', { order: 'name' }),
    db.get('invites', { used_at: 'is.null', order: 'created_at.desc' }),
  ]);
  const roleOpts = Object.entries(ROLES).filter(([k]) => k !== 'owner');
  const appUrl = location.origin + location.pathname;

  return {
    title: 'الإعدادات',
    html: `<div class="page-head"><div><h1>إعدادات الكراج</h1><p class="lead">تظهر هذه البيانات على الفواتير وعروض الأسعار.</p></div></div>

      <form class="card stack" id="garage" novalidate>
        <h2>بيانات الكراج</h2>
        <div class="grid form">
          ${field('اسم الكراج', `<input name="name" required value="${esc(g.name)}">`, { req: true })}
          ${field('الاسم بالإنجليزية', `<input name="name_en" dir="ltr" value="${esc(g.name_en || '')}">`)}
          ${field('الهاتف', `<input name="phone" type="tel" dir="ltr" value="${esc(g.phone || '')}">`)}
          ${field('البريد', `<input name="email" type="email" dir="ltr" value="${esc(g.email || '')}">`)}
          ${field('العنوان', `<input name="address" value="${esc(g.address || '')}">`, { cls: 'span-all' })}
          ${field('السجل التجاري', `<input name="cr_number" dir="ltr" value="${esc(g.cr_number || '')}">`)}
          ${field('الرقم الضريبي', `<input name="vat_number" dir="ltr" value="${esc(g.vat_number || '')}">`, { hint: 'يظهر على الفاتورة الضريبية' })}
          ${field('نسبة الضريبة ٪', `<input name="vat_rate" type="number" step="0.01" min="0" max="100" value="${esc(g.vat_rate)}">`)}
          ${field('سعر ساعة العمل (ر.ع)', `<input name="labor_rate" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(g.labor_rate)}">`, { hint: 'يُستخدم للخدمات التي ليس لها سعر ثابت' })}
          ${field('رابط شعار الكراج', `<input name="logo_url" type="url" dir="ltr" placeholder="https://" value="${esc(g.logo_url || '')}">`, { hint: 'اختياري. رفع الشعار مباشرة قادم قريباً', cls: 'span-all' })}
        </div>
        <div><button class="btn primary">احفظ البيانات</button></div>
      </form>

      <section class="card pad-0">
        <div class="card-head" style="padding:16px 20px 0"><h2>الخدمات والأسعار</h2><button class="btn small" id="add-svc">${icon('plus')} خدمة</button></div>
        <p class="subtle" style="padding:0 20px">إن تركت السعر صفراً يُحسب من الساعات × سعر ساعة العمل (${money(g.labor_rate)}).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>الخدمة</th><th class="num">الساعات المعيارية</th><th class="num">السعر</th><th>الحالة</th><th><span class="hidden">تعديل</span></th></tr></thead>
          <tbody>${services.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${num(s.std_hours)}</td>
            <td class="num">${Number(s.price) > 0 ? money(s.price) : `<span class="subtle">${money(Number(s.std_hours) * Number(g.labor_rate))}</span>`}</td>
            <td>${s.active ? '<span class="badge success">مفعّلة</span>' : '<span class="badge neutral">موقوفة</span>'}</td>
            <td><button class="btn small ghost" data-svc="${s.id}">تعديل</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="card pad-0">
        <div class="card-head" style="padding:16px 20px 0"><h2>الفريق</h2><button class="btn small teal" id="invite">${icon('plus')} ادعُ موظفاً</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>الدور</th><th>الحالة</th></tr></thead>
          <tbody>${ctx.staff.map((s) => `<tr><td>${esc(s.full_name)}${s.user_id === ctx.uid ? ' <span class="subtle">(أنت)</span>' : ''}</td>
            <td>${s.role === 'owner' || s.user_id === ctx.uid ? esc(ROLES[s.role]) : `<select data-role="${s.user_id}" aria-label="دور ${esc(s.full_name)}" style="max-width:180px">${options(roleOpts, s.role)}</select>`}</td>
            <td>${s.role === 'owner' || s.user_id === ctx.uid ? '<span class="badge success">نشط</span>' : `<button class="btn small ${s.active ? 'ghost' : 'teal'}" data-active="${s.user_id}" data-to="${!s.active}">${s.active ? 'أوقف' : 'فعّل'}</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
        ${invites.length ? `<div style="padding:12px 20px 20px"><h3>دعوات لم تُستخدم</h3><div class="list">${invites.map((i) => `<div class="list-item">
            <span><bdi class="ltr" style="font-weight:700;letter-spacing:.15em">${esc(i.code)}</bdi> · ${esc(ROLES[i.role])}${i.display_name ? ` · ${esc(i.display_name)}` : ''}<br><span class="subtle">تنتهي ${esc(dateTime(i.expires_at))}</span></span>
            <span class="row" style="gap:6px"><a class="btn small wa" target="_blank" rel="noopener" href="${esc(waLink('', inviteText(i, appUrl)))}">${icon('wa')} أرسل</a><button class="btn small ghost" data-del-inv="${i.id}" aria-label="احذف الدعوة">${icon('trash')}</button></span></div>`).join('')}</div></div>` : ''}
      </section>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelector('#garage').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target; if (!f.reportValidity()) return;
        const d = formData(f);
        busy(ev.submitter, async () => {
          await db.update('garages', { id: `eq.${g.id}` }, { ...d, vat_rate: Number(d.vat_rate || 0), labor_rate: Number(d.labor_rate || 0) });
          await refreshGarage();
          toast('حُفظت بيانات الكراج');
          document.querySelectorAll('.garage-name').forEach((n) => { n.textContent = ctx.garage.name; });
        });
      });

      const svcDialog = (s = {}) => openDialog(s.id ? 'تعديل خدمة' : 'خدمة جديدة', `
        ${field('اسم الخدمة', `<input name="name" required value="${esc(s.name || '')}">`, { req: true })}
        <div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('الساعات المعيارية', `<input name="std_hours" type="number" step="0.25" min="0" value="${esc(s.std_hours ?? 1)}">`)}
          ${field('السعر الثابت (ر.ع)', `<input name="price" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(s.price ?? 0)}">`)}
        </div>
        ${s.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''} style="width:auto;min-height:0"> مفعّلة</label>` : ''}`, async (d) => {
        const row = { name: d.name, std_hours: Number(d.std_hours || 0), price: Number(d.price || 0) };
        if (s.id) await db.update('services', { id: `eq.${s.id}` }, { ...row, active: !!d.active });
        else await db.insert('services', row);
        toast('حُفظت الخدمة'); reload();
      });
      el.querySelector('#add-svc').addEventListener('click', () => svcDialog());
      el.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', () => svcDialog(services.find((s) => s.id === b.dataset.svc))));

      el.querySelector('#invite').addEventListener('click', () => openDialog('دعوة موظف', `
        <p class="muted">ينشئ الموظف حساباً في التطبيق ثم يُدخل رمز الدعوة، فينضم إلى كراجك بالدور الذي تختاره. الرمز صالح ٧ أيام ولمرة واحدة.</p>
        ${field('اسم الموظف', '<input name="display_name">')}
        ${field('الدور', `<select name="role">${options(roleOpts, 'technician')}</select>`)}`, async (d) => {
        const i = await db.insert('invites', { role: d.role, display_name: d.display_name });
        openDialog('رمز الدعوة', `<p style="font-size:28px;font-weight:700;letter-spacing:.2em;text-align:center"><bdi class="ltr">${esc(i.code)}</bdi></p>
          <p class="muted">أرسله للموظف مع رابط التطبيق.</p>
          <a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink('', inviteText(i, appUrl)))}">${icon('wa')} أرسل عبر واتساب</a>`, async () => true, { submitLabel: 'تم' });
        reload();
      }, { submitLabel: 'أنشئ الدعوة' }));

      el.querySelectorAll('[data-del-inv]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.remove('invites', { id: `eq.${b.dataset.delInv}` }); reload();
      })));
      el.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => busy(s, async () => {
        await db.update('memberships', { garage_id: `eq.${g.id}`, user_id: `eq.${s.dataset.role}` }, { role: s.value });
        toast('تغيّر الدور'); ctx.staff = await db.rpc('garage_staff');
      })));
      el.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await db.update('memberships', { garage_id: `eq.${g.id}`, user_id: `eq.${b.dataset.active}` }, { active: b.dataset.to === 'true' });
        ctx.staff = await db.rpc('garage_staff'); reload();
      })));
    },
  };
}

function inviteText(i, url) {
  return `دعوة للانضمام إلى ${ctx.garage.name} على EMD Garage بدور ${ROLES[i.role]}.\n1) افتح ${url}\n2) أنشئ حساباً جديداً\n3) أدخل رمز الدعوة: ${i.code}`;
}
