// Session context shared by every view.
import { auth, db } from './api.js';

export const ctx = {
  profile: null,
  garage: null,
  role: null,
  staff: [],
  get uid() { return auth.user && auth.user.id; },
  can(...roles) { return roles.includes(this.role); },
  get isTech() { return this.role === 'technician'; },
  staffName(id) {
    const s = this.staff.find((x) => x.user_id === id);
    return s ? s.full_name : '';
  },
  get technicians() { return this.staff.filter((s) => s.active && ['technician', 'manager', 'owner'].includes(s.role)); },
};

export async function loadContext() {
  ctx.profile = await db.one('profiles', { id: `eq.${ctx.uid}`, select: '*' });
  ctx.garage = null; ctx.role = null; ctx.staff = [];
  if (!ctx.profile || !ctx.profile.current_garage_id) return ctx;
  const [garage, role] = await Promise.all([
    db.one('garages', { id: `eq.${ctx.profile.current_garage_id}`, select: '*' }),
    db.rpc('my_role'),
  ]);
  ctx.garage = garage; ctx.role = role;
  if (role) ctx.staff = await db.rpc('garage_staff');
  return ctx;
}

export async function refreshGarage() {
  if (ctx.garage) ctx.garage = await db.one('garages', { id: `eq.${ctx.garage.id}`, select: '*' });
}
