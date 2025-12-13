# EMQX Broker Service for Railway
FROM emqx/emqx:5.8.3

# Set environment variables for EMQX configuration
ENV EMQX_ALLOW_ANONYMOUS=true \
    EMQX_LISTENERS__TCP__DEFAULT__BIND="0.0.0.0:1883" \
    EMQX_LISTENERS__WS__DEFAULT__BIND="0.0.0.0:8083" \
    EMQX_DASHBOARD__LISTENERS__HTTP__BIND="0.0.0.0:18083"

# Expose ports
# 1883: MQTT TCP
# 8083: MQTT WebSocket  
# 18083: EMQX Dashboard
EXPOSE 1883 8083 18083

# Create initialization script to set up the rule
RUN mkdir -p /opt/emqx/data/configs

# Create rule configuration file
RUN cat > /opt/emqx/data/configs/rule_init.json << 'EOF'
{
"rules": [
{
"id": "device_server_republish",
"name": "Device Server Message Republish",
"sql": "SELECT payload, clientid FROM \"device-server\"",
"actions": [
{
"function": "republish",
"args": {
"topic": "internal/server-ingest",
"payload": "{\"orginal_payload\":${payload},\"sender_client_id\":\"${clientid}\"}",
"qos": 0,
"retain": false
}
}
],
"enable": true,
"description": "Republish device-server messages to internal/server-ingest with client metadata"
}
]
}
EOF

# Create startup script that initializes rules after EMQX starts
RUN cat > /docker-entrypoint-init.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 Starting EMQX..."

# Start EMQX in background
/usr/bin/docker-entrypoint.sh &
EMQX_PID=$!

# Wait for EMQX to be ready
echo "⏳ Waiting for EMQX to be ready..."
for i in {1..30}; do
if /opt/emqx/bin/emqx_ctl status | grep -q "is running"; then
echo "✅ EMQX is running"
break
fi
echo -n "."
sleep 1
done

# Wait a bit more for API to be ready
sleep 5

# Create the rule via HTTP API
echo "📝 Creating EMQX rule..."
curl -X POST 'http://localhost:18083/api/v5/rules' \
    -u 'admin:public' \
    -H 'Content-Type: application/json' \
    -d '{
"id": "device_server_republish",
"name": "Device Server Message Republish",
"sql": "SELECT payload, clientid FROM \"device-server\"",
"actions": [
{
"function": "republish",
"args": {
"topic": "internal/server-ingest",
"payload": "{\"orginal_payload\":${payload},\"sender_client_id\":\"${clientid}\"}",
"qos": 0,
"retain": false
}
}
],
"enable": true,
"description": "Republish device-server messages to internal/server-ingest with client metadata"
}' || echo "⚠️ Rule may already exist or API not ready"

echo "✅ EMQX initialization complete"

# Keep the container running
wait $EMQX_PID
EOF

RUN chmod +x /docker-entrypoint-init.sh

CMD ["/docker-entrypoint-init.sh"]
