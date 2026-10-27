// Synth character presets — each reshapes the chord voice engine.
// Expanded from the FL Studio AI preset library (osc combos + filter character).
// wave: main oscillator · detune: cents · sub: sub-osc level (one octave down)
// subWave: sub oscillator type · char: character filter cutoff (Hz)

export const SYNTH_PRESETS = {
  /* ---- Pads ---- */
  softPad: { name: 'Soft Pad', wave: 'sine', detune: 6, sub: 0.45, subWave: 'sine', char: 1600 },
  warmPad: { name: 'Warm Pad', wave: 'sawtooth', detune: 8, sub: 0.35, subWave: 'triangle', char: 1200 },
  darkPad: { name: 'Dark Pad', wave: 'sawtooth', detune: 14, sub: 0.5, subWave: 'sawtooth', char: 600 },
  ethereal: { name: 'Ethereal Pad', wave: 'triangle', detune: 10, sub: 0.4, subWave: 'sine', char: 1800 },
  /* ---- Leads ---- */
  brightLead: { name: 'Bright Lead', wave: 'sawtooth', detune: 12, sub: 0, subWave: 'sine', char: 3400 },
  analogLead: { name: 'Analog Lead', wave: 'sawtooth', detune: 16, sub: 0.25, subWave: 'square', char: 2000 },
  acidLead: { name: 'Acid Lead', wave: 'sawtooth', detune: 3, sub: 0, subWave: 'sine', char: 1000 },
  softLead: { name: 'Soft Lead', wave: 'triangle', detune: 7, sub: 0.2, subWave: 'sine', char: 1800 },
  /* ---- Bass ---- */
  subBass: { name: 'Sub Bass', wave: 'square', detune: 4, sub: 0.85, subWave: 'sine', char: 900 },
  reeseBass: { name: 'Reese Bass', wave: 'sawtooth', detune: 22, sub: 0.55, subWave: 'sawtooth', char: 400 },
  bass808: { name: '808 Bass', wave: 'sine', detune: 2, sub: 0.9, subWave: 'sine', char: 300 },
  /* ---- Keys / plucks ---- */
  rhodes: { name: 'Rhodes Keys', wave: 'triangle', detune: 5, sub: 0.3, subWave: 'sine', char: 1800 },
  organ: { name: 'Organ', wave: 'sawtooth', detune: 0, sub: 0.4, subWave: 'square', char: 2000 },
  glassKeys: { name: 'Glass Keys', wave: 'sine', detune: 11, sub: 0.25, subWave: 'square', char: 3500 },
  synthPluck: { name: 'Synth Pluck', wave: 'square', detune: 9, sub: 0, subWave: 'sine', char: 2000 },
  /* ---- Bells ---- */
  fmBell: { name: 'FM Bell', wave: 'sine', detune: 0, sub: 0.35, subWave: 'triangle', char: 2600 },
  vibraphone: { name: 'Vibraphone', wave: 'triangle', detune: 4, sub: 0.2, subWave: 'sine', char: 3500 },
};

export const PRESET_ORDER = [
  'softPad', 'warmPad', 'darkPad', 'ethereal',
  'brightLead', 'analogLead', 'acidLead', 'softLead',
  'subBass', 'reeseBass', 'bass808',
  'rhodes', 'organ', 'glassKeys', 'synthPluck',
  'fmBell', 'vibraphone',
];
