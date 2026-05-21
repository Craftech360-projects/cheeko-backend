const fs = require("fs/promises");
const path = require("path");
const logger = require("./logger");

function isEnabled() {
  const raw = (process.env.ANALYTICS_AUDIT_LOG_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function resolveLogPath() {
  const configured = (process.env.ANALYTICS_AUDIT_LOG_PATH || "").trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "logs", "analytics-events.ndjson");
}

function shouldIncludePayload() {
  const raw = (process.env.ANALYTICS_AUDIT_LOG_INCLUDE_PAYLOAD || "true").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

async function writeAnalyticsAuditLog(record) {
  if (!isEnabled()) return;

  try {
    const filePath = resolveLogPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      logged_at: new Date().toISOString(),
      ...record,
    });
    await fs.appendFile(filePath, `${line}\n`, "utf8");
  } catch (error) {
    logger.warn(`[ANALYTICS][AUDIT] Failed to write analytics audit log: ${error.message}`);
  }
}

module.exports = {
  writeAnalyticsAuditLog,
  shouldIncludePayload,
};
