/**
 * Script to verify MySQL prompts vs what was seeded
 */

const mysql = require('mysql2/promise');

async function checkPrompts() {
  const connection = await mysql.createConnection({
    host: '64.227.170.31',
    port: 3306,
    user: 'cheeko_user',
    password: 'Cheeko@123',
    database: 'manager_api'
  });

  console.log('Connected to MySQL database\n');

  // Fetch all templates with full system_prompt
  const [rows] = await connection.execute('SELECT id, agent_name, LENGTH(system_prompt) as prompt_length, system_prompt FROM ai_agent_template ORDER BY sort');

  console.log('=== MySQL Templates and Prompts ===\n');

  for (const row of rows) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Template: ${row.agent_name} (${row.id})`);
    console.log(`Prompt Length: ${row.prompt_length} characters`);
    console.log(`${'='.repeat(60)}`);
    console.log('FULL PROMPT:');
    console.log(row.system_prompt);
    console.log(`${'='.repeat(60)}\n`);
  }

  await connection.end();
  console.log('\nDone!');
}

checkPrompts().catch(console.error);
