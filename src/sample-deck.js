// SampleDeck — import a song, slice it on the beat grid, loop sections,
// scratch with your hand, reverse, repitch — all with Web Audio.
// Beat detection uses onset-energy autocorrelation (bpm-detective style).

export class SampleDeck {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.85;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;

    this.filter.connect(this.out);
    this.out.connect(destination);

    this.buffer = null;
    this.reversedBuffer = null;
    this.isReversed = false;
    this.bpm = 0;
    this.slices = []; // [{start, end}] in seconds
    this.sliceBars = 2; // slices per beat group

    this.source = null;
    this.playing = false;
    this.startedAt = 0;
    this.offset = 0;
    this.rate = 1;
    this.loopRegion = null; // {start, end} seconds
    this.duration = 0;
    this.onStateChange = null;

    this._playheadRaf = null;
  }

  get ready() {
    return !!this.buffer;
  }

  _emit() {
    this.onStateChange?.(this);
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), this.ctx.currentTime, 0.04);
  }

  setFilterHz(hz) {
    this.filter.frequency.setTargetAtTime(Math.max(60, Math.min(20000, hz)), this.ctx.currentTime, 0.05);
  }

  /* ---------- Loading & analysis ---------- */

  async loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.buffer = audioBuffer;
    this.duration = audioBuffer.duration;
    this.reversedBuffer = this._reverseBuffer(audioBuffer);
    this.isReversed = false;
    this.offset = 0;
    this.loopRegion = null;

    this.bpm = detectBPM(audioBuffer);
    this._buildSlices();
    this._emit();
    return { duration: this.duration, bpm: this.bpm, slices: this.slices.length };
  }

  _reverseBuffer(buffer) {
    const out = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0, n = src.length; i < n; i += 1) dst[i] = src[n - 1 - i];
    }
    return out;
  }

  // Beat-grid slicing: each slice = sliceBars bars worth of beats.
  _buildSlices() {
    this.slices = [];
    if (!this.buffer) return;
    const bpm = this.bpm || 120;
    const beat = 60 / bpm;
    const sliceLen = beat * 4 * this.sliceBars; // bars -> seconds
    for (let t = 0; t < this.duration; t += sliceLen) {
      this.slices.push({ start: t, end: Math.min(this.duration, t + sliceLen) });
    }
    if (this.slices.length === 0) {
      this.slices.push({ start: 0, end: this.duration });
    }
  }

  setSliceBars(bars) {
    this.sliceBars = Math.max(1, Math.min(8, bars | 0));
    this._buildSlices();
    this._emit();
  }

  /* ---------- Transport ---------- */

  play(offset = null, { loop = false } = {}) {
    this.stop();
    if (!this.buffer) return;
    const buffer = this.isReversed ? this.reversedBuffer : this.buffer;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.filter);

    let start = offset ?? this.offset;
    if (start >= this.duration) start = 0;

    if (loop && this.loopRegion) {
      src.loop = true;
      src.loopStart = Math.max(0, this.loopRegion.start);
      src.loopEnd = Math.min(this.duration, this.loopRegion.end);
      if (start < src.loopStart || start >= src.loopEnd) start = src.loopStart;
    }

    src.start(0, start);
    this.source = src;
    this.playing = true;
    this.startedAt = this.ctx.currentTime;
    this.offset = start;
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.offset = 0;
        this._emit();
      }
    };
    this._emit();
  }

  playSlice(index, { loop = true } = {}) {
    if (!this.slices[index]) return;
    const slice = this.slices[index];
    this.loopRegion = { start: slice.start, end: slice.end };
    this.play(slice.start, { loop });
  }

  stop() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    if (this.playing) {
      this.offset = this.getPosition();
    }
    this.playing = false;
    this._emit();
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  setRate(rate) {
    this.rate = Math.max(0.25, Math.min(4, rate));
    if (this.source) this.source.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.03);
    this._emit();
  }

  setReverse(on) {
    const pos = this.getPosition();
    this.isReversed = !!on;
    if (this.playing) {
      const newPos = on ? this.duration - pos : this.duration - pos;
      this.play(Math.max(0, newPos), { loop: !!this.loopRegion });
    } else {
      this.offset = Math.max(0, this.duration - pos);
    }
    this._emit();
  }

  // Scrub/scratch: seek to an absolute position (seconds).
  seek(pos) {
    const clamped = Math.max(0, Math.min(this.duration, pos));
    if (this.playing) {
      this.play(clamped, { loop: !!this.loopRegion });
    } else {
      this.offset = clamped;
    }
    this._emit();
  }

  // Position in seconds, accounting for playback rate.
  getPosition() {
    if (!this.playing) return this.offset;
    let pos = this.offset + (this.ctx.currentTime - this.startedAt) * this.rate;
    if (this.source?.loop && pos > this.source.loopEnd) {
      const loopLen = this.source.loopEnd - this.source.loopStart;
      pos = this.source.loopStart + ((pos - this.source.loopStart) % loopLen);
    }
    return Math.max(0, Math.min(this.duration, pos));
  }

  setLoopRegion(start, end) {
    if (start == null) {
      this.loopRegion = null;
    } else {
      this.loopRegion = { start: Math.max(0, start), end: Math.min(this.duration, end) };
    }
    if (this.playing && this.source) {
      this.play(this.getPosition(), { loop: !!this.loopRegion });
    }
    this._emit();
  }

  dispose() {
    this.stop();
    try {
      this.out.disconnect();
      this.filter.disconnect();
    } catch {
      /* noop */
    }
  }
}

/* ---------- BPM detection (bpm-detective style, from the FL repo algorithm) ---------- */

export function detectBPM(audioBuffer) {
  // Downmix to mono.
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i += 1) {
    mono[i] = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
  }

  // Cap analysis at 60s for speed.
  const sr = audioBuffer.sampleRate;
  const maxSamples = Math.min(mono.length, sr * 60);
  const window = 1024;
  const frames = Math.floor(maxSamples / window);
  if (frames < 16) return 0;

  // Onset energy per window.
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * window;
    for (let i = 0; i < window; i += 4) sum += Math.abs(mono[base + i]);
    energy[f] = sum;
  }

  // Autocorrelation over the BPM range 60–200.
  const fps = sr / window;
  const minLag = Math.max(1, Math.floor((60 / 200) * fps));
  const maxLag = Math.min(frames - 1, Math.ceil((60 / 60) * fps));

  let best = 0;
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i + lag < frames; i += 1) corr += energy[i] * energy[i + lag];
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }

  let bpm = (60 * fps) / bestLag;
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}
