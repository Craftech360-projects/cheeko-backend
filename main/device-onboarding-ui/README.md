# Cheeko Device Onboarding UI

Standalone onboarding UI for the new public device flow.

It is intentionally separate from `manager-web`.

## Flow

1. Register or login.
2. Enter the six-digit activation code shown by the device.
3. Enter the WebSocket URL.
4. On the next OTA check, the backend returns that WebSocket URL instead of MQTT details.

## Run

Run the included no-dependency static server:

```bash
cd main/device-onboarding-ui
node server.js
```

Then open:

```text
http://127.0.0.1:8003
```

By default the UI calls:

```text
http://127.0.0.1:8002/toy
```

To point it somewhere else, set `window.CHEEKO_API_BASE` before loading `app.js` or adjust the `API_BASE` constant in `app.js`.

## Backend Routes Used

- `POST /toy/onboarding/register`
- `POST /toy/onboarding/login`
- `POST /toy/onboarding/bind-device`
- `PUT /toy/onboarding/devices/:deviceId/websocket`
