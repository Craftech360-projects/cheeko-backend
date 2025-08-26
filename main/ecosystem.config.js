module.exports = {
  apps: [
    {
      name: "manager-web",
      cwd: "/root/xiaozhi-esp32-server/main/manager-web",
      script: "npm",
      args: "run serve",
      watch: false
    },
   {
    name: "manager-api",
    cwd: "/root/xiaozhi-esp32-server/main/manager-api",
    script: "mvn",
    args: "spring-boot:run",
    interpreter: "none",
    exec_mode: "fork"
    },

    {
      name: "mqtt-gateway",
      cwd: "/root/xiaozhi-esp32-server/main/mqtt-gateway",
      script: "app.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "xiaozhi-server",
      cwd: "/root/xiaozhi-esp32-server/main/xiaozhi-server",
      script: "app.py",
      interpreter: "/root/xiaozhi-esp32-server/main/xiaozhi-server/venv/bin/python",
      watch: false
    }

  ]
}
