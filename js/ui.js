// Shared UI pieces: icons, toast, dialogs, form helpers.
import { esc } from './format.js';

const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  intake: '<path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/><circle cx="7.5" cy="18" r=".5"/><circle cx="16.5" cy="18" r=".5"/><path d="M12 3v5M9.5 5.5h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5L12 12l9-4.5M12 12v9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  wa: '<path d="M3.5 20.5l1.3-4A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.2-1.1z"/><path d="M9 8.5c0 3.5 2.5 6.5 6.5 6.5l1-1.5-2-1-1 1c-1.2-.5-2.5-1.8-3-3l1-1-1-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  out: '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

let toastTimer;
export function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

export const errMsg = (e) => (e && e.message) || 'حدث خطأ غير متوقع';

// Read a form into a plain object; empty strings become null.
export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) {
    const t = typeof v === 'string' ? v.trim() : v;
    out[k] = t === '' ? null : t;
  }
  return out;
}

// Run an async action with the submit button disabled and errors toasted.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn) btn.disabled = false; }
}

// Modal dialog with a form. onSubmit(data, form) returns false to keep it open.
export function openDialog(title, bodyHtml, onSubmit, { submitLabel = 'احفظ', danger = false } = {}) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog" novalidate>
    <h2>${esc(title)}</h2>
    ${bodyHtml}
    <div class="dialog-actions">
      <button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(submitLabel)}</button>
      <button class="btn ghost" value="cancel" formnovalidate>إلغاء</button>
    </div></form>`;
  document.body.append(d);
  const form = d.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const btn = ev.submitter;
    if (btn) btn.disabled = true;
    try {
      const ok = await onSubmit(formData(form), form);
      if (ok !== false) d.close();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  d.querySelector('input,select,textarea')?.focus();
  return d;
}

export const field = (label, input, { req = false, hint = '', cls = '' } = {}) =>
  `<label class="field ${cls}"><span class="${req ? 'req' : ''}">${esc(label)}</span>${input}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;

export const options = (list, selected, { empty } = {}) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
