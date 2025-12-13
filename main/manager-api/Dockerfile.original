# Multi-stage build for Spring Boot application
FROM maven:3.9-eclipse-temurin-17 AS builder

# Set working directory
WORKDIR /app

# Copy pom.xml and download dependencies (for better caching)
COPY pom.xml .
RUN mvn dependency:resolve

# Copy source code and build the application
COPY src ./src
RUN mvn clean package -DskipTests

# Production stage
FROM eclipse-temurin:17-jre-alpine

# Install useful tools
RUN apk add --no-cache \
  curl \
  wget

# Create app user
RUN addgroup -S appgroup && adduser -S -G appgroup appuser

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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8001/actuator/health || exit 1

# Expose port
EXPOSE 8001

# Run the application
CMD ["java", "-jar", "-Dspring.profiles.active=dev", "app.jar"]