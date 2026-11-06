import { db } from '../api.js';
import { idn, esc, num, STATUS, FLOW, carName, dateTime } from '../format.js';
import { icon, toast, busy } from '../ui.js';
import { ctx } from '../state.js';
import { JOB_SELECT, plateTag, isLate } from './dashboard.js';

const LANES = ['received', 'inspection', 'approval', 'repair', 'qc', 'ready'];
const TECH_CAN = ['inspection', 'repair', 'qc', 'ready'];

function nextStatus(s) {
  const i = FLOW.indexOf(s);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

export default async function board() {
  const params = { select: JOB_SELECT, status: 'not.in.(delivered,cancelled)', order: 'received_at.asc' };
  if (ctx.isTech) params.technician_id = `eq.${ctx.uid}`;
  const jobs = await db.get('job_orders', params);

  const card = (j) => {
    const nx = nextStatus(j.status);
    const canMove = nx && (!ctx.isTech || TECH_CAN.includes(nx)) && !(nx === 'delivered');
    const late = isLate(j);
    return `<article class="jobcard ${late ? 'late' : ''}">
      <a class="open" href="#/job/${j.id}">
        <div class="top">${plateTag(j.vehicles) || `<span class="subtle">أمر ${idn(j.job_no)}</span>`}<span class="subtle">#${idn(j.job_no)}</span></div>
        <div class="car">${esc(carName(j.vehicles) || 'مركبة')}</div>
        ${j.complaint ? `<div class="meta">${esc(j.complaint.slice(0, 80))}</div>` : ''}
        <div class="meta">${[j.customers?.name, ctx.staffName(j.technician_id) && `الفني: ${ctx.staffName(j.technician_id)}`].filter(Boolean).map(esc).join(' · ')}</div>
        ${j.promised_at ? `<div class="meta">${late ? '<span class="badge danger">متأخرة</span> ' : ''}التسليم ${esc(dateTime(j.promised_at))}</div>` : ''}
      </a>
      ${canMove ? `<div class="actions"><button class="btn small" data-move="${j.id}" data-to="${nx}">${esc(STATUS[nx].label)} ${icon('arrow')}</button></div>` : ''}
    </article>`;
  };

  const lanes = LANES.map((s) => {
    const list = jobs.filter((j) => j.status === s);
    return `<section class="lane" aria-label="${esc(STATUS[s].label)}">
      <div class="lane-head"><span>${esc(STATUS[s].label)}</span><span class="count">${num(list.length)}</span></div>
      ${list.length ? list.map(card).join('') : '<div class="empty-lane">لا توجد سيارات</div>'}
    </section>`;
  }).join('');

  return {
    title: 'الورشة',
    html: `<div class="page-head">
        <div><h1>${ctx.isTech ? 'سياراتي' : 'لوحة الورشة'}</h1><p class="lead">${num(jobs.length)} سيارة في الورشة${jobs.filter(isLate).length ? ` · ${num(jobs.filter(isLate).length)} متأخرة` : ''}</p></div>
        ${ctx.can('owner', 'manager', 'reception') ? `<a class="btn primary" href="#/intake">${icon('plus')} استلام سيارة</a>` : ''}
      </div>
      ${jobs.length ? `<div class="board">${lanes}</div>` : `<div class="card empty"><p>${ctx.isTech ? 'لا توجد سيارات مسندة إليك الآن.' : 'الورشة فارغة.'}</p>${ctx.can('owner', 'manager', 'reception') ? '<a class="btn primary" href="#/intake">استلم سيارة</a>' : ''}</div>`}`,
    bind(el) {
      el.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-move]');
        if (!b) return;
        await busy(b, async () => {
          await db.rpc('set_job_status', { p_job: b.dataset.move, p_status: b.dataset.to });
          toast(`نُقلت إلى «${STATUS[b.dataset.to].label}»`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      });
    },
  };
}
