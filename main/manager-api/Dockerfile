# Multi-stage build for Spring Boot application - Cloud Run optimized
FROM maven:3.9-eclipse-temurin-17 AS builder

# Set working directory
WORKDIR /app

# Copy pom.xml and download dependencies (for better caching)
COPY pom.xml .
RUN mvn dependency:resolve

# Copy source code and build the application
COPY src ./src
RUN mvn clean package -DskipTests

# Production stage - Cloud Run optimized
FROM eclipse-temurin:17-jre-alpine

# Install useful tools
RUN apk add --no-cache \
    curl \
    wget

# Create app user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy the built jar from builder stage
COPY --from=builder /app/target/*.jar app.jar

# Create directories for uploads and logs
RUN mkdir -p /uploadfile /app/logs

# Change ownership to app user
RUN chown -R appuser:appgroup /app /uploadfile

# Switch to non-root user
USER appuser

# Railway uses PORT env var - Railway will inject PORT automatically
# ENV PORT=8002  # Commented out to allow Railway to set PORT dynamically

# Health check - Cloud Run handles this automatically
# HEALTHCHECK removed for Cloud Run compatibility

# Expose port
EXPOSE 8002

# Run with railway profile - explicitly bind to all interfaces
CMD java -jar -Dspring.profiles.active=railway -Dserver.port=${PORT:-8002} -Dserver.address=0.0.0.0 app.jar
