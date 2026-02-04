"""
OpenClaw Integration Tools for LiveKit Agent
Function tools to enable WhatsApp messaging from voice commands
"""

import os
import aiohttp
from livekit.agents import function_tool
from src.utils.loki_agent_logger import logger

# OpenClaw service URL
OPENCLAW_SERVICE_URL = os.getenv("OPENCLAW_SERVICE_URL", "http://localhost:8003")

# Default country code (change this based on your location)
DEFAULT_COUNTRY_CODE = os.getenv("DEFAULT_COUNTRY_CODE", "+91")  # India

# Global storage for device MAC (set by agent)
_current_device_mac = None

def set_device_mac(device_mac: str):
    """Set the current device MAC for OpenClaw tools"""
    global _current_device_mac
    _current_device_mac = device_mac
    logger.info(f"[OPENCLAW] Device MAC set: {device_mac}")

def get_device_mac() -> str:
    """Get the current device MAC"""
    global _current_device_mac
    return _current_device_mac or "DEFAULT_DEVICE"


def format_phone_number(phone: str) -> str:
    """
    Format phone number to include country code if missing.
    
    Args:
        phone: Phone number (with or without country code)
        
    Returns:
        Formatted phone number with country code
    """
    # Remove spaces and dashes
    phone = phone.replace(" ", "").replace("-", "")
    
    # If already has +, return as is
    if phone.startswith("+"):
        return phone
    
    # If starts with country code without +, add it
    if phone.startswith("91") and len(phone) > 10:
        return "+" + phone
    
    # Otherwise, add default country code
    return DEFAULT_COUNTRY_CODE + phone


@function_tool
async def send_whatsapp_message(recipient: str, message: str) -> str:
    """
    Send a WhatsApp message to a phone number.
    Use this when the user asks to send a message to someone via WhatsApp.
    
    Args:
        recipient: Phone number (with or without country code, e.g., "8296080183" or "+918296080183")
        message: Message text to send
    
    Examples:
        - "Send a message to 8296080183 saying I finished my homework"
        - "Tell +918296080183 I'm ready to be picked up"
        - "Message 8296080183 that I'll be late"
    """
    try:
        # Format phone number to include country code
        formatted_recipient = format_phone_number(recipient)
        logger.info(f"[OPENCLAW] Sending WhatsApp message to {formatted_recipient} (original: {recipient})")
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OPENCLAW_SERVICE_URL}/api/message/send",
                json={
                    "platform": "whatsapp",
                    "recipient": formatted_recipient,
                    "message": message
                },
                headers={"Content-Type": "application/json"}
            ) as response:
                result = await response.json()
                
                if result.get("code") == 0:
                    logger.info(f"[OPENCLAW] ✅ WhatsApp message sent successfully")
                    return f"Message sent successfully!"
                else:
                    error_msg = result.get("msg", "Unknown error")
                    logger.error(f"[OPENCLAW] Failed to send message: {error_msg}")
                    return f"Failed to send message: {error_msg}"
                    
    except Exception as e:
        logger.error(f"[OPENCLAW] Error sending WhatsApp message: {e}")
        return f"Error sending message: {str(e)}"


@function_tool
async def send_to_parent(message: str, device_mac: str = None) -> str:
    """
    Send a WhatsApp message to the child's parent.
    Use this when the user asks to message their parent/mom/dad.
    
    Args:
        message: Message text to send to parent
        device_mac: Device MAC address (optional, will be auto-detected)
    
    Examples:
        - "Tell Mom I finished my homework"
        - "Message my dad that I'm ready"
        - "Send a message to my parent saying I'm hungry"
    """
    try:
        logger.info(f"[OPENCLAW] Sending message to parent")
        
        # If device_mac not provided, it should be set in the context
        # For now, we'll get it from the room name or context
        if not device_mac:
            # This will be populated from the agent's context
            # For now, return error
            return "Error: Device MAC address not available. Please specify the recipient's phone number instead."
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OPENCLAW_SERVICE_URL}/api/message/send-to-parent",
                json={
                    "deviceMac": device_mac,
                    "message": message
                },
                headers={"Content-Type": "application/json"}
            ) as response:
                result = await response.json()
                
                if result.get("code") == 0:
                    logger.info(f"[OPENCLAW] ✅ Message sent to parent")
                    return "Message sent to your parent successfully!"
                else:
                    error_msg = result.get("msg", "Unknown error")
                    logger.error(f"[OPENCLAW] Failed to send to parent: {error_msg}")
                    return f"Failed to send message: {error_msg}"
                    
    except Exception as e:
        logger.error(f"[OPENCLAW] Error sending to parent: {e}")
        return f"Error sending message: {str(e)}"


