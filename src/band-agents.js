// Band agents — rule-based backing musicians that follow your gestures.
// Each agent schedules notes ahead of time using the Web Audio clock.

const LOOKAHEAD_MS = 40;
const SCHEDULE_AHEAD = 0.22;

export class BaseAgent {
  constructor(ctx, destination, name) {
    this.ctx = ctx;
    this.name = name;
    this.out = ctx.createGain();
    this.out.gain.value = 0.7;
    this.out.connect(destination);
    this.enabled = false;
    this._timer = null;
    this._nextTime = 0;
    this._step = 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) this._start();
    else this._stop();
  }

  setGain(v) {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.05);
  }

  _start() {
    if (this._timer) return;
    this._nextTime = this.ctx.currentTime + 0.06;
    this._step = 0;
    this._timer = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  _stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // Subclasses implement: stepDuration() and playStep(step, time)
  _tick() {
    while (this._nextTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      try {
        this.playStep(this._step, this._nextTime);
      } catch {
        /* never let an agent take down the app */
      }
      this._nextTime += this.stepDuration(this._step);
      this._step += 1;
    }
  }
}

export class BassAgent extends BaseAgent {
  constructor(ctx, destination) {
    super(ctx, destination, 'Bass');
    this.state = { chordNotes: [48, 52, 55], bpm: 100 };
    this.octave = -12;
  }

  stepDuration() {
    return 60 / this.state.bpm / 2; // eighth notes
  }

  update(state) {
    this.state = state;
  }

  playStep(step, t) {
    const notes = this.state.chordNotes?.length ? this.state.chordNotes : [48];
    const pattern = [0, -1, 0, 0, -1, 0, -1, 0]; // -1 = rest
    const p = pattern[step % 8];
    if (p < 0) return;
    const midi = Math.max(24, notes[0] + this.octave);
    this._note(midi, t, 0.34);
  }

  _note(midi, t, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

export class ArpAgent extends BaseAgent {
  constructor(ctx, destination) {
    super(ctx, destination, 'Arp');
    this.state = { chordNotes: [48, 52, 55, 59], bpm: 100 };
    this.waveform = 'triangle';
  }

  stepDuration() {
    return 60 / this.state.bpm / 2; // eighth notes
  }

  update(state) {
    this.state = state;
  }

  playStep(step, t) {
    const notes = this.state.chordNotes?.length ? this.state.chordNotes : [48, 52, 55];
    const midi = notes[step % notes.length] + 12 * (1 + (Math.floor(step / notes.length) % 2));
    const osc = this.ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

export class PadAgent extends BaseAgent {
  constructor(ctx, destination) {
    super(ctx, destination, 'Pad');
    this.state = { chordNotes: [48, 52, 55], bpm: 100 };
    this._voices = [];
  }

  stepDuration() {
    return (60 / this.state.bpm) * 2; // every 2 beats re-trigger
  }

  update(state) {
    this.state = state;
  }

  setEnabled(on) {
    super.setEnabled(on);
    if (!on) this._stopVoices();
  }

  _stopVoices() {
    const t = this.ctx.currentTime;
    this._voices.forEach(({ osc, gain }) => {
      gain.gain.setTargetAtTime(0, t, 0.15);
      osc.stop(t + 0.6);
    });
    this._voices = [];
  }

  playStep(step, t) {
    if (step % 2 !== 0) return;
    this._stopVoices();
    const notes = this.state.chordNotes?.length ? this.state.chordNotes : [48, 52, 55];
    const dur = this.stepDuration() * 1.1;
    notes.forEach((midi) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = (Math.random() * 10) - 5;
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.25);
      g.gain.setTargetAtTime(0, t + dur * 0.7, 0.2);
      osc.connect(lp).connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.4);
      this._voices.push({ osc, gain: g });
    });
  }
}
