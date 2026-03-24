/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview', 'architecture/protocols'],
    },
    {
      type: 'category',
      label: 'Firmware Integration',
      items: ['firmware/integration-guide'],
    },
    {
      type: 'category',
      label: 'Backend',
      items: [
        'backend/database-schema',
        'backend/mcp-protocol',
        {
          type: 'category',
          label: 'Manager API (Node.js)',
          items: [
            'backend/manager-api/overview',
            'backend/manager-api/ota',
            'backend/manager-api/device',
            'backend/manager-api/agent',
            'backend/manager-api/content',
            'backend/manager-api/rfid',
          ],
        },
        {
          type: 'category',
          label: 'MQTT Gateway',
          items: [
            'backend/mqtt-gateway/overview',
            'backend/mqtt-gateway/mqtt-protocol',
            'backend/mqtt-gateway/audio-pipeline',
          ],
        },
        {
          type: 'category',
          label: 'LiveKit Server (AI)',
          items: [
            'backend/livekit-server/overview',
            'backend/livekit-server/cheeko-agent',
            'backend/livekit-server/game-workers',
            'backend/livekit-server/function-tools',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'RFID Cards',
      items: ['rfid/overview'],
    },
    {
      type: 'category',
      label: 'Admin Dashboard',
      items: ['admin/manager-web'],
    },
    {
      type: 'category',
      label: 'Mobile App',
      items: ['mobile/parent-app'],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: ['deployment/environment', 'deployment/pm2', 'deployment/scaling'],
    },
  ],
};

module.exports = sidebars;
