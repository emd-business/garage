// Car intakes saved on this device while there is no internet, and sent when it returns.
// Every record is created with an id chosen here, so sending twice can never create it twice.
import { db } from './api.js';
import { ctx } from './state.js';

const key = () => `emd-outbox-${ctx.garage?.id || 'none'}`;
export const outbox = {
  list() { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; } },
  save(list) { try { localStorage.setItem(key(), JSON.stringify(list)); return true; } catch { return false; } },
  add(entry) { const l = this.list().filter((e) => e.id !== entry.id); l.push(entry); return this.save(l); },
  remove(id) { this.save(this.list().filter((e) => e.id !== id)); },
};

const isOffline = (e) => e && e.status === 0;
const samePk = (e) => /_pkey/.test(e?.message || '');

// Runs the intake steps. `entry` is updated as each step succeeds, so a retry continues where it stopped.
export async function sendIntake(entry) {
  // saved offline as "new customer and car": the car or the customer may in fact be registered already
  if (entry.match && entry.newVehicle && !entry.vehicle_id && entry.newVehicle.plate_number) {
    const f = { plate_number: `eq.${entry.newVehicle.plate_number}`, select: 'id,customer_id', limit: 1 };
    if (entry.newVehicle.plate_letters) f.plate_letters = `eq.${entry.newVehicle.plate_letters}`;
    const found = (await db.get('vehicles', f))[0];
    if (found) { entry.vehicle_id = found.id; entry.customer_id = found.customer_id; entry.matched = 'vehicle'; }
  }
  if (entry.match && entry.newCustomer && !entry.customer_id && entry.newCustomer.phone) {
    const found = (await db.get('customers', { phone: `eq.${entry.newCustomer.phone}`, select: 'id', limit: 1 }))[0];
    if (found) { entry.customer_id = found.id; entry.matched = entry.matched || 'customer'; }
  }
  if (!entry.customer_id) {
    try { await db.insert('customers', entry.newCustomer); } catch (e) { if (!samePk(e)) throw e; }
    entry.customer_id = entry.newCustomer.id;
  }
  if (entry.transfer && !entry.transferred) {
    await db.rpc('transfer_vehicle', { p_vehicle: entry.vehicle_id, p_customer: entry.customer_id });
    entry.transferred = true;
  }
  if (!entry.vehicle_id) {
    try {
      await db.insert('vehicles', { ...entry.newVehicle, customer_id: entry.customer_id });
    } catch (e) {
      if (isOffline(e)) throw e;
      if (!samePk(e)) {
        if (/vehicles_vin_unique/.test(e.message)) throw new Error('رقم الشاصي هذا مسجل لسيارة أخرى. ابحث عنه في أعلى الصفحة.');
        if (/vehicles_plate_unique|duplicate key/.test(e.message)) throw new Error('هذه اللوحة مسجلة من قبل. ابحث عنها في أعلى الصفحة، واختر «مالك جديد» إن كانت السيارة قد بيعت.');
        throw e;
      }
    }
    entry.vehicle_id = entry.newVehicle.id;
  }
  let job;
  try {
    job = await db.insert('job_orders', { ...entry.job, vehicle_id: entry.vehicle_id, customer_id: entry.customer_id });
  } catch (e) {
    if (!samePk(e)) throw e;
    job = await db.one('job_orders', { id: `eq.${entry.job.id}`, select: '*' });
  }
  return job;
}

// Send everything waiting. Stops at the first sign of no internet; other errors stay on the entry for the user to see.
let syncing = false;
export async function syncOutbox() {
  if (syncing || !ctx.garage) return { sent: [], failed: 0, left: outbox.list().length };
  syncing = true;
  const sent = []; let failed = 0;
  try {
    for (const entry of outbox.list()) {
      try {
        const job = await sendIntake(entry);
        outbox.remove(entry.id);
        sent.push(job);
      } catch (e) {
        outbox.add(isOffline(e) ? entry : { ...entry, error: e.message });   // keep the progress made so far
        if (isOffline(e)) break;
        failed++;
      }
    }
  } finally { syncing = false; }
  return { sent, failed, left: outbox.list().length };
}
