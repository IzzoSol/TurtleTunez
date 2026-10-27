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
      // Exponentially decaying noise burst.
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

  // Route a node through the reverb.
  connectFrom(node) {
    node.connect(this.input);
  }
}

// Karplus-Strong plucked string (javascript-karplus-strong-style),
// implemented with a Web Audio delay-line feedback loop.
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
