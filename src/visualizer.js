// CymaticsVisualizer — audio-reactive cymatics-style rings and spokes.
// Pure canvas 2D, no deps. Driven by an AnalyserNode on the master bus.

export class CymaticsVisualizer {
  constructor(canvas, analyser, opts = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.analyser = analyser;
    this.rings = opts.rings ?? 28;
    this.spokes = opts.spokes ?? 96;
    this.baseRadius = opts.baseRadius ?? 0.18;
    this.hue = opts.hue ?? 199;
    this.running = false;
    this._raf = null;
    this._data = null;
    this._time = 0;
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  setHue(h) {
    this.hue = h;
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.analyser && !this._data) {
      this._data = new Uint8Array(this.analyser.frequencyBinCount);
    }
    const loop = () => {
      if (!this.running) return;
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }

  _draw() {
    const { ctx2d, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.46;

    let energy = 0;
    let bass = 0;
    let mid = 0;
    let high = 0;
    if (this.analyser && this._data) {
      this.analyser.getByteFrequencyData(this._data);
      const bins = this._data.length;
      const avg = (from, to) => {
        let sum = 0;
        const a = Math.floor(bins * from);
        const b = Math.floor(bins * to);
        for (let i = a; i < b; i += 1) sum += this._data[i];
        return sum / Math.max(1, b - a) / 255;
      };
      bass = avg(0, 0.08);
      mid = avg(0.08, 0.35);
      high = avg(0.35, 0.8);
      energy = bass * 0.5 + mid * 0.35 + high * 0.15;
    }

    this._time += 0.016;

    // Fade previous frame for motion trails
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.fillStyle = 'rgba(4, 8, 20, 0.22)';
    ctx2d.fillRect(0, 0, w, h);

    ctx2d.globalCompositeOperation = 'lighter';

    // Cymatics rings — radius follows frequency bins, wobble follows phase
    const ringCount = this.rings;
    for (let i = 0; i < ringCount; i += 1) {
      const bin = Math.floor((i / ringCount) * (this._data?.length ?? 64));
      const level = this._data ? (this._data[bin] ?? 0) / 255 : 0.2 + 0.1 * Math.sin(this._time + i);
      const t = i / ringCount;
      const base = maxR * (this.baseRadius + t * 0.72);
      const radius = base * (0.86 + level * 0.35) + bass * maxR * 0.08;
      const hue = (this.hue + i * 4 + this._time * 6) % 360;
      const alpha = 0.05 + level * 0.25;
      ctx2d.beginPath();
      const steps = this.spokes;
      for (let s = 0; s <= steps; s += 1) {
        const angle = (s / steps) * Math.PI * 2;
        const wobble = Math.sin(angle * (3 + (i % 5)) + this._time * (1.1 + (i % 3))) * (2 + level * 9);
        const x = cx + Math.cos(angle) * (radius + wobble);
        const y = cy + Math.sin(angle) * (radius + wobble);
        if (s === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.closePath();
      ctx2d.strokeStyle = `hsla(${hue}, 85%, ${52 + level * 22}%, ${alpha})`;
      ctx2d.lineWidth = 1 + level * 1.6;
      ctx2d.shadowBlur = 8 + level * 18;
      ctx2d.shadowColor = `hsla(${hue}, 90%, 60%, ${alpha})`;
      ctx2d.stroke();
    }

    // Radial spokes — bass energy drives length, treble drives sparkle
    const spokeCount = this.spokes;
    for (let s = 0; s < spokeCount; s += 1) {
      const angle = (s / spokeCount) * Math.PI * 2 + this._time * 0.15;
      const bin = Math.floor((s / spokeCount) * (this._data?.length ?? 64));
      const level = this._data ? (this._data[bin] ?? 0) / 255 : 0.15;
      const inner = maxR * (0.1 + bass * 0.06);
      const outer = inner + maxR * (0.05 + level * 0.32 + high * 0.1);
      const hue = (this.hue + s * 1.5) % 360;
      ctx2d.beginPath();
      ctx2d.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx2d.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx2d.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.05 + level * 0.3})`;
      ctx2d.lineWidth = 1 + level;
      ctx2d.stroke();
    }

    // Core glow reacts to overall energy
    const coreR = maxR * (0.05 + energy * 0.09);
    const core = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, Math.max(4, coreR));
    core.addColorStop(0, `hsla(${this.hue}, 95%, 75%, ${0.35 + energy * 0.4})`);
    core.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx2d.fillStyle = core;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, Math.max(4, coreR), 0, Math.PI * 2);
    ctx2d.fill();

    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.shadowBlur = 0;
  }
}
