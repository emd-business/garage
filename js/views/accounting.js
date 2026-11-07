import { db } from '../api.js';
import { esc, money, num, idn, date, round3 } from '../format.js';
import { icon, toast, field, options, openDialog, busy } from '../ui.js';
import { ctx } from '../state.js';

const TYPES = { asset: 'الأصول', liability: 'الخصوم', equity: 'حقوق الملكية', revenue: 'الإيرادات', expense: 'المصروفات' };
const SOURCES = { invoice: 'فاتورة', payment: 'سند قبض', purchase: 'شراء', supplier_payment: 'سداد مورد', expense: 'مصروف', stock: 'مخزون', manual: 'يدوي', credit_note: 'إشعار دائن' };
const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const TABS = [['balance', 'الميزانية'], ['income', 'قائمة الدخل'], ['trial', 'ميزان المراجعة'], ['journal', 'القيود'], ['accounts', 'دليل الحسابات']];
// natural balance: debit-normal for assets/expenses, credit-normal otherwise
const natural = (type, v) => (['asset', 'expense'].includes(type) ? Number(v) : -Number(v));
const signed = (v) => `${Number(v) < -0.0005 ? '(' : ''}${money(Math.abs(Number(v)))}${Number(v) < -0.0005 ? ')' : ''}`;

const TEMPLATES = [
  ['capital', 'إيداع رأس مال', [['cash', 'd'], ['capital', 'c']]],
  ['vat', 'سداد ضريبة القيمة المضافة', [['vat_out', 'd'], ['vat_in', 'c'], ['bank', 'c']]],
  ['depr', 'قيد إهلاك', [['depreciation', 'd'], ['equipment', 'c']]],
  ['drawings', 'مسحوبات المالك', [['drawings', 'd'], ['cash', 'c']]],
  ['bank_dep', 'إيداع نقدية في البنك', [['bank', 'd'], ['cash', 'c']]],
  ['card_settle', 'تسوية مدفوعات البطاقات للبنك', [['bank', 'd'], ['card', 'c']]],
];

