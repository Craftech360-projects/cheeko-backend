/**
 * Module Import Verification Script
 * 
 * Verifies all 19 modules can be loaded without errors
 */

console.log('🔍 [VERIFY] Starting module import verification...\n');

const modules = [
    // Phase 1: Constants & Utilities
    { name: 'constants/audio', path: './constants/audio' },
    { name: 'utils/debug-logger', path: './utils/debug-logger' },
    { name: 'utils/config-manager', path: './utils/config-manager' },

    // Phase 2: Core Layer
    { name: 'core/media-api-client', path: './core/media-api-client' },
    { name: 'core/opus-initializer', path: './core/opus-initializer' },
    { name: 'core/streaming-crypto', path: './core/streaming-crypto' },
    { name: 'core/performance-monitor', path: './core/performance-monitor' },
    { name: 'core/worker-pool-manager', path: './core/worker-pool-manager' },

    // Phase 3: LiveKit Layer
    { name: 'livekit/audio-processor', path: './livekit/audio-processor' },
    { name: 'livekit/mcp-handler', path: './livekit/mcp-handler' },
    { name: 'livekit/message-handlers', path: './livekit/message-handlers' },
    { name: 'livekit/livekit-bridge', path: './livekit/livekit-bridge' },

    // Phase 4: MQTT Layer
    { name: 'mqtt/message-parser', path: './mqtt/message-parser' },
    { name: 'mqtt/virtual-connection', path: './mqtt/virtual-connection' },

    // Phase 5: Gateway Layer
    { name: 'gateway/udp-server', path: './gateway/udp-server' },
    { name: 'gateway/emqx-broker', path: './gateway/emqx-broker' },
    { name: 'gateway/device-handlers', path: './gateway/device-handlers' },
    { name: 'gateway/playback-control', path: './gateway/playback-control' },
    { name: 'gateway/mqtt-gateway', path: './gateway/mqtt-gateway' },
];

let passed = 0;
let failed = 0;
const errors = [];

for (const module of modules) {
    try {
        require(module.path);
        console.log(`✅ [${module.name}]`);
        passed++;
    } catch (error) {
        console.log(`❌ [${module.name}] - ${error.message}`);
        errors.push({ module: module.name, error: error.message });
        failed++;
    }
}

console.log(`\n📊 [RESULTS]`);
console.log(`   ✅ Passed: ${passed}/${modules.length}`);
console.log(`   ❌ Failed: ${failed}/${modules.length}`);

if (failed > 0) {
    console.log(`\n❌ [ERRORS]`);
    errors.forEach(({ module, error }) => {
        console.log(`   - ${module}: ${error}`);
    });
    process.exit(1);
} else {
    console.log(`\n🎉 [SUCCESS] All modules loaded successfully!`);
    process.exit(0);
}
