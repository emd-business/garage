// Scan the chassis-number (VIN) barcode with the phone camera, where the browser can read barcodes.
import { esc } from './format.js';
import { toast } from './ui.js';

export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

// A VIN is 17 letters and digits without I, O or Q. Door-jamb barcodes often add a leading "I".
export function vinFrom(raw) {
  const ok = (v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
  const one = (t) => (ok(t) ? t : t.length === 18 && t[0] === 'I' && ok(t.slice(1)) ? t.slice(1) : null);
  const up = String(raw || '').toUpperCase();
  for (const tok of up.split(/[^A-Z0-9]+/)) { const v = one(tok); if (v) return v; }
  return one(up.replace(/[^A-Z0-9]/g, ''));   // a VIN printed with spaces or dashes inside it
}

export function scanVin() {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'scan-dialog';
    d.innerHTML = `<div class="stack"><h2>امسح باركود الشاصي</h2>
      <p class="muted">وجّه الكاميرا إلى ملصق الباركود على قائم باب السائق أو أسفل الزجاج الأمامي.</p>
      <div class="scan-view"><video playsinline muted></video><span class="scan-line" aria-hidden="true"></span></div>
      <p class="subtle" id="scan-msg" role="status">جارٍ تشغيل الكاميرا…</p>
      <div class="dialog-actions"><button type="button" class="btn" data-close>إلغاء</button></div></div>`;
    document.body.append(d);
    const video = d.querySelector('video'), msg = d.querySelector('#scan-msg');
    let stream = null, timer = null, result = null, seenOther = '';
    const stop = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
    d.addEventListener('close', () => { stop(); d.remove(); resolve(result); });
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.showModal();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        video.srcObject = stream; await video.play();
        const all = await window.BarcodeDetector.getSupportedFormats();
        const formats = ['code_39', 'code_128', 'data_matrix', 'qr_code', 'pdf417'].filter((f) => all.includes(f));
        const det = new window.BarcodeDetector(formats.length ? { formats } : undefined);
        msg.textContent = 'ابحث عن الباركود…';
        timer = setInterval(async () => {
          if (video.readyState < 2) return;
          try {
            for (const c of await det.detect(video)) {
              const v = vinFrom(c.rawValue);
              if (v) { result = v; navigator.vibrate?.(60); d.close(); return; }
              if (c.rawValue && c.rawValue !== seenOther) { seenOther = c.rawValue; msg.innerHTML = `قُرئ باركود ليس رقم شاصي: <bdi class="ltr">${esc(c.rawValue.slice(0, 30))}</bdi>`; }
            }
          } catch { /* a frame that could not be read */ }
        }, 300);
      } catch (e) {
        msg.textContent = e.name === 'NotAllowedError' ? 'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح ثم أعد المحاولة.' : 'تعذّر تشغيل الكاميرا على هذا الجهاز.';
      }
    })();
  });
}

// <button data-scan-vin="#selector"> next to any field: fills it and fires its input event
let wired = false;
export function wireScan() {
  if (wired) return; wired = true;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-scan-vin]');
    if (!b) return;
    const scope = b.closest('form, dialog, section') || document;
    const input = scope.querySelector(b.dataset.scanVin) || document.querySelector(b.dataset.scanVin);
    const vin = await scanVin();
    if (!vin || !input) return;
    input.value = vin;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    toast(`قُرئ رقم الشاصي ${vin}`);
  });
}
export const scanButton = (target, label = 'امسح الشاصي') => (canScan() ? `<button type="button" class="btn small scan-btn" data-scan-vin="${esc(target)}">${label}</button>` : '');
