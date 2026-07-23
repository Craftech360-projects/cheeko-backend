/**
 * Subscription Admin Service (SUB-11)
 *
 * Super-admin support tooling over the subscription tables: search by MAC or
 * parent, comp/extend days, trial re-grant, the audit trail behind every
 * override, and the metrics the admin dashboard renders (funnel / churn /
 * MRR / gate hits).
 *
 * Every override writes subscription_admin_audit with before/after state —
 * the audit row commits in the same transaction as the change, so a logged
 * override can never have silently not happened (and vice versa).
 */

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');
const subscriptionService = require('./subscription.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_TIER = 'family'; // mirrors subscription.service TRIAL_TIER

/** The audit-relevant slice of a subscription row (JSON-safe: no BigInt). */
const auditState = (row) =>
  row
    ? {
        status: row.status,
        plan_id: row.plan_id == null ? null : Number(row.plan_id),
        trial_ends_at: row.trial_ends_at,
        trial_used: row.trial_used,
        current_period_start: row.current_period_start,
        current_period_end: row.current_period_end,
        grace_until: row.grace_until,
        cancel_at_period_end: row.cancel_at_period_end,
      }
    : null;

/** JSON-safe subscription row for API responses. */
const toApi = (row, device) => ({
  mac_address: row.mac_address,
  status: row.status,
  plan: row.subscription_plans
    ? { tier: row.subscription_plans.tier, name: row.subscription_plans.name, price_inr: row.subscription_plans.price_inr }
    : null,
  trial_started_at: row.trial_started_at,
  trial_ends_at: row.trial_ends_at,
  trial_used: row.trial_used,
  current_period_start: row.current_period_start,
  current_period_end: row.current_period_end,
  grace_until: row.grace_until,
  cancel_at_period_end: row.cancel_at_period_end,
  device: device
    ? {
        alias: device.alias || null,
        parent_email: device.sys_user?.email || null,
        parent_name: device.sys_user?.nickname || null,
        parent_phone: device.sys_user?.phone || null,
      }
    : null,
});

/**
 * Search subscriptions by MAC fragment, parent (email / name / phone), or the
 * RevenueCat original-transaction id (SUB-18 refund lookup — that id lives on
 * device_subscriptions, so it's matched separately and the MAC folded in).
 * Returns devices even when they have no subscription row yet.
 */
const searchSubscriptions = async (q, { limit = 25 } = {}) => {
  const term = (q || '').trim();
  if (!term) return [];

  const [devices, rcSubs] = await Promise.all([
    prisma.ai_device.findMany({
      where: {
        OR: [
          { mac_address: { contains: term, mode: 'insensitive' } },
          { sys_user: { email: { contains: term, mode: 'insensitive' } } },
          { sys_user: { nickname: { contains: term, mode: 'insensitive' } } },
          { sys_user: { phone: { contains: term } } },
        ],
      },
      select: {
        mac_address: true,
        alias: true,
        sys_user: { select: { email: true, nickname: true, phone: true } },
      },
      take: limit,
    }),
    prisma.device_subscriptions.findMany({
      where: { rc_original_transaction_id: { contains: term, mode: 'insensitive' } },
      select: { mac_address: true },
      take: limit,
    }),
  ]);

  // Fold in devices matched only by their RC txn id. The device row may be gone
  // (unbound), so keep the MAC even when ai_device has nothing for it.
  const known = new Set(devices.map((d) => d.mac_address));
  const extraMacs = rcSubs.map((s) => s.mac_address).filter((m) => !known.has(m));
  if (extraMacs.length) {
    const rcDevices = await prisma.ai_device.findMany({
      where: { mac_address: { in: extraMacs } },
      select: {
        mac_address: true,
        alias: true,
        sys_user: { select: { email: true, nickname: true, phone: true } },
      },
    });
    const byMac = new Map(rcDevices.map((d) => [d.mac_address, d]));
    for (const m of extraMacs) devices.push(byMac.get(m) || { mac_address: m, alias: null, sys_user: null });
  }
  if (devices.length === 0) return [];

  const macs = devices.map((d) => d.mac_address);
  const subs = await prisma.device_subscriptions.findMany({
    where: { mac_address: { in: macs } },
    include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
  });
  const byMac = new Map(subs.map((s) => [s.mac_address, s]));

  return devices.map((d) => {
    const sub = byMac.get(d.mac_address);
    return sub
      ? toApi(sub, d)
      : { mac_address: d.mac_address, status: 'none', plan: null, device: toApi({ mac_address: d.mac_address }, d).device };
  });
};

/** Statuses the admin page can browse by. */
const LISTABLE_STATUSES = ['trial', 'active', 'grace', 'lapsed', 'cancelled'];

/** List subscriptions in a given status, most recently updated first. */
const listByStatus = async (status, { limit = 100 } = {}) => {
  if (!LISTABLE_STATUSES.includes(status)) {
    throw Object.assign(new Error(`status must be one of: ${LISTABLE_STATUSES.join(', ')}`), { statusCode: 400 });
  }

  const subs = await prisma.device_subscriptions.findMany({
    where: { status },
    include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
    orderBy: { updated_at: 'desc' },
    take: limit,
  });
  if (subs.length === 0) return [];

  const devices = await prisma.ai_device.findMany({
    where: { mac_address: { in: subs.map((s) => s.mac_address) } },
    select: {
      mac_address: true,
      alias: true,
      sys_user: { select: { email: true, nickname: true, phone: true } },
    },
  });
  const byMac = new Map(devices.map((d) => [d.mac_address, d]));

  return subs.map((s) => toApi(s, byMac.get(s.mac_address) || null));
};

/**
 * Comp/extend: push the row's governing end date forward by `days`.
 * Trial rows extend trial_ends_at; paid rows extend current_period_end.
 */
const compExtend = async (macAddress, days, adminUser, reason) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw Object.assign(new Error('Invalid MAC'), { statusCode: 400 });
  const nDays = parseInt(days, 10);
  if (!Number.isFinite(nDays) || nDays === 0) throw Object.assign(new Error('days must be a non-zero integer'), { statusCode: 400 });

  return prisma.$transaction(async (tx) => {
    const row = await tx.device_subscriptions.findUnique({
      where: { mac_address: normalizedMac },
      include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
    });
    if (!row) throw Object.assign(new Error('No subscription row for that MAC'), { statusCode: 404 });

    const field = row.status === 'trial' ? 'trial_ends_at' : 'current_period_end';
    const base = row[field];
    if (!base) throw Object.assign(new Error(`Row has no ${field} to extend`), { statusCode: 400 });

    const before = auditState(row);
    const updated = await tx.device_subscriptions.update({
      where: { mac_address: normalizedMac },
      data: { [field]: new Date(base.getTime() + nDays * DAY_MS), updated_at: new Date() },
      include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
    });

    await tx.subscription_admin_audit.create({
      data: {
        admin_user: adminUser,
        action: `comp_extend:${nDays}d`,
        mac_address: normalizedMac,
        reason: reason || null,
        before_state: before,
        after_state: auditState(updated),
      },
    });
    logger.info(`[SUB-ADMIN] ${adminUser} extended ${normalizedMac} ${field} by ${nDays}d`);
    return toApi(updated, null);
  });
};

