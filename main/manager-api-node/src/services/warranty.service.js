/**
 * Warranty Service
 *
 * A toy's warranty starts the first time a parent activates it with its
 * 6-digit code, and never restarts on a later unbind/rebind. The record is
 * keyed by MAC in device_warranty, apart from ai_device, because that row does
 * not survive a hard unbind or an account deletion.
 */

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const { ApiError } = require('../middleware/errorHandler');

const WARRANTY_MONTHS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// Clamps to the month's last day: Aug 31 + 6 months is Feb 28/29, where
// Date#setMonth would roll over to Mar 3.
const addMonths = (date, months) => {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

const requireMac = (mac) => {
  const normalized = normalizeMacAddress(mac);
  if (!normalized) throw new ApiError('Invalid MAC address', 400, 400);
  return normalized;
};

const parseDate = (value, field) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(`${field} must be a valid date`, 400, 400);
  return date;
};

/**
 * Record the warranty of a first 6-digit activation. Runs inside the bind's
 * transaction; the unique MAC turns every later activation into a no-op.
 */
const startWarrantyIfNew = (tx, { macAddress, userId, at = new Date() }) =>
  tx.device_warranty.createMany({
    data: [{
      mac_address: macAddress,
      activated_at: at,
      warranty_start: at,
      warranty_end: addMonths(at, WARRANTY_MONTHS),
      first_user_id: userId ? BigInt(userId) : null,
    }],
    skipDuplicates: true,
  });

// Same name the Users page shows: the parent's display name, then email, then username.
const namesById = async (ids) => {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return {};
  const users = await prisma.sys_user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, username: true, email: true, parent_profile: { select: { display_name: true } } },
  });
  return Object.fromEntries(users.map(u => [
    String(u.id),
    u.parent_profile?.display_name || u.email || u.username || null,
  ]));
};

const getWarrantyByMac = async (mac) => {
  const macAddress = requireMac(mac);
  const row = await prisma.device_warranty.findUnique({ where: { mac_address: macAddress } });
  if (!row) {
    return { macAddress, registered: false, status: 'not_registered', warrantyMonths: WARRANTY_MONTHS };
  }

  const names = await namesById([row.first_user_id, row.updated_by]);
  const person = id => (id ? { id, name: names[String(id)] || null } : null);
  const msLeft = new Date(row.warranty_end).getTime() - Date.now();

  return {
    macAddress,
    registered: true,
    warrantyMonths: WARRANTY_MONTHS,
    activatedAt: row.activated_at,
    warrantyStart: row.warranty_start,
    warrantyEnd: row.warranty_end,
    status: msLeft > 0 ? 'active' : 'expired',
    daysRemaining: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
    firstUser: person(row.first_user_id),
    note: row.note,
    updatedBy: person(row.updated_by),
    updateDate: row.update_date,
  };
};

/**
 * Admin correction. Creates the record when there is none, because a toy bound
 * before warranties were recorded has no other way to get one; such a record
 * has no activated_at. warrantyEnd defaults to start + 6 months.
 */
const upsertWarranty = async (mac, { warrantyStart, warrantyEnd, note } = {}, adminId) => {
  const macAddress = requireMac(mac);
  const start = parseDate(warrantyStart, 'warrantyStart');
  const end = warrantyEnd ? parseDate(warrantyEnd, 'warrantyEnd') : addMonths(start, WARRANTY_MONTHS);
  if (end < start) throw new ApiError('warrantyEnd cannot be before warrantyStart', 400, 400);

  const fields = {
    warranty_start: start,
    warranty_end: end,
    note: (typeof note === 'string' && note.trim()) || null,
    updated_by: adminId ? BigInt(adminId) : null,
    update_date: new Date(),
  };
  await prisma.device_warranty.upsert({
    where: { mac_address: macAddress },
    create: { mac_address: macAddress, ...fields },
    update: fields,
  });
  return getWarrantyByMac(macAddress);
};

// The next 6-digit activation then starts a fresh warranty (e.g. a replacement unit).
const deleteWarranty = async (mac) => {
  const macAddress = requireMac(mac);
  const { count } = await prisma.device_warranty.deleteMany({ where: { mac_address: macAddress } });
  return { macAddress, deleted: count > 0 };
};

module.exports = {
  WARRANTY_MONTHS,
  addMonths,
  startWarrantyIfNew,
  getWarrantyByMac,
  upsertWarranty,
  deleteWarranty,
};
