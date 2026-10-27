// Euclidean rhythms (Beet.js-style) — evenly distributes pulses
// across steps using the Bjorklund algorithm. E.g. (3, 8) = [x..x..x.]

export function euclidPattern(pulses, steps, rotation = 0) {
  const p = Math.max(0, Math.min(steps, pulses | 0));
  const s = Math.max(1, steps | 0);
  const pattern = new Array(s).fill(0);

  if (p === 0) return pattern;
  if (p === s) return pattern.fill(1);

  // Bjorklund: bucket distribution.
  const bucket = Math.floor(s / p);
  const remainder = s % p;
  let index = 0;
  for (let i = 0; i < p; i += 1) {
    pattern[index % s] = 1;
    index += bucket + (i < remainder ? 1 : 0);
  }

  // Rotation shifts the pattern start.
  const rotated = new Array(s).fill(0);
  for (let i = 0; i < s; i += 1) {
    rotated[i] = pattern[(i + rotation + s) % s];
  }
  return rotated;
}

// Build a full drum pattern from three euclidean layers.
export function euclidDrumPattern({ kickPulses = 4, snarePulses = 2, hatPulses = 8, steps = 16, rotation = 0 } = {}) {
  return {
    name: 'Euclid',
    genre: 'Euclid',
    kick: euclidPattern(kickPulses, steps, 0),
    snare: euclidPattern(snarePulses, steps, 4 + rotation),
    hihat: euclidPattern(hatPulses, steps, rotation),
    clap: euclidPattern(Math.max(1, Math.floor(snarePulses / 2)), steps, 8 + rotation),
  };
}