/**
 * Trial re-grant: a fresh trial window on an existing row. Deliberately does
 * NOT clear trial_used — the automatic once-per-MAC-ever rule stays intact;
 * this is a manual, audited exception.
 */
const regrantTrial = async (macAddress, days, adminUser, reason) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw Object.assign(new Error('Invalid MAC'), { statusCode: 400 });
  const nDays = parseInt(days, 10) || 30;
  if (nDays < 1) throw Object.assign(new Error('days must be positive'), { statusCode: 400 });

  return prisma.$transaction(async (tx) => {
    const row = await tx.device_subscriptions.findUnique({
      where: { mac_address: normalizedMac },
      include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
    });
    if (!row) throw Object.assign(new Error('No subscription row for that MAC'), { statusCode: 404 });

    // Trials meter at Family limits; repoint plan_id if the row lost it.
    let planId = row.plan_id;
    if (planId == null) {
      const plan = await tx.subscription_plans.findUnique({ where: { tier: TRIAL_TIER }, select: { id: true } });
      planId = plan?.id ?? null;
    }

    const now = new Date();
    const before = auditState(row);
    const updated = await tx.device_subscriptions.update({
      where: { mac_address: normalizedMac },
      data: {
        status: 'trial',
        plan_id: planId,
        trial_started_at: now,
        trial_ends_at: new Date(now.getTime() + nDays * DAY_MS),
        trial_used: true, // stays true — no automatic future trials
        grace_until: null,
        cancel_at_period_end: false,
        updated_at: now,
      },
      include: { subscription_plans: { select: { tier: true, name: true, price_inr: true } } },
    });

    await tx.subscription_admin_audit.create({
      data: {
        admin_user: adminUser,
        action: `trial_regrant:${nDays}d`,
        mac_address: normalizedMac,
        reason: reason || null,
        before_state: before,
        after_state: auditState(updated),
      },
    });
    logger.info(`[SUB-ADMIN] ${adminUser} re-granted ${nDays}d trial to ${normalizedMac}`);
    return toApi(updated, null);
  });
};

/**
 * Full support view for one device (SUB-18 detail drawer). The status, plan,
 * metered usage and gate reason are pulled straight from subscription.service
 * (getSubscriptionSummary + a dry-run verdict) so the drawer's numbers can
 * never drift from what actually gates the device. The raw billing/store
 * fields, the webhook event ledger, and this MAC's override history are added
 * on top.
 *
 * Unknown MAC (no device *and* no subscription row) → 404. A bound device with
 * no subscription row → 200 with an empty (status 'none') shell.
 */
