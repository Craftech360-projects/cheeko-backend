// Quick script to analyze failure patterns in latest report
var fs = require('fs');
var path = require('path');

var runsDir = path.resolve(__dirname, '..', 'reports', 'runs');
var files = fs.readdirSync(runsDir).filter(function(f){return f.endsWith('.json')}).sort();
var latest = files[files.length - 1];
console.log('Analyzing: ' + latest);

var data = JSON.parse(fs.readFileSync(path.join(runsDir, latest), 'utf8'));
var failed = data.tests.filter(function(t){return t.status === 'failed'});

if (failed.length === 0) {
  console.log('No failures!');
  process.exit(0);
}

// Load scanner to get auth types
var scan = require('../scanners/express-scanner');
var config = require('../test.config');
var routes = scan.scan(config.sources.managerApiRoutes);
var routeMap = {};
routes.forEach(function(r){routeMap[r.method + ' ' + r.fullPath] = r});

var f403 = [], f401 = [], fOther = [];
failed.forEach(function(t) {
  var msg = (t.failureMessages[0] || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (msg.indexOf('Expected: not 403') > -1) f403.push(t);
  else if (msg.indexOf('Expected: not 401') > -1) f401.push(t);
  else fOther.push(t);
});

function countByAuth(list) {
  var counts = {};
  list.forEach(function(t) {
    var key = t.method + ' ' + t.path;
    var route = routeMap[key];
    var auth = route ? route.auth : 'NOT_FOUND_IN_SCANNER';
    counts[auth] = (counts[auth] || 0) + 1;
  });
  return counts;
}

function countByPrefix(list) {
  var counts = {};
  list.forEach(function(t) {
    var parts = t.path.split('/');
    var prefix = parts.slice(0, 4).join('/');
    counts[prefix] = (counts[prefix] || 0) + 1;
  });
  return counts;
}

console.log('\n=== Got 403 Forbidden (' + f403.length + ' failures) ===');
console.log('By auth type:');
var ac = countByAuth(f403);
for (var k in ac) console.log('  ' + ac[k] + 'x auth=' + k);
console.log('By path:');
var pc = countByPrefix(f403);
for (var k in pc) console.log('  ' + pc[k] + 'x ' + k);

console.log('\n=== Got 401 Unauthorized (' + f401.length + ' failures) ===');
console.log('By auth type:');
var ac2 = countByAuth(f401);
for (var k in ac2) console.log('  ' + ac2[k] + 'x auth=' + k);
console.log('By path:');
var pc2 = countByPrefix(f401);
for (var k in pc2) console.log('  ' + pc2[k] + 'x ' + k);

if (fOther.length > 0) {
  console.log('\n=== Other failures (' + fOther.length + ') ===');
  fOther.forEach(function(t) {
    console.log('  ' + t.method + ' ' + t.path + ' | ' + t.name.replace(/\[.*?\]\s*/, ''));
  });
}
