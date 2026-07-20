/**
 * Create a Razorpay plan object for every active subscription_plans row that
 * doesn't have one yet, and write the id back to razorpay_plan_id (SUB-6).
 *
 * Run once per Razorpay mode (test keys, then live keys):
 *   node scripts/razorpay-seed-plans.js
 *
 * Idempotent per run: rows with razorpay_plan_id set are skipped. Switching
 * key modes needs the column cleared first (test plan ids are invalid live).
 */

require('dotenv').config();
const axios = require('axios');
const { prisma } = require('../src/config/database');

const main = async () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
  }
  const auth = {
    username: process.env.RAZORPAY_KEY_ID,
    password: process.env.RAZORPAY_KEY_SECRET,
  };

  const plans = await prisma.subscription_plans.findMany({
    where: { is_active: true, razorpay_plan_id: null },
  });
  if (!plans.length) {
    console.log('All active plans already have a razorpay_plan_id — nothing to do.');
    return;
  }

  for (const plan of plans) {
    const { data } = await axios.post(
      'https://api.razorpay.com/v1/plans',
      {
        period: 'monthly',
        interval: 1,
        item: {
          name: `Cheeko ${plan.name}`,
          amount: plan.price_inr * 100, // paise
          currency: 'INR',
        },
        notes: { tier: plan.tier },
      },
      { auth, timeout: 10000 }
    );
    await prisma.subscription_plans.update({
      where: { id: plan.id },
      data: { razorpay_plan_id: data.id, updated_at: new Date() },
    });
    console.log(`${plan.tier}: ${data.id}`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.response?.data || err.message);
    process.exit(1);
  });
