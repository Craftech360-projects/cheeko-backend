#!/usr/bin/env node

/**
 * Test Runner CLI
 *
 * Usage:
 *   node scripts/run-tests.js --env=dev --service=manager-api --category=health
 *   node scripts/run-tests.js --scan-only
 */

const { execSync } = require('child_process');
const path = require('path');
const { scanAll } = require('../scanners');
const { generateAll } = require('../generators');

// Parse CLI args
const args = {};
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    args[key] = val || true;
  } else {
    // Positional arg (for --category shorthand)
    if (!args.category) args.category = arg;
  }
});

const envName = args.env || 'dev';
const scanOnly = args['scan-only'] || false;

console.log('╔══════════════════════════════════════════╗');
console.log('║  CHEEKO AUTO-DISCOVERY TEST RUNNER        ║');
console.log(`║  Environment: ${envName.padEnd(27)}║`);
console.log('╚══════════════════════════════════════════╝');
console.log('');

// Step 1: Scan
console.log('Step 1: Scanning source code...');
const scanResult = scanAll({
  service: args.service,
  category: args.category
});

console.log(`  Found ${scanResult.summary.total} routes`);
console.log(`  By method: ${JSON.stringify(scanResult.summary.byMethod)}`);
console.log(`  By auth: ${JSON.stringify(scanResult.summary.byAuth)}`);
console.log('');

if (scanOnly) {
  console.log('\nDiscovered routes:');
  console.log('─'.repeat(80));
  scanResult.routes.forEach(r => {
    console.log(`  ${r.method.padEnd(7)} ${r.fullPath.padEnd(45)} auth=${r.auth}`);
  });
  console.log('─'.repeat(80));
  console.log(`Total: ${scanResult.routes.length} routes`);
  process.exit(0);
}

if (scanResult.routes.length === 0) {
  console.log('No routes found. Check your source paths in test.config.js');
  process.exit(1);
}

// Step 2: Generate tests
console.log('Step 2: Generating test files...');
const genResult = generateAll(scanResult.routes, envName);
console.log(`  Generated ${genResult.filesGenerated} test files with ${genResult.totalTests} test cases`);
console.log('');

// Step 3: Run Jest
console.log('Step 3: Running tests...');
console.log('');

const jestBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'jest');
const jestConfig = path.resolve(__dirname, '..', 'jest.config.js');

// Build Jest command — filter to specific service directory if --service is set
let jestCmd = `"${jestBin}" --config="${jestConfig}"`;
if (args.service) {
  // Map service names to suite directory names
  const serviceDir = args.service; // e.g. 'mqtt-gateway', 'manager-api', 'livekit-server'
  jestCmd += ` --testPathPattern="suites/${serviceDir}/"`;
}

try {
  execSync(
    jestCmd,
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_ENV: envName
      }
    }
  );
} catch (error) {
  // Jest exits with code 1 when tests fail — that's expected
  process.exit(error.status || 1);
}
