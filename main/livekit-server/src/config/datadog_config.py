"""
Datadog logging configuration for LiveKit Server
Direct log streaming to Datadog without requiring the agent
"""
import logging
import os
import json
import sys
from datetime import datetime
from typing import Optional, Dict, Any

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

# Check if Datadog is available
try:
    from datadog_api_client import ApiClient, Configuration
    from datadog_api_client.v2.api.logs_api import LogsApi
    from datadog_api_client.v2.model.http_log import HTTPLog
    from datadog_api_client.v2.model.http_log_item import HTTPLogItem
    DATADOG_AVAILABLE = True
except ImportError:
    DATADOG_AVAILABLE = False


class DatadogLogHandler(logging.Handler):
    """
    Custom logging handler that sends logs directly to Datadog
    """

    def __init__(
        self,
        api_key: str,
        service_name: str = "livekit-server",
        env: str = "local",
        version: str = "1.0.0",
        site: str = "datadoghq.com",
        tags: Optional[list] = None
    ):
        super().__init__()
        self.api_key = api_key
        self.service_name = service_name
        self.env = env
        self.version = version
        self.site = site
        self.tags = tags or []
        self.enabled = False

        # Initialize Datadog API client
        if DATADOG_AVAILABLE and api_key and api_key != "your_datadog_api_key_here":
            try:
                configuration = Configuration()
                configuration.api_key["apiKeyAuth"] = api_key
                configuration.server_variables["site"] = site

                self.api_client = ApiClient(configuration)
                self.logs_api = LogsApi(self.api_client)
                self.enabled = True

                # Set JSON formatter for structured logging
                formatter = logging.Formatter(
                    '{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}'
                )
                self.setFormatter(formatter)

            except Exception as e:
                print(f"⚠️ Failed to initialize Datadog logging: {e}")
                self.enabled = False
        else:
            if not DATADOG_AVAILABLE:
                print(
                    "⚠️ Datadog API client not installed. Install with: pip install datadog-api-client ddtrace")
            else:
                print("⚠️ Datadog API key not configured or invalid")

    def emit(self, record: logging.LogRecord):
        """Send log record to Datadog"""
        if not self.enabled:
            return

        try:
            # Format the log record
            log_entry = self.format(record)

            # Parse JSON if formatted as JSON
            try:
                log_data = json.loads(log_entry)
            except json.JSONDecodeError:
                log_data = {"message": log_entry}

            # Add Datadog-specific fields
            log_data.update({
                "ddsource": "python",
                "ddtags": f"env:{self.env},service:{self.service_name},version:{self.version}",
                "hostname": os.getenv("HOSTNAME", "localhost"),
                "status": record.levelname.lower(),
            })

            # Add custom tags
            if self.tags:
                log_data["ddtags"] += "," + ",".join(self.tags)

            # Add exception info if present
            if record.exc_info:
                log_data["error.kind"] = record.exc_info[0].__name__ if record.exc_info[0] else "Exception"
                log_data["error.message"] = str(
                    record.exc_info[1]) if record.exc_info[1] else ""
                log_data["error.stack"] = self.formatter.formatException(
                    record.exc_info) if self.formatter else ""

            # Add extra context from record
            if hasattr(record, 'room_name'):
                log_data["room_name"] = record.room_name
            if hasattr(record, 'device_mac'):
                log_data["device_mac"] = record.device_mac
            if hasattr(record, 'session_id'):
                log_data["session_id"] = record.session_id

            # Create HTTP log item with ALL log data as JSON message
            # This ensures ERROR logs include exception details, stack traces, and custom context
            log_item = HTTPLogItem(
                ddsource="python",
                ddtags=log_data["ddtags"],
                hostname=log_data["hostname"],
                # Send entire log_data as JSON for full context
                message=json.dumps(log_data),
                service=self.service_name,
            )

            # Send to Datadog (async in background)
            try:
                http_log = HTTPLog([log_item])
                self.logs_api.submit_log(http_log)
            except Exception as e:
                # Don't fail the application if logging fails
                print(f"⚠️ Failed to send log to Datadog: {e}")

        except Exception as e:
            # Don't fail the application if logging fails
            print(f"⚠️ Error in Datadog log handler: {e}")
            self.handleError(record)


