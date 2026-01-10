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
            }
        }

        // ==========================================
        // DEPLOY STAGE - Sequential (API first, then Web)
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

        // ==========================================
        // HEALTH CHECK STAGE
        // ==========================================
        stage('Health Checks') {
            parallel {
                stage('Check Manager API') {
                    steps {
                        echo '🏥 Checking Manager API health...'
                        sh '''
                            echo "Waiting for Spring Boot to initialize..."
                            sleep 30

                            MAX_RETRIES=5
                            RETRY_COUNT=0

                            while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
                                if curl -sf http://localhost:8002/toy/actuator/health > /dev/null 2>&1; then
                                    echo "✅ Manager API is healthy!"
                                    exit 0
                                fi
                                RETRY_COUNT=$((RETRY_COUNT + 1))
                                echo "Waiting for API... (attempt $RETRY_COUNT/$MAX_RETRIES)"
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
                            if curl -sf http://localhost:8886/ > /dev/null 2>&1; then
                                echo "✅ Manager Web is healthy!"
                            else
                                echo "⚠️ Web health check failed"
                                exit 1
                            fi
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

            🌐 Manager Web:  http://localhost:8886
            🔌 Manager API:  http://localhost:8002/toy
            📚 API Docs:     http://localhost:8002/toy/doc.html
            ❤️ Health:       http://localhost:8002/toy/actuator/health

            ═══════════════════════════════════════════════════════════
            '''
        }
        failure {
            echo '❌ Pipeline failed! Checking container logs...'
            sh '''
                echo "=== Manager API Logs ==="
                docker logs cheeko-manager-api --tail 50 2>/dev/null || true
                echo "=== Manager Web Logs ==="
                docker logs cheeko-manager-web --tail 50 2>/dev/null || true
            '''
        }
        always {
            echo '🧹 Cleaning up workspace...'
            deleteDir()
        }
    }
}
