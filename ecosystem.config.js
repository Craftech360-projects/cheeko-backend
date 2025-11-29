module.exports = {
  apps: [
    {
      name: "manager-api",
      script: "mvn",
      args: "spring-boot:run -Dspring-boot.run.profiles=dev",
      cwd: "/root/xiaozhi-esp32-server/main/manager-api",
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
      name: "livekit-media-api",
      script: "media_api.py",
      cwd: "/root/xiaozhi-esp32-server/main/livekit-server",
      interpreter: "python3",
      watch: false
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
    }
  ]
};
