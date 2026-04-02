"""
Weather tools for Cheeko AI Assistant.
Uses OpenWeatherMap for current conditions.
"""

import logging
import os
from typing import Optional

import aiohttp
from livekit.agents import RunContext, function_tool

logger = logging.getLogger("weather_tools")

DEFAULT_LOCATION = "Bengaluru"

INDIAN_CITY_MAPPINGS = {
    "bombay": "Mumbai",
    "calcutta": "Kolkata",
    "madras": "Chennai",
    "bangalore": "Bengaluru",
    "poona": "Pune",
    "delhi": "New Delhi",
}


def _normalize_city_name(city_name: Optional[str]) -> str:
    """Normalize common Indian city aliases for better API recognition."""
    if not city_name:
        return DEFAULT_LOCATION

    normalized = city_name.strip().lower()
    return INDIAN_CITY_MAPPINGS.get(normalized, city_name.strip().title())


async def _fetch_weather_data(location: str, api_key: str) -> dict | None:
    """Fetch current weather from OpenWeatherMap."""
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {
        "q": location,
        "appid": api_key,
        "units": "metric",
        "lang": "en",
    }
    timeout = aiohttp.ClientTimeout(total=10)

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, params=params) as response:
                if response.status == 404:
                    logger.warning(f"Weather location not found: {location}")
                    return None

                response.raise_for_status()
                return await response.json()
    except Exception as exc:
        logger.error(f"Weather fetch failed for {location}: {exc}")
        return None


def _format_weather_response(weather_data: dict, location: str) -> str:
    """Format weather payload into a concise spoken response."""
    try:
        main = weather_data["main"]
        wind = weather_data.get("wind", {})
        description = weather_data["weather"][0]["description"].title()
        temp = round(main["temp"])
        feels_like = round(main["feels_like"])
        humidity = main["humidity"]
        wind_speed = round(wind.get("speed", 0))

        return (
            f"The weather in {location} is currently {temp} degrees Celsius with {description}. "
            f"It feels like {feels_like} degrees, humidity is {humidity} percent, and wind speed is about {wind_speed} meters per second."
        )
    except Exception as exc:
        logger.error(f"Weather formatting failed for {location}: {exc}")
        return f"I got the weather for {location}, but I could not format it properly."


@function_tool
async def get_weather(context: RunContext, location: Optional[str] = None) -> str:
    """
    Get the current weather for a city.

    Use this tool whenever the user asks for weather, temperature, rain, humidity,
    or current conditions in a place.

    Args:
        location: City name. Defaults to Bengaluru when omitted.

    Returns:
        A concise weather summary suitable for voice output.
    """
    del context

    api_key = os.getenv("WEATHER_API", "").strip()
    if not api_key:
        return "Weather service is not configured. Please set WEATHER_API."

    normalized_location = _normalize_city_name(location)
    logger.info(f"[WEATHER] Tool called for location: {normalized_location}")

    weather_data = await _fetch_weather_data(normalized_location, api_key)
    if not weather_data:
        return f"Unable to get weather data for {normalized_location}. Please check the city name and try again."

    logger.info(f"[WEATHER] Weather fetched successfully for {normalized_location}")
    return _format_weather_response(weather_data, normalized_location)
