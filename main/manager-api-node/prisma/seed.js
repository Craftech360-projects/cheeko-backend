/**
 * Database Seed Script
 *
 * Seeds the database with initial data from the MySQL manager-api database.
 * Runs automatically on server startup and only inserts records that don't exist.
 *
 * Tables seeded:
 * - sys_dict_type (dictionary types)
 * - sys_dict_data (dictionary values)
 * - sys_params (system parameters)
 * - sys_user (admin user)
 *
 * Usage:
 *   npm run prisma:seed
 *   - or -
 *   Called automatically from server.js on startup
 */

// Load environment variables
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase admin client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for seeding');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// SEED DATA - Exported from MySQL manager_api
// ============================================

const sysDictTypes = [
  { id: 101, dict_type: 'FIRMWARE_TYPE', dict_name: 'Firmware Type', remark: 'Firmware types dictionary', sort: 0 },
  { id: 102, dict_type: 'MOBILE_AREA', dict_name: 'Mobile Area', remark: 'Mobile area codes dictionary', sort: 0 },
];

const sysDictData = [
  // FIRMWARE_TYPE entries
  { id: 101001, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Bread Compact WiFi', dict_value: 'bread-compact-wifi', remark: 'Bread Compact WiFi', sort: 1 },
  { id: 101002, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Bread Compact WiFi + LCD', dict_value: 'bread-compact-wifi-lcd', remark: 'Bread Compact WiFi + LCD', sort: 2 },
  { id: 101003, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Bread Compact ML307 AT', dict_value: 'bread-compact-ml307', remark: 'Bread Compact ML307 AT', sort: 3 },
  { id: 101004, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Bread WiFi ESP32 DevKit', dict_value: 'bread-compact-esp32', remark: 'Bread WiFi ESP32 DevKit', sort: 4 },
  { id: 101005, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Bread WiFi + LCD ESP32 DevKit', dict_value: 'bread-compact-esp32-lcd', remark: 'Bread WiFi + LCD ESP32 DevKit', sort: 5 },
  { id: 101006, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'DFRobot Beetle K10', dict_value: 'df-k10', remark: 'DFRobot Beetle K10', sort: 6 },
  { id: 101007, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP32 CGC', dict_value: 'esp32-cgc', remark: 'ESP32 CGC', sort: 7 },
  { id: 101008, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP BOX 3', dict_value: 'esp-box-3', remark: 'ESP BOX 3', sort: 8 },
  { id: 101009, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP BOX', dict_value: 'esp-box', remark: 'ESP BOX', sort: 9 },
  { id: 101010, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP BOX Lite', dict_value: 'esp-box-lite', remark: 'ESP BOX Lite', sort: 10 },
  { id: 101011, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Kevin Box 1', dict_value: 'kevin-box-1', remark: 'Kevin Box 1', sort: 11 },
  { id: 101012, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Kevin Box 2', dict_value: 'kevin-box-2', remark: 'Kevin Box 2', sort: 12 },
  { id: 101013, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Kevin C3', dict_value: 'kevin-c3', remark: 'Kevin C3', sort: 13 },
  { id: 101014, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Kevin SP V3 Dev Board', dict_value: 'kevin-sp-v3-dev', remark: 'Kevin SP V3 Dev Board', sort: 14 },
  { id: 101015, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Kevin SP V4 Dev Board', dict_value: 'kevin-sp-v4-dev', remark: 'Kevin SP V4 Dev Board', sort: 15 },
  { id: 101016, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Yuying 3.13 LCD Dev Board', dict_value: 'kevin-yuying-313lcd', remark: 'Yuying 3.13 LCD Dev Board', sort: 16 },
  { id: 101017, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'LiChuang ESP32-S3 Dev Board', dict_value: 'lichuang-dev', remark: 'LiChuang ESP32-S3 Dev Board', sort: 17 },
  { id: 101018, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'LiChuang ESP32-C3 Dev Board', dict_value: 'lichuang-c3-dev', remark: 'LiChuang ESP32-C3 Dev Board', sort: 18 },
  { id: 101019, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Magiclick 2.4', dict_value: 'magiclick-2p4', remark: 'Magiclick 2.4', sort: 19 },
  { id: 101020, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Magiclick 2.5', dict_value: 'magiclick-2p5', remark: 'Magiclick 2.5', sort: 20 },
  { id: 101021, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Magiclick C3', dict_value: 'magiclick-c3', remark: 'Magiclick C3', sort: 21 },
  { id: 101022, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Magiclick C3 V2', dict_value: 'magiclick-c3-v2', remark: 'Magiclick C3 V2', sort: 22 },
  { id: 101023, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'M5Stack CoreS3', dict_value: 'm5stack-core-s3', remark: 'M5Stack CoreS3', sort: 23 },
  { id: 101024, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'AtomS3 + Echo Base', dict_value: 'atoms3-echo-base', remark: 'AtomS3 + Echo Base', sort: 24 },
  { id: 101025, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'AtomS3R + Echo Base', dict_value: 'atoms3r-echo-base', remark: 'AtomS3R + Echo Base', sort: 25 },
  { id: 101026, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'AtomS3R CAM/M12 + Echo Base', dict_value: 'atoms3r-cam-m12-echo-base', remark: 'AtomS3R CAM/M12 + Echo Base', sort: 26 },
  { id: 101027, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'AtomMatrix + Echo Base', dict_value: 'atommatrix-echo-base', remark: 'AtomMatrix + Echo Base', sort: 27 },
  { id: 101028, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'X Mini C3', dict_value: 'xmini-c3', remark: 'X Mini C3', sort: 28 },
  { id: 101029, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP32S3 KORVO2 V3 Dev Board', dict_value: 'esp32s3-korvo2-v3', remark: 'ESP32S3 KORVO2 V3 Dev Board', sort: 29 },
  { id: 101030, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP SparkBot Dev Board', dict_value: 'esp-sparkbot', remark: 'ESP SparkBot Dev Board', sort: 30 },
  { id: 101031, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'ESP-Spot-S3', dict_value: 'esp-spot-s3', remark: 'ESP-Spot-S3', sort: 31 },
  { id: 101032, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Waveshare ESP32-S3-Touch-AMOLED-1.8', dict_value: 'esp32-s3-touch-amoled-1.8', remark: 'Waveshare ESP32-S3-Touch-AMOLED-1.8', sort: 32 },
  { id: 101033, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Waveshare ESP32-S3-Touch-LCD-1.85C', dict_value: 'esp32-s3-touch-lcd-1.85c', remark: 'Waveshare ESP32-S3-Touch-LCD-1.85C', sort: 33 },
  { id: 101034, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Waveshare ESP32-S3-Touch-LCD-1.85', dict_value: 'esp32-s3-touch-lcd-1.85', remark: 'Waveshare ESP32-S3-Touch-LCD-1.85', sort: 34 },
  { id: 101035, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Waveshare ESP32-S3-Touch-LCD-1.46', dict_value: 'esp32-s3-touch-lcd-1.46', remark: 'Waveshare ESP32-S3-Touch-LCD-1.46', sort: 35 },
  { id: 101036, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Waveshare ESP32-S3-Touch-LCD-3.5', dict_value: 'esp32-s3-touch-lcd-3.5', remark: 'Waveshare ESP32-S3-Touch-LCD-3.5', sort: 36 },
  { id: 101037, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Tudouzi', dict_value: 'tudouzi', remark: 'Tudouzi', sort: 37 },
  { id: 101038, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'LILYGO T-Circle-S3', dict_value: 'lilygo-t-circle-s3', remark: 'LILYGO T-Circle-S3', sort: 38 },
  { id: 101039, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'LILYGO T-CameraPlus-S3', dict_value: 'lilygo-t-cameraplus-s3', remark: 'LILYGO T-CameraPlus-S3', sort: 39 },
  { id: 101040, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Movecall Moji AI Dev Board', dict_value: 'movecall-moji-esp32s3', remark: 'Movecall Moji AI Dev Board', sort: 40 },
  { id: 101041, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Movecall CuiCan AI Board', dict_value: 'movecall-cuican-esp32s3', remark: 'Movecall CuiCan AI Board', sort: 41 },
  { id: 101042, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Alientek DNESP32S3 Dev Board', dict_value: 'atk-dnesp32s3', remark: 'Alientek DNESP32S3 Dev Board', sort: 42 },
  { id: 101043, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'Alientek DNESP32S3-BOX', dict_value: 'atk-dnesp32s3-box', remark: 'Alientek DNESP32S3-BOX', sort: 43 },
  { id: 101044, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'DuDu CHATX (WiFi)', dict_value: 'du-chatx', remark: 'DuDu CHATX (WiFi)', sort: 44 },
  { id: 101045, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'TaiJi Pi ESP32S3', dict_value: 'taiji-pi-s3', remark: 'TaiJi Pi ESP32S3', sort: 45 },
  { id: 101046, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 0.85 (WiFi)', dict_value: 'xingzhi-cube-0.85tft-wifi', remark: 'XingZhi Cube 0.85 (WiFi)', sort: 46 },
  { id: 101047, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 0.85 (ML307)', dict_value: 'xingzhi-cube-0.85tft-ml307', remark: 'XingZhi Cube 0.85 (ML307)', sort: 47 },
  { id: 101048, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 0.96 (WiFi)', dict_value: 'xingzhi-cube-0.96oled-wifi', remark: 'XingZhi Cube 0.96 (WiFi)', sort: 48 },
  { id: 101049, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 0.96 (ML307)', dict_value: 'xingzhi-cube-0.96oled-ml307', remark: 'XingZhi Cube 0.96 (ML307)', sort: 49 },
  { id: 101050, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 1.54 (WiFi)', dict_value: 'xingzhi-cube-1.54tft-wifi', remark: 'XingZhi Cube 1.54 (WiFi)', sort: 50 },
  { id: 101051, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'XingZhi Cube 1.54 (ML307)', dict_value: 'xingzhi-cube-1.54tft-ml307', remark: 'XingZhi Cube 1.54 (ML307)', sort: 51 },
  { id: 101052, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'SenseCAP Watcher', dict_value: 'sensecap-watcher', remark: 'SenseCAP Watcher', sort: 52 },
  { id: 101053, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'DoIT AI Voice Box', dict_value: 'doit-s3-aibox', remark: 'DoIT AI Voice Box', sort: 53 },
  { id: 101054, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'MixGo Nova', dict_value: 'mixgo-nova', remark: 'MixGo Nova', sort: 54 },
  { id: 101055, dict_type_id: 101, dict_type: 'FIRMWARE_TYPE', dict_label: 'DoIT AI 01 Kit', dict_value: 'doit-ai-01-kit', remark: 'DoIT AI 01 Kit', sort: 55 },

  // MOBILE_AREA entries
  { id: 102001, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'China', dict_value: '+86', remark: 'China', sort: 1 },
  { id: 102002, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Hong Kong', dict_value: '+852', remark: 'Hong Kong', sort: 2 },
  { id: 102003, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Macau', dict_value: '+853', remark: 'Macau', sort: 3 },
  { id: 102004, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Taiwan', dict_value: '+886', remark: 'Taiwan', sort: 4 },
  { id: 102005, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'USA/Canada', dict_value: '+1', remark: 'USA/Canada', sort: 5 },
  { id: 102006, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'United Kingdom', dict_value: '+44', remark: 'United Kingdom', sort: 6 },
  { id: 102007, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'France', dict_value: '+33', remark: 'France', sort: 7 },
  { id: 102008, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Italy', dict_value: '+39', remark: 'Italy', sort: 8 },
  { id: 102009, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Germany', dict_value: '+49', remark: 'Germany', sort: 9 },
  { id: 102010, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Poland', dict_value: '+48', remark: 'Poland', sort: 10 },
  { id: 102011, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Switzerland', dict_value: '+41', remark: 'Switzerland', sort: 11 },
  { id: 102012, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Spain', dict_value: '+34', remark: 'Spain', sort: 12 },
  { id: 102013, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Denmark', dict_value: '+45', remark: 'Denmark', sort: 13 },
  { id: 102014, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Malaysia', dict_value: '+60', remark: 'Malaysia', sort: 14 },
  { id: 102015, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Australia', dict_value: '+61', remark: 'Australia', sort: 15 },
  { id: 102016, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Indonesia', dict_value: '+62', remark: 'Indonesia', sort: 16 },
  { id: 102017, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Philippines', dict_value: '+63', remark: 'Philippines', sort: 17 },
  { id: 102018, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'New Zealand', dict_value: '+64', remark: 'New Zealand', sort: 18 },
  { id: 102019, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Singapore', dict_value: '+65', remark: 'Singapore', sort: 19 },
  { id: 102020, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Thailand', dict_value: '+66', remark: 'Thailand', sort: 20 },
  { id: 102021, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Japan', dict_value: '+81', remark: 'Japan', sort: 21 },
  { id: 102022, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'South Korea', dict_value: '+82', remark: 'South Korea', sort: 22 },
  { id: 102023, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Vietnam', dict_value: '+84', remark: 'Vietnam', sort: 23 },
  { id: 102024, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'India', dict_value: '+91', remark: 'India', sort: 24 },
  { id: 102025, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Pakistan', dict_value: '+92', remark: 'Pakistan', sort: 25 },
  { id: 102026, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Nigeria', dict_value: '+234', remark: 'Nigeria', sort: 26 },
  { id: 102027, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Bangladesh', dict_value: '+880', remark: 'Bangladesh', sort: 27 },
  { id: 102028, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Saudi Arabia', dict_value: '+966', remark: 'Saudi Arabia', sort: 28 },
  { id: 102029, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'UAE', dict_value: '+971', remark: 'United Arab Emirates', sort: 29 },
  { id: 102030, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Brazil', dict_value: '+55', remark: 'Brazil', sort: 30 },
  { id: 102031, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Mexico', dict_value: '+52', remark: 'Mexico', sort: 31 },
  { id: 102032, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Chile', dict_value: '+56', remark: 'Chile', sort: 32 },
  { id: 102033, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Argentina', dict_value: '+54', remark: 'Argentina', sort: 33 },
  { id: 102034, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Egypt', dict_value: '+20', remark: 'Egypt', sort: 34 },
  { id: 102035, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'South Africa', dict_value: '+27', remark: 'South Africa', sort: 35 },
  { id: 102036, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Kenya', dict_value: '+254', remark: 'Kenya', sort: 36 },
  { id: 102037, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Tanzania', dict_value: '+255', remark: 'Tanzania', sort: 37 },
  { id: 102038, dict_type_id: 102, dict_type: 'MOBILE_AREA', dict_label: 'Russia', dict_value: '+7', remark: 'Russia', sort: 38 },
];

const sysParams = [
  { id: 102, param_code: 'server.secret', param_value: 'da11d988-f105-4e71-b095-da62ada82189', value_type: 'string', param_type: 1, remark: 'Server secret key for authentication' },
  { id: 103, param_code: 'server.allow_user_register', param_value: 'true', value_type: 'boolean', param_type: 1, remark: 'Allow user self-registration' },
  { id: 104, param_code: 'server.fronted_url', param_value: 'http://localhost:8001', value_type: 'string', param_type: 1, remark: 'Frontend URL for device binding QR code' },
  { id: 106, param_code: 'server.websocket', param_value: 'ws://localhost:8000/xiaozhi/v1/', value_type: 'string', param_type: 1, remark: 'WebSocket server URLs (semicolon separated)' },
  { id: 107, param_code: 'server.ota', param_value: 'http://localhost:8002/toy/ota/', value_type: 'string', param_type: 1, remark: 'OTA firmware update URL' },
  { id: 108, param_code: 'server.name', param_value: 'cheeko-esp32-server', value_type: 'string', param_type: 1, remark: 'Server name' },
  { id: 302, param_code: 'close_connection_no_voice_time', param_value: '120', value_type: 'number', param_type: 1, remark: 'Time to disconnect when no voice input (seconds)' },
  { id: 305, param_code: 'enable_greeting', param_value: 'true', value_type: 'boolean', param_type: 1, remark: 'Enable greeting message on connection' },
  { id: 309, param_code: 'cheeko', param_value: '{\n  "type": "hello",\n  "version": 1,\n  "transport": "websocket",\n  "audio_params": {\n    "format": "opus",\n    "sample_rate": 16000,\n    "channels": 1,\n    "frame_duration": 60\n  }\n}', value_type: 'json', param_type: 1, remark: 'Protocol configuration JSON' },
  { id: 310, param_code: 'wakeup_words', param_value: 'hello cheeko;hey cheeko;cheeko cheeko;hey assistant;hello assistant;wake up;listen to me;hey buddy', value_type: 'array', param_type: 1, remark: 'Wake word list for wake word recognition' },
  { id: 500, param_code: 'end_prompt.enable', param_value: 'true', value_type: 'boolean', param_type: 1, remark: 'Enable end prompt feature' },
  { id: 501, param_code: 'end_prompt.prompt', param_value: 'Goodbye! Looking forward to chatting with you again!', value_type: 'string', param_type: 1, remark: 'End prompt message template' },
  { id: 600, param_code: 'mqtt.broker', param_value: '192.168.1.99', value_type: 'string', param_type: 1, remark: 'MQTT broker IP address or hostname' },
  { id: 601, param_code: 'mqtt.port', param_value: '1883', value_type: 'string', param_type: 1, remark: 'MQTT broker port' },
  { id: 602, param_code: 'mqtt.signature_key', param_value: 'test-signature-key-12345', value_type: 'string', param_type: 1, remark: 'MQTT password signature key for HMAC-SHA256' },
  { id: 701, param_code: 'server.enable_mobile_register', param_value: 'false', value_type: 'boolean', param_type: 1, remark: 'Enable mobile registration' },
  { id: 702, param_code: 'server.beian_icp_num', param_value: '', value_type: 'string', param_type: 1, remark: 'ICP registration number' },
  { id: 703, param_code: 'server.beian_ga_num', param_value: '', value_type: 'string', param_type: 1, remark: 'GA registration number' },
];

const sysUsers = [
  {
    id: '2009521127141888000',
    username: 'admin',
    password: '$2a$10$UaqDQlwQWgEz9pi76AHc/.8FZkVyQkIyHooQClEGplGjOAagtRPi',
    email: null,
    phone: null,
    nickname: 'Administrator',
    avatar: null,
    gender: 0,
    status: 1,
    role: 'admin',
    last_login_at: null,
  },
];

// ============================================
// SEED FUNCTIONS
// ============================================

async function seedTable(tableName, data, idField = 'id') {
  console.log(`Seeding ${tableName}...`);
  let inserted = 0, skipped = 0, errors = 0;

  for (const record of data) {
    // Check if record exists
    const { data: existing } = await supabase
      .from(tableName)
      .select(idField)
      .eq(idField, record[idField])
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    // Insert record
    const { error } = await supabase
      .from(tableName)
      .insert(record);

    if (error) {
      if (error.code === '23505') { // Unique violation - already exists
        skipped++;
      } else {
        console.error(`  Error inserting ${tableName} id=${record[idField]}: ${error.message}`);
        errors++;
      }
    } else {
      inserted++;
    }
  }

  console.log(`  ${tableName}: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
  return { inserted, skipped, errors };
}

async function main() {
  console.log('\n========================================');
  console.log('Starting database seed...');
  console.log('========================================\n');

  try {
    // Seed in order (types before data due to foreign key)
    await seedTable('sys_dict_type', sysDictTypes);
    await seedTable('sys_dict_data', sysDictData);
    await seedTable('sys_params', sysParams);
    await seedTable('sys_user', sysUsers);

    console.log('\n========================================');
    console.log('Database seed completed successfully!');
    console.log('========================================\n');
  } catch (error) {
    console.error('Seed failed:', error);
    throw error;
  }
}

// Export for use in server.js
module.exports = { main };

// Run if called directly
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
