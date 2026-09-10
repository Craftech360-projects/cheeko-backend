'use strict';
/**
 * Pack keys (K) and device secrets (S) for content encryption. Spec §6.
 *
 * Both live in Postgres encrypted under CONTENT_MASTER_KEY. When that env var
 * is unset the whole feature is off: every getter answers null and callers
 * fall back to today's plaintext behaviour.
 */
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const cc = require('../utils/contentCrypto');
const logger = require('../utils/logger');

const masterKey = () => {
  const hex = process.env.CONTENT_MASTER_KEY || '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
};

const isEnabled = () => masterKey() !== null;

const getPackKey = async (packCode) => {
  const mk = masterKey();
  if (!mk || !packCode) return null;
  const row = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCode },
    select: { id: true, content_key: true },
  });
  if (!row || !row.content_key) return null;
  return cc.decryptAtRest(Buffer.from(row.content_key), mk);
};

const getOrCreatePackKey = async (packCode) => {
  const mk = masterKey();
  if (!mk || !packCode) return null;
  const row = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCode },
    select: { id: true, content_key: true },
  });
  if (!row) return null;
  if (row.content_key) return cc.decryptAtRest(Buffer.from(row.content_key), mk);

  const key = crypto.randomBytes(16);
  await prisma.rfid_content_pack.updateMany({
    where: { id: row.id, content_key: null },   // never overwrite a key that landed first
    data: { content_key: cc.encryptAtRest(key, mk) },
  });
  // Re-read: if a concurrent upload won the race, use its key, not ours.
  const again = await prisma.rfid_content_pack.findFirst({ where: { id: row.id }, select: { content_key: true } });
  return cc.decryptAtRest(Buffer.from(again.content_key), mk);
};

const registerDeviceSecret = async (mac, secretHex) => {
  const mk = masterKey();
  if (!mk) return;
  if (!/^[0-9a-f]{64}$/i.test(secretHex || '')) throw new Error('content_secret must be 64 hex chars');
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  const res = await prisma.ai_device.updateMany({
    where: { mac_address: normalizedMac },
    data: { content_secret: cc.encryptAtRest(Buffer.from(secretHex, 'hex'), mk) },
  });
  if (res.count === 0) logger.warn(`[CONTENT-KEYS] content_secret for unknown device ${normalizedMac} ignored`);
};

const getDeviceSecret = async (mac) => {
  const mk = masterKey();
  const normalizedMac = normalizeMacAddress(mac);
  if (!mk || !normalizedMac) return null;
  const row = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { content_secret: true },
  });
  if (!row || !row.content_secret) return null;
  return cc.decryptAtRest(Buffer.from(row.content_secret), mk);
};

module.exports = {
  isEnabled,
  getPackKey,
  getOrCreatePackKey,
  registerDeviceSecret,
  getDeviceSecret,
};
