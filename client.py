import json
import time
import uuid
import threading
import socket
import struct
import logging
import pyaudio
import keyboard
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Dict, Optional, Tuple
import requests
import paho.mqtt.client as mqtt_client
from paho.mqtt.enums import CallbackAPIVersion
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from queue import Queue, Empty
import opuslib

# --- Configuration ---

SERVER_IP = "192.168.1.101"
OTA_PORT = 8002
MQTT_BROKER_HOST =  "192.168.1.101"


MQTT_BROKER_PORT = 1883
# DEVICE_MAC is now dynamically generated for uniqueness
# Minimum frames to have in buffer to continue playback
PLAYBACK_BUFFER_MIN_FRAMES = 3
# Number of frames to buffer before starting playback
PLAYBACK_BUFFER_START_FRAMES = 16

# --- NEW: Sequence tracking configuration ---
# Set to False to disable sequence logging
ENABLE_SEQUENCE_LOGGING = True
LOG_SEQUENCE_EVERY_N_PACKETS = 32  # Reduced logging frequency for multi-client scenarios

# --- NEW: Timeout configurations ---
TTS_TIMEOUT_SECONDS = 30  # Maximum time to wait for TTS audio
BUFFER_TIMEOUT_SECONDS = 5  # Reduced timeout for faster recovery
KEEP_ALIVE_INTERVAL = 5  # Send keep-alive every N seconds

# --- Logging ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("TestClient")

# --- Global variables ---
mqtt_message_queue = Queue()
udp_session_details = {}
stop_threads = threading.Event()
# Event to signal recording thread to start
start_recording_event = threading.Event()
# Event to signal recording thread to stop
stop_recording_event = threading.Event()

# --- Web UI state ---
RFID_WEB_UI_PORT = 8088
_web_ui_client = None
_last_rfid_response = None
_last_rfid_response_time = 0
_rfid_response_history = []  # capped at 20 entries

RFID_HTML_PAGE = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cheeko Device Simulator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#060918;--surface:rgba(255,255,255,0.04);--surface-hover:rgba(255,255,255,0.07);--border:rgba(255,255,255,0.08);--border-focus:rgba(59,130,246,0.5);--text:#e2e8f0;--text-muted:#64748b;--text-dim:#475569;--blue:#3b82f6;--green:#22c55e;--amber:#f59e0b;--red:#ef4444;--purple:#8b5cf6;--inset:#030712;--radius:12px;--radius-sm:8px;--font-ui:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono','Fira Code',monospace}
body{font-family:var(--font-ui);background:var(--bg);color:var(--text);min-height:100vh;padding:0}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(59,130,246,0.08),transparent 70%);pointer-events:none;z-index:0}

/* Header */
.header{position:sticky;top:0;z-index:50;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;background:rgba(6,9,24,0.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.header-left{display:flex;align-items:center;gap:12px}
.logo{width:28px;height:28px;background:linear-gradient(135deg,var(--blue),var(--purple));border-radius:8px;display:flex;align-items:center;justify-content:center}
.logo svg{width:16px;height:16px;fill:white}
.header-title{font-size:16px;font-weight:700;letter-spacing:-0.02em}
.header-right{display:flex;align-items:center;gap:16px;font-size:12px}
.status-pill{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;background:var(--surface);border:1px solid var(--border)}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0}
.status-dot.off{background:var(--red)}
.mac-display{font-family:var(--font-mono);color:var(--text-muted);font-size:11px}

/* Layout */
.main{position:relative;z-index:1;max-width:960px;margin:0 auto;padding:20px 24px;display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start}
@media(max-width:800px){.main{grid-template-columns:1fr;max-width:500px}}

/* Cards */
.card{background:var(--surface);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:var(--radius);padding:20px;transition:border-color 0.2s}
.card:hover{border-color:rgba(255,255,255,0.12)}
.card+.card{margin-top:16px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.card-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)}
.card-icon{width:18px;height:18px;color:var(--text-dim)}

/* Inputs */
label{display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:500}
input[type="text"],select{width:100%;padding:10px 12px;background:var(--inset);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:13px;font-family:var(--font-mono);outline:none;transition:border-color 0.2s,box-shadow 0.2s}
input[type="text"]:focus,select:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(59,130,246,0.15)}
input::placeholder{color:var(--text-dim)}
.input-row{display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:12px}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 16px;border:none;border-radius:var(--radius-sm);font-size:13px;font-weight:600;font-family:var(--font-ui);cursor:pointer;transition:all 0.15s;outline:none}
.btn:active{transform:scale(0.97)}
.btn:disabled{opacity:0.4;cursor:not-allowed;transform:none}
.btn-primary{background:var(--blue);color:white;width:100%}
.btn-primary:hover:not(:disabled){background:#2563eb;box-shadow:0 0 20px rgba(59,130,246,0.25)}
.btn-sm{padding:7px 10px;font-size:12px;font-weight:500}
.btn-ghost{background:var(--surface);color:var(--text-muted);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--surface-hover);color:var(--text);border-color:rgba(255,255,255,0.15)}
.btn-danger{background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.2)}
.btn-danger:hover{background:rgba(239,68,68,0.2)}

/* Control Grid */
.ctrl-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.ctrl-btn{padding:10px 8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;font-weight:500;font-family:var(--font-ui);cursor:pointer;transition:all 0.15s;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px}
.ctrl-btn:hover{background:var(--surface-hover);border-color:rgba(255,255,255,0.15)}
.ctrl-btn:active{transform:scale(0.96)}
.ctrl-btn svg{width:16px;height:16px;opacity:0.7}
.ctrl-btn.listen{border-color:rgba(34,197,94,0.3)}
.ctrl-btn.listen:hover{background:rgba(34,197,94,0.08);border-color:rgba(34,197,94,0.5)}
.ctrl-btn.abort{border-color:rgba(239,68,68,0.3)}
.ctrl-btn.abort:hover{background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.5)}
.ctrl-btn.goodbye{border-color:rgba(249,115,22,0.3)}
.ctrl-btn.goodbye:hover{background:rgba(249,115,22,0.08);border-color:rgba(249,115,22,0.5)}

/* Advanced section */
details{margin-top:12px}
summary{font-size:11px;color:var(--text-dim);cursor:pointer;user-select:none;padding:4px 0;letter-spacing:0.04em;text-transform:uppercase;font-weight:600}
summary:hover{color:var(--text-muted)}
details[open] summary{margin-bottom:12px}
.adv-row{display:flex;gap:8px;margin-bottom:8px;align-items:end}
.adv-row label{margin-bottom:0}
.adv-row .adv-input{flex:1}
.adv-row .adv-input label{margin-bottom:4px}
.adv-row select,.adv-row input{margin-bottom:0}

/* Quick UIDs */
.quick-uids{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;min-height:26px}
.uid-chip{padding:3px 10px;background:var(--surface);border:1px solid var(--border);border-radius:20px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);cursor:pointer;transition:all 0.15s}
.uid-chip:hover{background:var(--surface-hover);color:var(--text);border-color:rgba(255,255,255,0.15)}

/* Response Panel */
.resp-empty{color:var(--text-dim);font-size:13px;text-align:center;padding:40px 20px}
.resp-empty svg{width:32px;height:32px;margin-bottom:12px;opacity:0.3}
.badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;margin-bottom:12px;letter-spacing:0.03em}
.badge-green{background:rgba(34,197,94,0.12);color:var(--green)}
.badge-blue{background:rgba(59,130,246,0.12);color:var(--blue)}
.badge-purple{background:rgba(139,92,246,0.12);color:var(--purple)}
.meta-table{width:100%;margin-bottom:12px}
.meta-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}
.meta-label{color:var(--text-muted)}
.meta-value{color:var(--text);font-weight:500;font-family:var(--font-mono);font-size:11px}
.file-list{margin-top:8px;max-height:400px;overflow-y:auto}
.file-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);transition:background 0.15s}
.file-row:nth-child(odd){background:rgba(255,255,255,0.02)}
.file-row:hover{background:rgba(255,255,255,0.05)}
.file-row svg{width:14px;height:14px;flex-shrink:0;opacity:0.5}
.file-seq{color:var(--blue);font-weight:600;min-width:24px}
.file-url{word-break:break-all;flex:1;font-size:10px;opacity:0.7}
.file-actions{display:flex;gap:4px;flex-shrink:0}
.play-btn,.view-btn{padding:4px 8px;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:4px}
.play-btn{background:rgba(34,197,94,0.15);color:var(--green)}
.play-btn:hover{background:rgba(34,197,94,0.25)}
.play-btn.playing{background:rgba(239,68,68,0.15);color:var(--red)}
.view-btn{background:rgba(139,92,246,0.15);color:var(--purple)}
.view-btn:hover{background:rgba(139,92,246,0.25)}
.play-btn svg,.view-btn svg{width:12px;height:12px}

/* Audio Player */
.audio-player{margin-top:12px;padding:12px;background:var(--inset);border-radius:var(--radius-sm);display:none}
.audio-player.active{display:block}
.audio-player-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.audio-player-title{font-size:12px;font-weight:600;color:var(--text)}
.audio-player-close{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px}
.audio-player audio{width:100%}