class DatadogConfig:
    """Configuration manager for Datadog integration"""

    @staticmethod
    def is_enabled() -> bool:
        """Check if Datadog is enabled"""
        enabled = os.getenv("DATADOG_ENABLED", "false").lower() == "true"
        api_key = os.getenv("DATADOG_API_KEY", "")

        if enabled and not api_key:
            print("⚠️ DATADOG_ENABLED=true but DATADOG_API_KEY is not set")
            return False

        return enabled and DATADOG_AVAILABLE

    @staticmethod
    def get_config() -> Dict[str, Any]:
        """Get Datadog configuration from environment variables"""
        return {
            "api_key": os.getenv("DATADOG_API_KEY", ""),
            "app_key": os.getenv("DATADOG_APP_KEY", ""),  # Optional
            "service": os.getenv("DD_SERVICE", "livekit-server"),
            "env": os.getenv("DD_ENV", "local"),
            "version": os.getenv("DD_VERSION", "1.0.0"),
            # or datadoghq.eu for US5
            "site": os.getenv("DD_SITE", "us5.datadoghq.com"),
            "tags": os.getenv("DD_TAGS", "").split(",") if os.getenv("DD_TAGS") else [],
        }

    @staticmethod
    def setup_logging(logger: Optional[logging.Logger] = None) -> bool:
        """
        Set up Datadog logging handler

        Args:
            logger: Optional specific logger to configure. If None, configures root logger.

        Returns:
            bool: True if Datadog logging was successfully configured
        """
        # Always set up basic console logging first
        # This ensures logs are visible even when Datadog is disabled
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )

        if not DatadogConfig.is_enabled():
            print("ℹ️ Datadog logging is disabled (set DATADOG_ENABLED=true to enable)")
            print("ℹ️ Console logging enabled at INFO level")
            return False

        config = DatadogConfig.get_config()

        try:
            # Create Datadog handler
            datadog_handler = DatadogLogHandler(
                api_key=config["api_key"],
                service_name=config["service"],
                env=config["env"],
                version=config["version"],
                site=config["site"],
                tags=config["tags"]
            )

            if not datadog_handler.enabled:
                print("⚠️ Datadog handler could not be initialized")
                return False

            # Set log level
            datadog_handler.setLevel(logging.INFO)

            # Add handler to logger
            target_logger = logger or logging.getLogger()
            target_logger.addHandler(datadog_handler)

            print(
                f"✅ Datadog logging enabled: service={config['service']}, env={config['env']}, site={config['site']}")
            return True

        except Exception as e:
            print(f"❌ Failed to setup Datadog logging: {e}")
            return False


def add_log_context(record: logging.LogRecord, room_name: str = None, device_mac: str = None, session_id: str = None):
    """
    Helper function to add context to log records for Datadog

    Usage:
        logger = logging.getLogger(__name__)
        record = logger.makeRecord(...)
        add_log_context(record, room_name="room_123", device_mac="00:11:22:33:44:55")
    """
    if room_name:
        record.room_name = room_name
    if device_mac:
        record.device_mac = device_mac
    if session_id:
        record.session_id = session_id
    return record


# Context-aware logger wrapper
class ContextLogger:
    """
    Wrapper around logging.Logger that automatically adds context fields
    """

    def __init__(self, logger: logging.Logger, room_name: str = None, device_mac: str = None, session_id: str = None):
        self.logger = logger
        self.room_name = room_name
        self.device_mac = device_mac
        self.session_id = session_id

    def _add_context(self, extra: Dict = None) -> Dict:
        """Add context fields to extra dict"""
        extra = extra or {}
        if self.room_name:
            extra['room_name'] = self.room_name
        if self.device_mac:
            extra['device_mac'] = self.device_mac
        if self.session_id:
            extra['session_id'] = self.session_id
        return extra

    def debug(self, msg, *args, **kwargs):
        kwargs['extra'] = self._add_context(kwargs.get('extra'))
        self.logger.debug(msg, *args, **kwargs)

    def info(self, msg, *args, **kwargs):
        kwargs['extra'] = self._add_context(kwargs.get('extra'))
        self.logger.info(msg, *args, **kwargs)

    def warning(self, msg, *args, **kwargs):
        kwargs['extra'] = self._add_context(kwargs.get('extra'))
        self.logger.warning(msg, *args, **kwargs)

    def error(self, msg, *args, **kwargs):
        kwargs['extra'] = self._add_context(kwargs.get('extra'))
        self.logger.error(msg, *args, **kwargs)

    def critical(self, msg, *args, **kwargs):
        kwargs['extra'] = self._add_context(kwargs.get('extra'))
        self.logger.critical(msg, *args, **kwargs)
