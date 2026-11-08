// Interface language. Arabic is the source language of the app; English is applied by
// translating every rendered text node and label through the dictionary, longest phrase first.
import DICT from './i18n-en.js';

const KEY = 'emd-lang';
export const lang = (() => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } })();
export const isEn = lang === 'en';
export const LOCALE = isEn ? 'en-GB' : 'ar-OM';

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode: stays for this page only */ }
  location.reload();
}

document.documentElement.lang = isEn ? 'en' : 'ar';
document.documentElement.dir = isEn ? 'ltr' : 'rtl';

const AR = /[؀-ۿ]/;
const LETTER = /[ء-ي٠-٩]/;
const entries = Object.entries(DICT).sort((a, b) => b[0].length - a[0].length);
const exact = new Map(entries);
// Short connecting words are translated only when they stand alone, never inside someone's own text
const STOP = new Set(['أو', 'تم', 'في', 'كم', 'لـ', 'من', 'إلى', 'على', 'عند', 'حتى', 'منذ', 'مرة', 'فقط', 'بمبلغ', 'عليه', 'بند', 'أمر', 'فحص', 'صورة', 'سيارة', 'خدمة', 'قطعة', 'عميل', 'مورد', 'فاتورة', 'ساعة', 'يحتاج', 'مخزون', 'محرك', 'فرامل', 'تبريد', 'تعليق', 'زيوت', 'فلاتر', 'إطارات', 'كهرباء', 'وقود', 'رواتب', 'إيجار', 'تسويق', 'تأمين', 'بيان', 'ملاحظات', 'سداد', 'شراء', 'فرع', 'الفرع', 'تحويل', 'الرئيسي', 'مفعّل', 'موقوف', 'مستعمل', 'جديد', 'تناسب', 'الشركة', 'الموديل']);
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.', '٬': ',', '٪': '%', '،': ',', '؛': ';', '؟': '?' };

function replaceWord(text, word, value) {
  // a single short word only matches as a whole word, so names and data are left alone
  let i = text.indexOf(word);
  while (i !== -1) {
    const before = text[i - 1], after = text[i + word.length];
    if ((!before || !LETTER.test(before)) && (!after || !LETTER.test(after))) {
      text = text.slice(0, i) + value + text.slice(i + word.length);
      i = text.indexOf(word, i + value.length);
    } else i = text.indexOf(word, i + 1);
  }
  return text;
}

export function tr(text) {
  if (!isEn || !text || !AR.test(text)) return text;
  const t = text.trim();
  if (exact.has(t)) return text.replace(t, exact.get(t));
  let out = text;
  for (const [k, v] of entries) {
    if (!AR.test(out)) break;
    if (!out.includes(k) || STOP.has(k)) continue;
    out = /\s/.test(k) ? out.split(k).join(v) : replaceWord(out, k, v);
  }
  // what's left is either someone's own text (left alone) or only connecting words of a UI sentence
  if (AR.test(out)) {
    const words = out.match(/[\u0621-\u064A\u0640]+(?:\s?ـ)?/g) || [];
    if (words.every((w) => STOP.has(w) || exact.has(w))) for (const w of new Set(words)) out = replaceWord(out, w, exact.get(w));
  }
  return out.replace(/[٠-٩٫٬٪،؛؟]/g, (c) => DIGITS[c]).replace(/ +([,.;:?%])/g, '$1');
}

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

export function translate(root) {
  if (!isEn || !root) return;
  if (root.nodeType === 3) {
    const p = root.parentElement;
    if (p && !SKIP.has(p.tagName) && !p.closest('[data-raw]')) { const n = tr(root.nodeValue); if (n !== root.nodeValue) root.nodeValue = n; }
    return;
  }
  if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.closest?.('[data-raw]')) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = root;
  while (node) {
    if (node.nodeType === 1) {
      if (node.tagName === 'TEXTAREA') { const v = node.getAttribute('placeholder'); if (v && AR.test(v)) node.setAttribute('placeholder', tr(v)); }
      if (SKIP.has(node.tagName) || node.hasAttribute('data-raw')) { node = skipSubtree(walker); continue; }
      for (const a of ATTRS) { const v = node.getAttribute(a); if (v && AR.test(v)) node.setAttribute(a, tr(v)); }
      if (node.tagName === 'INPUT' && (node.type === 'submit' || node.type === 'button') && AR.test(node.value)) node.value = tr(node.value);
    } else if (AR.test(node.nodeValue)) {
      const n = tr(node.nodeValue); if (n !== node.nodeValue) node.nodeValue = n;
    }
    node = walker.nextNode();
  }
}
function skipSubtree(walker) {
  let n = walker.currentNode;
  while (n) { if (n.nextSibling) { walker.currentNode = n.nextSibling; return n.nextSibling; } n = n.parentNode; if (!n || n === walker.root) return null; walker.currentNode = n; }
  return null;
}

if (isEn) {
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translate(m.target);
      else m.addedNodes.forEach(translate);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const setTitle = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  Object.defineProperty(document, 'title', { get() { return setTitle.get.call(this); }, set(v) { setTitle.set.call(this, tr(v)); }, configurable: true });
}

// Language switch button, usable anywhere: <button data-lang-toggle>
export const langButton = (cls = 'btn small ghost') => `<button type="button" class="${cls}" data-lang-toggle data-raw>${isEn ? 'العربية' : 'English'}</button>`;
document.addEventListener('click', (e) => { if (e.target.closest('[data-lang-toggle]')) setLang(isEn ? 'ar' : 'en'); });
