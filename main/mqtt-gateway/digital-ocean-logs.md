Service Status:

  # Check container status
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose ps'

  # Check container health
  ssh root@209.38.120.140 'docker ps'

  Logs:
  # All logs (follow mode)
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose logs -f'

  # mqtt-gateway logs only
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose logs -f mqtt-gateway'

  # EMQX logs only
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose logs -f emqx'

  # Last 100 lines
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose logs --tail=100 mqtt-gateway'

  Filter specific logs (UDP, MQTT, connections):
  # UDP related logs
  ssh root@209.38.120.140 'docker logs mqtt-gateway 2>&1 | grep -i udp'

  # Connection logs
  ssh root@209.38.120.140 'docker logs mqtt-gateway 2>&1 | grep -i "connect\|hello"'

  # Error logs
  ssh root@209.38.120.140 'docker logs mqtt-gateway 2>&1 | grep -i "error\|fail"'

  EMQX Dashboard (web UI):
  http://209.38.120.140:18083
  Username: admin
  Password: public
  - View connected clients, subscriptions, messages

  Restart/Stop:
  # Restart all
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose restart'

  # Restart mqtt-gateway only
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose restart mqtt-gateway'

  # Stop all
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose down'

  # Start all
  ssh root@209.38.120.140 'cd /opt/mqtt-gateway && docker-compose up -d'

  Resource usage:
  # Container resource usage
  ssh root@209.38.120.140 'docker stats --no-stream'

  # System resources
  ssh root@209.38.120.140 'free -h && df -h'