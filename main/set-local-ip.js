#!/usr/bin/env node
// Replace this machine's LAN IP across the gateway config files.
// Usage:
//   node set-local-ip.js            # auto-detect LAN IPv4, apply
//   node set-local-ip.js 192.168.0.99   # force a specific IP
//   node set-local-ip.js --dry      # show what would change, write nothing
//   node set-local-ip.js --self-test
//
// "Old" IP = whatever PUBLIC_IP is currently set to in mqtt-gateway/.env.
// Only that value is swapped, so other hosts (broker/redis on another box) are untouched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

// The three dev services, in start order (api before gateway, which depends on it).
const SERVICES = [
  { title: 'manager-api', dir: 'manager-api-node', cmd: 'npm run dev' },
  { title: 'mqtt-gateway', dir: 'mqtt-gateway', cmd: 'node app.js' },
  { title: 'manager-web', dir: 'manager-web', cmd: 'npm run serve' },
];

// Ports the dev services need. Kill anything already holding them (stale crashes, etc).
const PORTS = [8001, 8002, 8884];

function freePorts(ports) {
  console.log('\nFreeing ports...');
  if (process.platform !== 'win32') {
    console.log('  (non-Windows) free them with: lsof -ti:<port> | xargs kill -9');
    return;
  }
  let out = '';
  try { out = execSync('netstat -ano', { encoding: 'utf8' }); }
  catch { console.log('  netstat unavailable — skipped'); return; }
  const lines = out.split('\n');
  for (const port of ports) {
    const re = new RegExp(`:${port}\\b`);
    const pids = new Set();
    for (const ln of lines) {
      if (!re.test(ln)) continue;
      const pid = ln.trim().split(/\s+/).pop();
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    if (!pids.size) { console.log(`  ${port}: free`); continue; }
    for (const pid of pids) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); console.log(`  ${port}: killed PID ${pid}`); }
      catch { console.log(`  ${port}: could not kill PID ${pid} (try as admin)`); }
    }
  }
}

function startServices(root) {
  console.log('\nStarting services...');
  if (process.platform !== 'win32') {
    for (const s of SERVICES) console.log(`  (cd ${path.join(root, s.dir)} && ${s.cmd})`);
    return;
  }
  for (const s of SERVICES) {
    const dir = path.join(root, s.dir);
    // each service in its own titled terminal (start /D sets the dir, cmd /k keeps it open)
    spawn(`start "${s.title}" /D "${dir}" cmd /k "${s.cmd}"`,
      { shell: true, detached: true, stdio: 'ignore' }).unref();
    console.log(`  ${s.title}: ${s.cmd}`);
  }
}

function dockerRunning() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Block until the user presses Enter; returns the trimmed line typed (e.g. "skip").
function waitForEnter(promptText) {
  process.stdout.write(promptText);
  const buf = Buffer.alloc(256);
  const n = fs.readSync(0, buf, 0, buf.length, null); // fd 0 = stdin
  return buf.toString('utf8', 0, n).trim().toLowerCase();
}

function ensureDocker() {
  console.log('\nChecking Docker...');
  if (dockerRunning()) {
    console.log('Docker is already running.');
    return true;
  }
  console.log('Docker is NOT running. Please start Docker Desktop and wait for the whale icon to go steady.');
  while (true) {
    const ans = waitForEnter('When ready, press Enter to re-check (or type "skip" to continue anyway): ');
    if (ans === 'skip') { console.log('Skipped — continuing without Docker.'); return false; }
    if (dockerRunning()) { console.log('Docker is running ✓'); return true; }
    console.log('Still not ready. Give it a bit more time, then try again.');
  }
}

// Containers we need up. `match` is a substring of the container name (handles
// emqx-broker / livekit-server regardless of exact local naming).
const NEEDED = [
  { label: 'EMQX', match: 'emqx' },
  { label: 'LiveKit', match: 'livekit' },
  { label: 'Postgres', match: 'cheeko-postgres' },
];

// Point the app's mqtt.broker system param at this machine's IP (local DB).
function updateMqttBroker(newIp) {
  const pg = containerNames(false).find((n) => n.toLowerCase().includes('cheeko-postgres'));
  if (!pg) { console.log('\nsys_params: skipped (cheeko-postgres not running).'); return; }
  console.log(`\nUpdating sys_params mqtt.broker -> ${newIp} ...`);
  const sql = `UPDATE sys_params SET param_value='${newIp}' WHERE param_code='mqtt.broker';`;
  try {
    const out = execSync(`docker exec ${pg} psql -U postgres -d postgres -tc "${sql}"`, { encoding: 'utf8' });
    console.log(`  ${out.trim()}`); // "UPDATE 1" on success, "UPDATE 0" if the row is missing
  } catch (e) {
    console.log(`  failed: ${(e.stderr || e.message || '').toString().trim()}`);
  }
}

