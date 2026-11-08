import { LOCALE, isEn } from './i18n.js';
// Formatting helpers: escaping, numbers, money, dates, Arabic amount in words, WhatsApp links.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nfMoney = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nfNum = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
export const money = (n) => (isEn ? `${nfMoney.format(Number(n) || 0)} OMR` : `${nfMoney.format(Number(n) || 0)} ر.ع`);
export const num = (n) => nfNum.format(Number(n) || 0);
const nfId = new Intl.NumberFormat(LOCALE, { useGrouping: false });
export const idn = (n) => nfId.format(Number(n) || 0);
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const dtf = new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', year: 'numeric', month: 'long', day: 'numeric' });
export const dateTime = (d) => (d ? dtf.format(new Date(d)) : '');
export const date = (d) => (d ? df.format(new Date(d)) : '');

// value for <input type="datetime-local"> in Muscat time
export function toLocalInput(d) {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + 4 * 3600 * 1000);
  return t.toISOString().slice(0, 16);
}
export function fromLocalInput(v) {
  if (!v) return null;
  return new Date(`${v}:00+04:00`).toISOString();
}

export const STATUS = {
  received: { label: 'استلام', tone: 'neutral' },
  inspection: { label: 'فحص', tone: 'info' },
  approval: { label: 'بانتظار الموافقة', tone: 'warning' },
  repair: { label: 'إصلاح', tone: 'info' },
  qc: { label: 'فحص الجودة', tone: 'info' },
  ready: { label: 'جاهزة', tone: 'success' },
  delivered: { label: 'مُسلَّمة', tone: 'neutral' },
  cancelled: { label: 'ملغاة', tone: 'danger' },
};
export const FLOW = ['received', 'inspection', 'approval', 'repair', 'qc', 'ready', 'delivered'];

export const ROLES = {
  owner: 'المالك', manager: 'المدير', reception: 'الاستقبال',
  accountant: 'المحاسب', storekeeper: 'أمين المخزن', technician: 'الفني',
};
export const METHODS = { cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل' };

export const badge = (status) => {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return `<span class="badge ${s.tone}">${esc(s.label)}</span>`;
};

export function plate(v) {
  if (!v) return '';
  return [v.plate_number, v.plate_letters].filter(Boolean).join(' ');
}
export function carName(v) {
  if (!v) return '';
  return [v.make, v.model, v.year].filter(Boolean).join(' ');
}

// ---- Arabic amount in words (Omani rial = 1000 baisa) ----
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function under1000(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const o = r % 10, t = Math.floor(r / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

function scale(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${under1000(n)} ${few}`;
  return `${under1000(n)} ${many}`;
}

export function intToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts = [];
  const millions = Math.floor(n / 1e6), thousands = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (millions) parts.push(scale(millions, 'مليون', 'مليونان', 'ملايين', 'مليون'));
  if (thousands) parts.push(scale(thousands, 'ألف', 'ألفان', 'آلاف', 'ألف'));
  if (rest) parts.push(under1000(rest));
  return parts.join(' و');
}

// ---- English amount in words ----
const EN1 = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN10 = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function en999(n) {
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if (h) out.push(`${EN1[h]} hundred`);
  if (r) out.push(r < 20 ? EN1[r] : EN10[Math.floor(r / 10)] + (r % 10 ? `-${EN1[r % 10]}` : ''));
  return out.join(' and ');
}
function enWords(n) {
  n = Math.floor(Math.abs(n));
  if (!n) return 'zero';
  const parts = [], m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000;
  if (m) parts.push(`${en999(m)} million`);
  if (t) parts.push(`${en999(t)} thousand`);
  if (r) parts.push(en999(r));
  return parts.join(' ');
}

export function amountWords(amount) {
  if (isEn) {
    const total = Math.round((Number(amount) || 0) * 1000), rials = Math.floor(total / 1000), baisa = total % 1000;
    const p = [];
    if (rials) p.push(`${enWords(rials)} Omani rial${rials === 1 ? '' : 's'}`);
    if (baisa) p.push(`${enWords(baisa)} baisa`);
    const w = p.length ? p.join(' and ') : 'zero Omani rials';
    return `${w.charAt(0).toUpperCase()}${w.slice(1)} only`;
  }
  const total = Math.round((Number(amount) || 0) * 1000);
  const rials = Math.floor(total / 1000), baisa = total % 1000;
  const parts = [];
  if (rials) parts.push(`${intToWords(rials)} ريال عماني`);
  if (baisa) parts.push(`${intToWords(baisa)} بيسة`);
  if (!parts.length) return 'صفر ريال عماني';
  return `فقط ${parts.join(' و')} لا غير`;
}

// ---- WhatsApp ----
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = `968${d}`;
  return d;
}
export function waLink(phone, text) {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

// Spare parts: condition and the vehicles a part fits
export const CONDITION = { new: ['جديد', 'success'], used: ['مستعمل', 'warning'], refurbished: ['مجدَّد', 'neutral'] };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
export function fitText(f) {
  // years kept left-to-right inside Arabic text (Unicode isolate marks)
  const yrs = f.year_from || f.year_to ? ` \u2066${f.year_from || '…'}–${f.year_to || '…'}\u2069` : '';
  return `${f.make || ''}${f.model ? ` ${f.model}` : ''}${yrs}`.trim();
}
export const fitsText = (fits) => (fits || []).map(fitText).join('، ');
// true when the part is listed for this vehicle (make, and model and year when given)
export function fitsVehicle(fits, v) {
  if (!v || !(fits || []).length) return false;
  return fits.some((f) => norm(f.make) === norm(v.make)
    && (!f.model || !v.model || norm(v.model).includes(norm(f.model)) || norm(f.model).includes(norm(v.model)))
    && (!v.year || ((!f.year_from || Number(v.year) >= Number(f.year_from)) && (!f.year_to || Number(v.year) <= Number(f.year_to)))));
}

export const MAKES = ['تويوتا', 'نيسان', 'هيونداي', 'كيا', 'ميتسوبيشي', 'هوندا', 'مازدا', 'لكزس', 'إيسوزو', 'سوزوكي',
  'شيفروليه', 'جي إم سي', 'فورد', 'دودج', 'جيب', 'كرايسلر', 'كاديلاك', 'لاند روفر', 'رنج روفر', 'مرسيدس',
  'بي إم دبليو', 'أودي', 'فولكس فاجن', 'بورشه', 'إنفينيتي', 'جينيسيس', 'شيري', 'جيلي', 'إم جي', 'هافال',
  'شانجان', 'بيجو', 'رينو', 'سوبارو', 'فولفو'];
