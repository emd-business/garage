// Session context shared by every view.
import { auth, db } from './api.js';

export const ctx = {
  profile: null,
  garage: null,
  role: null,
  isAdmin: false,
  staff: [],
  branches: [],       // active branches of this garage
  branch: null,       // the branch the user is working in now
  branchLocked: false, // the user is assigned to one branch only
  get uid() { return auth.user && auth.user.id; },
  can(...roles) { return roles.includes(this.role); },
  get isTech() { return this.role === 'technician'; },
  get multiBranch() { return this.branches.length > 1; },
  staffName(id) {
    const s = this.staff.find((x) => x.user_id === id);
    return s ? s.full_name : '';
  },
  branchName(id) {
    const b = this.allBranches.find((x) => x.id === id);
    return b ? b.name : '';
  },
  allBranches: [],
  get technicians() {
    return this.staff.filter((s) => s.active && ['technician', 'manager', 'owner'].includes(s.role) && (!s.branch_id || !this.branch || s.branch_id === this.branch.id));
  },
  // filter for lists that belong to the current branch
  get here() { return this.branch ? { branch_id: `eq.${this.branch.id}` } : {}; },
};

export async function loadContext() {
  ctx.profile = await db.one('profiles', { id: `eq.${ctx.uid}`, select: '*' });
  ctx.garage = null; ctx.role = null; ctx.staff = []; ctx.branches = []; ctx.allBranches = []; ctx.branch = null; ctx.branchLocked = false;
  ctx.isAdmin = !!(await db.rpc('is_platform_admin').catch(() => false));
  if (!ctx.profile || !ctx.profile.current_garage_id) return ctx;
  const [garage, role] = await Promise.all([
    db.one('garages', { id: `eq.${ctx.profile.current_garage_id}`, select: '*' }),
    db.rpc('my_role'),
  ]);
  ctx.garage = garage; ctx.role = role;
  if (role) {
    const [staff, branches, cur] = await Promise.all([
      db.rpc('garage_staff'),
      db.get('branches', { order: 'is_main.desc,created_at' }).catch(() => []),
      db.rpc('current_branch').catch(() => null),
    ]);
    ctx.staff = staff;
    ctx.allBranches = branches;
    ctx.branches = branches.filter((b) => b.active);
    ctx.branch = branches.find((b) => b.id === cur) || ctx.branches[0] || null;
    const me = staff.find((s) => s.user_id === ctx.uid);
    ctx.branchLocked = !!(me && me.branch_id);
  }
  return ctx;
}

export async function refreshGarage() {
  if (ctx.garage) ctx.garage = await db.one('garages', { id: `eq.${ctx.garage.id}`, select: '*' });
}

export async function switchBranch(id) {
  await db.rpc('switch_branch', { p_branch: id });
  ctx.branch = ctx.branches.find((b) => b.id === id) || ctx.branch;
}
