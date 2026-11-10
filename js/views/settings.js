import { db } from '../api.js';
import { esc, money, num, ROLES, dateTime, waLink } from '../format.js';
import { icon, toast, field, options, formData, busy, openDialog } from '../ui.js';
import { ctx, refreshGarage } from '../state.js';
import { uploadImage } from '../media.js';
import { readiness } from '../einvoice.js';
import { ownerCards, bindOwner } from './settings-owner.js';

let itemsForReady = [];
export default async function settings() {
  const g = ctx.garage;
  const [services, invites, lim] = await Promise.all([
    db.get('services', { order: 'name' }),
    db.get('invites', { used_at: 'is.null', order: 'created_at.desc' }),
    db.rpc('my_limits').catch(() => null),
    db.get('items', { select: 'id,hs_code,active', active: 'eq.true' }).catch(() => []),
  ]).then(([a, b, c, d]) => { itemsForReady = d; return [a, b, c]; });
  const ready = readiness(g, itemsForReady, services);
  const usage = (n, max, word) => (max ? `<span class="badge ${n >= max ? 'warning' : 'neutral'}">${num(n)} من ${num(max)} ${word}${lim.plan ? ` · باقة ${esc(lim.plan)}` : ''}</span>` : '');
  const fullUsers = lim && lim.max_users && lim.users >= lim.max_users;
  const fullBranches = lim && lim.max_branches && lim.branches >= lim.max_branches;
  const roleOpts = Object.entries(ROLES).filter(([k]) => k !== 'owner');
  const appUrl = location.origin + location.pathname;

  return {
    title: 'الإعدادات',
    html: `<div class="page-head"><div><h1>إعدادات الكراج</h1><p class="lead">بيانات الكراج، وقواعد العمل التي تقررها أنت.</p></div></div>
      <nav class="jump" aria-label="أقسام الإعدادات">${[['garage', 'البيانات'], ['printing', 'الطباعة'], ['docs', 'المستندات'], ['controls', 'الصلاحيات'], ['service', 'الاستلام'], ['wa', 'الرسائل'], ...(ctx.can('owner') ? [['backup', 'النسخ']] : []), ['fawtara', 'فوترة'], ['svcs', 'الخدمات'], ['branches', 'الفروع'], ['team', 'الفريق']].map(([id, t]) => `<a href="#" data-jump="${id}">${t}</a>`).join('')}</nav>

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
          <div class="span-all row" style="gap:16px;align-items:center">
            ${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="شعار الكراج" style="height:64px;width:64px;object-fit:contain;border:1px solid var(--border);border-radius:10px;background:#fff">` : ''}
            <label class="btn small" style="cursor:pointer">${g.logo_url ? 'غيّر الشعار' : 'ارفع شعار الكراج'}<input type="file" id="logo-file" accept="image/*" class="hidden"></label>
            ${g.logo_url ? '<button type="button" class="btn small ghost" id="logo-rm">احذف الشعار</button>' : ''}
            <span class="subtle">يظهر على الفواتير ورابط العميل</span>
          </div>
          ${field('بيانات التحويل البنكي', `<textarea name="bank_details" placeholder="اسم البنك، اسم الحساب، رقم الحساب أو IBAN">${esc(g.bank_details || '')}</textarea>`, { hint: 'تظهر للعميل في رابط المتابعة عند وجود مبلغ مستحق', cls: 'span-all' })}
        </div>
        <div><button class="btn primary">احفظ البيانات</button></div>
      </form>

      <section class="card stack" id="printing">
        <h2>الطباعة</h2>
        <p class="subtle">اختر ورق الطابعة التي تستخدمها للفواتير وعروض الأسعار وسندات القبض. تستطيع دائماً الحفظ كملف PDF من نافذة الطباعة.</p>
        <div class="paper-pick" role="radiogroup" aria-label="ورق الطباعة">
          ${[['a4', 'ورق A4', 'طابعة مكتبية عادية، فاتورة كاملة بالترويسة والتوقيع'], ['80mm', 'إيصال حراري ٨٠ مم', 'طابعة إيصالات صغيرة، فاتورة مختصرة بعرض الإيصال']].map(([k, t, d]) => `<label class="paper ${(g.print_paper || 'a4') === k ? 'on' : ''}"><input type="radio" name="paper" value="${k}" ${(g.print_paper || 'a4') === k ? 'checked' : ''}><strong>${t}</strong><span class="subtle">${d}</span></label>`).join('')}
        </div>
        <p class="subtle">ومن صفحة أمر العمل تطبع أيضاً «كرت الورشة» للفني: بيانات السيارة والشكوى والأعمال المطلوبة بلا أسعار.</p>
      </section>

      ${ownerCards(g)}

      <section class="card stack" id="fawtara">
        <div class="card-head" style="margin:0"><h2>جاهزية الفوترة الإلكترونية (فوترة)</h2><span class="badge ${ready.every((r) => r.ok) ? 'success' : 'warning'}">${num(ready.filter((r) => r.ok).length)} من ${num(ready.length)}</span></div>
        <p class="subtle">تُلزم هيئة الضرائب الكراجات بالفوترة الإلكترونية على مراحل، وتبدأ للمنشآت الأصغر من ١ أكتوبر ٢٠٢٧. أكمل هذه البيانات من الآن، وعند التعاقد مع مزوّد معتمد يُرسل النظام فواتيرك إليه. وتستطيع من صفحة الفاتورة تنزيل ملفها بصيغة الفوترة (XML).</p>
        <div class="list">${ready.map((r) => `<div class="list-item"><span>${r.ok ? '<span class="badge success">مكتمل</span>' : '<span class="badge warning">ناقص</span>'} ${esc(r.label)}${r.count ? ` <span class="subtle">(${num(r.count[0])} من ${num(r.count[1])})</span>` : ''}</span>${r.ok ? '' : `<span class="subtle">${esc(r.fix)}</span>`}</div>`).join('')}</div>
      </section>

      <section class="card pad-0" id="svcs">
        <div class="card-head" style="padding:16px 20px 0"><h2>الخدمات والأسعار</h2><button class="btn small" id="add-svc">${icon('plus')} خدمة</button></div>
        <p class="subtle" style="padding:0 20px">إن تركت السعر صفراً يُحسب من الساعات × سعر ساعة العمل (${money(g.labor_rate)}).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>الخدمة</th><th class="num">الساعات المعيارية</th><th class="num">السعر</th><th class="num">الضمان</th><th>الحالة</th><th><span class="hidden">تعديل</span></th></tr></thead>
          <tbody>${services.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${num(s.std_hours)}</td>
            <td class="num">${Number(s.price) > 0 ? money(s.price) : `<span class="subtle">${money(Number(s.std_hours) * Number(g.labor_rate))}</span>`}</td>
            <td class="num">${Number(s.warranty_days) ? `${num(s.warranty_days)} يوماً` : '—'}</td>
            <td>${s.active ? '<span class="badge success">مفعّلة</span>' : '<span class="badge neutral">موقوفة</span>'}</td>
            <td><button class="btn small ghost" data-svc="${s.id}">تعديل</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="card pad-0" id="branches">
        <div class="card-head" style="padding:16px 20px 0"><h2>الفروع ${lim ? usage(lim.branches, lim.max_branches, 'فروع') : ''}</h2><button class="btn small" id="add-br" ${fullBranches ? 'disabled title="وصلت إلى حد الفروع في باقتك"' : ''}>${icon('plus')} فرع</button></div>
        <p class="subtle" style="padding:0 20px">لكل فرع أوامر عمله ومواعيده ومخزونه ومصروفاته، والعملاء والأصناف والحسابات مشتركة بين الفروع.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>الفرع</th><th>الهاتف</th><th>العنوان</th><th>الحالة</th><th><span class="hidden">تعديل</span></th></tr></thead>
          <tbody>${ctx.allBranches.map((b) => `<tr><td>${esc(b.name)}${b.is_main ? ' <span class="badge neutral">الرئيسي</span>' : ''}</td>
            <td><bdi class="ltr">${esc(b.phone || '—')}</bdi></td><td>${esc(b.address || '—')}</td>
            <td>${b.active ? '<span class="badge success">مفعّل</span>' : '<span class="badge neutral">موقوف</span>'}</td>
            <td><button class="btn small ghost" data-br="${b.id}">تعديل</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <section class="card pad-0" id="team">
        <div class="card-head" style="padding:16px 20px 0"><h2>الفريق ${lim ? usage(lim.users, lim.max_users, 'مستخدمين') : ''}</h2><button class="btn small teal" id="invite" ${fullUsers ? 'disabled title="وصلت إلى حد المستخدمين في باقتك"' : ''}>${icon('plus')} ادعُ موظفاً</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>الدور</th><th>عمولة العمالة ٪</th>${ctx.multiBranch ? '<th>الفرع</th>' : ''}<th>الحالة</th></tr></thead>
          <tbody>${ctx.staff.map((s) => `<tr><td>${esc(s.full_name)}${s.user_id === ctx.uid ? ' <span class="subtle">(أنت)</span>' : ''}</td>
            <td>${s.role === 'owner' || s.user_id === ctx.uid ? esc(ROLES[s.role]) : `<select data-role="${s.user_id}" aria-label="دور ${esc(s.full_name)}" style="max-width:180px">${options(roleOpts, s.role)}</select>`}</td>
            <td>${s.role === 'owner' || s.user_id === ctx.uid ? '—' : `<input type="number" min="0" max="100" step="0.5" value="${esc(s.commission_pct ?? 0)}" data-comm="${s.user_id}" aria-label="عمولة ${esc(s.full_name)}" style="max-width:90px">`}</td>
            ${ctx.multiBranch ? `<td>${s.role === 'owner' || s.user_id === ctx.uid ? 'كل الفروع' : `<select data-mbr="${s.user_id}" aria-label="فرع ${esc(s.full_name)}" style="max-width:180px"><option value="">كل الفروع</option>${ctx.branches.map((b) => `<option value="${b.id}" ${b.id === s.branch_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`}</td>` : ''}
            <td>${s.role === 'owner' || s.user_id === ctx.uid ? '<span class="badge success">نشط</span>' : `<button class="btn small ${s.active ? 'ghost' : 'teal'}" data-active="${s.user_id}" data-to="${!s.active}">${s.active ? 'أوقف' : 'فعّل'}</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
        ${fullUsers ? '<p class="notice warn" style="margin:12px 20px">وصلت إلى حد المستخدمين في باقتك. لإضافة موظف أوقف موظفاً آخر أو تواصل مع EMD لترقية الباقة.</p>' : ''}
        ${invites.length ? `<div style="padding:12px 20px 20px"><h3>دعوات لم تُستخدم</h3><div class="list">${invites.map((i) => `<div class="list-item">
            <span><bdi class="ltr" style="font-weight:700;letter-spacing:.15em">${esc(i.code)}</bdi> · ${esc(ROLES[i.role])}${i.display_name ? ` · ${esc(i.display_name)}` : ''}<br><span class="subtle">تنتهي ${esc(dateTime(i.expires_at))}</span></span>
            <span class="row" style="gap:6px"><a class="btn small wa" target="_blank" rel="noopener" href="${esc(waLink('', inviteText(i, appUrl)))}">${icon('wa')} أرسل</a><button class="btn small ghost" data-del-inv="${i.id}" aria-label="احذف الدعوة">${icon('trash')}</button></span></div>`).join('')}</div></div>` : ''}
      </section>`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      bindOwner(el, g);
      el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); el.querySelector(`#${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
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

      el.querySelectorAll('[name=paper]').forEach((r) => r.addEventListener('change', async () => {
        try {
          await db.update('garages', { id: `eq.${g.id}` }, { print_paper: r.value });
          await refreshGarage();
          el.querySelectorAll('.paper').forEach((p) => p.classList.toggle('on', p.querySelector('input').checked));
          toast('حُفظ نوع الورق');
        } catch (err) { toast(err.message, 'error'); }
      }));
      el.querySelector('#logo-file').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        toast('جارٍ رفع الشعار…');
        try {
          const url = await uploadImage(f, 'logo');
          await db.update('garages', { id: `eq.${g.id}` }, { logo_url: url });
          await refreshGarage(); toast('حُفظ الشعار'); reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      el.querySelector('#logo-rm')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await db.update('garages', { id: `eq.${g.id}` }, { logo_url: null }); await refreshGarage(); reload();
      }));
      const svcDialog = (s = {}) => openDialog(s.id ? 'تعديل خدمة' : 'خدمة جديدة', `
        ${field('اسم الخدمة', `<input name="name" required value="${esc(s.name || '')}">`, { req: true })}
        <div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('الساعات المعيارية', `<input name="std_hours" type="number" step="0.25" min="0" value="${esc(s.std_hours ?? 1)}">`)}
          ${field('السعر الثابت (ر.ع)', `<input name="price" type="number" step="0.001" min="0" inputmode="decimal" value="${esc(s.price ?? 0)}">`)}
          ${field('الضمان (يوم)', `<input name="warranty_days" type="number" step="1" min="0" inputmode="numeric" value="${esc(s.warranty_days ?? 0)}">`)}
          ${field('رمز نوع الخدمة (فوترة)', `<input name="service_code" dir="ltr" value="${esc(s.service_code || '')}">`, { hint: 'من قائمة أنواع الخدمات لدى هيئة الضرائب' })}
        </div>
        ${s.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''} style="width:auto;min-height:0"> مفعّلة</label>` : ''}`, async (d) => {
        const row = { name: d.name, std_hours: Number(d.std_hours || 0), price: Number(d.price || 0), warranty_days: Number(d.warranty_days || 0), service_code: d.service_code || null };
        if (s.id) await db.update('services', { id: `eq.${s.id}` }, { ...row, active: !!d.active });
        else await db.insert('services', row);
        toast('حُفظت الخدمة'); reload();
      });
      el.querySelector('#add-svc').addEventListener('click', () => svcDialog());
      el.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', () => svcDialog(services.find((s) => s.id === b.dataset.svc))));

      const brDialog = (b = {}) => openDialog(b.id ? 'تعديل فرع' : 'فرع جديد', `
        ${field('اسم الفرع', `<input name="name" required value="${esc(b.name || '')}">`, { req: true })}
        ${field('هاتف الفرع', `<input name="phone" type="tel" dir="ltr" value="${esc(b.phone || '')}">`, { hint: 'يظهر على فواتير هذا الفرع' })}
        ${field('عنوان الفرع', `<input name="address" value="${esc(b.address || '')}">`)}
        ${b.id && !b.is_main ? `<label class="row" style="gap:8px"><input type="checkbox" name="active" value="1" ${b.active ? 'checked' : ''} style="width:auto;min-height:0"> مفعّل</label>` : ''}`, async (d) => {
        const row = { name: d.name, phone: d.phone || null, address: d.address || null };
        if (b.id) await db.update('branches', { id: `eq.${b.id}` }, b.is_main ? row : { ...row, active: !!d.active });
        else await db.insert('branches', row);
        toast('حُفظ الفرع');
        location.reload();
      });
      el.querySelector('#add-br').addEventListener('click', () => brDialog());
      el.querySelectorAll('[data-br]').forEach((x) => x.addEventListener('click', () => brDialog(ctx.allBranches.find((b) => b.id === x.dataset.br))));
      el.querySelectorAll('[data-mbr]').forEach((s) => s.addEventListener('change', () => busy(s, async () => {
        await db.update('memberships', { garage_id: `eq.${g.id}`, user_id: `eq.${s.dataset.mbr}` }, { branch_id: s.value || null });
        toast(s.value ? 'صار الموظف يعمل في هذا الفرع فقط' : 'صار الموظف يعمل في كل الفروع'); ctx.staff = await db.rpc('garage_staff');
      })));

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
      el.querySelectorAll('[data-comm]').forEach((i) => i.addEventListener('change', () => busy(i, async () => {
        await db.update('memberships', { garage_id: `eq.${g.id}`, user_id: `eq.${i.dataset.comm}` }, { commission_pct: Number(i.value || 0) });
        toast('حُفظت العمولة'); ctx.staff = await db.rpc('garage_staff');
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
