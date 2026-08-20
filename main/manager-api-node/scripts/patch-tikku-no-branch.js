// Stop Tikku announcing the ladder level to the child.
//
// The level still drives which words are served and still travels in the MEMO —
// it is the mechanism, not a thing to say out loud. Announcing "Branch One
// contestant!" every session tells a child who has not climbed yet that they
// are at the bottom, which is the opposite of what the ladder is for.
//
// Guarded like every prompt edit: the UPDATE carries the before-image, so a row
// changed under us updates zero rows instead of being clobbered.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const CODE = 'spell_master';

const SYS_FROM = '- THREE first-try correct words in a row at the current level -> LEVEL UP, announced with full ceremony and a long drumroll: "[excited] Trrrrrrr... TIK-TIK-TIK! Branch THREE unlocked! The words grow bigger - and so do you!"';
const SYS_TO = '- THREE first-try correct words in a row at the current level -> LEVEL UP, announced with full ceremony and a long drumroll: "[excited] Trrrrrrr... TIK-TIK-TIK! The words grow bigger - and so do you!" NEVER say a branch or level number aloud, here or anywhere: the ladder is how you pick words, not a rank to read out. Celebrate the climb, never the rung.';

const GREET_FROM = 'Greet as Tikku the woodpecker, host of the Spell Bee Championship, in at most two short ceremonial sentences: tak-tak welcome with the child\'s name, announce their CURRENT LEVEL from the MEMO like a rank ("Branch four contestant!"), and go straight into the first word - announced clearly, used in one short sentence, then "Spell it!" Never ask "are you ready" and never offer a menu.';
const GREET_TO = 'Greet as Tikku the woodpecker, host of the Spell Bee Championship, in at most two short ceremonial sentences: tak-tak welcome with the child\'s name, then go straight into the first word - announced clearly, used in one short sentence, then "Spell it!" Never say a branch or level number aloud; the level chooses the words and is never a rank you read out. Never ask "are you ready" and never offer a menu.';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const row = (await c.query('SELECT system_prompt, greeting_prompt FROM ai_agent_template WHERE agent_code = $1', [CODE])).rows[0];
  if (!row) { console.error('no row for', CODE); process.exit(1); }

  const sysHits = row.system_prompt.split(SYS_FROM).length - 1;
  const greetHits = row.greeting_prompt.split(GREET_FROM).length - 1;
  console.log('system_prompt  match:', sysHits);
  console.log('greeting_prompt match:', greetHits);
  if (sysHits !== 1 || greetHits !== 1) {
    console.error('expected exactly one match each — the prompt changed; re-read before patching');
    process.exit(1);
  }

  const newSys = row.system_prompt.split(SYS_FROM).join(SYS_TO);
  const newGreet = row.greeting_prompt.split(GREET_FROM).join(GREET_TO);
  // Any other place a number could be spoken.
  const leftovers = (newSys + '\n' + newGreet).split('\n')
    .filter((l) => /branch\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d)/i.test(l));
  if (leftovers.length) {
    console.log('\nremaining lines naming a branch number:');
    leftovers.forEach((l) => console.log('  ' + l.slice(0, 150)));
  }

  if (!APPLY) { console.log('\nDRY RUN — rerun with --apply'); await c.end(); return; }
  const res = await c.query(
    `UPDATE ai_agent_template SET system_prompt = $1, greeting_prompt = $2, updated_at = now()
     WHERE agent_code = $3 AND system_prompt = $4 AND greeting_prompt = $5`,
    [newSys, newGreet, CODE, row.system_prompt, row.greeting_prompt]
  );
  console.log(res.rowCount === 1 ? 'UPDATED' : 'GUARD FAILED — row changed under us');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
