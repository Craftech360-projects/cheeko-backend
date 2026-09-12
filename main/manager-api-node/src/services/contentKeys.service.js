'use strict';
/**
 * Pack keys (K) for content encryption, version 1.
 *
 * K lives in Postgres encrypted under CONTENT_MASTER_KEY. When that env var is
 * unset the whole feature is off: every getter answers null and callers fall
 * back to today's plaintext behaviour.
 *
 * The wrap secret is shared by the whole fleet and must be byte-identical to
 * the firmware build constant CONFIG_CHEEKO_CONTENT_WRAP_SECRET_HEX. A
 * mismatch is silent — CTR has no integrity check — so pin it with the §6
 * test vectors, not by trying it on hardware.
 */
const crypto = require('crypto');
const { prisma } = require('../config/database');
const cc = require('../utils/contentCrypto');

const masterKey = () => {
  const hex = process.env.CONTENT_MASTER_KEY || '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
};

const getWrapSecret = () => {
  const hex = process.env.CONTENT_WRAP_SECRET || '';
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

module.exports = {
  isEnabled,
  getWrapSecret,
  getPackKey,
  getOrCreatePackKey,
};