@function_tool
async def check_openclaw_status() -> str:
    """
    Check if OpenClaw service and WhatsApp are ready.
    Use this to verify messaging capabilities before sending.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{OPENCLAW_SERVICE_URL}/api/message/status"
            ) as response:
                result = await response.json()
                
                if result.get("code") == 0:
                    data = result.get("data", {})
                    whatsapp = data.get("whatsapp", {})
                    
                    if whatsapp.get("enabled") and whatsapp.get("ready"):
                        return "WhatsApp messaging is ready and available."
                    elif whatsapp.get("enabled"):
                        return "WhatsApp is enabled but not ready. Please scan QR code first."
                    else:
                        return "WhatsApp messaging is not enabled."
                else:
                    return "OpenClaw service is not responding."
                    
    except Exception as e:
        logger.error(f"[OPENCLAW] Error checking status: {e}")
        return f"Error checking OpenClaw status: {str(e)}"


def parse_time_to_cron(time_str: str, frequency: str = "daily") -> str:
    """
    Convert natural language time to cron expression.
    
    Args:
        time_str: Time in format like "8 PM", "20:00", "8:30 PM"
        frequency: "daily", "weekly", "once"
        
    Returns:
        Cron expression
    """
    import re
    
    # Parse time string
    time_str = time_str.lower().strip()
    
    # Handle "8 PM", "8:30 PM" format
    match = re.match(r'(\d+)(?::(\d+))?\s*(am|pm)?', time_str)
    if not match:
        # Default to 8 PM if can't parse
        return "0 20 * * *"
    
    hour = int(match.group(1))
    minute = int(match.group(2)) if match.group(2) else 0
    meridiem = match.group(3)
    
    # Convert to 24-hour format
    if meridiem == 'pm' and hour != 12:
        hour += 12
    elif meridiem == 'am' and hour == 12:
        hour = 0
    
    # Generate cron expression based on frequency
    if frequency == "daily":
        return f"{minute} {hour} * * *"  # Every day at specified time
    elif frequency == "weekly":
        return f"{minute} {hour} * * 0"  # Every Sunday
    else:
        return f"{minute} {hour} * * *"  # Default to daily


@function_tool
async def set_reminder(reminder_text: str, time: str, device_mac: str = None) -> str:
    """
    Set a daily reminder that will be spoken by the device at the specified time.
    
    Args:
        reminder_text: What to remind (e.g., "brush your teeth", "do homework")
        time: When to remind in format like "8 PM", "20:00", "8:30 PM"
        device_mac: Device MAC address (optional, will be auto-detected)
        
    Examples:
        - "Remind me to brush teeth at 8 PM"
        - "Set a reminder for homework at 5 PM"
        - "Remind me to take medicine at 9 AM every day"
    """
    try:
        logger.info(f"[OPENCLAW] Setting reminder: '{reminder_text}' at {time}")
        
        # Parse time to cron expression
        cron_schedule = parse_time_to_cron(time, "daily")
        logger.info(f"[OPENCLAW] Cron schedule: {cron_schedule}")
        
        # Get device MAC from global context
        if not device_mac:
            device_mac = get_device_mac()
        
        logger.info(f"[OPENCLAW] Setting reminder for device: {device_mac}")
        # Schedule task via OpenClaw API
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OPENCLAW_SERVICE_URL}/api/task/schedule",
                json={
                    "schedule": cron_schedule,
                    "action": {
                        "type": "speak",
                        "text": reminder_text,
                        "deviceMac": device_mac
                    },
                    "metadata": {
                        "title": f"Reminder: {reminder_text}",
                        "category": "reminder",
                        "priority": "medium"
                    }
                },
                headers={"Content-Type": "application/json"}
            ) as response:
                result = await response.json()
                
                if result.get("code") == 0:
                    task_data = result.get("data", {})
                    logger.info(f"[OPENCLAW] ✅ Reminder scheduled: {task_data.get('taskId')}")
                    return f"Reminder set! I'll remind you to {reminder_text} at {time} every day."
                else:
                    error_msg = result.get("msg", "Unknown error")
                    logger.error(f"[OPENCLAW] Failed to set reminder: {error_msg}")
                    return f"Failed to set reminder: {error_msg}"
                    
    except Exception as e:
        logger.error(f"[OPENCLAW] Error setting reminder: {e}")
        return f"Error setting reminder: {str(e)}"


@function_tool
async def list_reminders() -> str:
    """
    List all active reminders.
    Use this when the user asks what reminders are set.
    
    Examples:
        - "What reminders do I have?"
        - "Show my reminders"
        - "List all reminders"
    """
    try:
        logger.info(f"[OPENCLAW] Listing reminders")
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{OPENCLAW_SERVICE_URL}/api/task/list"
            ) as response:
                result = await response.json()
                
                if result.get("code") == 0:
                    data = result.get("data", {})
                    tasks = data.get("tasks", [])
                    
                    if not tasks:
                        return "You don't have any reminders set."
                    
                    # Format reminder list
                    reminder_list = []
                    for task in tasks:
                        title = task.get("metadata", {}).get("title", "Untitled")
                        reminder_list.append(title)
                    
                    return f"You have {len(tasks)} reminders: " + ", ".join(reminder_list)
                else:
                    return "Could not retrieve reminders."
                    
    except Exception as e:
        logger.error(f"[OPENCLAW] Error listing reminders: {e}")
        return f"Error listing reminders: {str(e)}"


# Export tools and helper functions for use in agent
OPENCLAW_TOOLS = [
    send_whatsapp_message,
    send_to_parent,
    check_openclaw_status,
    set_reminder,
    list_reminders,
]

__all__ = ['OPENCLAW_TOOLS', 'set_device_mac', 'get_device_mac']
