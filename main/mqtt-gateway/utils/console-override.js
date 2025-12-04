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
    
    // Override console methods
    console.log = (...args) => {
        originalConsole.log(...args); // Still show in terminal
        
        const message = args.join(' ');
        if (loggerReady && logger) {
            logger.info(message);
        } else {
            messageQueue.push({ level: 'info', message });
        }
    };
    
    console.warn = (...args) => {
        originalConsole.warn(...args);
        
        const message = args.join(' ');
        if (loggerReady && logger) {
            logger.warn(message);
        } else {
            messageQueue.push({ level: 'warn', message });
        }
    };
    
    console.error = (...args) => {
        originalConsole.error(...args);
        
        const message = args.join(' ');
        if (loggerReady && logger) {
            logger.error(message);
        } else {
            messageQueue.push({ level: 'error', message });
        }
    };
    
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