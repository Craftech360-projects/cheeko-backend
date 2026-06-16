module.exports = {
  apps: [
    {
      name: "manager-api",
      script: "npm",
      args: "start",
      cwd: "/root/xiaozhi-esp32-server/main/manager-api-node",
      interpreter: "none"
    },
    {
      name: "manager-web",
      script: "npm",
      args: "run serve",
      cwd: "/root/xiaozhi-esp32-server/main/manager-web",
      interpreter: "none"
    },
    {
      name: "mqtt-gateway",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      interpreter: "node",
      watch: false
    },
    {
      name: "livekit-server",
      script: "main.py",
      args: "dev",
      cwd: "/root/xiaozhi-esp32-server/main/livekit-server",
      interpreter: "python3"
    },
    {
      name: "math-game",
      script: "workers/math_game_worker.py",
      args: "dev",
      cwd: "/root/xiaozhi-esp32-server/main/livekit-server",
      interpreter: "python3"
    },
    {
      name: "livekit-react-cheeko",
      script: "npm",
      args: "run dev",
      cwd: "/root/xiaozhi-esp32-server/livkit-react-with-python-cheeko",
      interpreter: "none",
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "line-art",
      script: "uvicorn",
      args: "app.main:app --host 0.0.0.0 --port 8003",
      cwd: "/root/xiaozhi-esp32-server/line_art",
      interpreter: "none"
    }
  ]
};