/* Image Modal */
.img-modal{position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
.img-modal.active{display:flex}
.img-modal-content{max-width:90%;max-height:90%;position:relative}
.img-modal-content img{max-width:100%;max-height:80vh;border-radius:8px}
.img-modal-close{position:absolute;top:-40px;right:0;background:none;border:none;color:white;font-size:24px;cursor:pointer}
.img-modal-info{color:white;text-align:center;margin-top:12px;font-size:12px;font-family:var(--font-mono)}

/* Play All Button */
.play-all-btn{margin-top:12px;width:100%;padding:10px;background:linear-gradient(135deg,var(--green),#16a34a);color:white;border:none;border-radius:var(--radius-sm);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.15s}
.play-all-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(34,197,94,0.3)}
.play-all-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.play-all-btn svg{width:16px;height:16px}
.json-pre{background:var(--inset);border-radius:var(--radius-sm);padding:14px;font-family:var(--font-mono);font-size:12px;line-height:1.6;overflow-x:auto;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.json-key{color:#94a3b8}
.json-str{color:#4ade80}
.json-num{color:#fbbf24}
.json-bool{color:#c084fc}
.json-null{color:#64748b}

/* Log */
.log-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.log-area{background:var(--inset);border-radius:var(--radius-sm);padding:10px 12px;max-height:200px;overflow-y:auto;font-family:var(--font-mono);font-size:11px;line-height:1.7;color:var(--text-dim)}
.log-entry{display:flex;gap:8px}
.log-ts{color:var(--text-dim);opacity:0.5;flex-shrink:0}
.log-msg{}
.log-entry.ok .log-msg{color:var(--green)}
.log-entry.info .log-msg{color:var(--blue)}
.log-entry.err .log-msg{color:var(--red)}
.log-entry.warn .log-msg{color:var(--amber)}

/* History */
.hist-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background 0.15s;font-size:12px}
.hist-item:hover{background:var(--surface-hover)}
.hist-ts{color:var(--text-dim);font-size:10px;font-family:var(--font-mono);flex-shrink:0}
.hist-uid{font-family:var(--font-mono);font-weight:500;flex:1}
.hist-badge{font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600}

/* Scrollbar */
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.2)}

/* Spinner */
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.6s linear infinite;display:none}
.btn.loading .spinner{display:block}
.btn.loading .btn-text{display:none}
</style>
</head><body>

<!-- Header -->
<header class="header">
  <div class="header-left">
    <div class="logo"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93s3.05-7.44 7-7.93v15.86zm2-15.86c1.03.13 2 .45 2.87.93H13v-.93zM13 7h5.24c.25.31.48.65.68 1H13V7zm0 3h6.74c.08.33.15.66.19 1H13v-1zm0 9.93V14h2.87c-.87.48-1.84.8-2.87.93zM18.24 13H13v-1h6.93c-.04.34-.11.67-.19 1zM13 17v-1h5.92c-.2.35-.43.69-.68 1H13z"/></svg></div>
    <span class="header-title">Cheeko Device Simulator</span>
  </div>
  <div class="header-right">
    <span class="mac-display" id="macDisplay">--:--:--:--:--:--</span>
    <div class="status-pill">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusTxt">Connecting</span>
    </div>
  </div>
</header>

<!-- Main Grid -->
<div class="main">
  <!-- LEFT COLUMN -->
  <div class="left-col">

    <!-- RFID Scanner -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">RFID Scanner</span>
        <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>
      </div>
      <div class="quick-uids" id="quickUids"></div>
      <div class="input-row">
        <div><label>RFID UID</label><input type="text" id="uid" placeholder="e.g. 12345678"></div>
        <div><label>Sequence</label><input type="text" id="seq" placeholder="1"></div>
      </div>
      <button class="btn btn-primary" id="sendBtn" onclick="sendRfid()">
        <span class="btn-text">Scan Card</span>
        <div class="spinner"></div>
      </button>
    </div>

    <!-- Device Controls -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Device Controls</span>
        <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>
      </div>
      <div class="ctrl-grid">
        <button class="ctrl-btn listen" onclick="sendAction('listen')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          Listen
        </button>
        <button class="ctrl-btn abort" onclick="sendAction('abort')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
          Abort
        </button>
        <button class="ctrl-btn" onclick="sendAction('previous')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19,20 9,12 19,4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          Prev Track
        </button>
        <button class="ctrl-btn" onclick="sendAction('next')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          Next Track
        </button>
        <button class="ctrl-btn" onclick="sendAction('start_agent')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Start Agent
        </button>
        <button class="ctrl-btn goodbye" onclick="sendAction('goodbye')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          Goodbye
        </button>
      </div>

      <details>
        <summary>Advanced Controls</summary>
        <div class="adv-row">
          <div class="adv-input"><label>Mode</label><select id="modeSelect">
            <option value="conversation">Conversation</option>
            <option value="music">Music</option>
            <option value="story">Story</option>
            <option value="game">Game</option>
          </select></div>
          <button class="btn btn-sm btn-ghost" onclick="sendAction('mode-change',{mode:document.getElementById('modeSelect').value})">Apply</button>
        </div>
        <div class="adv-row">
          <div class="adv-input"><label>Character</label><input type="text" id="charInput" placeholder="Character name"></div>
          <button class="btn btn-sm btn-ghost" onclick="sendAction('character-change',{character:document.getElementById('charInput').value})">Apply</button>
        </div>
        <div class="adv-row">
          <div class="adv-input"><label>Download</label><select id="dlSelect">
            <option value="story">Story</option>
            <option value="rhyme">Rhyme</option>
            <option value="habit">Habit</option>
          </select></div>
          <button class="btn btn-sm btn-ghost" onclick="sendAction('download_request',{content_type:document.getElementById('dlSelect').value})">Request</button>
        </div>
      </details>
    </div>

    <!-- Scan History -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Scan History</span>
      </div>
      <div id="history"><div class="resp-empty" style="padding:12px;font-size:12px">No scans yet</div></div>
    </div>
  </div>

  <!-- RIGHT COLUMN -->
  <div class="right-col">

    <!-- Response -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Response</span>
      </div>
      <div id="resp">
        <div class="resp-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/></svg>
          <div>No response yet. Scan a card or send a command.</div>
        </div>
      </div>
    </div>

    <!-- Activity Log -->
    <div class="card">
      <div class="log-header">
        <span class="card-title">Activity Log</span>
        <button class="btn btn-sm btn-ghost" onclick="clearLog()" style="padding:4px 10px;font-size:11px">Clear</button>
      </div>
      <div class="log-area" id="log"></div>
    </div>
  </div>
</div>

<!-- Audio Player (hidden by default) -->
<div class="audio-player" id="audioPlayer">
  <div class="audio-player-header">
    <span class="audio-player-title" id="audioTitle">Now Playing</span>
    <button class="audio-player-close" onclick="stopAudio()">&times;</button>
  </div>
  <audio id="audioElement" controls></audio>
</div>

<!-- Image Modal -->
<div class="img-modal" id="imgModal" onclick="closeImageModal()">
  <div class="img-modal-content" onclick="event.stopPropagation()">
    <button class="img-modal-close" onclick="closeImageModal()">&times;</button>
    <img id="modalImg" src="" alt="Preview">
    <div class="img-modal-info" id="modalInfo"></div>
  </div>
</div>

<script>
let lastT=0;
const scanHistory=[];
let currentAudio=null;
let currentPlaylist=[];
let currentTrackIndex=0;
let isPlayingAll=false;

/* --- Logging --- */
function addLog(m,t=''){
  const a=document.getElementById('log'),d=document.createElement('div');
  d.className='log-entry '+t;
  const ts=document.createElement('span');ts.className='log-ts';ts.textContent=new Date().toLocaleTimeString();
  const msg=document.createElement('span');msg.className='log-msg';msg.textContent=m;
  d.appendChild(ts);d.appendChild(msg);a.appendChild(d);a.scrollTop=a.scrollHeight;
}
function clearLog(){document.getElementById('log').innerHTML='';addLog('Log cleared','info')}

/* --- Quick UIDs (localStorage) --- */
function getRecentUids(){try{return JSON.parse(localStorage.getItem('cheeko_uids')||'[]')}catch(e){return[]}}
function saveRecentUid(uid){
  let list=getRecentUids().filter(u=>u!==uid);
  list.unshift(uid);list=list.slice(0,5);
  localStorage.setItem('cheeko_uids',JSON.stringify(list));
  renderQuickUids();
}
function renderQuickUids(){
  const c=document.getElementById('quickUids'),list=getRecentUids();
  c.innerHTML='';
  list.forEach(uid=>{
    const ch=document.createElement('span');ch.className='uid-chip';ch.textContent=uid;
    ch.onclick=()=>{document.getElementById('uid').value=uid};
    c.appendChild(ch);
  });
}

/* --- RFID Scan --- */
async function sendRfid(){
  const uid=document.getElementById('uid').value.trim(),seq=document.getElementById('seq').value.trim();
  if(!uid){addLog('RFID UID is required','err');return}
  const btn=document.getElementById('sendBtn');btn.classList.add('loading');btn.disabled=true;
  try{
    const r=await fetch('/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rfid_uid:uid,sequence:seq})});
    const d=await r.json();
    if(d.status==='sent'){addLog('RFID scan sent: '+uid+(seq?' seq='+seq:''),'ok');saveRecentUid(uid);addHistory(uid,seq)}
    else addLog('Error: '+d.error,'err');
  }catch(e){addLog('Send failed: '+e.message,'err')}
  btn.classList.remove('loading');btn.disabled=false;
}

/* --- Device Actions --- */
async function sendAction(action,extra){
  addLog('Sending: '+action,'info');
  try{
    const body={action};if(extra)Object.assign(body,extra);
    const r=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.status==='sent')addLog('Action sent: '+action,'ok');
    else addLog('Error: '+(d.error||'unknown'),'err');
  }catch(e){addLog('Action failed: '+e.message,'err')}
}

/* --- Scan History --- */
function addHistory(uid,seq){
  scanHistory.unshift({uid,seq,time:new Date(),type:null});
  if(scanHistory.length>10)scanHistory.pop();
  renderHistory();
}
function renderHistory(){
  const c=document.getElementById('history');
  if(!scanHistory.length){c.innerHTML='<div class="resp-empty" style="padding:12px;font-size:12px">No scans yet</div>';return}
  c.innerHTML='';
  scanHistory.forEach((h,i)=>{
    const d=document.createElement('div');d.className='hist-item';
    d.innerHTML='<span class="hist-ts">'+h.time.toLocaleTimeString()+'</span>'
      +'<span class="hist-uid">'+h.uid+(h.seq?' #'+h.seq:'')+'</span>'
      +(h.type?'<span class="hist-badge" style="background:rgba(34,197,94,0.12);color:var(--green)">'+h.type+'</span>':'');
    d.onclick=()=>{document.getElementById('uid').value=h.uid;if(h.seq)document.getElementById('seq').value=h.seq;sendRfid()};
    c.appendChild(d);
  });
}

/* --- JSON syntax highlight --- */
function highlightJson(obj){
  const s=JSON.stringify(obj,null,2);
  return s.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*")(\\s*:)?/g,function(m){
    let cls='json-str';
    if(/:$/.test(m)){cls='json-key';m=m.slice(0,-1)+':'}
    else if(/^"/.test(m))cls='json-str';
    return '<span class="'+cls+'">'+m+'</span>';
  }).replace(/\\b(true|false)\\b/g,'<span class="json-bool">$1</span>')
    .replace(/\\bnull\\b/g,'<span class="json-null">null</span>')
    .replace(/\\b(-?\\d+\\.?\\d*)\\b/g,'<span class="json-num">$1</span>');
}

/* --- Audio Playback --- */
function playAudio(url,title,idx){
  const player=document.getElementById('audioPlayer');
  const audio=document.getElementById('audioElement');
  const titleEl=document.getElementById('audioTitle');

  // Update all play buttons
  document.querySelectorAll('.play-btn').forEach(btn=>btn.classList.remove('playing'));
  const activeBtn=document.querySelector('.play-btn[data-idx="'+idx+'"]');
  if(activeBtn)activeBtn.classList.add('playing');

  titleEl.textContent='Playing: '+title;
  audio.src=url;
  audio.play();
  player.classList.add('active');
  currentAudio={url,title,idx};
  addLog('Playing audio #'+idx+': '+title,'info');
}

function stopAudio(){
  const player=document.getElementById('audioPlayer');
  const audio=document.getElementById('audioElement');
  audio.pause();
  audio.src='';
  player.classList.remove('active');
  document.querySelectorAll('.play-btn').forEach(btn=>btn.classList.remove('playing'));
  currentAudio=null;
  isPlayingAll=false;
  addLog('Audio stopped','info');
}

function playAll(audioList,skillName){
  if(!audioList||!audioList.length)return;
  currentPlaylist=audioList;
  currentTrackIndex=0;
  isPlayingAll=true;

  const audio=document.getElementById('audioElement');
  audio.onended=()=>{
    if(isPlayingAll&&currentTrackIndex<currentPlaylist.length-1){
      currentTrackIndex++;
      const next=currentPlaylist[currentTrackIndex];
      playAudio(next.url,skillName+' #'+next.index,next.index);
    }else{
      isPlayingAll=false;
      document.querySelectorAll('.play-btn').forEach(btn=>btn.classList.remove('playing'));
    }
  };

  const first=currentPlaylist[0];
  playAudio(first.url,skillName+' #'+first.index,first.index);
  addLog('Playing all '+audioList.length+' tracks','ok');
}

/* --- Image Viewing --- */
function isBinFile(url){return url&&url.toLowerCase().endsWith('.bin')}

// Decode LVGL .bin file (RGB565 format) to canvas
async function decodeLvglBin(url){
  const resp=await fetch(url);
  const buf=await resp.arrayBuffer();
  const data=new DataView(buf);

  // Parse 12-byte LVGL header (little-endian)
  const magic=data.getUint8(0);      // 0x19 for LVGL v9
  const cf=data.getUint8(1);          // Color format (0x12=RGB565)
  const flags=data.getUint16(2,true);
  const w=data.getUint16(4,true);
  const h=data.getUint16(6,true);
  const stride=data.getUint16(8,true);

  console.log('LVGL Header:',{magic:magic.toString(16),cf:cf.toString(16),w,h,stride});

  // Create canvas
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');
  const imgData=ctx.createImageData(w,h);

  // Decode pixels starting after 12-byte header
  let offset=12;
  let pixIdx=0;

  if(cf===0x12){  // RGB565
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const rgb565=data.getUint16(offset,true);
        offset+=2;

        // Extract RGB565 components and convert to RGB888
        const r=((rgb565>>11)&0x1F)*255/31;
        const g=((rgb565>>5)&0x3F)*255/63;
        const b=(rgb565&0x1F)*255/31;

        imgData.data[pixIdx++]=r;
        imgData.data[pixIdx++]=g;
        imgData.data[pixIdx++]=b;
        imgData.data[pixIdx++]=255;
      }
    }
  }else if(cf===0x0F){  // RGB888
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const b=data.getUint8(offset++);
        const g=data.getUint8(offset++);
        const r=data.getUint8(offset++);
        imgData.data[pixIdx++]=r;
        imgData.data[pixIdx++]=g;
        imgData.data[pixIdx++]=b;
        imgData.data[pixIdx++]=255;
      }
    }
  }else{
    throw new Error('Unsupported color format: 0x'+cf.toString(16));
  }

  ctx.putImageData(imgData,0,0);
  return {canvas,w,h,cf};
}

