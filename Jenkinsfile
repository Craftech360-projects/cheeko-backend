pipeline {
    agent any

    tools {
        nodejs 'NodeJS'
    }

    environment {
        // Manager Web
        WEB_IMAGE = 'cheeko-manager-web'
        WEB_CONTAINER = 'cheeko-manager-web'
        WEB_PORT = '8886'

        // Manager API
        API_IMAGE = 'cheeko-manager-api'
        API_CONTAINER = 'cheeko-manager-api'
        API_PORT = '8002'

        // MQTT Gateway
        MQTT_IMAGE = 'cheeko-mqtt-gateway'
        MQTT_CONTAINER = 'cheeko-mqtt-gateway'
        MQTT_HTTP_PORT = '8004'
        MQTT_UDP_PORT = '8884'

        // EMQX Broker
        EMQX_CONTAINER = 'cheeko-emqx'
        EMQX_IMAGE = 'emqx/emqx:5.8.3'
    }

    stages {
        stage('Checkout') {
            steps {
                echo '📥 Checking out code...'
                checkout scm
            }
        }

        // ==========================================
        // BUILD STAGE - Parallel builds
        // ==========================================
        stage('Build All Services') {
            parallel {
                stage('Build Manager Web') {
                    steps {
                        echo '🔨 Building Manager Web (Vue.js)...'
                        dir('main/manager-web') {
                            sh 'npm ci --no-audit --no-fund'
                            sh 'npm run build'
                            sh """
                                docker build \
                                    -t ${WEB_IMAGE}:${BUILD_NUMBER} \
                                    -t ${WEB_IMAGE}:latest \
                                    -f Dockerfile.production .
                            """
                        }
                    }
                }

                stage('Build Manager API') {
                    steps {
                        echo '🔨 Building Manager API (Spring Boot)...'
                        dir('main/manager-api') {
                            sh """
                                docker build \
                                    -t ${API_IMAGE}:${BUILD_NUMBER} \
                                    -t ${API_IMAGE}:latest \
                                    -f Dockerfile.local .
                            """
                        }
                    }
                }

                stage('Build MQTT Gateway') {
                    steps {
                        echo '🔨 Building MQTT Gateway (Node.js)...'
                        dir('main/mqtt-gateway') {
                            sh """
                                docker build \
                                    -t ${MQTT_IMAGE}:${BUILD_NUMBER} \
                                    -t ${MQTT_IMAGE}:latest \
                                    -f Dockerfile.local .
                            """
                        }
                    }
                }
            }
        }

        // ==========================================
        // DEPLOY EMQX BROKER (with predefined rules)
        // ==========================================
        stage('Deploy EMQX Broker') {
            steps {
                echo '📡 Checking EMQX Broker...'
                sh '''
                    # Check if ANY EMQX container is running (by port or by name pattern)
                    EMQX_RUNNING=$(docker ps --filter "publish=1883" --format "{{.Names}}" | head -1)

                    if [ -n "$EMQX_RUNNING" ]; then
                        echo "✅ EMQX already running as '$EMQX_RUNNING' - keeping existing to preserve connections"
                        echo "   MQTT: localhost:1883"
                        echo "   Dashboard: localhost:18083"
                    else
                        echo "Starting new EMQX container..."

                        # Remove old container if exists
                        docker rm cheeko-emqx 2>/dev/null || true

                        # Run EMQX with predefined rules via environment variables
                        docker run -d \
                            --name cheeko-emqx \
                            --restart unless-stopped \
                            -p 1883:1883 \
                            -p 8083:8083 \
                            -p 8084:8084 \
                            -p 18083:18083 \
                            -e EMQX_DASHBOARD__DEFAULT_USERNAME=admin \
                            -e EMQX_DASHBOARD__DEFAULT_PASSWORD=public \
                            -e EMQX_ALLOW_ANONYMOUS=true \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ENABLE=true" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__SQL=SELECT payload, clientid FROM \"device-server\"" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ACTIONS__1__FUNCTION=republish" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ACTIONS__1__ARGS__TOPIC=internal/server-ingest" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ACTIONS__1__ARGS__PAYLOAD={\"orginal_payload\": \\${payload}, \"sender_client_id\": \"\\${clientid}\"}" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ACTIONS__1__ARGS__QOS=0" \
                            -e "EMQX_RULE_ENGINE__RULES__FORWARD_SERVER_INGEST__ACTIONS__1__ARGS__RETAIN=false" \
                            emqx/emqx:5.8.3

                        echo "Waiting for EMQX to start..."
                        sleep 15
                    fi
                '''
            }
        }

        // ==========================================
        // DEPLOY SERVICES
        // ==========================================
        stage('Deploy Manager API') {
            steps {
                echo '🚀 Deploying Manager API...'
                sh """
                    # Stop and remove existing container
                    docker stop ${API_CONTAINER} 2>/dev/null || true
                    docker rm ${API_CONTAINER} 2>/dev/null || true

                    # Run new container
                    docker run -d \
                        --name ${API_CONTAINER} \
                        --restart unless-stopped \
                        --add-host=host.docker.internal:host-gateway \
                        -p ${API_PORT}:8002 \
                        -v /uploadfile:/uploadfile \
                        ${API_IMAGE}:${BUILD_NUMBER}

                    echo 'Waiting for API container to start...'
                    sleep 10
                """
            }
        }

        stage('Deploy Manager Web') {
            steps {
                echo '🚀 Deploying Manager Web...'
                sh """
                    # Stop and remove existing container
                    docker stop ${WEB_CONTAINER} 2>/dev/null || true
                    docker rm ${WEB_CONTAINER} 2>/dev/null || true

                    # Run new container
                    docker run -d \
                        --name ${WEB_CONTAINER} \
                        --restart unless-stopped \
                        -p ${WEB_PORT}:80 \
                        ${WEB_IMAGE}:${BUILD_NUMBER}

                    echo 'Waiting for Web container to start...'
                    sleep 5
                """
            }
        }

        stage('Deploy MQTT Gateway') {
            steps {
                echo '🚀 Deploying MQTT Gateway...'
                sh """
                    # Stop and remove existing container
                    docker stop ${MQTT_CONTAINER} 2>/dev/null || true
                    docker rm ${MQTT_CONTAINER} 2>/dev/null || true

                    # Run new container
                    docker run -d \
                        --name ${MQTT_CONTAINER} \
                        --restart unless-stopped \
                        --add-host=host.docker.internal:host-gateway \
                        -p ${MQTT_HTTP_PORT}:8004 \
                        -p ${MQTT_UDP_PORT}:8884/udp \
                        ${MQTT_IMAGE}:${BUILD_NUMBER}

                    echo 'Waiting for MQTT Gateway to start...'
                    sleep 10
                """
            }
        }

        // ==========================================
        // HEALTH CHECK STAGE
        // ==========================================
        stage('Health Checks') {
            parallel {
                stage('Check EMQX') {
                    steps {
                        echo '🏥 Checking EMQX health...'
                        sh '''
                            HOST="host.docker.internal"
                            MAX_RETRIES=5
                            RETRY_COUNT=0

                            while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
                                if curl -sf http://${HOST}:18083/status > /dev/null 2>&1; then
                                    echo "✅ EMQX is healthy!"
                                    exit 0
                                fi
                                RETRY_COUNT=$((RETRY_COUNT + 1))
                                echo "Waiting for EMQX... (attempt $RETRY_COUNT/$MAX_RETRIES)"
                                sleep 5
                            done

                            echo "⚠️ EMQX health check failed"
                            docker logs cheeko-emqx --tail 20 2>/dev/null || true
                            exit 1
                        '''
                    }
                }

                stage('Check Manager API') {
                    steps {
                        echo '🏥 Checking Manager API health...'
                        sh '''
                            echo "Waiting for Spring Boot to initialize..."
                            sleep 30

                            MAX_RETRIES=5
                            RETRY_COUNT=0
                            API_HOST="host.docker.internal"

                            while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
                                HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://${API_HOST}:8002/toy/actuator/health 2>/dev/null || echo "000")

                                if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
                                    echo "✅ Manager API is healthy! (HTTP $HTTP_CODE)"
                                    exit 0
                                fi

                                RETRY_COUNT=$((RETRY_COUNT + 1))
                                echo "Waiting for API... (attempt $RETRY_COUNT/$MAX_RETRIES, HTTP: $HTTP_CODE)"
                                sleep 10
                            done

                            echo "⚠️ API health check failed"
                            docker logs cheeko-manager-api --tail 30
                            exit 1
                        '''
                    }
                }

                stage('Check Manager Web') {
                    steps {
                        echo '🏥 Checking Manager Web health...'
                        sh '''
                            sleep 5
                            WEB_HOST="host.docker.internal"

                            if curl -sf http://${WEB_HOST}:8886/ > /dev/null 2>&1; then
                                echo "✅ Manager Web is healthy!"
                            else
                                echo "⚠️ Web health check failed"
                                docker logs cheeko-manager-web --tail 20
                                exit 1
                            fi
                        '''
                    }
                }

                stage('Check MQTT Gateway') {
                    steps {
                        echo '🏥 Checking MQTT Gateway health...'
                        sh '''
                            sleep 10
                            HOST="host.docker.internal"
                            MAX_RETRIES=5
                            RETRY_COUNT=0

                            while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
                                HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://${HOST}:8004/health 2>/dev/null || echo "000")

                                if [ "$HTTP_CODE" = "200" ]; then
                                    echo "✅ MQTT Gateway is healthy!"
                                    exit 0
                                fi

                                RETRY_COUNT=$((RETRY_COUNT + 1))
                                echo "Waiting for MQTT Gateway... (attempt $RETRY_COUNT/$MAX_RETRIES, HTTP: $HTTP_CODE)"
                                sleep 5
                            done

                            echo "⚠️ MQTT Gateway health check failed"
                            docker logs cheeko-mqtt-gateway --tail 30
                            exit 1
                        '''
                    }
                }
            }
        }
    }

    post {
        success {
            echo '''
            ═══════════════════════════════════════════════════════════
            ✅ PIPELINE COMPLETED SUCCESSFULLY!
            ═══════════════════════════════════════════════════════════

            🌐 Manager Web:     http://localhost:8886
            🔌 Manager API:     http://localhost:8002/toy
            📚 API Docs:        http://localhost:8002/toy/doc.html
            📡 MQTT Gateway:    http://localhost:8004/health
            🔗 EMQX Dashboard:  http://localhost:18083 (admin/public)
            🔗 EMQX MQTT:       localhost:1883

            ═══════════════════════════════════════════════════════════
            '''
        }
        failure {
            echo '❌ Pipeline failed! Checking container logs...'
            sh '''
                echo "=== EMQX Logs ==="
                docker logs cheeko-emqx --tail 30 2>/dev/null || true
                echo "=== Manager API Logs ==="
                docker logs cheeko-manager-api --tail 30 2>/dev/null || true
                echo "=== Manager Web Logs ==="
                docker logs cheeko-manager-web --tail 30 2>/dev/null || true
                echo "=== MQTT Gateway Logs ==="
                docker logs cheeko-mqtt-gateway --tail 30 2>/dev/null || true
            '''
        }
        always {
            echo '🧹 Cleaning up workspace...'
            deleteDir()
        }
    }
}