export default async function accounting([tab = 'balance', from, to]) {
  if (!TABS.some(([k]) => k === tab)) tab = 'balance';
  const t = valid(to) ? to : today();
  const f = valid(from) ? from : yearStart();
  const accounts = await db.get('accounts', { order: 'code' });
  const byKey = Object.fromEntries(accounts.filter((a) => a.system_key).map((a) => [a.system_key, a]));
  let body = '';

  const rangeBar = (showFrom = true) => `<div class="row">
      ${showFrom ? `<label class="row" style="gap:6px">من <input type="date" id="from" value="${f}" style="max-width:170px"></label>` : ''}
      <label class="row" style="gap:6px">${showFrom ? 'إلى' : 'كما في'} <input type="date" id="to" value="${t}" style="max-width:170px"></label>
      <button class="btn small" id="apply">عرض</button></div>`;
  const acctLink = (a, label) => `<a href="#/ledger/${a.account_id || a.id}/${showFromFor(tab) ? f : yearStart()}/${t}">${esc(label || a.name)}</a>`;
  const showFromFor = (k) => k !== 'balance';

  if (tab === 'balance' || tab === 'income' || tab === 'trial') {
    const tb = await db.rpc('trial_balance', { p_from: tab === 'balance' ? '2000-01-01' : f, p_to: t });
    if (tab === 'balance') {
      const group = (type) => tb.filter((r) => r.type === type && Math.abs(Number(r.closing)) > 0.0005);
      const total = (type) => round3(tb.filter((r) => r.type === type).reduce((a, r) => a + natural(type, r.closing), 0));
      const profit = round3(total('revenue') - total('expense'));
      const assets = total('asset'), liab = total('liability'), eq = round3(total('equity') + profit);
      const section = (type, extra = '') => `<h3 style="margin:14px 0 6px">${TYPES[type]}</h3><div class="totals">
          ${group(type).map((r) => `<span>${acctLink(r)}</span><span class="num">${signed(natural(type, r.closing))}</span>`).join('') || '<span class="muted">—</span><span></span>'}
          ${extra}</div>`;
      body = `${rangeBar(false)}
        <div class="grid two">
          <section class="card">${section('asset')}<div class="totals" style="margin-top:8px"><span class="grand">مجموع الأصول</span><span class="num grand">${money(assets)}</span></div></section>
          <section class="card">${section('liability')}<div class="totals" style="margin-top:8px"><span><strong>مجموع الخصوم</strong></span><span class="num"><strong>${money(liab)}</strong></span></div>
            ${section('equity', `<span>صافي ربح الفترة الحالية</span><span class="num">${signed(profit)}</span>`)}
            <div class="totals" style="margin-top:8px"><span><strong>مجموع حقوق الملكية</strong></span><span class="num"><strong>${money(eq)}</strong></span>
            <span class="grand">الخصوم وحقوق الملكية</span><span class="num grand">${money(round3(liab + eq))}</span></div></section>
        </div>
        <div class="notice ${Math.abs(assets - liab - eq) < 0.001 ? 'ok' : 'error'}">${Math.abs(assets - liab - eq) < 0.001 ? 'الميزانية متوازنة: الأصول = الخصوم + حقوق الملكية.' : 'الميزانية غير متوازنة، راجع القيود اليدوية.'}</div>
        ${Number(byKey.card && tb.find((r) => r.account_id === byKey.card.id)?.closing) > 0.0005 ? '<p class="subtle">مدفوعات البطاقات تبقى في حسابها حتى تسجّل قيد «تسوية مدفوعات البطاقات للبنك» عند وصولها.</p>' : ''}`;
    } else if (tab === 'income') {
      const mv = (r) => Number(r.debit) - Number(r.credit);
      const rev = tb.filter((r) => r.type === 'revenue' && Math.abs(mv(r)) > 0.0005);
      const exp = tb.filter((r) => r.type === 'expense' && Math.abs(mv(r)) > 0.0005);
      const totRev = round3(rev.reduce((a, r) => a - mv(r), 0)), totExp = round3(exp.reduce((a, r) => a + mv(r), 0));
      const cogs = exp.filter((r) => ['cogs', 'inv_var'].includes(r.system_key));
      const opex = exp.filter((r) => !['cogs', 'inv_var'].includes(r.system_key));
      const cogsT = round3(cogs.reduce((a, r) => a + mv(r), 0));
      body = `${rangeBar()}
        <section class="card" style="max-width:720px"><div class="totals">
          ${rev.map((r) => `<span>${acctLink(r)}</span><span class="num">${signed(-mv(r))}</span>`).join('')}
          <span><strong>صافي الإيرادات</strong></span><span class="num"><strong>${money(totRev)}</strong></span>
          ${cogs.map((r) => `<span>${acctLink(r)}</span><span class="num">(${money(mv(r))})</span>`).join('')}
          <span><strong>مجمل الربح</strong></span><span class="num"><strong>${signed(totRev - cogsT)}</strong></span>
          ${opex.map((r) => `<span>${acctLink(r)}</span><span class="num">(${money(mv(r))})</span>`).join('')}
          <span class="grand">صافي الربح</span><span class="num grand" style="color:${totRev - totExp < 0 ? 'var(--danger-ink)' : 'inherit'}">${signed(totRev - totExp)}</span>
        </div></section>`;
    } else {
      const rows = tb.filter((r) => Math.abs(Number(r.opening)) > 0.0005 || Number(r.debit) > 0 || Number(r.credit) > 0);
      const sum = (k) => rows.reduce((a, r) => a + Number(r[k]), 0);
      const dr = (v) => (Number(v) > 0.0005 ? money(v) : '—'), cr = (v) => (Number(v) < -0.0005 ? money(-v) : '—');
      body = `${rangeBar()}
        <section class="card pad-0"><div class="table-wrap"><table>
          <thead><tr><th>الرمز</th><th>الحساب</th><th class="num">افتتاحي مدين</th><th class="num">افتتاحي دائن</th><th class="num">حركة مدين</th><th class="num">حركة دائن</th><th class="num">ختامي مدين</th><th class="num">ختامي دائن</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${acctLink(r)}</td><td class="num">${dr(r.opening)}</td><td class="num">${cr(r.opening)}</td><td class="num">${Number(r.debit) ? money(r.debit) : '—'}</td><td class="num">${Number(r.credit) ? money(r.credit) : '—'}</td><td class="num">${dr(r.closing)}</td><td class="num">${cr(r.closing)}</td></tr>`).join('')}
          <tr><td></td><td><strong>المجموع</strong></td>
            <td class="num"><strong>${money(rows.reduce((a, r) => a + Math.max(0, Number(r.opening)), 0))}</strong></td><td class="num"><strong>${money(rows.reduce((a, r) => a + Math.max(0, -Number(r.opening)), 0))}</strong></td>
            <td class="num"><strong>${money(sum('debit'))}</strong></td><td class="num"><strong>${money(sum('credit'))}</strong></td>
            <td class="num"><strong>${money(rows.reduce((a, r) => a + Math.max(0, Number(r.closing)), 0))}</strong></td><td class="num"><strong>${money(rows.reduce((a, r) => a + Math.max(0, -Number(r.closing)), 0))}</strong></td></tr>
          </tbody></table></div></section>`;
    }
  } else if (tab === 'journal') {
    const entries = await db.get('journal_entries', { select: '*,journal_lines(debit,credit,memo,accounts(code,name))', entry_date: `gte.${f}`, and: `(entry_date.lte.${t})`, order: 'entry_date.desc,entry_no.desc', limit: 200 });
    body = `${rangeBar()}
      <div class="row"><button class="btn primary" id="manual">${icon('plus')} قيد يدوي</button></div>
      <div class="stack" style="gap:12px">${entries.length ? entries.map((e) => `<section class="card" style="padding:14px 16px">
        <div class="row" style="justify-content:space-between"><span><strong>قيد ${idn(e.entry_no)}</strong> · ${esc(date(e.entry_date))} · ${esc(e.description)}</span>
          <span class="row" style="gap:6px"><span class="badge ${e.source_type === 'manual' ? 'warning' : 'neutral'}">${esc(SOURCES[e.source_type])}</span>
          ${e.source_type === 'manual' && ctx.can('owner', 'accountant') ? `<button class="btn small ghost icon-btn" data-del-entry="${e.id}" aria-label="احذف القيد">${icon('trash')}</button>` : ''}</span></div>
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>الحساب</th><th>بيان</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead>
        <tbody>${e.journal_lines.sort((a, b) => Number(b.debit) - Number(a.debit)).map((l) => `<tr><td>${esc(l.accounts?.code)} ${esc(l.accounts?.name)}</td><td class="subtle">${esc(l.memo || '')}</td><td class="num">${Number(l.debit) ? money(l.debit) : ''}</td><td class="num">${Number(l.credit) ? money(l.credit) : ''}</td></tr>`).join('')}</tbody></table></div>
      </section>`).join('') : '<div class="card empty"><p>لا توجد قيود في هذه الفترة.</p><p class="subtle">تُنشأ القيود تلقائياً من الفواتير والدفعات والمشتريات والمصروفات.</p></div>'}</div>`;
  } else if (tab === 'accounts') {
    body = `<div class="row"><button class="btn primary" id="add-acc">${icon('plus')} حساب جديد</button></div>
      ${Object.entries(TYPES).map(([type, label]) => `<section class="card pad-0"><div class="card-head" style="padding:14px 20px 0"><h2>${label}</h2></div>
        <div class="table-wrap"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>النوع</th><th><span class="hidden">إجراءات</span></th></tr></thead>
        <tbody>${accounts.filter((a) => a.type === type).map((a) => `<tr><td>${esc(a.code)}</td><td>${acctLink(a)}${a.active ? '' : ' <span class="badge neutral">موقوف</span>'}</td>
          <td>${a.system_key ? '<span class="badge info">حساب نظام</span>' : '<span class="subtle">مضاف</span>'}</td>
          <td><button class="btn small ghost" data-edit-acc="${a.id}">تعديل</button></td></tr>`).join('')}</tbody></table></div></section>`).join('')}`;
  }

  return {
    title: 'المحاسبة',
    html: `<div class="page-head"><div><h1>المحاسبة</h1><p class="lead">كل فاتورة ودفعة وشراء ومصروف يُقيَّد تلقائياً بالقيد المزدوج.</p></div></div>
      <div class="tabs" role="tablist" style="max-width:720px;overflow-x:auto">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join('')}</div>
      ${body}`,
    bind(el) {
      const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
      el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/accounting/${b.dataset.tab}`; }));
      el.querySelector('#apply')?.addEventListener('click', () => {
        const a = el.querySelector('#from')?.value || f, z = el.querySelector('#to').value || t;
        location.hash = `#/accounting/${tab}/${a <= z ? a : z}/${a <= z ? z : a}`;
      });
      el.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', () => openDialog('حذف القيد اليدوي', '<p>سيُحذف القيد نهائياً من الدفاتر.</p>', async () => {
        await db.rpc('delete_manual_entry', { p_entry: b.dataset.delEntry }); toast('حُذف القيد'); reload();
      }, { submitLabel: 'احذف', danger: true })));

      const active = accounts.filter((a) => a.active);
      const accOpts = (sel) => options(active.map((a) => [a.id, `${a.code} ${a.name}`]), sel, { empty: 'اختر الحساب' });
      el.querySelector('#manual')?.addEventListener('click', () => {
        const lineHtml = (acc = '', side = 'd') => `<div class="jline grid" style="grid-template-columns:minmax(0,2fr) 110px 110px 44px;gap:8px;align-items:end">
            <label class="field"><span>الحساب</span><select data-j="acc">${accOpts(acc)}</select></label>
            <label class="field"><span>مدين</span><input data-j="dr" type="number" min="0" step="0.001" inputmode="decimal" ${side === 'd' ? '' : 'value=""'}></label>
            <label class="field"><span>دائن</span><input data-j="cr" type="number" min="0" step="0.001" inputmode="decimal"></label>
            <button type="button" class="btn ghost icon-btn" data-rm aria-label="احذف السطر">${icon('trash')}</button></div>`;
        const d = openDialog('قيد يدوي', `
          ${field('قالب جاهز', `<select id="tpl">${options(TEMPLATES.map(([k, l]) => [k, l]), '', { empty: 'بدون قالب' })}</select>`)}
          <div class="grid form" style="grid-template-columns:1fr 2fr">
            ${field('التاريخ', `<input name="date" type="date" required value="${today()}">`, { req: true })}
            ${field('البيان', '<input name="desc" required>', { req: true })}
          </div>
          <div id="jlines" class="stack" style="gap:8px">${lineHtml()}${lineHtml()}</div>
          <button type="button" class="btn small" id="add-jl" style="align-self:flex-start">${icon('plus')} سطر</button>
          <div class="totals"><span>مجموع المدين</span><span class="num" id="j-dr">${money(0)}</span><span>مجموع الدائن</span><span class="num" id="j-cr">${money(0)}</span><span>الفرق</span><span class="num" id="j-diff">${money(0)}</span></div>`, async (data, form) => {
          const lines = [...form.querySelectorAll('.jline')].map((r) => ({ account_id: r.querySelector('[data-j=acc]').value, debit: Number(r.querySelector('[data-j=dr]').value || 0), credit: Number(r.querySelector('[data-j=cr]').value || 0) }))
            .filter((l) => l.account_id && (l.debit || l.credit));
          await db.rpc('post_manual_entry', { p_date: data.date, p_desc: data.desc, p_lines: lines });
          toast('سُجّل القيد'); reload();
        }, { submitLabel: 'سجّل القيد' });
        d.style.maxWidth = '720px';
        const box = d.querySelector('#jlines');
        const recalc = () => {
          let dr = 0, cr = 0;
          box.querySelectorAll('.jline').forEach((r) => { dr += Number(r.querySelector('[data-j=dr]').value || 0); cr += Number(r.querySelector('[data-j=cr]').value || 0); });
          d.querySelector('#j-dr').textContent = money(dr); d.querySelector('#j-cr').textContent = money(cr);
          const diff = d.querySelector('#j-diff'); diff.textContent = money(Math.abs(dr - cr)); diff.style.color = Math.abs(dr - cr) > 0.0005 ? 'var(--danger-ink)' : 'var(--success-ink)';
        };
        box.addEventListener('input', recalc);
        box.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && box.children.length > 2) { e.target.closest('.jline').remove(); recalc(); } });
        d.querySelector('#add-jl').addEventListener('click', () => box.insertAdjacentHTML('beforeend', lineHtml()));
        d.querySelector('#tpl').addEventListener('change', (e) => {
          const tpl = TEMPLATES.find(([k]) => k === e.target.value);
          if (!tpl) return;
          d.querySelector('[name=desc]').value = tpl[1];
          box.innerHTML = tpl[2].map(([key]) => lineHtml(byKey[key]?.id || '')).join('');
          recalc();
        });
      });

      const accDialog = (a = {}) => openDialog(a.id ? 'تعديل الحساب' : 'حساب جديد', `
        ${a.id ? `<p class="muted">الرمز ${esc(a.code)} · ${TYPES[a.type]}</p>` : `<div class="grid form" style="grid-template-columns:1fr 1fr">
          ${field('الرمز', '<input name="code" required dir="ltr" inputmode="numeric" placeholder="مثال: 6120">', { req: true })}
          ${field('النوع', `<select name="type">${options(Object.entries(TYPES), 'expense')}</select>`)}</div>`}
        ${field('اسم الحساب', `<input name="name" required value="${esc(a.name || '')}">`, { req: true })}
        ${a.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="active" value="1" ${a.active ? 'checked' : ''} style="width:auto;min-height:0"> نشط</label>` : ''}`, async (d) => {
        if (a.id) await db.update('accounts', { id: `eq.${a.id}` }, { name: d.name, active: !!d.active });
        else await db.insert('accounts', { code: d.code, name: d.name, type: d.type });
        toast('حُفظ الحساب'); reload();
      });
      el.querySelector('#add-acc')?.addEventListener('click', () => accDialog());
      el.querySelectorAll('[data-edit-acc]').forEach((b) => b.addEventListener('click', () => accDialog(accounts.find((a) => a.id === b.dataset.editAcc))));
    },
  };
}

export async function ledger([id, from, to]) {
  const t = valid(to) ? to : today(), f = valid(from) ? from : yearStart();
  const r = await db.rpc('account_ledger', { p_account: id, p_from: f, p_to: t });
  if (!r || !r.account) throw new Error('الحساب غير موجود');
  const a = r.account;
  let bal = Number(r.opening);
  const rows = r.lines.map((l) => { bal += Number(l.debit) - Number(l.credit); return { ...l, bal }; });
  return {
    title: a.name,
    html: `<div class="page-head"><div class="stack" style="gap:4px"><a href="#/accounting/accounts" class="subtle">دليل الحسابات</a><h1>${esc(a.code)} ${esc(a.name)}</h1><p class="lead">دفتر الأستاذ من ${esc(date(f))} إلى ${esc(date(t))}</p></div></div>
      <div class="row"><label class="row" style="gap:6px">من <input type="date" id="from" value="${f}" style="max-width:170px"></label><label class="row" style="gap:6px">إلى <input type="date" id="to" value="${t}" style="max-width:170px"></label><button class="btn small" id="apply">عرض</button></div>
      <section class="card pad-0"><div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead>
        <tbody><tr><td></td><td></td><td><strong>رصيد أول المدة</strong></td><td></td><td></td><td class="num"><strong>${signed(r.opening)}</strong></td></tr>
        ${rows.map((l) => `<tr><td>${esc(date(l.date))}</td><td>${idn(l.entry_no)}</td><td>${esc(l.description)}${l.memo ? ` <span class="subtle">· ${esc(l.memo)}</span>` : ''}</td>
          <td class="num">${Number(l.debit) ? money(l.debit) : ''}</td><td class="num">${Number(l.credit) ? money(l.credit) : ''}</td><td class="num">${signed(l.bal)}</td></tr>`).join('')}
        <tr><td></td><td></td><td><strong>رصيد آخر المدة</strong></td><td class="num"><strong>${money(rows.reduce((s, l) => s + Number(l.debit), 0))}</strong></td><td class="num"><strong>${money(rows.reduce((s, l) => s + Number(l.credit), 0))}</strong></td><td class="num"><strong>${signed(bal)}</strong></td></tr>
        </tbody></table></div></section>
      <p class="subtle">الرصيد الموجب مدين، وما بين قوسين دائن.</p>`,
    bind(el) {
      el.querySelector('#apply').addEventListener('click', () => {
        const x = el.querySelector('#from').value, z = el.querySelector('#to').value;
        location.hash = `#/ledger/${id}/${x <= z ? x : z}/${x <= z ? z : x}`;
      });
    },
  };
}

