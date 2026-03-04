const r = require('../reports/runs/2026-03-04T12-15-58_dev.json');
const failed = r.tests.filter(t => t.status === 'failed');

const cats = {};
failed.forEach(t => {
  const c = (t.ancestorTitles && t.ancestorTitles[0]) || 'unknown';
  if (!cats[c]) cats[c] = { count: 0, errors: [] };
  cats[c].count++;
  if (cats[c].errors.length < 1) {
    const raw = t.failureMessages[0] || '';
    // Extract "received" value from Jest error
    const recMatch = raw.match(/Received:\s*(\d+)/);
    cats[c].errors.push(recMatch ? `got status ${recMatch[1]}` : raw.split('\n').slice(0, 3).join(' ').substring(0, 120));
  }
});

const sorted = Object.entries(cats).sort((a, b) => b[1].count - a[1].count);
console.log('\nFailed tests by category:');
console.log('-'.repeat(70));
sorted.forEach(([name, info]) => {
  const short = name.length > 45 ? name.slice(0, 42) + '...' : name;
  console.log(`  ${String(info.count).padStart(3)} failures | ${short}`);
  console.log(`              ${info.errors[0]}`);
});
console.log('-'.repeat(70));
console.log(`  Total: ${failed.length} failures across ${sorted.length} categories\n`);
