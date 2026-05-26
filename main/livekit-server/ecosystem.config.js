/**
 * PM2 Ecosystem Configuration for Multi-Agent LiveKit Workers
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only cheeko-agent
 *   pm2 restart all
 *   pm2 logs cheeko-agent
 *
 * Each agent runs as a separate process with its own port and agent_name.
 * Ports are needed for LiveKit worker health checks when running on same machine.
 */

module.exports = {
  apps: [
    {
      name: "cheeko-agent",
      script: "env/bin/python",
      args: "workers/cheeko_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8081",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "math-tutor-agent",
      script: "env/bin/python",
      args: "workers/math_tutor_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8082",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "riddle-solver-agent",
      script: "env/bin/python",
      args: "workers/riddle_solver_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8085",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "word-ladder-agent",
      script: "env/bin/python",
      args: "workers/word_ladder_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8086",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "cheeko-magic-agent",
      script: "env/bin/python",
      args: "workers/cheeko_magic_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8087",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "cheeko-astronaut-agent",
      script: "env/bin/python",
      args: "workers/cheeko_astronaut_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8088",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "cheeko-german-agent",
      script: "env/bin/python",
      args: "workers/cheeko_german_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8089",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "livekit-media-api",
      script: "env/bin/python",
      args: "-m uvicorn media_api:app --host 127.0.0.1 --port 8003",
      cwd: __dirname,
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
    },
  ],
};
