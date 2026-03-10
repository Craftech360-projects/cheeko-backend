module.exports = {
  apps: [
    // --- Manager API (Node.js) ---
    {
      name: "manager-api",
      script: "server.js",
      cwd: "/root/xiaozhi-esp32-server/main/manager-api-node",
      time: true
    },

    // --- Manager Web (Vue frontend) ---
    {
      name: "manager-web",
      script: "npm",
      args: "run serve",
      cwd: "/root/xiaozhi-esp32-server/main/manager-web",
      interpreter: "none",
      time: true
    },

    // --- MQTT Gateway (4 instances with shared subscription) ---
    {
      name: "gateway-1",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      time: true,
      env: {
        INSTANCE_ID: "1",
        UDP_PORT: "8881",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-2",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      time: true,
      env: {
        INSTANCE_ID: "2",
        UDP_PORT: "8882",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-3",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      time: true,
      env: {
        INSTANCE_ID: "3",
        UDP_PORT: "8883",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },
    {
      name: "gateway-4",
      script: "app.js",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      time: true,
      env: {
        INSTANCE_ID: "4",
        UDP_PORT: "8884",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    },

    // --- LiveKit Server (Python) ---
    // {
    //   name: "livekit-server",
    //   script: "main.py",
    //   args: "dev",
    //   cwd: "/root/xiaozhi-esp32-server/main/livekit-server",
    //   interpreter: "python3",
    //   time: true
    // },

    // --- LiveKit React (Cheeko) ---
    // {
    //   name: "livekit-react-cheeko",
    //   script: "npm",
    //   args: "run dev",
    //   cwd: "/root/xiaozhi-esp32-server/livkit-react-with-python-cheeko",
    //   interpreter: "none",
    //   time: true,
    //   env: {
    //     NODE_ENV: "development"
    //   }
    // }
  ]
};
