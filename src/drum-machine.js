// DrumMachine — Web Audio drum synth + 16-step sequencer.
// Patterns adapted from the FL Studio AI pattern library (trap/house/hiphop/lofi/techno).

const PATTERNS = {
  trap: {
    name: 'Trap',
    kick: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  house: {
    name: 'House',
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  },
  hiphop: {
    name: 'Hip-Hop',
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  lofi: {
    name: 'Lo-Fi',
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  techno: {
    name: 'Techno',
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hihat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  },
};

const DRUM_ROWS = ['kick', 'snare', 'hihat', 'clap'];

export class DrumMachine {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(destination);

    this.bpm = 100;
    this.enabled = false;
    this.pattern = PATTERNS.trap;
    this.swing = 0; // 0..0.3 seconds offbeat delay
    this.custom = null; // when set, overrides pattern

    this._noise = this._makeNoise();
    this._timer = null;
    this._nextStepTime = 0;
    this._step = 0;
    this._onStep = null; // callback(stepIndex)
  }

  static get patterns() {
    return PATTERNS;
  }

  static get rows() {
    return DRUM_ROWS;
  }

  setBpm(bpm) {
    this.bpm = Math.min(220, Math.max(50, Number(bpm) || 100));
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) this._startClock();
    else this._stopClock();
  }

  setPattern(name) {
    if (PATTERNS[name]) {
      this.pattern = PATTERNS[name];
      this.custom = null;
    }
  }

  setCustom(custom) {
    this.custom = custom;
  }

  get active() {
    return this.custom || this.pattern;
  }

  onStep(cb) {
    this._onStep = cb;
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startClock() {
    if (this._timer) return;
    this._nextStepTime = this.ctx.currentTime + 0.08;
    this._step = 0;
    this._timer = setInterval(() => this._schedule(), 40);
  }

  _stopClock() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _schedule() {
    const stepDur = 60 / this.bpm / 4;
    while (this._nextStepTime < this.ctx.currentTime + 0.18) {
      const stepIdx = this._step % 16;
      const pat = this.active;
      const swingDelay = stepIdx % 2 === 1 ? this.swing : 0;
      DRUM_ROWS.forEach((row) => {
        if (pat[row] && pat[row][stepIdx]) {
          this.trigger(row, this._nextStepTime + swingDelay);
        }
      });
      const displayStep = stepIdx;
      const at = this._nextStepTime;
      setTimeout(() => this._onStep?.(displayStep), Math.max(0, (at - this.ctx.currentTime) * 1000));
      this._nextStepTime += stepDur;
      this._step += 1;
    }
  }

  trigger(row, when) {
    const t = when ?? this.ctx.currentTime;
    switch (row) {
      case 'kick': return this._kick(t);
      case 'snare': return this._snare(t);
      case 'hihat': return this._hihat(t);
      case 'clap': return this._clap(t);
      default: return null;
    }
  }

  _env(t, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  _kick(t) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this._env(t, 0.002, 0.28, 1.0);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  _snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = this._env(t, 0.001, 0.16, 0.7);
    src.connect(bp).connect(g);
    src.start(t);
    src.stop(t + 0.2);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g2 = this._env(t, 0.001, 0.09, 0.4);
    osc.connect(g2);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  _hihat(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = this._env(t, 0.001, 0.045, 0.35);
    src.connect(hp).connect(g);
    src.start(t);
    src.stop(t + 0.08);
  }

  _clap(t) {
    for (let i = 0; i < 3; i += 1) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 1.4;
      const start = t + i * 0.012;
      const g = this._env(start, 0.001, 0.1, 0.45);
      src.connect(bp).connect(g);
      src.start(start);
      src.stop(start + 0.14);
    }
  }
}
