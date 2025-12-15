# EMQX Broker - Simple Single Node Deployment for Railway
# Based on: https://docs.emqx.com/en/emqx/latest/deploy/install-docker.html
FROM emqx/emqx-enterprise:6.0.1

# Set environment variables for Railway
ENV EMQX_ALLOW_ANONYMOUS=true \
    EMQX_NODE_NAME=emqx@emqx-broker.railway.internal

# Expose required ports
# 1883: MQTT TCP
# 8083: MQTT WebSocket
# 8084: MQTT Secure WebSocket
# 8883: MQTT TLS
# 18083: EMQX Dashboard (admin:public)
EXPOSE 1883 8083 8084 8883 18083

# Use default EMQX entrypoint
# Data will be stored in /opt/emqx/data (ephemeral unless Railway volume is attached)
