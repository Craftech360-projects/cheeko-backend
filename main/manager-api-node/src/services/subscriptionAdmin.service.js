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
 * Search subscriptions by MAC fragment or parent (email / name / phone).
 * Returns devices even when they have no subscription row yet.
 */
const searchSubscriptions = async (q, { limit = 25 } = {}) => {
  const term = (q || '').trim();
  if (!term) return [];

  const devices = await prisma.ai_device.findMany({
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
  });
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

module.exports = { searchSubscriptions, compExtend, regrantTrial, getAuditLog, getMetrics };