async function viewImage(url,title){
  const modal=document.getElementById('imgModal');
  const img=document.getElementById('modalImg');
  const info=document.getElementById('modalInfo');

  // Handle LVGL .bin files
  if(isBinFile(url)){
    addLog('Decoding LVGL binary: '+title,'info');
    try{
      const {canvas,w,h,cf}=await decodeLvglBin(url);
      img.src=canvas.toDataURL('image/png');
      const fmt=cf===0x12?'RGB565':cf===0x0F?'RGB888':'0x'+cf.toString(16);
      info.textContent=title+' ('+w+'x'+h+', '+fmt+')';
      modal.classList.add('active');
      addLog('Decoded '+w+'x'+h+' '+fmt+' image','ok');
    }catch(e){
      addLog('Failed to decode .bin: '+e.message,'err');
      // Fallback to download
      const a=document.createElement('a');
      a.href=url;a.download=url.split('/').pop();a.target='_blank';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
    }
    return;
  }

  // Regular image files
  img.src=url;
  info.textContent=title;
  modal.classList.add('active');
  addLog('Viewing image: '+title,'info');
}

function closeImageModal(){
  document.getElementById('imgModal').classList.remove('active');
}

// Close modal on Escape key
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeImageModal()});

/* --- Render response --- */
function metaRow(l,v){return '<div class="meta-row"><span class="meta-label">'+l+'</span><span class="meta-value">'+(v!=null?v:'N/A')+'</span></div>'}