// Printable statement of account for a customer or a supplier
export async function statement([kind, id]) {
  const isCust = kind === 'customer';
  const party = await db.one(isCust ? 'customers' : 'suppliers', { id: `eq.${id}` });
  if (!party) throw new Error('غير موجود');
  const rows = await db.rpc(isCust ? 'customer_statement' : 'supplier_statement', isCust ? { p_customer: id } : { p_supplier: id });
  let bal = 0;
  const lines = rows.map((r) => { bal += isCust ? Number(r.debit) - Number(r.credit) : Number(r.credit) - Number(r.debit); return { ...r, bal }; });
  const g = ctx.garage;
  return {
    html: `<div class="print-bar"><button class="btn primary" id="do-print">${icon('print')} اطبع أو احفظ PDF</button>
        <a class="btn" href="${isCust ? `#/customer/${id}` : '#/purchases/suppliers'}">رجوع</a></div>
      <article class="doc">
        <header class="doc-head"><div><div class="g-name">${esc(g.name)}</div>${g.name_en ? `<div class="g-meta" dir="ltr" style="text-align:right">${esc(g.name_en)}</div>` : ''}</div>
          <div class="g-meta" style="text-align:left">${g.phone ? `<div>هاتف: <bdi class="ltr">${esc(g.phone)}</bdi></div>` : ''}${g.vat_number ? `<div>الرقم الضريبي: <bdi class="ltr">${esc(g.vat_number)}</bdi></div>` : ''}</div></header>
        <div class="doc-title">كشف حساب ${isCust ? 'عميل' : 'مورد'}<small>Statement of Account</small></div>
        <div class="doc-grid"><div><strong>${isCust ? 'العميل' : 'المورد'}:</strong> ${esc(party.name)}</div><div><strong>الهاتف:</strong> <bdi class="ltr">${esc(party.phone || '')}</bdi></div>
          <div><strong>تاريخ الكشف:</strong> ${esc(date(new Date()))}</div><div><strong>الرصيد ${isCust ? 'المستحق عليه' : 'المستحق له'}:</strong> ${money(bal)}</div></div>
        <table><thead><tr><th>التاريخ</th><th>البيان</th><th class="num">${isCust ? 'مدين (عليه)' : 'مدين (سداد)'}</th><th class="num">${isCust ? 'دائن (دفعات)' : 'دائن (مشتريات)'}</th><th class="num">الرصيد</th></tr></thead>
          <tbody>${lines.map((l) => `<tr><td>${esc(date(l.d))}</td><td>${esc(l.ref)}</td><td class="num">${Number(l.debit) ? money(l.debit) : ''}</td><td class="num">${Number(l.credit) ? money(l.credit) : ''}</td><td class="num">${money(l.bal)}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد حركات.</td></tr>'}</tbody></table>
        <div class="totals"><span class="grand">الرصيد</span><span class="num grand">${money(bal)}</span></div>
        <footer class="doc-foot"><span>${esc(g.name)}</span><span class="row" style="gap:6px">بواسطة <img src="assets/logo.svg" alt="EMD Garage"></span></footer>
      </article>`,
    bind(el) { el.querySelector('#do-print').addEventListener('click', () => window.print()); },
  };
}
