# EMQX Broker - Simple Single Node Deployment for Railway
# Based on: https://docs.emqx.com/en/emqx/latest/deploy/install-docker.html
FROM emqx/emqx-enterprise:6.0.1

# Set environment variables for Railway
# - Listen on IPv6 ALL interfaces for Railway private networking
# - Single node deployment (no clustering)
# - Dashboard binds to 0.0.0.0 (IPv4) to avoid startup issues
ENV EMQX_NODE_NAME=emqx@emqx-docker.railway.internal \
    EMQX_LISTENERS__TCP__DEFAULT__BIND="[::]:1883" \
    EMQX_LISTENERS__WS__DEFAULT__BIND="[::]:8083" \
    EMQX_LISTENERS__WSS__DEFAULT__BIND="[::]:8084" \
    EMQX_LISTENERS__SSL__DEFAULT__BIND="[::]:8883" \
    EMQX_DASHBOARD__LISTENERS__HTTP__BIND="0.0.0.0:18083"

# Expose required ports
EXPOSE 1883 8083 8084 8883 18083

# Health check
HEALTHCHECK --interval=5s --timeout=25s --retries=5 \
    CMD ["/opt/emqx/bin/emqx", "ctl", "status"]