const getDetail = async (macAddress, { now = new Date() } = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) throw Object.assign(new Error('Invalid MAC'), { statusCode: 400 });

  // Shared helpers first: both repair a lazily-expired row, so the raw read
  // below reflects the post-repair state (e.g. grace_until cleared).
  const summary = await subscriptionService.getSubscriptionSummary(normalizedMac, { now });
  const verdict = await subscriptionService.getSessionVerdict(normalizedMac, {
    flow: 'voice',
    now,
    dryRun: true,
  });

  const [row, device] = await Promise.all([
    prisma.device_subscriptions.findUnique({
      where: { mac_address: normalizedMac },
      select: {
        trial_started_at: true,
        trial_ends_at: true,
        trial_used: true,
        current_period_start: true,
        current_period_end: true,
        grace_until: true,
        cancel_at_period_end: true,
        billing_cycle: true,
        store: true,
        rc_original_transaction_id: true,
      },
    }),
    prisma.ai_device.findFirst({
      where: { mac_address: normalizedMac },
      select: { alias: true, sys_user: { select: { email: true, nickname: true, phone: true } } },
    }),
  ]);

  if (!row && !device) throw Object.assign(new Error('Unknown MAC'), { statusCode: 404 });

  const [events, audit] = await Promise.all([
    prisma.subscription_events.findMany({
      where: { mac_address: normalizedMac },
      // id is the deterministic tiebreaker: created_at is nullable, so it alone
      // can't guarantee "newest first".
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, event_type: true, processed_at: true, created_at: true },
    }),
    getAuditLog({ mac: normalizedMac, limit: 50 }),
  ]);

  return {
    mac_address: normalizedMac,
    enforcement_enabled: subscriptionService.isEnforcementEnabled(),
    status: summary ? summary.status : 'none',
    gate: { allowed: verdict.allowed, reason: verdict.reason },
    plan: summary ? summary.plan : null,
    period: row ? { start: row.current_period_start, end: row.current_period_end } : null,
    trial: row
      ? { started_at: row.trial_started_at, ends_at: row.trial_ends_at, used: row.trial_used }
      : null,
    grace_until: row ? row.grace_until : null,
    cancel_at_period_end: row ? row.cancel_at_period_end : false,
    billing_cycle: row ? row.billing_cycle : null,
    store: row ? { store: row.store, rc_original_transaction_id: row.rc_original_transaction_id } : null,
    usage: summary ? summary.usage : null,
    device: device
      ? {
          alias: device.alias || null,
          parent_email: device.sys_user?.email || null,
          parent_name: device.sys_user?.nickname || null,
          parent_phone: device.sys_user?.phone || null,
        }
      : null,
    events: events.map((e) => ({
      id: Number(e.id),
      event_type: e.event_type,
      processed_at: e.processed_at,
      created_at: e.created_at,
    })),
    audit,
  };
};

/** Recent audit rows, optionally filtered to one MAC. */
const getAuditLog = async ({ mac, limit = 50 } = {}) => {
  const normalizedMac = mac ? normalizeMacAddress(mac) : null;
  const rows = await prisma.subscription_admin_audit.findMany({
    where: normalizedMac ? { mac_address: normalizedMac } : undefined,
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: Number(r.id),
    admin_user: r.admin_user,
    action: r.action,
    mac_address: r.mac_address,
    reason: r.reason,
    before_state: r.before_state,
    after_state: r.after_state,
    created_at: r.created_at,
  }));
};

/**
 * Dashboard metrics: conversion funnel, churn, MRR, gate hits by reason.
 * Live queries — no materialised views; call volume is one admin page.
 */
const getMetrics = async ({ now = new Date() } = {}) => {
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [bound, statusCounts, activeWithPlan, churnEvents, gateHits] = await Promise.all([
    prisma.ai_device.count({ where: { user_id: { not: null } } }),
    prisma.device_subscriptions.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.device_subscriptions.findMany({
      where: { status: 'active' },
      select: { subscription_plans: { select: { price_inr: true } } },
    }),
    prisma.subscription_events.groupBy({
      by: ['event_type'],
      where: { event_type: { in: ['EXPIRATION', 'CANCELLATION'] }, created_at: { gte: since30d } },
      _count: { _all: true },
    }),
    prisma.subscription_gate_hits.groupBy({
      by: ['reason'],
      where: { created_at: { gte: since30d } },
      _count: { _all: true },
    }),
  ]);

  const trialsStarted = await prisma.device_subscriptions.count({ where: { trial_used: true } });

  const status = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
  const mrrInr = activeWithPlan.reduce((sum, r) => sum + (r.subscription_plans?.price_inr || 0), 0);

  return {
    funnel: {
      devices_bound: bound,
      trials_started: trialsStarted,
      trial_now: status.trial || 0,
      paid_now: status.active || 0,
      grace_now: status.grace || 0,
      lapsed_now: status.lapsed || 0,
      cancelled_now: status.cancelled || 0,
    },
    churn_30d: Object.fromEntries(churnEvents.map((e) => [e.event_type, e._count._all])),
    mrr_inr: mrrInr,
    gate_hits_30d: Object.fromEntries(gateHits.map((g) => [g.reason, g._count._all])),
  };
};

module.exports = { searchSubscriptions, listByStatus, getDetail, compExtend, regrantTrial, getAuditLog, getMetrics };
