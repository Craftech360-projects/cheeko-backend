module.exports = {
  apps: [
    {
      name: "gateway-1",
      script: "app.js",
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
      time: true,
      env: {
        INSTANCE_ID: "4",
        UDP_PORT: "8884",
        WORKER_COUNT: "4",
        DISABLE_WORKER_AUTOSCALE: "true"
      }
    }
  ]
};
