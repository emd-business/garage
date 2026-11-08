// Photo upload to Supabase Storage (bucket "garage", one folder per garage), with on-device compression.
import { SUPABASE_URL, SUPABASE_KEY, auth } from './api.js';
import { esc } from './format.js';
import { ctx } from './state.js';

const MAX = 1600;

async function compress(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    throw new Error('الملف ليس صورة');
  }
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file; // let the server judge it
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
}

export async function uploadImage(file, kind = 'photos') {
  const blob = await compress(file);
  const path = `${ctx.garage.id}/${kind}/${crypto.randomUUID()}.jpg`;
  const token = auth.session && auth.session.access_token;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/garage/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: blob,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(/exceeded|too large/i.test(t) ? 'الصورة كبيرة جداً' : 'تعذّر رفع الصورة');
  }
  return `${SUPABASE_URL}/storage/v1/object/public/garage/${path}`;
}

// Raw upload of an already-prepared blob (signatures, PDF files)
export async function uploadBlob(blob, kind, ext, type) {
  const path = `${ctx.garage.id}/${kind}/${crypto.randomUUID()}.${ext}`;
  const token = auth.session && auth.session.access_token;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/garage/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': type, 'x-upsert': 'false' },
    body: blob,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(/exceeded|too large/i.test(t) ? 'الملف كبير جداً (الحد ٨ ميغابايت)' : 'تعذّر رفع الملف');
  }
  return `${SUPABASE_URL}/storage/v1/object/public/garage/${path}`;
}

// A receipt or supplier invoice: photos are compressed, PDF files go as they are
export async function uploadDoc(file, kind = 'docs') {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 8 * 1024 * 1024) throw new Error('الملف كبير جداً (الحد ٨ ميغابايت)');
    return uploadBlob(file, kind, 'pdf', 'application/pdf');
  }
  return uploadImage(file, kind);
}

// Link to an attachment: a thumbnail for photos, a label for PDF
export const attachLink = (url) => (!url ? '' : /\.pdf$/i.test(url)
  ? `<a class="attach pdf" href="${esc(url)}" target="_blank" rel="noopener">PDF</a>`
  : `<a class="attach" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="المرفق" loading="lazy"></a>`);

export async function uploadMany(files, kind) {
  const out = [];
  for (const f of files) out.push(await uploadImage(f, kind));
  return out;
}

export const photoGrid = (urls = [], { removable = false } = {}) => (urls.length
  ? `<div class="photos">${urls.map((u, i) => `<span class="ph"><a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="صورة ${i + 1}" loading="lazy"></a>${removable ? `<button type="button" class="ph-x" data-rm-photo="${i}" aria-label="احذف الصورة">×</button>` : ''}</span>`).join('')}</div>`
  : '');

// A labelled file picker that opens the camera on phones
export const photoPicker = (name = 'photos', label = 'أضف صوراً') => `<label class="btn small photo-pick">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
  ${esc(label)}<input type="file" name="${esc(name)}" accept="image/*" capture="environment" multiple class="hidden"></label>`;
