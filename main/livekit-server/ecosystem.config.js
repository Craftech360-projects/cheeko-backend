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
      script: "python",
      args: "workers/cheeko_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8081",
        LIVEKIT_URL: process.env.LIVEKIT_URL,
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        MANAGER_API_URL: process.env.MANAGER_API_URL,
        MANAGER_API_SECRET: process.env.MANAGER_API_SECRET,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "math-tutor-agent",
      script: "python",
      args: "workers/math_tutor_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8082",
        LIVEKIT_URL: process.env.LIVEKIT_URL,
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        MANAGER_API_URL: process.env.MANAGER_API_URL,
        MANAGER_API_SECRET: process.env.MANAGER_API_SECRET,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "riddle-solver-agent",
      script: "python",
      args: "workers/riddle_solver_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8083",
        LIVEKIT_URL: process.env.LIVEKIT_URL,
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        MANAGER_API_URL: process.env.MANAGER_API_URL,
        MANAGER_API_SECRET: process.env.MANAGER_API_SECRET,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "word-ladder-agent",
      script: "python",
      args: "workers/word_ladder_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8084",
        LIVEKIT_URL: process.env.LIVEKIT_URL,
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        MANAGER_API_URL: process.env.MANAGER_API_URL,
        MANAGER_API_SECRET: process.env.MANAGER_API_SECRET,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
  ],
};
