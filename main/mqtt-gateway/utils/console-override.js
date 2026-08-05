/**
 * Console Override for Loki Integration
 * This file must be loaded BEFORE any other modules that use console.log
 */

require('dotenv').config();

// Only override if Loki is enabled and console capture is requested
if (process.env.LOKI_HOST && process.env.CAPTURE_CONSOLE_LOGS === 'true') {
    // Store original console methods
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error
    };
    
    // Queue for console messages before logger is ready
    const messageQueue = [];
    let loggerReady = false;
    let logger = null;
    
    // Once the logger exists, winston's own Console transport prints to the
    // terminal, so writing here as well duplicated every line. Write directly
    // only while the logger is still missing - otherwise boot messages, which
    // are queued rather than printed, would be invisible until it is ready.
    const forward = (level, args) => {
        const message = args.join(' ');
        if (loggerReady && logger) {
            logger[level](message);
        } else {
            originalConsole[level === 'info' ? 'log' : level](...args);
            messageQueue.push({ level, message });
        }
    };

    console.log = (...args) => forward('info', args);
    console.warn = (...args) => forward('warn', args);
    console.error = (...args) => forward('error', args);
    
    // Function to set the logger when it's ready
    global.setConsoleLogger = (loggerInstance) => {
        logger = loggerInstance;
        loggerReady = true;
        
        // Process queued messages
        messageQueue.forEach(({ level, message }) => {
            if (logger[level]) {
                logger[level](message);
            }
        });
        messageQueue.length = 0; // Clear queue
        
        originalConsole.log('✅ [CONSOLE-OVERRIDE] Console messages now forwarding to Loki');
    };
    
    originalConsole.log('🔧 [CONSOLE-OVERRIDE] Console override initialized, waiting for logger...');
}