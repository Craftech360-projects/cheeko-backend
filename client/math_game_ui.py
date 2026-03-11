"""Math Commander Flask UI — real-time game UI driven by MQTT state polling."""

from flask import Flask, jsonify, request
import logging
import webbrowser
import json

logger = logging.getLogger("MathGameUI")

# Global reference to the TestClient (set by client.py)
_client = None

_app = Flask(__name__)
_app.logger.setLevel(logging.WARNING)

# Suppress Flask/Werkzeug request logs
logging.getLogger('werkzeug').setLevel(logging.WARNING)

GAME_HTML = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Math Commander</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#060918;color:#e5e7eb;font-family:Inter,system-ui,sans-serif;min-height:100vh}
  header{background:#0a0d1f;border-bottom:1px solid rgba(255,255,255,0.1);padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
  .logo{display:flex;align-items:center;gap:12px}
  .logo-icon{width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:bold}
  .logo-text{color:white;font-weight:bold;font-size:18px}
  .conn{display:flex;align-items:center;gap:8px}
  .conn-dot{width:8px;height:8px;border-radius:50%;background:#22c55e}
  .conn-dot.off{background:#ef4444}
  .conn-label{font-size:12px;color:#9ca3af}
  .main{max-width:640px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:16px}
  .badges{display:flex;justify-content:space-between;align-items:center}
  .badge{padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600}
  .badge-level{border:1px solid #f59e0b;color:#f59e0b}
  .badge-mode{border:1px solid #8b5cf6;color:#8b5cf6}
  .stars{display:flex;justify-content:center;gap:8px}
  .star{font-size:28px;transition:all 0.3s}
  .star-on{color:#facc15;transform:scale(1.15)}
  .star-off{color:#374151}
  .lives{text-align:center;font-size:18px;display:none}
  .card{background:#0a0d1f;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;text-align:center}
  .story{font-size:15px;color:#9ca3af;margin-bottom:8px}
  .question{font-size:28px;font-weight:bold;color:#60a5fa}
  .options{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .opt-btn{min-height:60px;min-width:80px;flex:1;font-size:20px;font-weight:700;border:none;border-radius:12px;cursor:pointer;background:#1e293b;color:white;transition:all 0.15s}
  .opt-btn:hover:not(:disabled){background:#334155;transform:scale(1.03)}
  .opt-btn:disabled{opacity:0.5;cursor:not-allowed}
  .opt-btn.correct{background:#166534;color:#4ade80}
  .opt-btn.wrong{background:#7f1d1d;color:#f87171}
  .result{text-align:center;padding:12px;border-radius:8px;font-weight:600;font-size:15px;display:none}
  .result.show-correct{display:block;background:rgba(34,197,94,0.15);color:#4ade80}
  .result.show-wrong{display:block;background:rgba(239,68,68,0.15);color:#f87171}
  .overlay{background:rgba(0,0,0,0.6);border-radius:12px;padding:32px;text-align:center;display:none}
  .overlay.visible{display:block}
  .overlay-emoji{font-size:48px;margin-bottom:8px}
  .overlay-title{font-size:20px;font-weight:bold}
  .overlay-title.complete{color:#facc15}
  .overlay-title.failed{color:#f87171}
  .overlay-sub{font-size:14px;color:#9ca3af;margin-top:4px}
</style>
</head>
<body>
<header>
  <div class="logo">
    <div class="logo-icon">M</div>
    <div class="logo-text">Math Commander</div>
  </div>
  <div class="conn">
    <div class="conn-dot" id="connDot"></div>
    <div class="conn-label" id="connLabel">Connected</div>
  </div>
</header>
<div class="main">
  <div class="badges">
    <span class="badge badge-level" id="levelBadge">Lv.0</span>
    <span class="badge badge-mode" id="modeBadge">Explorer</span>
  </div>
  <div class="stars" id="starsRow"></div>
  <div class="lives" id="livesRow"></div>
  <div class="card">
    <div class="story" id="storyLabel">Waiting for question...</div>
    <div class="question" id="questionLabel">&mdash;</div>
  </div>
  <div class="options" id="optionsRow"></div>
  <div class="result" id="resultBanner"></div>
  <div class="overlay" id="overlayCard">
    <div class="overlay-emoji" id="overlayEmoji"></div>
    <div class="overlay-title" id="overlayTitle"></div>
    <div class="overlay-sub" id="overlaySub"></div>
  </div>
</div>
<script>
const _actx=new (window.AudioContext||window.webkitAudioContext)();
function playSfx(type){
  const o=_actx.createOscillator(),g=_actx.createGain();
  o.connect(g);g.connect(_actx.destination);
  const now=_actx.currentTime;
  if(type==='correct'){
    o.type='sine';o.frequency.setValueAtTime(523,now);o.frequency.setValueAtTime(659,now+0.1);o.frequency.setValueAtTime(784,now+0.2);
    g.gain.setValueAtTime(0.3,now);g.gain.exponentialRampToValueAtTime(0.01,now+0.4);
    o.start(now);o.stop(now+0.4);
  }else if(type==='wrong'){
    o.type='square';o.frequency.setValueAtTime(300,now);o.frequency.setValueAtTime(200,now+0.15);
    g.gain.setValueAtTime(0.2,now);g.gain.exponentialRampToValueAtTime(0.01,now+0.3);
    o.start(now);o.stop(now+0.3);
  }else if(type==='star'){
    o.type='sine';o.frequency.setValueAtTime(880,now);o.frequency.setValueAtTime(1108,now+0.08);o.frequency.setValueAtTime(1318,now+0.16);
    g.gain.setValueAtTime(0.25,now);g.gain.exponentialRampToValueAtTime(0.01,now+0.35);
    o.start(now);o.stop(now+0.35);
  }else if(type==='tap'){
    o.type='sine';o.frequency.setValueAtTime(600,now);
    g.gain.setValueAtTime(0.15,now);g.gain.exponentialRampToValueAtTime(0.01,now+0.08);
    o.start(now);o.stop(now+0.08);
  }else if(type==='level_up'){
    [523,659,784,1047].forEach((f,i)=>{
      const os=_actx.createOscillator(),gs=_actx.createGain();
      os.connect(gs);gs.connect(_actx.destination);
      os.type='sine';os.frequency.setValueAtTime(f,now+i*0.15);
      gs.gain.setValueAtTime(0.3,now+i*0.15);gs.gain.exponentialRampToValueAtTime(0.01,now+i*0.15+0.3);
      os.start(now+i*0.15);os.stop(now+i*0.15+0.3);
    });
  }else if(type==='game_over'){
    [392,349,330,262].forEach((f,i)=>{
      const os=_actx.createOscillator(),gs=_actx.createGain();
      os.connect(gs);gs.connect(_actx.destination);
      os.type='triangle';os.frequency.setValueAtTime(f,now+i*0.2);
      gs.gain.setValueAtTime(0.25,now+i*0.2);gs.gain.exponentialRampToValueAtTime(0.01,now+i*0.2+0.35);
      os.start(now+i*0.2);os.stop(now+i*0.2+0.35);
    });
  }
}

// --- State tracking ---
let prevStars=0, prevResultId=null, prevOverlay=null, lastQid=null, lastOpts='';
let disabledValues=new Set();

function sendAnswer(qid, val){
  playSfx('tap');
  fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question_id:qid,value:val})});
}

function refresh(){
  fetch('/api/state').then(r=>r.json()).then(s=>{
    const p=s.progress||{};

    // Connection
    const dot=document.getElementById('connDot');
    const lbl=document.getElementById('connLabel');
    if(s.connected){dot.classList.remove('off');lbl.textContent='Connected';}
    else{dot.classList.add('off');lbl.textContent='Disconnected';}

    // Level & mode
    document.getElementById('levelBadge').textContent='Lv.'+( p.level||0);
    document.getElementById('modeBadge').textContent=s.game_mode==='commander'?'Commander':'Explorer';

    // Stars
    const total=p.total_needed||5;
    const stars=p.stars||0;
    let sh='';
    for(let i=0;i<total;i++) sh+='<span class="star '+(i<stars?'star-on':'star-off')+'">&#9733;</span>';
    document.getElementById('starsRow').innerHTML=sh;
    if(stars>prevStars && prevStars>=0) playSfx('star');
    prevStars=stars;

    // Lives
    const livesEl=document.getElementById('livesRow');
    if(p.lives!=null && p.max_lives!=null){
      livesEl.style.display='block';
      livesEl.textContent='\u2764\uFE0F'.repeat(p.lives)+'\U0001F5A4'.repeat(p.max_lives-p.lives);
    }else{livesEl.style.display='none';}

    // Question
    const q=s.question;
    if(q){
      document.getElementById('storyLabel').textContent=q.story_text||'';
      document.getElementById('questionLabel').textContent=q.question_text||'\u2014';

      const qid=q.question_id;
      const opts=q.options||[];
      const optKey=opts.map(o=>o.value).join(',');

      if(qid!==lastQid || optKey!==lastOpts){
        if(qid!==lastQid){
          disabledValues.clear();
          document.getElementById('resultBanner').className='result';
          document.getElementById('overlayCard').className='overlay';
        }
        lastQid=qid; lastOpts=optKey;
        const row=document.getElementById('optionsRow');
        row.innerHTML='';
        opts.forEach(opt=>{
          const btn=document.createElement('button');
          btn.className='opt-btn';
          btn.textContent=opt.label;
          btn.onclick=()=>sendAnswer(qid,opt.value);
          if(disabledValues.has(opt.value)){btn.disabled=true;btn.classList.add('wrong');}
          row.appendChild(btn);
        });
      }
    }

    // Result
    const r=s.result;
    if(r){
      const rid=JSON.stringify(r);
      const banner=document.getElementById('resultBanner');
      if(r.correct){
        banner.textContent='\u2713 Correct!';
        banner.className='result show-correct';
      }else{
        banner.textContent='\u2717 Wrong! Answer: '+(r.correct_answer||'?');
        banner.className='result show-wrong';
      }
      // Update buttons
      const btns=document.querySelectorAll('.opt-btn');
      const isRetry=r.retry||false;
      btns.forEach(btn=>{
        const v=parseInt(btn.textContent);
        if(isNaN(v)) return;
        if(r.correct && v===r.correct_answer){btn.classList.add('correct');btn.disabled=true;}
        else if(!r.correct && v===r.user_answer){btn.classList.add('wrong');btn.disabled=true;disabledValues.add(v);}
        else if(!isRetry){if(v===r.correct_answer) btn.classList.add('correct');btn.disabled=true;}
      });
      if(rid!==prevResultId){
        prevResultId=rid;
        playSfx(r.correct?'correct':'wrong');
      }
    }

    // Overlays
    const ov=document.getElementById('overlayCard');
    if(s.game_complete){
      const lvl=p.level||0;
      ov.className='overlay visible';
      document.getElementById('overlayEmoji').textContent='\u2B50';
      document.getElementById('overlayTitle').textContent='LEVEL '+lvl+' COMPLETE!';
      document.getElementById('overlayTitle').className='overlay-title complete';
      document.getElementById('overlaySub').textContent='Level '+(lvl+1)+' loading...';
      if(prevOverlay!=='complete'){prevOverlay='complete';playSfx('level_up');}
    }else if(s.game_over){
      ov.className='overlay visible';
      document.getElementById('overlayEmoji').textContent='\uD83D\uDC94';
      document.getElementById('overlayTitle').textContent='Mission Failed';
      document.getElementById('overlayTitle').className='overlay-title failed';
      document.getElementById('overlaySub').textContent='Restarting...';
      if(prevOverlay!=='game_over'){prevOverlay='game_over';playSfx('game_over');}
    }else{
      ov.className='overlay';
      prevOverlay=null;
    }
  }).catch(()=>{});
}

setInterval(refresh,200);
</script>
</body>
</html>'''


@_app.route('/')
def index():
    return GAME_HTML


@_app.route('/api/state')
def get_state():
    if not _client:
        return jsonify({})
    s = _client.math_game_state
    return jsonify({
        'connected': _client.session_active,
        'question': s.get('question'),
        'result': s.get('result'),
        'progress': s.get('progress', {}),
        'game_mode': s.get('game_mode', 'explorer'),
        'game_complete': s.get('game_complete', False),
        'game_over': s.get('game_over', False),
    })


@_app.route('/api/answer', methods=['POST'])
def post_answer():
    if not _client:
        return jsonify({'error': 'no client'}), 500
    data = request.get_json()
    _client.send_math_answer(data['question_id'], data['value'])
    return jsonify({'ok': True})


def start_math_ui(client, port=8088):
    """Start the Flask Math Commander UI. Call from a daemon thread."""
    global _client
    _client = client
    logger.info(f"[UI] Flask Math Commander starting on http://localhost:{port}")
    webbrowser.open(f'http://localhost:{port}')
    _app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)
