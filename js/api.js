// Minimal Supabase client over fetch: auth, PostgREST and RPC. No dependencies.
export const SUPABASE_URL = 'https://abywaqevzqryznvpyqcg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_NxlrqvhLhWYMp0blB9mu4w_YkGPCqzR';
const STORE = 'emd-garage-session';

let session = load();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}
function save(s) {
  session = s;
  try { s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE); } catch {}
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const MESSAGES = {
  'Invalid login credentials': 'البريد أو كلمة المرور غير صحيحة',
  'Email not confirmed': 'لم يُؤكَّد البريد بعد. افتح رسالة التأكيد في بريدك',
  'User already registered': 'هذا البريد مسجل مسبقاً، سجّل الدخول',
  'Password should be at least 6 characters': 'كلمة المرور يجب أن تكون ٦ أحرف على الأقل',
};

async function parse(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const raw = (body && (body.message || body.msg || body.error_description || body.error)) || `خطأ ${res.status}`;
    throw new ApiError(MESSAGES[raw] || raw, res.status);
  }
  return body;
}

const here = () => location.origin + location.pathname;

async function authFetch(path, payload) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(res);
}

function store(data) {
  if (!data || !data.access_token) return null;
  save({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  });
  return session;
}

export const auth = {
  get session() { return session; },
  get user() { return session && session.user; },
  async signIn(email, password) {
    return store(await authFetch('token?grant_type=password', { email, password }));
  },
  async signUp(email, password, full_name, phone) {
    const data = await authFetch(`signup?redirect_to=${encodeURIComponent(here())}`, { email, password, data: { full_name, phone } });
    return { session: store(data), needsConfirm: !data.access_token };
  },
  // After an email-confirmation or recovery link, Supabase returns the tokens in the URL hash.
  async fromUrl() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const at = h.get('access_token');
    if (!at) return null;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${at}` } });
    const user = await parse(res);
    store({ access_token: at, refresh_token: h.get('refresh_token'), expires_in: Number(h.get('expires_in')) || 3600, user });
    history.replaceState(null, '', location.pathname + location.search);
    return { session, type: h.get('type') };
  },
  async updatePassword(password) {
    const t = await token();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return parse(res);
  },
  async recover(email) {
    return authFetch(`recover?redirect_to=${encodeURIComponent(here())}`, { email });
  },
  async refresh() {
    if (!session) return null;
    try {
      return store(await authFetch('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
    } catch (e) {
      save(null);
      throw e;
    }
  },
  async signOut() {
    if (session) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {});
    }
    save(null);
    clearOffline();
  },
};

async function token() {
  if (!session) return null;
  if (session.expires_at - 60 < Date.now() / 1000) await auth.refresh();
  return session && session.access_token;
}

async function rest(method, path, { body, prefer, headers = {} } = {}) {
  const t = await token();
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (t) h.Authorization = `Bearer ${t}`;
  if (prefer) h.Prefer = prefer;
  const read = method === 'GET' || (method === 'POST' && READ_RPC.has(path.slice(4)) && path.startsWith('rpc/'));
  const key = read ? cacheKey(method, path, body) : null;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // No network: show the last saved copy of what was read before; never pretend a save worked
    if (read) {
      const cached = await cacheGet(key);
      if (cached !== undefined) { setOffline(true, true); return cached; }
    }
    setOffline(true, false);
    throw new ApiError(read ? 'لا يوجد اتصال بالإنترنت، ولم تُفتح هذه الصفحة من قبل على هذا الجهاز' : 'لا يوجد اتصال بالإنترنت. لم يُحفظ شيء، حاول عند عودة الاتصال', 0);
  }
  if (res.status === 401 && session) {
    await auth.refresh();
    return rest(method, path, { body, prefer, headers });
  }
  const data = await parse(res);
  setOffline(false);
  if (read) cachePut(key, data);
  return data;
}

// ---------- Offline copies of what was read ----------
// Reads that change nothing; their answers are kept on this device for viewing without internet.
const READ_RPC = new Set(['dashboard_today', 'garage_staff', 'my_role', 'is_platform_admin', 'report_summary', 'trial_balance', 'account_ledger',
  'customer_statement', 'supplier_statement', 'service_due', 'monthly_costs', 'job_time', 'job_lines_for_tech', 'warranty_check', 'tech_time',
  'admin_garages', 'my_subscription', 'portal_job', 'current_branch', 'my_limits', 'setup_progress', 'cash_status', 'sublet_suppliers',
  'reorder_suggestions', 'platform_contact', 'global_search']);
const CACHE = 'emd-garage-data';
function cacheKey(method, path, body) {
  const who = (session && session.user && session.user.id) || 'anon';
  return `${SUPABASE_URL}/__offline/${who}/${method}/${encodeURIComponent(path)}/${body === undefined ? '' : encodeURIComponent(JSON.stringify(body))}`;
}
async function cachePut(key, data) {
  try { const c = await caches.open(CACHE); await c.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'x-saved': new Date().toISOString() } })); } catch { /* no cache API */ }
}
async function cacheGet(key) {
  try { const c = await caches.open(CACHE); const r = await c.match(key); return r ? r.json() : undefined; } catch { return undefined; }
}
export async function clearOffline() { try { await caches.delete(CACHE); } catch { /* ignore */ } }

let offlineState = null;
function setOffline(off, fromCache) {
  const next = off ? (fromCache ? 'cache' : 'down') : 'up';
  if (next === offlineState) return;
  offlineState = next;
  let bar = document.getElementById('offline-bar');
  if (next === 'up') { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'offline-bar'; bar.setAttribute('role', 'status'); document.body.prepend(bar); }
  bar.textContent = 'لا يوجد اتصال بالإنترنت. تُعرض آخر بيانات محفوظة على هذا الجهاز. استلام السيارات يُحفظ على الجهاز ويُرسل لاحقاً، وباقي الحفظ متوقف حتى يعود الاتصال.';
}
window.addEventListener('offline', () => setOffline(true, true));
window.addEventListener('online', () => { setOffline(false); window.dispatchEvent(new HashChangeEvent('hashchange')); });

// db.get('customers', {select:'*', phone:'eq.9', order:'name'})
function qs(params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.append(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const db = {
  get: (table, params) => rest('GET', table + qs(params)),
  one: async (table, params) => (await rest('GET', table + qs(params), { headers: { Accept: 'application/json' } }))[0] || null,
  insert: (table, row, params) => rest('POST', table + qs({ select: '*', ...params }), { body: row, prefer: 'return=representation' }).then((r) => (Array.isArray(row) ? r : r[0])),
  update: (table, filter, patch) => rest('PATCH', table + qs({ select: '*', ...filter }), { body: patch, prefer: 'return=representation' }),
  remove: (table, filter) => rest('DELETE', table + qs(filter)),
  rpc: (fn, args = {}) => rest('POST', `rpc/${fn}`, { body: args }),
};

// PostgREST ilike value: escape the characters that would change the pattern
export function like(term) {
  return `*${String(term).replace(/[*,()%]/g, ' ').trim()}*`;
}
