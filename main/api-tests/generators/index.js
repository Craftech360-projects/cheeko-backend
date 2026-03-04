/**
 * Test Generator Orchestrator
 *
 * Takes scanner output, groups routes by category,
 * and generates .test.js files in the suites/ directory.
 */

const fs = require('fs');
const path = require('path');
const httpGenerator = require('./http-test-generator');

/**
 * Generate all test files from discovered routes
 *
 * @param {Array} routes - All discovered routes from scanners
 * @param {string} envName - 'dev' or 'prod'
 * @returns {Object} { filesGenerated, totalTests }
 */
function generateAll(routes, envName) {
  const suitesDir = path.resolve(__dirname, '..', 'suites');

  // Group routes by service and category
  const groups = {};
  for (const route of routes) {
    const service = route.service || 'manager-api';
    const category = route.category || 'unknown';
    const key = `${service}/${category}`;

    if (!groups[key]) {
      groups[key] = { service, category, routes: [] };
    }
    groups[key].routes.push(route);
  }

  let filesGenerated = 0;
  let totalTests = 0;

  for (const [key, group] of Object.entries(groups)) {
    const serviceDir = path.join(suitesDir, group.service);
    fs.mkdirSync(serviceDir, { recursive: true });

    // Generate test file
    const content = httpGenerator.generateTestFile(group.category, group.routes, envName);

    // Count tests (rough: count 'test(' occurrences)
    const testCount = (content.match(/test\(/g) || []).length;
    totalTests += testCount;

    // Write file
    const fileName = `${group.category}.test.js`;
    const filePath = path.join(serviceDir, fileName);
    fs.writeFileSync(filePath, content);
    filesGenerated++;

    console.log(`  Generated: suites/${group.service}/${fileName} (${group.routes.length} routes, ${testCount} tests)`);
  }

  return { filesGenerated, totalTests };
}

module.exports = { generateAll };