function render(d){
  if(!d||!d.type)return;
  const a=document.getElementById('resp');

  // Store for playback
  window.lastContent=d;

  // Phase 9 card_content format
  if(d.type==='card_content'){
    const audioList=d.audio||[];
    const imagesList=d.images||[];
    let h='<div class="badge badge-green">Card Content (Phase 9)</div><div class="meta-table">';
    h+=metaRow('RFID UID',d.rfid_uid)+metaRow('Skill ID',d.skill_id)+metaRow('Skill Name',d.skill_name);
    h+=metaRow('Version',d.version);
    h+=metaRow('Audio Files',audioList.length)+metaRow('Image Files',imagesList.length)+'</div>';

    if(audioList.length){
      // Play All button
      h+='<button class="play-all-btn" onclick="playAll(window.lastContent.audio,\\''+d.skill_name.replace(/'/g,"\\\\'")+'\\')"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Play All ('+audioList.length+' tracks)</button>';

      h+='<div class="file-list">';
      audioList.forEach(item=>{
        const idx=item.index||'?';
        const imgItem=imagesList.find(i=>i.index===idx);

        h+='<div class="file-row">';
        h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
        h+='<span class="file-seq">#'+idx+'</span>';
        h+='<span class="file-url">'+item.url.split('/').pop()+'</span>';
        h+='<div class="file-actions">';
        h+='<button class="play-btn" data-idx="'+idx+'" onclick="playAudio(\\''+item.url+'\\',\\''+d.skill_name+' #'+idx+'\\','+idx+')"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>Play</button>';
        if(imgItem){
          h+='<button class="view-btn" onclick="viewImage(\\''+imgItem.url+'\\',\\'Image #'+idx+'\\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>View</button>';
        }
        h+='</div></div>';
      });
      h+='</div>';
    }
    a.innerHTML=h;
    addLog('Card Content: '+d.skill_name+' ('+audioList.length+' audio, '+imagesList.length+' images)','ok');
    if(scanHistory.length)scanHistory[0].type='content';
    renderHistory();
  }
  // card_unknown - no mapping found
  else if(d.type==='card_unknown'){
    let h='<div class="badge" style="background:rgba(239,68,68,0.12);color:var(--red)">Unknown Card</div>';
    h+='<div class="meta-table">'+metaRow('RFID UID',d.rfid_uid)+'</div>';
    h+='<div style="padding:20px;text-align:center;color:var(--text-muted)">';
    h+='<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    h+='<div style="font-size:14px;margin-bottom:8px">No mapping found for this card</div>';
    h+='<div style="font-size:12px">Add a card mapping or bulk range in the dashboard.</div>';
    h+='</div>';
    a.innerHTML=h;
    addLog('Unknown card: '+d.rfid_uid,'warn');
    if(scanHistory.length)scanHistory[0].type='unknown';
    renderHistory();
  }
  // Legacy download_response format (backward compatibility)
  else if(d.type==='download_response'){
    const f=d.files||{};
    const audioKeys=Object.keys(f).filter(k=>k.startsWith('audio_')).sort();
    const imageKeys=Object.keys(f).filter(k=>k.startsWith('image_')).sort();

    // Convert legacy format to playlist array for playAll
    window.legacyPlaylist=audioKeys.map(k=>({index:parseInt(k.replace('audio_','')),url:f[k]}));

    let h='<div class="badge badge-green">Content Pack (Legacy)</div><div class="meta-table">';
    h+=metaRow('RFID UID',d.rfid_uid)+metaRow('Pack Code',d.pack_code)+metaRow('Pack Name',d.pack_name);
    h+=metaRow('Version',d.version)+metaRow('Total Items',d.total_items);
    h+=metaRow('Audio',audioKeys.length)+metaRow('Images',imageKeys.length)+'</div>';

    if(audioKeys.length){
      // Play All button
      h+='<button class="play-all-btn" onclick="playAll(window.legacyPlaylist,\\''+d.pack_name.replace(/'/g,"\\\\'")+'\\')"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Play All ('+audioKeys.length+' tracks)</button>';

      h+='<div class="file-list">';
      audioKeys.forEach(k=>{
        const seq=k.replace('audio_','');
        const imgKey='image_'+seq;
        const hasImg=f[imgKey];

        h+='<div class="file-row">';
        h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
        h+='<span class="file-seq">#'+seq+'</span>';
        h+='<span class="file-url">'+f[k].split('/').pop()+'</span>';
        h+='<div class="file-actions">';
        h+='<button class="play-btn" data-idx="'+seq+'" onclick="playAudio(\\''+f[k]+'\\',\\''+d.pack_name+' #'+seq+'\\','+seq+')"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>Play</button>';
        if(hasImg){
          h+='<button class="view-btn" onclick="viewImage(\\''+f[imgKey]+'\\',\\'Image #'+seq+'\\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>View</button>';
        }
        h+='</div></div>';
      });
      h+='</div>';
    }
    a.innerHTML=h;
    addLog('Content Pack: '+d.pack_name+' ('+d.total_items+' items)','info');
    if(scanHistory.length)scanHistory[0].type='content';
    renderHistory();
  }else{
    a.innerHTML='<div class="badge badge-blue">'+d.type+'</div><pre class="json-pre">'+highlightJson(d)+'</pre>';
    addLog('Response: type='+d.type,'info');
    if(scanHistory.length)scanHistory[0].type=d.type;
    renderHistory();
  }
}

/* --- Poll server status --- */
async function poll(){
  try{
    const r=await fetch('/status'),d=await r.json();
    const dot=document.getElementById('statusDot'),txt=document.getElementById('statusTxt');
    if(d.connected){dot.classList.remove('off');txt.textContent='Connected'}
    else{dot.classList.add('off');txt.textContent='Disconnected'}
    if(d.device_mac)document.getElementById('macDisplay').textContent=d.device_mac;
    if(d.last_response&&d.last_response_time>lastT){lastT=d.last_response_time;render(d.last_response)}
  }catch(e){}
}

