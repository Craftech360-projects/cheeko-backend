const r = require('../reports/runs/2026-03-04T12-15-58_dev.json');
const failed = r.tests.filter(t => t.status === 'failed');

// Show first 3 failures fully
console.log('=== First 3 failures (full structure) ===');
for (let i = 0; i < Math.min(3, failed.length); i++) {
  const t = failed[i];
  console.log(`\n--- Failure ${i + 1} ---`);
  console.log('Keys:', Object.keys(t));
  console.log('title:', t.title);
  console.log('fullName:', t.fullName);
  console.log('ancestorTitles:', t.ancestorTitles);
  const msg = (t.failureMessages && t.failureMessages[0]) || '';
  // Just first 300 chars of error
  console.log('failureMsg (300 chars):', msg.substring(0, 300));
}

// Count by ancestor
const cats = {};
failed.forEach(t => {
  const c = (t.ancestorTitles && t.ancestorTitles[0]) || 'none';
  cats[c] = (cats[c] || 0) + 1;
});
console.log('\n=== Failures by ancestor title ===');
Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${v} | ${k.substring(0, 60)}`);
});
