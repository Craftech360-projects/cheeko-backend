/**
 * The admin console must read progress the way the toy does.
 *
 * allDeviceProgress grouped answers by device_mac alone while the play path had
 * moved to the child, so a child who changed toys showed as never having played
 * on the console while their toy resumed them at the right level, and a child
 * with no toy at all had no row.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findMany: jest.fn() },
    kid_profile: { findMany: jest.fn() },
    quiz_question: { findMany: jest.fn() },
    quiz_question_answer: { findMany: jest.fn() },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { prisma } = require('../../src/config/database');
const quizService = require('../../src/services/quiz.service');

const OLD_MAC = 'AA:AA:AA:AA:AA:AA';
const NEW_MAC = 'BB:BB:BB:BB:BB:BB';
const KID = { id: 15n, name: 'Kishore', birth_date: null, language: 'en' };

const BANK = [
  { id: 1n, age_band: '6-8', level: 1, language: 'en' },
  { id: 2n, age_band: '6-8', level: 1, language: 'en' },
];

const answer = (over) => ({
  device_mac: OLD_MAC,
  kid_id: KID.id,
  question_id: 1n,
  result: 'correct',
  answered_at: new Date('2026-08-01T10:00:00Z'),
  ...over,
});

const byMac = (rows) => new Map(rows.map((r) => [r.device_mac, r]));

beforeEach(() => {
  jest.clearAllMocks();
  prisma.quiz_question.findMany.mockResolvedValue(BANK);
  prisma.kid_profile.findMany.mockResolvedValue([KID]);
});

it('follows the child onto a new toy instead of restarting at the old MAC', async () => {
  prisma.ai_device.findMany.mockResolvedValue([{ mac_address: NEW_MAC, kid_id: KID.id }]);
  // Written on the toy the child no longer has.
  prisma.quiz_question_answer.findMany.mockResolvedValue([answer({ device_mac: OLD_MAC })]);

  const rows = await quizService.allDeviceProgress();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ device_mac: NEW_MAC, kid_name: 'Kishore', correct: 1 });
});

it('gives a child with answers but no toy a row of their own', async () => {
  prisma.ai_device.findMany.mockResolvedValue([]);
  prisma.quiz_question_answer.findMany.mockResolvedValue([answer({})]);

  const rows = await quizService.allDeviceProgress();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ device_mac: '', kid_name: 'Kishore', correct: 1 });
});

it('does not count a child twice when they are paired', async () => {
  prisma.ai_device.findMany.mockResolvedValue([{ mac_address: OLD_MAC, kid_id: KID.id }]);
  prisma.quiz_question_answer.findMany.mockResolvedValue([answer({})]);

  const rows = await quizService.allDeviceProgress();

  expect(rows).toHaveLength(1);
});

it('keeps an unpaired toy on its own childless rows, not the previous child\'s', async () => {
  prisma.ai_device.findMany.mockResolvedValue([{ mac_address: OLD_MAC, kid_id: null }]);
  prisma.kid_profile.findMany.mockResolvedValue([KID]);
  prisma.quiz_question_answer.findMany.mockResolvedValue([
    answer({ device_mac: OLD_MAC, kid_id: KID.id }),
    answer({ device_mac: OLD_MAC, kid_id: null, question_id: 2n }),
  ]);

  const rows = await quizService.allDeviceProgress();
  const row = byMac(rows).get(OLD_MAC);

  // One childless row, not both.
  expect(row).toMatchObject({ kid_name: null, correct: 1 });
  // The child still gets their own row, on no toy.
  expect(byMac(rows).get('')).toMatchObject({ kid_name: 'Kishore', correct: 1 });
});
