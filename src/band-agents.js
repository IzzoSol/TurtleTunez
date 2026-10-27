// Band agents — rule-based backing musicians that follow your gestures.
// Each agent schedules notes ahead of time using the Web Audio clock.

import { pluck } from './effects.js';

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
    this.intensity = 2; // 1 = sparse, 2 = normal, 3 = busy
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

  setIntensity(level) {
    this.intensity = Math.max(1, Math.min(3, level | 0));
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
    const root = Math.max(24, notes[0] + this.octave);
    const fifth = Math.max(24, (notes[2] ?? notes[0] + 7) + this.octave);
    const oct = root + 12;

    // Grooves: intensity 1 = laid back, 2 = pocketed, 3 = driving with octave jumps.
    const patterns = {
      1: [0, -1, -1, 0, -1, -1, 0, -1],
      2: [0, -1, 0, -1, 0, 0, -1, 0],
      3: [0, 0, -1, 0, 0, -1, oct, 0],
    };
    const p = patterns[this.intensity][step % 8];
    if (p === -1) return;

    // Land the fifth on beat 3 for movement.
    const midi = step % 8 === 4 && this.intensity > 1 ? fifth : p;
    this._note(midi === oct ? oct : midi, t, 0.34);
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
    const idx = step % notes.length;

    // Intensity 1 skips off-beats, 3 doubles up with octave shimmer.
    if (this.intensity === 1 && step % 2 === 1) return;
    let midi = notes[idx] + 12;
    if (this.intensity === 3 && step % 4 >= 2) midi += 12;

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

export class StringsAgent extends BaseAgent {
  constructor(ctx, destination) {
    super(ctx, destination, 'Strings');
    this.state = { chordNotes: [48, 52, 55], bpm: 100 };
  }

  stepDuration() {
    // One pluck per beat — a gentle guitar-like strum.
    return 60 / this.state.bpm;
  }

  update(state) {
    this.state = state;
  }

  playStep(step, t) {
    // Strum a chord voicing once per bar; intensity adds an off-beat pluck.
    const inBar = step % 4;
    if (inBar !== 0 && !(this.intensity >= 3 && inBar === 2)) return;

    const notes = this.state.chordNotes?.length ? this.state.chordNotes : [48, 52, 55];
    const voicing = notes.slice(0, this.intensity >= 2 ? 4 : 3);
    voicing.forEach((midi, i) => {
      // Stagger the plucks a few milliseconds apart = strummed feel.
      pluck(this.ctx, this.out, midiToFreq(midi), {
        damping: 0.995 - i * 0.001,
        duration: 1.6,
        level: 0.32 / voicing.length,
        when: t + i * 0.014,
      });
    });
  }
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class PadAgent extends BaseAgent {
  constructor(ctx, destination) {
    super(ctx, destination, 'Pad');
    this.state = { chordNotes: [48, 52, 55], bpm: 100 };
    this._voices = [];
  }

  stepDuration() {
    return (60 / this.state.bpm) * 2; // re-trigger every 2 beats
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
    // Intensity scales both level and brightness.
    const level = 0.08 + this.intensity * 0.03;
    const cutoff = 900 + this.intensity * 700;
    notes.forEach((midi) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = (Math.random() * 10) - 5;
      osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t);
      lp.frequency.linearRampToValueAtTime(cutoff * 0.55, t + dur); // slow sweep
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.25);
      g.gain.setTargetAtTime(0, t + dur * 0.7, 0.2);
      osc.connect(lp).connect(g).connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.4);
      this._voices.push({ osc, gain: g });
    });
  }
}
