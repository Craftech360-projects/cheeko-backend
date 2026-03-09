const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true, override: false });
const { scanAll } = require('../scanners');
const results = scanAll();

const cats = {};
results.routes.forEach(r => {
  if (!cats[r.category]) cats[r.category] = { routes: 0, auths: new Set() };
  cats[r.category].routes++;
  cats[r.category].auths.add(r.auth);
});

console.log('');
console.log('#'.padEnd(5) + 'Category'.padEnd(22) + 'Routes'.padEnd(10) + 'Auth Types');
console.log('-'.repeat(75));
let i = 1;
let total = 0;
const sorted = Object.entries(cats).sort((a, b) => b[1].routes - a[1].routes);
sorted.forEach(([name, info]) => {
  console.log(String(i++).padEnd(5) + name.padEnd(22) + String(info.routes).padEnd(10) + [...info.auths].join(', '));
  total += info.routes;
});
console.log('-'.repeat(75));
console.log(''.padEnd(5) + 'TOTAL'.padEnd(22) + total);
console.log('');
console.log('Service coverage:');
console.log('  manager-api-node:  ' + sorted.length + ' categories, ' + total + ' routes [COMPLETE]');
console.log('  mqtt-gateway:      not yet scanned');
console.log('  livekit-server:    not yet scanned');
console.log('');
