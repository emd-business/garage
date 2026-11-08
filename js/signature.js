// Finger or mouse signature pad in a dialog; resolves to a PNG blob, or null when cancelled.
import { esc } from './format.js';

export function askSignature(title, note = '') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sign-dialog';
    d.innerHTML = `<form method="dialog" class="stack">
      <h2>${esc(title)}</h2>${note ? `<p class="muted">${esc(note)}</p>` : ''}
      <canvas class="sign-pad" width="600" height="220" aria-label="خانة التوقيع"></canvas>
      <div class="dialog-actions"><button class="btn primary" value="ok" disabled>احفظ التوقيع</button>
        <button type="button" class="btn" data-clear>امسح</button><button class="btn ghost" value="cancel" formnovalidate>إلغاء</button></div></form>`;
    document.body.append(d);
    const c = d.querySelector('canvas'), g = c.getContext('2d'), ok = d.querySelector('[value=ok]');
    g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0B1E33';
    let drawing = false, drawn = false, last = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    c.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
    c.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p;
      if (!drawn) { drawn = true; ok.disabled = false; }
    });
    const end = () => { drawing = false; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    d.querySelector('[data-clear]').addEventListener('click', () => { g.clearRect(0, 0, c.width, c.height); drawn = false; ok.disabled = true; });
    let result = null;
    d.querySelector('form').addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      c.toBlob((b) => { result = b; d.close(); }, 'image/png');
    });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.showModal();
  });
}