/* --- Init --- */
document.getElementById('uid').addEventListener('keydown',e=>{if(e.key==='Enter')sendRfid()});
document.getElementById('seq').addEventListener('keydown',e=>{if(e.key==='Enter')sendRfid()});
renderQuickUids();
setInterval(poll,1000);
addLog('Device simulator UI ready','info');
</script>
</body></html>"""


class RfidWebHandler(BaseHTTPRequestHandler):
    """HTTP handler for the RFID test web UI."""

    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(RFID_HTML_PAGE.encode())
        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            connected = _web_ui_client is not None and _web_ui_client.session_active
            resp = {
                "connected": connected,
                "last_response": _last_rfid_response,
                "last_response_time": _last_rfid_response_time,
                "device_mac": _web_ui_client.device_mac_formatted if _web_ui_client else None,
                "session_id": udp_session_details.get("session_id") if udp_session_details else None,
            }
            self.wfile.write(json.dumps(resp).encode())
        elif self.path == '/history':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(_rfid_response_history).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/send':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode()
            data = json.loads(body)

            rfid_uid = data.get('rfid_uid', '').strip()
            seq_str = data.get('sequence', '').strip()
            seq_num = int(seq_str) if seq_str else None

            if rfid_uid and _web_ui_client:
                _web_ui_client.send_rfid_greeting(rfid_uid, seq_num)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "sent", "rfid_uid": rfid_uid, "sequence": seq_num
                }).encode())
            else:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing RFID UID or client not connected"}).encode())
        elif self.path == '/action':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode()
            data = json.loads(body)

            action = data.get('action', '').strip()
            if not action or not _web_ui_client:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing action or client not connected"}).encode())
                return

            # Map UI actions to MQTT message types and extra fields
            action_map = {
                "listen": ("listen", {"state": "detect", "text": "hello baby"}),
                "abort": ("abort", None),
                "next": ("playback_control", {"action": "next"}),
                "previous": ("playback_control", {"action": "previous"}),
                "start_agent": ("playback_control", {"action": "start_agent"}),
                "goodbye": ("goodbye", None),
                "mode-change": ("mode-change", {"mode": data.get("mode", "conversation")}),
                "character-change": ("character-change", {"character": data.get("character", "")}),
                "download_request": ("download_request", {"content_type": data.get("content_type", "story")}),
            }

            if action in action_map:
                msg_type, extra = action_map[action]
                _web_ui_client.send_mqtt_action(msg_type, extra)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "sent", "action": action}).encode())
            else:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Unknown action: {action}"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default HTTP request logs


def generate_mqtt_credentials(device_mac: str) -> Dict[str, str]:
    """Generate MQTT credentials for the gateway."""
    import base64
    import hashlib
    import hmac

    # Create client ID
    client_id = f"GID_test@@@{device_mac}@@@{uuid.uuid4()}"

    # Create username (base64 encoded JSON)
    username_data = {"ip": "192.168.1.10"}  # Placeholder IP
    username = base64.b64encode(json.dumps(username_data).encode()).decode()

    # Create password (HMAC-SHA256) - must match gateway's logic
    # Gateway uses: clientId + '|' + username as content
    # Must match MQTT_SIGNATURE_KEY in gateway's .env
    secret_key = "test-signature-key-12345"
    content = f"{client_id}|{username}"
    password = base64.b64encode(hmac.new(
        secret_key.encode(), content.encode(), hashlib.sha256).digest()).decode()

    return {
        "client_id": client_id,
        "username": username,
        "password": password
    }


def generate_unique_mac() -> str:
    """Generates a unique MAC address for the client."""
    # Generate 6 random bytes for the MAC address
    # Using a common OUI prefix (00:16:3E) for locally administered addresses
    # and then random bytes to ensure uniqueness for each client instance.
    mac_bytes = [0x00, 0x16, 0x3E,  # OUI prefix
                 uuid.uuid4().bytes[0], uuid.uuid4().bytes[1], uuid.uuid4().bytes[2]]
    return '_'.join(f'{b:02x}' for b in mac_bytes)


class TestClient:
    def __init__(self):
        self.mqtt_client = None
        # Generate a unique MAC address for this client instance
        self.device_mac_formatted = "00:16:3e:ac:b5:38"
        print(f"Generated unique MAC address: {self.device_mac_formatted}")

        # MQTT credentials will be set from OTA response
        self.mqtt_credentials = None

        # The P2P topic - will be set after getting MQTT credentials from OTA
        self.p2p_topic = None
        self.ota_config = {}
        self.websocket_url = None  # Will be set from OTA endpoint
        self.udp_socket = None
        self.udp_listener_thread = None
        self.playback_thread = None
        self.audio_recording_thread = None
        self.udp_local_sequence = 0
        self.audio_playback_queue = Queue()

        # --- NEW: Sequence tracking variables ---
        self.expected_sequence = 1  # Expected next sequence number
        self.last_received_sequence = 0  # Last sequence number received
        self.total_packets_received = 0  # Total packets received
        self.out_of_order_packets = 0  # Count of out-of-order packets
        self.duplicate_packets = 0  # Count of duplicate packets
        self.missing_packets = 0  # Count of missing packets
        self.sequence_gaps = []  # List of detected gaps in sequence

        # --- NEW: State tracking ---
        self.tts_active = False
        self.last_audio_received = 0
        self.session_active = True
        self.conversation_count = 0

        logger.info(
            f"Client initialized with unique MAC: {self.device_mac_formatted}")

    def on_mqtt_connect(self, client, userdata, flags, rc, properties=None):
        """Callback for MQTT connection."""
        if rc == 0:
            logger.info(
                f"[OK] MQTT Connected! Subscribing to P2P topic: {self.p2p_topic}")
            client.subscribe(self.p2p_topic)
        else:
            logger.error(f"[ERROR] MQTT Connection failed with code {rc}")

    def on_mqtt_message(self, client, userdata, msg):
        """Callback for MQTT message reception."""
        try:
            payload_str = msg.payload.decode()
            payload = json.loads(payload_str)
            logger.info(
                f"[EMOJI] MQTT Message received on topic '{msg.topic}':\n{json.dumps(payload, indent=2)}")

            # Handle TTS start signal (reset sequence tracking)
            if payload.get("type") == "tts" and payload.get("state") == "start":
                logger.info("[TTS] TTS started. Resetting sequence tracking.")
                self.tts_active = True
                self.reset_sequence_tracking()
                # Send immediate UDP keepalive to ensure connection is ready
                if self.udp_socket and udp_session_details:
                    try:
                        keepalive_payload = f"keepalive:{udp_session_details['session_id']}".encode()
                        encrypted_keepalive = self.encrypt_packet(keepalive_payload)
                        if encrypted_keepalive:
                            server_udp_addr = (udp_session_details['udp']['server'], udp_session_details['udp']['port'])
                            self.udp_socket.sendto(encrypted_keepalive, server_udp_addr)
                            logger.info("[UDP] Sent UDP keepalive to ensure connection readiness")
                    except Exception as e:
                        logger.warning(f"[WARN] Failed to send UDP keepalive: {e}")

            # Handle TTS stop signal (start recording for next user input)
            elif payload.get("type") == "tts" and payload.get("state") == "stop":
                logger.info(
                    "[MIC] TTS finished. Received 'stop' signal. Preparing for microphone capture...")
                self.tts_active = False
                self.print_sequence_summary()  # Print summary when TTS ends

                # Only proceed with recording if we actually received audio
                if self.total_packets_received > 0:
                    # Clear the stop event to allow the recording thread to continue or start
                    stop_recording_event.clear()
                    # Set the start event to signal the recording thread to begin (if it was waiting)
                    start_recording_event.set()
                    logger.info(
                        "[MIC] Cleared stop_recording_event and set start_recording_event for next recording.")
                else:
                    logger.warning(
                        "[WARN] No audio packets received during TTS. Server may have an issue.")
                    # Try to trigger another conversation after a short delay
                    threading.Timer(2.0, self.retry_conversation).start()

            # Handle STT message (server processed our speech)
            elif payload.get("type") == "stt":
                transcription = payload.get("text", "")
                logger.info(f"[EMOJI] Server transcribed: '{transcription}'")

            # Handle record stop signal (stop recording)
            elif payload.get("type") == "record_stop":
                logger.info(
                    "[STOP] Received 'record_stop' signal from server. Stopping current audio recording...")
                stop_recording_event.set()  # This will cause the recording thread loop to exit

            # Handle Phase 9 card_content (new format with skill_id, audio[], images[])
            elif payload.get("type") == "card_content":
                global _last_rfid_response, _last_rfid_response_time, _rfid_response_history
                _last_rfid_response = payload
                _last_rfid_response_time = time.time()
                _rfid_response_history.append({
                    "timestamp": _last_rfid_response_time,
                    "rfid_uid": payload.get("rfid_uid"),
                    "type": "card_content",
                    "response": payload,
                })
                if len(_rfid_response_history) > 20:
                    _rfid_response_history.pop(0)

                rfid_uid = payload.get("rfid_uid", "N/A")
                skill_id = payload.get("skill_id", "N/A")
                skill_name = payload.get("skill_name", "N/A")
                version = payload.get("version", "N/A")
                audio_list = payload.get("audio", [])
                images_list = payload.get("images", [])

                logger.info("=" * 60)
                logger.info("[CARD-CONTENT] Phase 9 Content Response Received!")
                logger.info("=" * 60)
                logger.info(f"  RFID UID   : {rfid_uid}")
                logger.info(f"  Skill ID   : {skill_id}")
                logger.info(f"  Skill Name : {skill_name}")
                logger.info(f"  Version    : {version}")
                logger.info(f"  Audio Files: {len(audio_list)}")
                logger.info(f"  Image Files: {len(images_list)}")
                logger.info("-" * 60)

                # Display audio files
                for item in audio_list:
                    idx = item.get("index", "?")
                    url = item.get("url", "N/A")
                    logger.info(f"  Audio #{idx}: {url}")

                # Display image files
                for item in images_list:
                    idx = item.get("index", "?")
                    url = item.get("url", "N/A")
                    logger.info(f"  Image #{idx}: {url}")

                logger.info("-" * 60)
                logger.info(f"  Summary: {len(audio_list)} audio, {len(images_list)} images")
                logger.info("=" * 60)

            # Handle card_unknown (no mapping found for RFID)
            elif payload.get("type") == "card_unknown":
                _last_rfid_response = payload
                _last_rfid_response_time = time.time()
                _rfid_response_history.append({
                    "timestamp": _last_rfid_response_time,
                    "rfid_uid": payload.get("rfid_uid"),
                    "type": "card_unknown",
                    "response": payload,
                })
                if len(_rfid_response_history) > 20:
                    _rfid_response_history.pop(0)

                rfid_uid = payload.get("rfid_uid", "N/A")
                logger.warning("=" * 60)
                logger.warning("[CARD-UNKNOWN] No mapping found for RFID card!")
                logger.warning("=" * 60)
                logger.warning(f"  RFID UID: {rfid_uid}")
                logger.warning("  This card is not mapped to any content or Q&A pack.")
                logger.warning("  Add a mapping in the dashboard or create a bulk range.")
                logger.warning("=" * 60)

            # Handle legacy download_response format (backward compatibility)
            elif payload.get("type") == "download_response":
                _last_rfid_response = payload
                _last_rfid_response_time = time.time()
                _rfid_response_history.append({
                    "timestamp": _last_rfid_response_time,
                    "rfid_uid": payload.get("rfid_uid"),
                    "type": "download_response",
                    "response": payload,
                })
                if len(_rfid_response_history) > 20:
                    _rfid_response_history.pop(0)

                status = payload.get("status", "unknown")
                rfid_uid = payload.get("rfid_uid", "N/A")
                pack_code = payload.get("pack_code", "N/A")
                pack_name = payload.get("pack_name", "N/A")
                version = payload.get("version", "N/A")
                total_items = payload.get("total_items", 0)
                files = payload.get("files", {})

                logger.info("=" * 60)
                logger.info("[CONTENT-PACK] Legacy Download Response Received!")
                logger.info("=" * 60)
                logger.info(f"  RFID UID   : {rfid_uid}")
                logger.info(f"  Pack Code  : {pack_code}")
                logger.info(f"  Pack Name  : {pack_name}")
                logger.info(f"  Version    : {version}")
                logger.info(f"  Status     : {status}")
                logger.info(f"  Total Items: {total_items}")
                logger.info("-" * 60)

                # Parse and display audio/image files
                audio_count = 0
                image_count = 0
                for key in sorted(files.keys()):
                    url = files[key]
                    if key.startswith("audio_"):
                        audio_count += 1
                        seq = key.replace("audio_", "")
                        logger.info(f"  Audio #{seq}: {url}")
                    elif key.startswith("image_"):
                        image_count += 1
                        seq = key.replace("image_", "")
                        logger.info(f"  Image #{seq}: {url}")

                logger.info("-" * 60)
                logger.info(f"  Summary: {audio_count} audio files, {image_count} image files")
                logger.info("=" * 60)

            else:
                mqtt_message_queue.put(payload)
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Error processing MQTT message: {e}")

    def retry_conversation(self):
        """Retry triggering a conversation if no audio was received."""
        if self.session_active and not self.tts_active:
            self.conversation_count += 1
            logger.info(
                f"[RETRY] Retry attempt #{self.conversation_count}: Sending listen message again...")

            if self.conversation_count < 3:  # Limit retries
                listen_payload = {
                    "type": "listen",
                    "session_id": udp_session_details["session_id"],
                    "state": "detect",
                    "text": f"retry attempt {self.conversation_count}"
                }
                if self.mqtt_client:
                    self.mqtt_client.publish(
                        "device-server", json.dumps(listen_payload))
            else:
                logger.error(
                    "[ERROR] Too many retry attempts. There may be a server issue.")
                self.session_active = False

    def reset_sequence_tracking(self):
        """Reset sequence tracking statistics for a new TTS stream."""
        self.expected_sequence = 1
        self.last_received_sequence = 0
        self.total_packets_received = 0
        self.out_of_order_packets = 0
        self.duplicate_packets = 0
        self.missing_packets = 0
        self.sequence_gaps = []
        self.last_audio_received = time.time()
        if ENABLE_SEQUENCE_LOGGING:
            logger.info("[RETRY] Reset sequence tracking for new TTS stream")

    def print_sequence_summary(self):
        """Print a summary of sequence statistics."""
        if not ENABLE_SEQUENCE_LOGGING:
            return

        logger.info("=" * 60)
        logger.info("[STATS] SEQUENCE TRACKING SUMMARY")
        logger.info("=" * 60)
        logger.info(f"[PKT] Total packets received: {self.total_packets_received}")
        logger.info(f"[SEQ] Last sequence number: {self.last_received_sequence}")
        logger.info(f"[ERROR] Missing packets: {self.missing_packets}")
        logger.info(f"[RETRY] Out-of-order packets: {self.out_of_order_packets}")
        logger.info(f"[DUP] Duplicate packets: {self.duplicate_packets}")

        if self.sequence_gaps:
            logger.info(
                f"[GAP]  Sequence gaps detected: {len(self.sequence_gaps)}")
            for gap in self.sequence_gaps[-5:]:  # Show last 5 gaps
                logger.info(
                    f"   Gap: expected {gap['expected']}, got {gap['received']}")
        else:
            logger.info("[OK] No sequence gaps detected")

        # Calculate packet loss percentage
        if self.last_received_sequence > 0:
            expected_total = self.last_received_sequence
            loss_rate = (self.missing_packets / expected_total) * 100
            logger.info(f"[LOSS] Packet loss rate: {loss_rate:.2f}%")

        logger.info("=" * 60)

    def parse_packet_header(self, header: bytes) -> Dict:
        """Parse the packet header to extract sequence and other info."""
        if len(header) < 16:
            return {}

        try:
            # Unpack header: packet_type, flags, payload_len, ssrc, timestamp, sequence
            packet_type, flags, payload_len, ssrc, timestamp, sequence = struct.unpack(
                '>BBHIII', header)
            return {
                'packet_type': packet_type,
                'flags': flags,
                'payload_len': payload_len,
                'ssrc': ssrc,
                'timestamp': timestamp,
                'sequence': sequence
            }
        except struct.error:
            return {}

    def track_sequence(self, sequence: int):
        """Track and analyze packet sequence numbers (optimized for performance)."""
        if not ENABLE_SEQUENCE_LOGGING:
            return

        self.total_packets_received += 1
        self.last_audio_received = time.time()

        # Check for missing packets (gaps in sequence) - most critical
        if sequence > self.expected_sequence:
            gap_size = sequence - self.expected_sequence
            self.missing_packets += gap_size
            # Only log significant gaps to reduce overhead
            if gap_size > 1:  # Only log if more than 1 packet missing
                self.sequence_gaps.append({
                    'expected': self.expected_sequence,
                    'received': sequence,
                    'gap_size': gap_size
                })
                logger.warning(
                    f"[GAP]  Sequence gap detected: expected {self.expected_sequence}, got {sequence} (missing {gap_size} packets)")

        # Check for out-of-order/duplicate packets (less critical, minimal logging)
        elif sequence < self.expected_sequence:
            if sequence <= self.last_received_sequence:
                self.duplicate_packets += 1
            else:
                self.out_of_order_packets += 1

        # Update tracking variables
        if sequence > self.last_received_sequence:
            self.last_received_sequence = sequence
            self.expected_sequence = sequence + 1

        # Reduce logging frequency to minimize overhead
        if self.total_packets_received % (LOG_SEQUENCE_EVERY_N_PACKETS * 4) == 0:
            logger.info(
                f"[SEQ] Packet #{self.total_packets_received}: seq={sequence}, expected={self.expected_sequence}")

    def encrypt_packet(self, payload: bytes) -> bytes:
        """Encrypts the audio payload using AES-CTR with header as nonce."""
        global udp_session_details
        if "udp" not in udp_session_details:
            logger.error("UDP session details not available for encryption.")
            return b''

        aes_key = bytes.fromhex(udp_session_details["udp"]["key"])

        # Extract connectionId from the nonce (which is the header template)
        nonce_bytes = bytes.fromhex(udp_session_details["udp"]["nonce"])
        connection_id = struct.unpack('>I', nonce_bytes[4:8])[
            0]  # Extract connectionId from nonce

        packet_type, flags = 0x01, 0x00
        payload_len, timestamp, sequence = len(payload), int(
            time.time()), self.udp_local_sequence

        # Header format: [type: 1u, flags: 1u, payload_len: 2u, connectionId: 4u, timestamp: 4u, sequence: 4u]
        header = struct.pack('>BBHIII', packet_type, flags,
                             payload_len, connection_id, timestamp, sequence)

        cipher = Cipher(algorithms.AES(aes_key), modes.CTR(
            header), backend=default_backend())
        encryptor = cipher.encryptor()
        encrypted_payload = encryptor.update(payload) + encryptor.finalize()
        self.udp_local_sequence += 1
        return header + encrypted_payload

    def get_ota_config(self) -> bool:
        """Requests OTA configuration from the server."""
        logger.info(
            f"[STEP] STEP 1: Requesting OTA config from http://{SERVER_IP}:{OTA_PORT}/toy/ota/")
        try:
            # Generate a client ID for this session
            import uuid
            session_client_id = str(uuid.uuid4())

            headers = {"device-id": self.device_mac_formatted}
            data = {
                "application": {
                    "version": "1.7.6",
                    "name": "DOIT AI Kit v1.7.6"
                },
                "board": {
                    "type": "doit-ai-01-kit"
                },
                "client_id": session_client_id
            }
            response = requests.post(
                f"http://{SERVER_IP}:{OTA_PORT}/toy/ota/", headers=headers, json=data, timeout=5)
            response.raise_for_status()
            self.ota_config = response.json()
            print(
                f"OTA Config received: {json.dumps(self.ota_config, indent=2)}")

            # Extract websocket URL from the new OTA response format
            websocket_info = self.ota_config.get("websocket", {})
            if websocket_info and "url" in websocket_info:
                self.websocket_url = websocket_info["url"]
                logger.info(
                    f"[OK] Got websocket URL from OTA: {self.websocket_url}")
            else:
                logger.warning(
                    "[WARN] No websocket URL in OTA response, using fallback")
                self.websocket_url = f"ws://{SERVER_IP}:8000/toy/v1/"

            # Extract MQTT credentials from OTA response
            mqtt_info = self.ota_config.get("mqtt", {})
            if mqtt_info:
                self.mqtt_credentials = {
                    "client_id": mqtt_info.get("client_id"),
                    "username": mqtt_info.get("username"),
                    "password": mqtt_info.get("password")
                }
                logger.info(
                    f"✅ Got MQTT credentials from OTA: {self.mqtt_credentials['client_id']}")
                # Set P2P topic to match the full client_id (as gateway publishes to this)
                self.p2p_topic = f"devices/p2p/{self.mqtt_credentials['client_id']}"
            else:
                logger.warning(
                    "[WARN] No MQTT credentials in OTA response, generating locally as fallback")
                # Generate MQTT credentials locally as fallback
                self.mqtt_credentials = generate_mqtt_credentials(
                    self.device_mac_formatted)
                logger.info(
                    f"✅ Generated MQTT credentials locally: {self.mqtt_credentials['client_id']}")
                # Set P2P topic to match the full client_id
                self.p2p_topic = f"devices/p2p/{self.mqtt_credentials['client_id']}"

            logger.info("[OK] OTA config received successfully.")

            # --- Handle activation logic (optional, may not be needed) ---
            activation = self.ota_config.get("activation")
            if activation:
                code = activation.get("code")
                if code:
                    print(f"[EMOJI] Activation Required. Code: {code}")
                    activated = False
                    for attempt in range(10):
                        logger.info(
                            f"[EMOJI] Checking activation status... Attempt {attempt + 1}/10")
                        try:
                            status_response = requests.get(
                                f"http://{SERVER_IP}:{OTA_PORT}/ota/active", params={"mac": self.device_mac_formatted}, timeout=3)
                            print(
                                f"Activation status response: {status_response.text}")
                            if status_response.ok and status_response.json().get("activated"):
                                logger.info("[OK] Device activated!")
                                activated = True
                                break
                            else:
                                logger.warning(
                                    "[ERROR] Device not activated yet. Retrying...")

                        except Exception as e:
                            logger.warning(f"Activation check failed: {e}")
                        time.sleep(5)
                    if not activated:
                        logger.error(
                            "[ERROR] Activation failed after 10 attempts. Exiting client.")
                        return False
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"[ERROR] Failed to get OTA config: {e}")
            return False

    def connect_mqtt(self) -> bool:
        """Connects to the MQTT Broker."""
        # Get MQTT configuration from OTA response
        mqtt_config = self.ota_config.get("mqtt_gateway", {})
        mqtt_broker = mqtt_config.get("broker", MQTT_BROKER_HOST)
        mqtt_port = mqtt_config.get("port", MQTT_BROKER_PORT)

        logger.info(f"[INFO] MQTT Config from OTA: {mqtt_config}")
        logger.info(f"[INFO] Using MQTT Broker: {mqtt_broker}")
        logger.info(f"[INFO] Using MQTT Port: {mqtt_port}")
        logger.info(
            f"[INFO] MQTT Credentials: client_id={self.mqtt_credentials.get('client_id', 'NOT SET')}")
        logger.info(
            f"[STEP] STEP 2: Connecting to MQTT Gateway at {mqtt_broker}:{mqtt_port}...")

        self.mqtt_client = mqtt_client.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=self.mqtt_credentials["client_id"]
        )
        self.mqtt_client.on_connect = self.on_mqtt_connect
        self.mqtt_client.on_message = self.on_mqtt_message
        self.mqtt_client.username_pw_set(
            self.mqtt_credentials["username"],
            self.mqtt_credentials["password"]
        )

        try:
            logger.info(f"[RETRY] Attempting connection to MQTT broker...")
            logger.info(f"   Host: {mqtt_broker}")
            logger.info(f"   Port: {mqtt_port}")
            logger.info(f"   Client ID: {self.mqtt_credentials['client_id']}")
            logger.info(f"   Username: {self.mqtt_credentials['username']}")

            self.mqtt_client.connect(mqtt_broker, mqtt_port, 60)
            self.mqtt_client.loop_start()

            # Wait a moment for connection to establish
            time.sleep(2)

            # Check if connected
            if self.mqtt_client.is_connected():
                logger.info("[OK] MQTT client is connected!")
            else:
                logger.warning(
                    "[WARN] MQTT client connection status unknown, waiting...")

            return True
        except Exception as e:
            logger.error(f"[ERROR] Failed to connect to MQTT Gateway: {e}")
            logger.error(f"   Error type: {type(e).__name__}")
            logger.error(f"   Broker: {mqtt_broker}:{mqtt_port}")
            return False

    def send_hello_and_get_session(self) -> bool:
        """Sends 'hello' message and waits for session details."""
        logger.info("[STEP] STEP 3: Sending 'hello' and pinging UDP...")
        # Use the client_id from our generated MQTT credentials
        hello_message = {
            "type": "hello",
            "version": 3,
            "transport": "mqtt",
            "audio_params": {
                "sample_rate": 16000,
                "channels": 1,
                "frame_duration": 20,
                "format": "opus"
            },
            "features": ["tts", "asr", "vad"]
        }
        self.mqtt_client.publish("device-server", json.dumps(hello_message))
        try:
            deadline = time.time() + 30
            while time.time() < deadline:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                response = mqtt_message_queue.get(timeout=remaining)
                if response.get("type") == "hello" and "udp" in response:
                    global udp_session_details
                    udp_session_details = response
                    self.udp_socket = socket.socket(
                        socket.AF_INET, socket.SOCK_DGRAM)
                    # Increase UDP receive buffer to handle burst traffic
                    self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)  # 1MB buffer
                    self.udp_socket.settimeout(1.0)
                    ping_payload = f"ping:{udp_session_details['session_id']}".encode(
                    )
                    encrypted_ping = self.encrypt_packet(ping_payload)
                    server_udp_addr = (
                        udp_session_details['udp']['server'], udp_session_details['udp']['port'])
                    logger.info(f"[RETRY] Sending UDP Ping to {server_udp_addr} with session ID {udp_session_details['session_id']}"
                                f" and key {udp_session_details['udp']['key']}"
                                f" (local sequence: {self.udp_local_sequence})"
                                )
                    if encrypted_ping:
                        self.udp_socket.sendto(encrypted_ping, server_udp_addr)
                        logger.info(f"[OK] UDP Ping sent. Session configured.")
                        return True
                else:
                    logger.info(f"[SKIP] Ignoring non-hello message: {response.get('type')}")
            logger.error("[ERROR] Timed out waiting for 'hello' response.")
            return False
        except Empty:
            logger.error("[ERROR] Timed out waiting for 'hello' response.")
            return False

    def _playback_thread(self):
        """Thread to play back incoming audio from the server with a robust jitter buffer."""
        p = pyaudio.PyAudio()
        audio_params = udp_session_details["audio_params"]
        stream = p.open(format=p.get_format_from_width(2),
                        channels=audio_params["channels"],
                        rate=audio_params["sample_rate"],
                        output=True)

        logger.info("[PLAY] Playback thread started.")
        is_playing = False
        buffer_timeout_start = time.time()

        while not stop_threads.is_set() and self.session_active:
            try:
                # --- JITTER BUFFER LOGIC ---
                if not is_playing:
                    # Wait until we have enough frames to start playback smoothly
                    if self.audio_playback_queue.qsize() < PLAYBACK_BUFFER_START_FRAMES:
                        # Check for timeout
                        if time.time() - buffer_timeout_start > BUFFER_TIMEOUT_SECONDS:
                            # logger.warning(
                            #     f"[TIME] Buffer timeout after {BUFFER_TIMEOUT_SECONDS}s. Queue size: {self.audio_playback_queue.qsize()}")
                            if self.tts_active:
                                logger.warning(
                                    "[PLAY] TTS is active but no audio received. Possible server issue.")
                            buffer_timeout_start = time.time()  # Reset timeout

                        # logger.info(
                        #     f"[AUDIO] Buffering audio... {self.audio_playback_queue.qsize()}/{PLAYBACK_BUFFER_START_FRAMES}")
                        time.sleep(0.05)
                        continue
                    else:
                        logger.info("[OK] Buffer ready. Starting playback.")
                        is_playing = True

                # --- If buffer runs low, stop playing and re-buffer ---
                if self.audio_playback_queue.qsize() < PLAYBACK_BUFFER_MIN_FRAMES:
                    is_playing = False
                    buffer_timeout_start = time.time()  # Reset timeout when buffering starts
                    logger.warning(
                        f"[ALERT] Playback buffer low ({self.audio_playback_queue.qsize()}). Re-buffering...")
                    continue

                # Get audio chunk from the queue and play it
                stream.write(self.audio_playback_queue.get(timeout=1))

            except Empty:
                is_playing = False
                buffer_timeout_start = time.time()  # Reset timeout
                continue
            except Exception as e:
                logger.error(f"Playback error: {e}")
                break

        stream.stop_stream()
        stream.close()
        p.terminate()
        logger.info("[PLAY] Playback thread finished.")

    def listen_for_udp_audio(self):
        """Thread to listen for incoming UDP audio from the server with sequence tracking."""
        logger.info(
            f"[AUDIO] UDP Listener started on local socket {self.udp_socket.getsockname()}")
        aes_key = bytes.fromhex(udp_session_details["udp"]["key"])
        audio_params = udp_session_details["audio_params"]

        # Initialize the decoder with the sample rate provided by the server
        decoder = opuslib.Decoder(
            audio_params["sample_rate"], audio_params["channels"])
        frame_size_samples = int(
            audio_params["sample_rate"] * audio_params["frame_duration"] / 1000)
        # Maximum frame size for Opus (120ms at 48kHz = 5760 samples, but we'll use a larger buffer)
        # 120ms worth of samples
        max_frame_size = int(audio_params["sample_rate"] * 0.12)

        while not stop_threads.is_set() and self.session_active:
            try:
                data, addr = self.udp_socket.recvfrom(4096)
                if data and len(data) > 16:
                    header, encrypted = data[:16], data[16:]

                    # --- Parse header to extract sequence number (optimized) ---
                    if ENABLE_SEQUENCE_LOGGING:
                        header_info = self.parse_packet_header(header)
                        if header_info:
                            sequence = header_info.get('sequence', 0)
                            # Track sequence for analysis (minimal processing)
                            self.track_sequence(sequence)
                            
                            # Only log details for first few packets to reduce overhead
                            if self.total_packets_received <= 5:
                                timestamp = header_info.get('timestamp', 0)
                                payload_len = header_info.get('payload_len', 0)
                                logger.info(
                                    f"[PKT] Packet details: seq={sequence}, payload={payload_len}B, ts={timestamp}, from={addr}")

                    # Decrypt and decode as usual
                    cipher = Cipher(algorithms.AES(aes_key), modes.CTR(
                        header), backend=default_backend())
                    decryptor = cipher.decryptor()
                    opus_payload = decryptor.update(
                        encrypted) + decryptor.finalize()

                    # Decode the Opus payload to PCM and put it in the playback queue
                    # Use max_frame_size to provide enough buffer space for variable frame sizes
                    pcm_payload = decoder.decode(opus_payload, max_frame_size)
                    self.audio_playback_queue.put(pcm_payload)

            except socket.timeout:
                continue
            except Exception as e:
                logger.error(f"UDP Listen Error: {e}", exc_info=True)

        logger.info("[BYE] UDP Listener shutting down.")

    def _record_and_send_audio_thread(self):
        """Thread to record microphone audio and send it to the server."""
        # Main loop to keep the thread alive for multiple recording sessions
        while not stop_threads.is_set() and self.session_active:
            # Wait here until the start event is set (e.g., after TTS stop)
            if not start_recording_event.wait(timeout=1):
                continue

            # If the main stop signal was set while waiting, exit the thread
            if stop_threads.is_set():
                break

            logger.info("[REC] Recording thread activated. Capturing audio.")
            p = pyaudio.PyAudio()
            audio_params = udp_session_details["audio_params"]
            FORMAT, CHANNELS, RATE, FRAME_DURATION_MS = pyaudio.paInt16, audio_params[
                "channels"], audio_params["sample_rate"], audio_params["frame_duration"]
            SAMPLES_PER_FRAME = int(RATE * FRAME_DURATION_MS / 1000)

            try:
                encoder = opuslib.Encoder(
                    RATE, CHANNELS, opuslib.APPLICATION_VOIP)
            except Exception as e:
                logger.error(f"[ERROR] Failed to create Opus encoder: {e}")
                return  # Exit thread if encoder fails

            stream = p.open(format=FORMAT, channels=CHANNELS, rate=RATE,
                            input=True, frames_per_buffer=SAMPLES_PER_FRAME)
            logger.info(
                "[MIC] Microphone stream opened. Sending audio to server...")
            server_udp_addr = (
                udp_session_details['udp']['server'], udp_session_details['udp']['port'])

            packets_sent = 0
            last_log_time = time.time()

            # Inner loop for the active recording session
            while not stop_threads.is_set() and not stop_recording_event.is_set() and self.session_active:
                try:
                    pcm_data = stream.read(
                        SAMPLES_PER_FRAME, exception_on_overflow=False)
                    opus_data = encoder.encode(pcm_data, SAMPLES_PER_FRAME)
                    encrypted_packet = self.encrypt_packet(opus_data)

                    if encrypted_packet:
                        self.udp_socket.sendto(
                            encrypted_packet, server_udp_addr)
                        packets_sent += 1

                        if time.time() - last_log_time >= 1.0:
                            logger.info(
                                f"[UP]  Sent {packets_sent} audio packets in the last second.")
                            packets_sent = 0
                            last_log_time = time.time()

                except Exception as e:
                    logger.error(
                        f"An error occurred in the recording loop: {e}")
                    break  # Exit inner loop on error

            # Cleanup for the current recording session
            logger.info("[MIC] Stopping microphone stream for this session.")
            stream.stop_stream()
            stream.close()
            p.terminate()

            # Clear the start event so it has to be triggered again for the next session
            start_recording_event.clear()

            if stop_recording_event.is_set():
                logger.info(
                    "[STOP] Recording stopped by server signal. Waiting for next turn.")

        logger.info("[REC] Recording thread finished completely.")

    def _start_rfid_web_ui(self):
        """Start the RFID web UI HTTP server and open browser."""
        global _web_ui_client
        _web_ui_client = self

        server = HTTPServer(('localhost', RFID_WEB_UI_PORT), RfidWebHandler)
        self._web_server = server

        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        url = f"http://localhost:{RFID_WEB_UI_PORT}"
        logger.info(f"[UI] RFID Web UI started at {url}")
        webbrowser.open(url)

    def send_rfid_greeting(self, rfid_uid, sequence=None):
        """Sends an RFID card scan message to the gateway.
        
        Args:
            rfid_uid: The RFID card UID (e.g., 'E96C8A82')
            sequence: Optional sequence number for content packs (e.g., 1 for first item)
        """
        logger.info(f"[RFID] Simulating RFID card scan: UID={rfid_uid}, sequence={sequence}")
        
        rfid_payload = {
            "type": "card_lookup",
            "rfid_uid": rfid_uid,
            "text": f"RFID card scanned: {rfid_uid}",
            "session_id": udp_session_details.get("session_id")
        }
        
        if sequence is not None:
            rfid_payload["sequence"] = sequence
        
        # Publish to device-server topic (gateway will process this)
        self.mqtt_client.publish("device-server", json.dumps(rfid_payload))
        logger.info(f"[RFID] Sent RFID greeting: {json.dumps(rfid_payload, indent=2)}")

    def send_mqtt_action(self, action_type, extra_fields=None):
        """Generic MQTT action sender for UI control buttons."""
        payload = {"type": action_type, "session_id": udp_session_details.get("session_id")}
        if extra_fields:
            payload.update(extra_fields)
        self.mqtt_client.publish("device-server", json.dumps(payload))
        logger.info(f"[ACTION] Sent '{action_type}': {json.dumps(payload, indent=2)}")

    def trigger_conversation(self, rfid_uid=None, rfid_sequence=None):
        """Starts the audio streaming threads and sends initial listen message or RFID greeting.
        
        Args:
            rfid_uid: Optional RFID card UID to simulate card scan
            rfid_sequence: Optional sequence number for RFID content packs
        """
        if not self.udp_socket:
            return False
        logger.info("[STEP] STEP 4: Starting all streaming audio threads...")
        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.clear()
        # Initially, clear both events. The server's initial TTS will set start_recording_event.
        start_recording_event.clear()
        stop_recording_event.clear()

        self.playback_thread = threading.Thread(
            target=self._playback_thread, daemon=True)
        self.udp_listener_thread = threading.Thread(
            target=self.listen_for_udp_audio, daemon=True)
        self.audio_recording_thread = threading.Thread(
            target=self._record_and_send_audio_thread, daemon=True)
        self.playback_thread.start(), self.udp_listener_thread.start(
        ), self.audio_recording_thread.start()

        # Start the RFID web UI (browser-based)
        self._start_rfid_web_ui()

        if rfid_uid:
            # RFID mode: Send RFID greeting instead of listen message
            logger.info(
                f"[STEP] STEP 5: Sending RFID greeting for card {rfid_uid}...")
            time.sleep(0.5)  # Give threads a moment to start
            self.send_rfid_greeting(rfid_uid, rfid_sequence)
        else:
            # Normal mode: Send listen message
            logger.info(
                "[STEP] STEP 5: Sending 'listen' message to trigger initial TTS from server...")
            # The server's initial TTS will then trigger the client's recording.
            listen_payload = {
                "type": "listen", "session_id": udp_session_details["session_id"], "state": "detect", "text": "hello baby"}
            self.mqtt_client.publish("device-server", json.dumps(listen_payload))
        
        logger.info(
            "[WAIT] Test running. Press Spacebar to abort TTS or Ctrl+C to stop.")

        # Start a thread to monitor spacebar press
        def monitor_spacebar():
            while not stop_threads.is_set() and self.session_active:
                if keyboard.is_pressed('space'):
                    logger.info(
                        "[EMOJI] Spacebar pressed. Sending abort message to server...")
                    abort_payload = {
                        "type": "abort",
                        "session_id": udp_session_details["session_id"]
                    }
                    self.mqtt_client.publish(
                        "device-server", json.dumps(abort_payload))
                    logger.info(f"[EMOJI] Sent abort message: {abort_payload}")
                    # Wait for the key to be released to avoid multiple sends
                    while keyboard.is_pressed('space') and not stop_threads.is_set():
                        time.sleep(0.01)
                time.sleep(0.01)

        spacebar_thread = threading.Thread(
            target=monitor_spacebar, daemon=True)
        spacebar_thread.start()

        try:
            # Keep running with better timeout handling
            timeout_count = 0
            while not stop_threads.is_set() and self.session_active:
                time.sleep(1)

                # Check if we've been inactive for too long
                if self.tts_active and time.time() - self.last_audio_received > TTS_TIMEOUT_SECONDS:
                    logger.warning(
                        f"[TIME] No audio received for {TTS_TIMEOUT_SECONDS}s during TTS. Possible server issue.")
                    timeout_count += 1
                    if timeout_count >= 3:
                        logger.error("[ERROR] Too many timeouts. Stopping session.")
                        self.session_active = False
                        break
                    else:
                        logger.info(
                            "[RETRY] Attempting to recover by sending new listen message...")
                        self.retry_conversation()

        except KeyboardInterrupt:
            logger.info("Manual interruption detected. Cleaning up...")
            stop_threads.set()
            self.session_active = False
        return True

    def cleanup(self):
        """Cleans up resources and disconnects."""
        logger.info("[STEP] STEP 6: Cleaning up and disconnecting...")
        global stop_threads, start_recording_event, stop_recording_event
        stop_threads.set()
        self.session_active = False
        start_recording_event.set()  # Unblock if waiting
        stop_recording_event.set()  # Unblock if running

        # Shutdown web UI server
        if hasattr(self, '_web_server') and self._web_server:
            self._web_server.shutdown()
            logger.info("[UI] Web UI server stopped.")

        # Print final sequence summary
        if ENABLE_SEQUENCE_LOGGING and self.total_packets_received > 0:
            logger.info("[STATS] FINAL SEQUENCE SUMMARY")
            self.print_sequence_summary()

        if self.audio_recording_thread:
            logger.info("Attempting to join audio_recording_thread...")
            self.audio_recording_thread.join(timeout=2)
            if self.audio_recording_thread.is_alive():
                logger.warning(
                    "Audio recording thread did not terminate gracefully.")

        if self.playback_thread:
            self.playback_thread.join(timeout=2)
        if self.udp_listener_thread:
            self.udp_listener_thread.join(timeout=2)
        if self.udp_socket:
            self.udp_socket.close()

        if self.mqtt_client and udp_session_details:
            goodbye_payload = {"type": "goodbye",
                               "session_id": udp_session_details.get("session_id")}
            self.mqtt_client.publish(
                "device-server", json.dumps(goodbye_payload))
            logger.info("[BYE] Sent 'goodbye' message.")

        if self.mqtt_client:
            self.mqtt_client.loop_stop()
            self.mqtt_client.disconnect()
            logger.info("[DISC] MQTT Disconnected.")
        logger.info("[OK] Test finished.")

    def run_test(self, rfid_uid=None, rfid_sequence=None):
        """Runs the full test sequence.
        
        Args:
            rfid_uid: Optional RFID card UID to test RFID functionality
            rfid_sequence: Optional sequence number for RFID content packs
        """
        if ENABLE_SEQUENCE_LOGGING:
            logger.info("[SEQ] Sequence tracking is ENABLED")
            logger.info(
                f"[STATS] Will log sequence info every {LOG_SEQUENCE_EVERY_N_PACKETS} packets")
        else:
            logger.info("[SEQ] Sequence tracking is DISABLED")

        if rfid_uid:
            logger.info(f"[RFID] RFID TEST MODE: Will scan card {rfid_uid}")
            if rfid_sequence:
                logger.info(f"[RFID] Sequence: {rfid_sequence}")

        if not self.get_ota_config():
            return
        if not self.connect_mqtt():
            return
        time.sleep(1)  # Give MQTT a moment to connect and subscribe
        if not self.send_hello_and_get_session():
            self.cleanup()
            return
        self.trigger_conversation(rfid_uid, rfid_sequence)
        self.cleanup()


if __name__ == "__main__":
    import sys
    
    # You can control sequence logging from here
    print(
        f"[SEQ] Sequence logging: {'ENABLED' if ENABLE_SEQUENCE_LOGGING else 'DISABLED'}")
    print(f"[STATS] Log frequency: Every {LOG_SEQUENCE_EVERY_N_PACKETS} packets")

    # Check for RFID test mode from command line
    rfid_uid = None
    rfid_sequence = None
    
    if len(sys.argv) > 1:
        if sys.argv[1] == '--rfid':
            if len(sys.argv) > 2:
                rfid_uid = sys.argv[2]
                print(f"[RFID] RFID TEST MODE: Card UID = {rfid_uid}")
                
                if len(sys.argv) > 3:
                    try:
                        rfid_sequence = int(sys.argv[3])
                        print(f"[RFID] Sequence = {rfid_sequence}")
                    except ValueError:
                        print("[WARN] Invalid sequence number, ignoring")
            else:
                print("[ERROR] --rfid requires a card UID")
                print("Usage: python client.py --rfid <RFID_UID> [sequence]")
                print("Example: python client.py --rfid E96C8A82")
                print("Example: python client.py --rfid BEDTIME001 1")
                sys.exit(1)

    client = TestClient()
    try:
        client.run_test(rfid_uid, rfid_sequence)
    except KeyboardInterrupt:
        logger.info("Manual interruption detected. Cleaning up...")
        client.cleanup()
