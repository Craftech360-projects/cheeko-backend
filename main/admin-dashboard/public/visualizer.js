// Radial audio visualizer — a ring of bars whose lengths follow whatever
// analyser is attached, coloured by agent state.
//
// Hand-rolled canvas rather than LiveKit's agents-ui React components: this app
// has no bundler, and the whole look is a few trig calls. Same idea, no build
// step.

const BAR_COUNT = 24;
const RADIUS = 60;
const BAR_WIDTH = 5;
const BAR_MIN = 8;
const BAR_MAX = 34;

// One colour per state, from the dashboard's own palette rather than the
// agents-ui green — this page is light-themed.
const STATE_STYLE = {
  connecting: { color: '#8A8F95', idleLen: 10, pulse: 0.35 },
  idle: { color: '#C9C2B8', idleLen: 8, pulse: 0.15 },
  listening: { color: '#9BCB71', idleLen: 10, pulse: 0 },
  thinking: { color: '#E96B2C', idleLen: 12, pulse: 0.9 },
  speaking: { color: '#4AA3DF', idleLen: 10, pulse: 0 },
};

class RadialVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.analyser = null;
    this.bins = null;
    // Rendered bar lengths, eased toward the target every frame so the ring
    // never jitters on a single loud sample.
    this.levels = new Array(BAR_COUNT).fill(0);
    this.frame = 0;
    this.raf = null;
  }

  setState(state) {
    if (STATE_STYLE[state]) this.state = state;
  }

  // Pass null to fall back to the state's idle animation (thinking pulses,
  // speaking/listening go flat when their track is silent).
  attachAnalyser(analyser) {
    this.analyser = analyser;
    this.bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  }

  start() {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.analyser = null;
    this.levels.fill(0);
    this.draw();
  }

  // Average the FFT bins into BAR_COUNT buckets, skewed toward the low end
  // where speech energy actually lives — an even split leaves most bars dead.
  sample() {
    if (!this.analyser || !this.bins) return null;
    this.analyser.getByteFrequencyData(this.bins);
    const usable = Math.floor(this.bins.length * 0.6);
    const per = Math.max(1, Math.floor(usable / BAR_COUNT));
    const out = new Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      let sum = 0;
      for (let j = 0; j < per; j++) sum += this.bins[i * per + j] || 0;
      out[i] = (sum / per) / 255;
    }
    return out;
  }

  draw() {
    const { ctx, canvas } = this;
    const style = STATE_STYLE[this.state] || STATE_STYLE.idle;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.frame++;
    const levels = this.sample();
    // No analyser (or a silent one): breathe so the ring never looks frozen.
    const breathe = style.pulse
      ? (Math.sin(this.frame / 12) + 1) / 2 * style.pulse
      : 0;

    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = BAR_WIDTH;
    ctx.lineCap = 'round';

    for (let i = 0; i < BAR_COUNT; i++) {
      // Rotate the pulse around the ring while thinking, so it reads as a
      // spinner rather than everything throbbing in unison.
      const phase = style.pulse
        ? (Math.sin((this.frame / 8) - (i / BAR_COUNT) * Math.PI * 2) + 1) / 2
        : 0;
      const target = levels ? levels[i] : Math.max(breathe, phase * style.pulse);
      this.levels[i] += (target - this.levels[i]) * 0.35;

      const len = style.idleLen + this.levels[i] * (BAR_MAX - BAR_MIN);
      const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
      const inner = RADIUS - len / 2;
      const outer = RADIUS + len / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }
}

window.RadialVisualizer = RadialVisualizer;