function containerNames(allFlag) {
  // returns array of container names (running, or all if allFlag)
  const out = execSync(`docker ps ${allFlag ? '-a ' : ''}--format "{{.Names}}"`, { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function ensureContainers() {
  console.log('\nChecking containers...');
  const running = containerNames(false);
  const all = containerNames(true);
  for (const { label, match } of NEEDED) {
    const live = running.find((n) => n.toLowerCase().includes(match));
    if (live) { console.log(`${label}: running ✓ (${live})`); continue; }

    const stopped = all.find((n) => n.toLowerCase().includes(match));
    if (stopped) {
      process.stdout.write(`${label}: starting ${stopped}... `);
      try {
        execSync(`docker start ${stopped}`, { stdio: 'ignore' });
        console.log('started ✓');
      } catch {
        console.log(`failed — start it manually: docker start ${stopped}`);
      }
    } else {
      console.log(`${label}: no container found — create it first (e.g. docker compose up -d).`);
    }
  }
}

// Files that carry this machine's IP. Add lines here if more appear.
const TARGETS = [
  'mqtt-gateway/.env',
  'mqtt-gateway/config/mqtt.json',
];

const MARKER_FILE = 'mqtt-gateway/.env'; // file holding PUBLIC_IP=<old ip>

function readOldIp(root) {
  const env = fs.readFileSync(path.join(root, MARKER_FILE), 'utf8');
  const m = env.match(/^\s*PUBLIC_IP\s*=\s*([\d.]+)/m);
  if (!m) throw new Error(`PUBLIC_IP not found in ${MARKER_FILE}`);
  return m[1];
}

// Pick a LAN IPv4. Prefer one on the same /24 as the old IP (beats VM/loopback adapters).
// ponytail: first-private-match heuristic; pass the IP explicitly if you have many NICs.
function detectIp(oldIp) {
  const candidates = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
    }
  }
  const isPrivate = (ip) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const oldNet = oldIp.split('.').slice(0, 3).join('.');
  return (
    candidates.find((ip) => ip.startsWith(oldNet + '.')) ||
    candidates.find(isPrivate) ||
    candidates[0]
  );
}

function apply(root, oldIp, newIp, dry) {
  let total = 0;
  for (const rel of TARGETS) {
    const file = path.join(root, rel);
    const before = fs.readFileSync(file, 'utf8');
    const hits = before.split(oldIp).length - 1;
    if (!hits) continue;
    total += hits;
    console.log(`  ${rel}: ${hits} occurrence(s)`);
    if (!dry) fs.writeFileSync(file, before.split(oldIp).join(newIp));
  }
  return total;
}

function selfTest() {
  // detectIp prefers same-subnet candidate
  const pick = (cands, old) => {
    const oldNet = old.split('.').slice(0, 3).join('.');
    return cands.find((ip) => ip.startsWith(oldNet + '.')) || cands[0];
  };
  console.assert(pick(['10.0.0.5', '192.168.0.42'], '192.168.0.68') === '192.168.0.42', 'subnet pick');
  // replace is exact + counts right
  const s = 'a=192.168.0.68\nb=192.168.0.68:8003';
  console.assert(s.split('192.168.0.68').length - 1 === 2, 'count');
  console.assert(s.split('192.168.0.68').join('1.2.3.4') === 'a=1.2.3.4\nb=1.2.3.4:8003', 'replace');
  console.log('self-test OK');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const dry = args.includes('--dry');
  const forced = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));

  const root = __dirname;
  const oldIp = readOldIp(root);
  const newIp = forced || detectIp(oldIp);
  if (!newIp) throw new Error('No LAN IPv4 detected. Pass one explicitly: node set-local-ip.js <ip>');

  console.log(`Old IP : ${oldIp}`);
  console.log(`New IP : ${newIp}${forced ? ' (forced)' : ' (auto-detected)'}`);
  if (oldIp === newIp) {
    console.log('IP already up to date, nothing to change.');
  } else {
    console.log(dry ? 'Would change:' : 'Changing:');
    const n = apply(root, oldIp, newIp, dry);
    console.log(dry ? `\nDry run: ${n} change(s) pending.` : `\nDone: ${n} change(s) written.`);
  }

  if (!dry) {
    if (ensureDocker()) {
      ensureContainers();
      updateMqttBroker(newIp);
    }
    freePorts(PORTS);
    startServices(root);
  }
}

main();
