/**
 * Swagger/OpenAPI Configuration
 *
 * Configures swagger-jsdoc and swagger-ui-express.
 * Documentation available at /toy/doc.html
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cheeko Manager API',
      version: '1.0.0',
      description: `
## Overview

Cheeko Manager API is the backend service for the Cheeko AI companion system for children (ages 3-16).

This Node.js/Express API is a port of the original Java Spring Boot API, maintaining full API compatibility.

## Authentication

The API supports two authentication methods:

1. **OAuth2 Bearer Token** - For user authentication
   - Include token in header: \`Authorization: Bearer <token>\`

2. **Service Key** - For backend-to-backend calls
   - Include key in header: \`X-Service-Key: <service_secret>\`

## Response Format

All responses follow this format:
\`\`\`json
{
  "code": 0,        // 0 = success, non-zero = error code
  "msg": "success", // Message string
  "data": {}        // Response data (null on error)
}
\`\`\`

## Modules

- **User** - Authentication, registration, profiles
- **Device** - ESP32 device management
- **Agent** - AI agent configuration
- **Content** - Music, stories, content library
- **RFID** - RFID card mappings and RAG
- **Models** - LLM/TTS/STT model configuration
- **Analytics** - Usage tracking and statistics
      `,
      contact: {
        name: 'Cheeko Team'
      }
    },
    servers: [
      {
        url: 'http://localhost:8002/toy',
        description: 'Local development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token'
        },
        serviceKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Service-Key',
          description: 'Service-to-service authentication key'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            code: {
              type: 'integer',
              description: 'Error code (non-zero)',
              example: 400
            },
            msg: {
              type: 'string',
              description: 'Error message',
              example: 'Bad request'
            },
            data: {
              type: 'object',
              nullable: true,
              description: 'Additional error data'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            code: {
              type: 'integer',
              description: 'Status code (0 for success)',
              example: 0
            },
            msg: {
              type: 'string',
              description: 'Success message',
              example: 'success'
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          }
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            code: {
              type: 'integer',
              example: 0
            },
            msg: {
              type: 'string',
              example: 'success'
            },
            data: {
              type: 'object',
              properties: {
                list: {
                  type: 'array',
                  items: {}
                },
                total: {
                  type: 'integer',
                  description: 'Total number of items'
                },
                page: {
                  type: 'integer',
                  description: 'Current page number'
                },
                limit: {
                  type: 'integer',
                  description: 'Items per page'
                },
                totalPages: {
                  type: 'integer',
                  description: 'Total number of pages'
                }
              }
            }
          }
        }
      }
    },
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'User', description: 'User authentication and management' },
      { name: 'Device', description: 'ESP32 device management' },
      { name: 'Agent', description: 'AI agent configuration' },
      { name: 'Content', description: 'Content library management' },
      { name: 'RFID', description: 'RFID card mappings' },
      { name: 'Profiles', description: 'Kid and parent profiles' },
      { name: 'Models', description: 'AI model configuration' },
      { name: 'Analytics', description: 'Usage analytics' }
    ]
  },
  apis: ['./src/routes/*.js', './src/routes/**/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * Setup Swagger UI
 * @param {Object} app - Express app
 * @param {string} contextPath - Base context path (e.g., '/toy')
 */
const setupSwagger = (app, contextPath) => {
  // Serve Swagger JSON
  app.get(`${contextPath}/swagger.json`, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Serve Swagger UI at /toy/doc.html (matching Spring Boot's Knife4j)
  app.use(
    `${contextPath}/doc.html`,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Cheeko Manager API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true
      }
    })
  );

  // Also serve at /toy/api-docs for standard path
  app.use(
    `${contextPath}/api-docs`,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec)
  );
};

module.exports = setupSwagger;
