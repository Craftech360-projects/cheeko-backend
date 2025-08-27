import os
import sys
import uuid
import signal
import asyncio
from aioconsole import ainput
from config.settings import load_config
from config.logger import setup_logging
from core.utils.util import get_local_ip, validate_mcp_endpoint
from core.http_server import SimpleHttpServer
from core.websocket_server import WebSocketServer
from core.utils.util import check_ffmpeg_installed
from core.rag.rag_startup import initialize_rag_services, shutdown_rag_services, check_rag_status

TAG = __name__
logger = setup_logging()

async def wait_for_exit() -> None:
    """
    Block until receiving Ctrl-C / SIGTERM.
    - Unix: Use add_signal_handler
    - Windows: Rely on KeyboardInterrupt
    """
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    if sys.platform != "win32":  # Unix / macOS
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop_event.set)
        await stop_event.wait()
    else:
        # Windows: await a forever pending future,
        # let KeyboardInterrupt bubble up to asyncio.run, to eliminate process exit blocking caused by legacy normal threads
        try:
            await asyncio.Future()
        except KeyboardInterrupt:  # Ctrl-C
            pass

async def monitor_stdin():
    """Monitor standard input, consume enter key presses"""
    while True:
        await ainput()  # Asynchronously wait for input, consume enter

async def main():
    check_ffmpeg_installed()
    config = load_config()

    # Use SERVER_SECRET from environment for API authentication
    # If not set, use manager-api's secret or generate random key
    server_secret = os.getenv("SERVER_SECRET", "")
    auth_key = config.get("manager-api", {}).get("secret", "")
    
    if server_secret:
        auth_key = server_secret
        logger.bind(tag=TAG).info(f"Using SERVER_SECRET for authentication")
    elif not auth_key or len(auth_key) == 0 or "你" in auth_key:
        auth_key = str(uuid.uuid4().hex)
        logger.bind(tag=TAG).info(f"Generated auth_key: {auth_key}")
    
    config["server"]["auth_key"] = auth_key

    # Initialize RAG services
    rag_enabled = await initialize_rag_services(auth_key)
    if rag_enabled:
        rag_status = check_rag_status()
        logger.bind(tag=TAG).info(f"RAG Status: {rag_status}")
    
    # Add stdin monitoring task
    stdin_task = asyncio.create_task(monitor_stdin())

    # Start WebSocket server
    ws_server = WebSocketServer(config)
    ws_task = asyncio.create_task(ws_server.start())

    # Start Simple http server
    ota_server = SimpleHttpServer(config)
    ota_task = asyncio.create_task(ota_server.start())

    read_config_from_api = config.get("read_config_from_api", False)
    port = int(config["server"].get("http_port", 8003))

    if not read_config_from_api:
        logger.bind(tag=TAG).info(
            "OTA interface is\t\thttp://{}:{}/xiaozhi/ota/",
            get_local_ip(),
            port,
        )

    mcp_endpoint = config.get("mcp_endpoint", None)
    if mcp_endpoint is not None and "你" not in mcp_endpoint:
        # Validate MCP endpoint format
        if validate_mcp_endpoint(mcp_endpoint):
            logger.bind(tag=TAG).info("MCP endpoint is\t{}", mcp_endpoint)
            # Convert mcp endpoint address to call endpoint
            mcp_endpoint = mcp_endpoint.replace("/mcp/", "/call/")
            config["mcp_endpoint"] = mcp_endpoint
        else:
            logger.bind(tag=TAG).error("MCP endpoint does not conform to specifications")
            config["mcp_endpoint"] = "Your endpoint websocket address"

    logger.bind(tag=TAG).info(
        "Vision analysis interface is\thttp://{}:{}/mcp/vision/explain",
        get_local_ip(),
        port,
    )

    # Get WebSocket configuration, use safe default values
    websocket_port = 8000
    server_config = config.get("server", {})
    if isinstance(server_config, dict):
        websocket_port = int(server_config.get("port", 8000))

    logger.bind(tag=TAG).info(
        "Websocket address is\tws://{}:{}/xiaozhi/v1/",
        get_local_ip(),
        websocket_port,
    )

    logger.bind(tag=TAG).info(
        "=======The above address is websocket protocol address, please do not access with browser======="
    )

    logger.bind(tag=TAG).info(
        "If you want to test websocket please use Google Chrome to open test_page.html in test directory"
    )

    logger.bind(tag=TAG).info(
        "=============================================================\n"
    )

    try:
        await wait_for_exit()  # Block until receiving exit signal
    except asyncio.CancelledError:
        print("Task was cancelled, cleaning up resources...")
    finally:
        # Shutdown RAG services
        await shutdown_rag_services()
        
        # Cancel all tasks (critical fix point)
        stdin_task.cancel()
        ws_task.cancel()
        if ota_task:
            ota_task.cancel()

        # Wait for task termination (must add timeout)
        await asyncio.wait(
            [stdin_task, ws_task, ota_task] if ota_task else [stdin_task, ws_task],
            timeout=3.0,
            return_when=asyncio.ALL_COMPLETED,
        )

        print("Server has been closed, program exiting.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Manual interruption, program terminated.")
