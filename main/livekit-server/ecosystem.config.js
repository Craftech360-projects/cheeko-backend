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
      name: "math-game-agent",
      script: "env/bin/python",
      args: "workers/math_game_worker.py dev",
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
      name: "yesno-quiz-agent",
      script: "env/bin/python",
      args: "workers/yesno_quiz_worker.py dev",
      cwd: __dirname,
      interpreter: "none",
      env: {
        PORT: "8090",
        YESNO_LLM_PROVIDER: "openrouter",
        YESNO_LLM_MODEL: "openai/gpt-4o-mini",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
    },
    {
      name: "livekit-media-api",
      script: "env/bin/python",
      args: "-m uvicorn media_api:app --host 0.0.0.0 --port 8003",
      cwd: __dirname,
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
    },
  ],
};
