// Effects — studio-grade Web Audio effects built natively.
// Reverb: noise-burst impulse response generation (reverbGen-style)
// rendered into a ConvolverNode with wet/dry control.

export function generateImpulseResponse(ctx, { seconds = 2.2, decay = 2.6 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export class Reverb {
  constructor(ctx, destination, { seconds = 2.2, decay = 2.6, wet = 0.25 } = {}) {
    this.ctx = ctx;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = generateImpulseResponse(ctx, { seconds, decay });

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = wet;

    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1 - wet;

    this.input.connect(this.dryGain).connect(destination);
    this.input.connect(this.convolver).connect(this.wetGain).connect(destination);
  }

  setWet(wet) {
    const w = Math.max(0, Math.min(1, wet));
    const t = this.ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(w, t, 0.08);
    this.dryGain.gain.setTargetAtTime(1 - w, t, 0.08);
  }

  connectFrom(node) {
    node.connect(this.input);
  }
}

// Effects extended — delay, chorus, phaser, overdrive, compressor, ping-pong delay, bitcrush.
// Each builds a node chain and exposes connectFrom(node) + setWet(value).

export class Delay {
  constructor(ctx, destination, { time = 0.3, feedback = 0.4, wet = 0.35 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = time;
    this.fb = ctx.createGain();
    this.fb.gain.value = feedback;
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    this.input.connect(this.dry).connect(destination);
    this.input.connect(this.delay).connect(this.wet).connect(destination);
    this.delay.connect(this.fb).connect(this.delay);
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  setTime(s) { this.delay.delayTime.setTargetAtTime(Math.max(0.001, Math.min(2, s)), this.ctx.currentTime, 0.06); }
  setFeedback(f) { this.fb.gain.setTargetAtTime(Math.max(0, Math.min(0.92, f)), this.ctx.currentTime, 0.06); }
  connectFrom(n) { n.connect(this.input); }
}

export class Chorus {
  constructor(ctx, destination, { rate = 1.5, depth = 0.003, wet = 0.35 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = rate;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = depth;
    this.lfo.connect(this.lfoDepth);

    // Two slightly detuned delay lines for stereo width.
    this.delayL = ctx.createDelay(0.05);
    this.delayR = ctx.createDelay(0.05);
    this.delayL.delayTime.value = 0.012;
    this.delayR.delayTime.value = 0.018;
    this.lfoDepth.connect(this.delayL.delayTime);
    this.lfoDepth.connect(this.delayR.delayTime);

    const merge = ctx.createChannelMerger(2);
    this.delayL.connect(merge, 0, 0);
    this.delayR.connect(merge, 0, 1);

    this.input.connect(this.dry).connect(destination);
    this.input.connect(this.delayL);
    this.input.connect(this.delayR);
    merge.connect(this.wet).connect(destination);
    this.lfo.start();
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  connectFrom(n) { n.connect(this.input); }
}

export class Phaser {
  constructor(ctx, destination, { rate = 1.5, depth = 0.3, stages = 4, wet = 0.35 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = rate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200 + depth * 1500;
    this.lfo.connect(lfoGain);

    // Allpass stages in series.
    let node = this.input;
    const filters = [];
    for (let i = 0; i < stages; i += 1) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 400 + i * 200;
      lfoGain.connect(ap.frequency);
      node.connect(ap);
      filters.push(ap);
      node = ap;
    }
    node.connect(this.wet).connect(destination);
    this.input.connect(this.dry).connect(destination);
    this.lfo.start();
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  connectFrom(n) { n.connect(this.input); }
}

export class Overdrive {
  constructor(ctx, destination, { drive = 0.6, wet = 0.5 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    // Waveshaper curve: tanh-style soft clip.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    const k = 1 + drive * 8;
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 128) - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '4x';

    this.input.connect(this.dry).connect(destination);
    this.input.connect(shaper).connect(this.wet).connect(destination);
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  setDrive(d) {
    const shaper = this.input.context.createWaveShaper();
    // rebuild curve with new drive (cheap-ish; called rarely)
    const curve = new Float32Array(256);
    const k = 1 + d * 8;
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 128) - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
  }
  connectFrom(n) { n.connect(this.input); }
}

export class Compressor {
  constructor(ctx, destination, { threshold = -18, ratio = 4, attack = 0.003, release = 0.25 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = threshold;
    this.comp.knee.value = 12;
    this.comp.ratio.value = ratio;
    this.comp.attack.value = attack;
    this.comp.release.value = release;
    this.input.connect(this.comp).connect(destination);
  }
  connectFrom(n) { n.connect(this.input); }
}

export class Bitcrush {
  constructor(ctx, destination, { bits = 8, wet = 0.0 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    const shaper = ctx.createWaveShaper();
    const levels = Math.pow(2, bits);
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) {
      const x = (i / 512) - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    shaper.curve = curve;

    this.input.connect(this.dry).connect(destination);
    this.input.connect(shaper).connect(this.wet).connect(destination);
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  connectFrom(n) { n.connect(this.input); }
}

export function pluck(ctx, destination, freq, { damping = 0.996, duration = 2.2, level = 0.5, when = 0 } = {}) {
  const t = when || ctx.currentTime;
  const delayTime = 1 / Math.max(20, freq);

  // Excite the string with a short noise burst.
  const exciteLength = Math.max(1, Math.floor(ctx.sampleRate * delayTime));
  const excite = ctx.createBuffer(1, exciteLength, ctx.sampleRate);
  const exciteData = excite.getChannelData(0);
  for (let i = 0; i < exciteLength; i += 1) exciteData[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = excite;

  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = delayTime;

  const feedback = ctx.createGain();
  feedback.gain.value = damping;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = Math.min(12000, freq * 8);

  const out = ctx.createGain();
  out.gain.setValueAtTime(level, t);
  out.gain.setTargetAtTime(0, t + duration * 0.6, duration * 0.25);

  src.connect(delay);
  delay.connect(lowpass).connect(feedback).connect(delay); // string loop
  delay.connect(out).connect(destination);

  src.start(t);
  src.stop(t + delayTime + 0.02);
  return out;
}

export class PingPong {
  constructor(ctx, destination, { left = 0.15, right = 0.2, feedback = 0.35, wet = 0.3 } = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = wet;
    this.dry.gain.value = 1 - wet;

    this.dl = ctx.createDelay(2);
    this.dr = ctx.createDelay(2);
    this.dl.delayTime.value = left;
    this.dr.delayTime.value = right;

    this.fbl = ctx.createGain();
    this.fbr = ctx.createGain();
    this.fbl.gain.value = feedback;
    this.fbr.gain.value = feedback;

    this.input.connect(this.dry).connect(destination);
    this.input.connect(this.dl);
    this.dl.connect(this.dr);
    this.dr.connect(this.dl);
    this.dl.connect(this.wet).connect(destination);
    this.dr.connect(this.wet);
    this.dl.connect(this.fbl).connect(this.dr);
    this.dr.connect(this.fbr).connect(this.dl);
  }
  setWet(w) {
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w, t, 0.06);
    this.dry.gain.setTargetAtTime(1 - w, t, 0.06);
  }
  connectFrom(n) { n.connect(this.input); }
}
