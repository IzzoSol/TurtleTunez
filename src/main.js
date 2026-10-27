import './styles.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DrumMachine } from './drum-machine.js';
import { BassAgent, ArpAgent, PadAgent, StringsAgent } from './band-agents.js';
import { CymaticsVisualizer } from './visualizer.js';
import { SYNTH_PRESETS } from './synth-presets.js';
import { StudioRecorder } from './recorder.js';
import { SampleDeck } from './sample-deck.js';
import { parseInstruction, askLLM, loadBrainSettings, saveBrainSettings, hasLLM } from './agent-brain.js';
import { Reverb, pluck, Bitcrush, Compressor, Chorus, Delay, Overdrive, Phaser, PingPong } from './effects.js';
import { euclidDrumPattern } from './euclid.js';

const WASM_BASE = '/wasm';
const MODEL_URL = '/hand_landmarker.task';

const VOICE_COUNT = 5;
const CONFIRM_FRAMES = 4;
const HAND_LOST_MS = 500;
const MAX_VOLUME = 0.5;

const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const PITCH_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_SEMITONES = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const KEY_OPTIONS = Object.keys(KEY_SEMITONES);
const PATTERN_ORDER = ['trap', 'house', 'hiphop', 'lofi', 'techno'];
const MODES = ['solo', 'duo', 'band', 'beats', 'sample', 'cymatics'];
const DRAWER_TITLES = { sound: 'Sound', beats: 'Beats', sample: 'Sample', agents: 'Agents', guide: 'Guide' };

const HAND_BONES = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [0, 17, 18, 19, 20],
];

const $ = (id) => document.getElementById(id);

const video = $('video');
const canvas = $('overlay');
const ctx2d = canvas.getContext('2d');
const startButton = $('startButton');
const recordButton = $('recordButton');
const keySelect = $('keySelect');
const presetSelect = $('presetSelect');
const statusBadge = $('statusBadge');
const drumPatternSelect = $('drumPatternSelect');
const grooveSelect = $('grooveSelect');
const fillsToggle = $('fillsToggle');
const tuningSelect = $('tuningSelect');
const reverbSlider = $('reverbSlider');
const reverbValue = $('reverbValue');
const euclidKick = $('euclidKick');
const euclidSnare = $('euclidSnare');
const euclidHat = $('euclidHat');
const euclidRotate = $('euclidRotate');
const euclidApply = $('euclidApply');
const beatBrowser = $('beatBrowser');
const sampleImport = $('sampleImport');
const sampleFile = $('sampleFile');
const sampleEmpty = $('sampleEmpty');
const sampleDeckUI = $('sampleDeckUI');
const sampleName = $('sampleName');
const sampleBpm = $('sampleBpm');
const waveformCanvas = $('waveformCanvas');
const waveformCursor = $('waveformCursor');
const samplePlayBtn = $('samplePlay');
const sampleStopBtn = $('sampleStop');
const sampleReverseBtn = $('sampleReverse');
const sampleLoopClearBtn = $('sampleLoopClear');
const sampleMatchBpmBtn = $('sampleMatchBpm');
const rateBtns = Array.from(document.querySelectorAll('.rate-btn'));
const slicePadsEl = $('slicePads');
const sliceCountEl = $('sliceCount');
const brainInput = $('brainInput');
const brainApplyBtn = $('brainApply');
const brainStatus = $('brainStatus');
const brainEndpoint = $('brainEndpoint');
const brainModel = $('brainModel');
const brainKey = $('brainKey');
const brainSaveBtn = $('brainSave');
const themeChips = Array.from(document.querySelectorAll('.theme-chip'));
const accentSwatches = Array.from(document.querySelectorAll('.accent-swatch'));
const flashlightBtn = $('flashlightBtn');
const layoutChips = Array.from(document.querySelectorAll('.layout-chip'));
const providerChips = Array.from(document.querySelectorAll('.provider-chip'));
const bpmInput = $('bpmInput');
const seqGrid = $('seqGrid');
const vizCanvas = $('vizCanvas');
const stage = $('stage');
const cameraWrap = $('cameraWrap');
const cameraIdle = $('cameraIdle');
const vizStage = $('vizStage');
const drawer = $('drawer');
const drawerTitle = $('drawerTitle');
const drawerClose = $('drawerClose');
const modeChips = Array.from(document.querySelectorAll('.mode-chip'));
const railBtns = Array.from(document.querySelectorAll('.rail-btn'));
const agentChips = Array.from(document.querySelectorAll('.agent-chip'));
const intensityBtns = Array.from(document.querySelectorAll('.intensity-segment button'));

const readouts = {
  chord: $('chordValue'),
  quality: $('qualityValue'),
  volume: $('volumeValue'),
  filter: $('filterValue'),
};

const state = {
  session: 0,
  running: false,
  starting: false,
  stream: null,
  handLandmarker: null,
  rafId: null,
  lastVideoTime: -1,
  key: 'C',
  preset: 'softPad',
  tuning: 'equal',
  reverbWet: 0.25,
  audio: null,
  left: { candidateKey: null, count: 0, value: null },
  right: { candidateKey: null, count: 0, value: null },
  lastRightSeen: 0,
  volumeTarget: 0,
  filterHz: 1200,
  musicSignature: '',
  badgeText: '',
  readoutText: {},
  bpm: 100,
  mode: 'solo',
  agentFlags: { drums: false, bass: false, arp: false, pad: false, strings: false },
  agentIntensity: 2,
  seqCustom: null,
  chordNotes: [48, 52, 55],
  playheadStep: -1,
  lastAgentSync: 0,
  activeTab: null,
};

// Tuning tables (TuneJS-style) — cent offsets per semitone from the root.
const TUNINGS = {
  equal: { name: 'Equal (12-TET)', cents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100] },
  just: { name: 'Just Intonation', cents: [0, 111.7, 203.9, 315.6, 386.3, 498.0, 702.0, 813.7, 884.4, 1017.6, 1088.3, 1200] },
  pythagorean: { name: 'Pythagorean', cents: [0, 113.7, 203.9, 317.6, 407.8, 498.0, 611.7, 702.0, 815.6, 905.9, 1019.6, 1109.8] },
  meantone: { name: 'Quarter-Comma Mean-tone', cents: [0, 76.0, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8, 1082.9] },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Tuning-aware note frequency. Falls back to 12-TET.
function midiToFrequency(midi) {
  const table = TUNINGS[state.tuning] ?? TUNINGS.equal;
  const octave = Math.floor(midi / 12);
  const semitone = ((midi % 12) + 12) % 12;
  const cents = table.cents[semitone] ?? semitone * 100;
  return 440 * Math.pow(2, (midi - 69) / 12 + cents / 1200 - semitone / 12);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- Status & readouts ---------- */

function setStatus(message) {
  if (state.badgeText === message) return;
  state.badgeText = message;
  statusBadge.textContent = message;
  statusBadge.classList.toggle('is-live', message.startsWith('Live'));
}

function setReadout(name, text) {
  if (state.readoutText[name] === text) return;
  state.readoutText[name] = text;
  readouts[name].textContent = text;
}

function setStartButton(label, { running = false, disabled = false } = {}) {
  startButton.textContent = label;
  startButton.disabled = disabled;
  startButton.classList.toggle('is-running', running);
  startButton.setAttribute('aria-pressed', String(state.running));
}

/* ---------- Visualizer lifecycle ---------- */

let vizInstance = null;

function updateVizRunState() {
  if (!vizInstance) return;
  if (state.mode === 'cymatics') vizInstance.start();
  else vizInstance.stop();
}

function ensureVisualizer(analyser) {
  vizInstance?.dispose();
  vizInstance = new CymaticsVisualizer(vizCanvas, analyser);
  updateVizRunState();
}

/* ---------- Camera framing (never cropped) ---------- */

function syncOverlayToVideo() {
  const vRect = video.getBoundingClientRect();
  const wRect = cameraWrap.getBoundingClientRect();
  canvas.style.left = `${vRect.left - wRect.left}px`;
  canvas.style.top = `${vRect.top - wRect.top}px`;
  canvas.style.width = `${vRect.width}px`;
  canvas.style.height = `${vRect.height}px`;
}

/* ---------- Gesture recognition ---------- */

function isFingerExtended(lm, tipIndex) {
  const wrist = lm[0];
  return dist(lm[tipIndex], wrist) > dist(lm[tipIndex - 2], wrist) * 1.1;
}

function isThumbExtended(lm) {
  return dist(lm[4], lm[17]) > dist(lm[2], lm[17]) * 1.2;
}

function countExtendedFingers(lm) {
  return [8, 12, 16, 20].filter((tip) => isFingerExtended(lm, tip)).length;
}

function classifyLeftHand(lm) {
  const index = isFingerExtended(lm, 8);
  const middle = isFingerExtended(lm, 12);
  const ring = isFingerExtended(lm, 16);
  const pinky = isFingerExtended(lm, 20);
  const thumb = isThumbExtended(lm);
  const count = countExtendedFingers(lm);

  let degree;
  if (index && pinky && !middle && !ring) degree = thumb ? 6 : 5;
  else if (count === 0 && thumb) degree = 4;
  else degree = count <= 1 ? 0 : count - 1;

  const tilt = lm[9].x - lm[0].x;
  return { degree, minor: tilt <= 0.04 };
}

function classifyRightHand(lm) {
  const wrist = lm[0];
  const tiltX = (lm[9].x + lm[13].x) / 2 - wrist.x;
  return {
    voicing: Math.max(1, countExtendedFingers(lm)),
    octave: isThumbExtended(lm) ? 1 : 0,
    volume: clamp(Math.max(0.2, (0.7 - wrist.y) / 0.4), 0, 1),
    filterHz: clamp(1200 * Math.pow(2, tiltX * 8), 250, 6000),
  };
}

function stabilize(tracker, sample) {
  const key = JSON.stringify(sample);
  if (key === tracker.candidateKey) {
    tracker.count += 1;
  } else {
    tracker.candidateKey = key;
    tracker.count = 1;
  }
  if (tracker.count >= CONFIRM_FRAMES) tracker.value = sample;
  return tracker.value;
}

/* ---------- Music theory ---------- */

function buildChord({ degree, minor }, { voicing, octave }, key) {
  const scale = minor ? SCALE_MINOR : SCALE_MAJOR;
  const base = 48 + KEY_SEMITONES[key] + octave * 12;
  const note = (step) => base + scale[step % 7] + 12 * Math.floor(step / 7);

  const root = note(degree);
  const third = note(degree + 2);
  const fifth = note(degree + 4);
  const seventh = note(degree + 6);

  let notes;
  if (voicing === 1) notes = [root, third, fifth];
  else if (voicing === 2) notes = [third, fifth, root + 12];
  else if (voicing === 3) notes = [root, third, fifth, seventh];
  else notes = [root, third, fifth, seventh, root + 12];

  const thirdInterval = (third - root) % 12;
  const fifthInterval = (fifth - root) % 12;
  let quality = 'Major';
  if (thirdInterval === 3) quality = fifthInterval === 6 ? 'Diminished' : 'Minor';

  const rootName = PITCH_NAMES[(root % 12 + 12) % 12];
  return { notes, quality: `${rootName} ${quality}` };
}

/* ---------- Audio graph (created only after a user gesture) ---------- */

function ensureAudio() {
  if (state.audio) {
    if (state.audio.ctx.state === 'suspended') state.audio.ctx.resume();
    return true;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return false;

  const ctx = new AudioCtor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  analyser.connect(ctx.destination);

  // Gesture chord bus — its level is played by your right hand.
  const master = ctx.createGain();
  master.gain.value = 0;

  // Studio bus — drums and agents live here so they stay audible
  // even when the gesture volume is down (e.g. Beats mode, no camera).
  const studioBus = ctx.createGain();
  studioBus.gain.value = 0.9;

  // Studio reverb (reverbGen-style convolution) on the whole mix.
  const reverb = new Reverb(ctx, analyser, { wet: state.reverbWet });
  reverb.connectFrom(master);
  reverb.connectFrom(studioBus);

  // Parallel FX sends from the chord bus (bap-style effects).
  const fx = {
    delay: new Delay(ctx, analyser, { time: 0.3, feedback: 0.4, wet: 0.3 }),
    chorus: new Chorus(ctx, analyser, { rate: 1.5, depth: 0.003, wet: 0.3 }),
    phaser: new Phaser(ctx, analyser, { rate: 1.5, depth: 0.3, wet: 0.3 }),
    overdrive: new Overdrive(ctx, analyser, { drive: 0.6, wet: 0.0 }), // off by default
    pingpong: new PingPong(ctx, analyser, { wet: 0.0 }), // off by default
    bitcrush: new Bitcrush(ctx, analyser, { bits: 8, wet: 0.0 }), // off by default
    compressor: new Compressor(ctx, analyser, { threshold: -18, ratio: 4 }),
  };
  Object.values(fx).forEach((effect) => effect.connectFrom?.(master));
  // Compressor also on the studio bus (gentle glue).
  fx.compressor.connectFrom(studioBus);

  // Gesture filter — its cutoff is played by your right-hand tilt.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = state.filterHz;
  filter.Q.value = 0.7;
  filter.connect(master);

  const voices = Array.from({ length: VOICE_COUNT }, () => {
    const preset = SYNTH_PRESETS[state.preset] ?? SYNTH_PRESETS.softPad;
    // Main oscillator + detuned sub oscillator -> character filter -> gesture filter.
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    const subGain = ctx.createGain();
    const charFilter = ctx.createBiquadFilter();

    osc.type = preset.wave;
    sub.type = preset.subWave;
    osc.detune.value = preset.detune;
    sub.detune.value = -preset.detune;
    subGain.gain.value = preset.sub;

    charFilter.type = 'lowpass';
    charFilter.frequency.value = preset.char;
    charFilter.Q.value = 0.6;

    gain.gain.value = 0;
    osc.connect(gain);
    sub.connect(subGain);
    gain.connect(charFilter);
    subGain.connect(charFilter);
    charFilter.connect(filter);

    osc.start();
    sub.start();
    return { osc, sub, gain, subGain, charFilter };
  });

  const drums = new DrumMachine(ctx, studioBus);
  drums.setBpm(state.bpm);
  drums.onStep((step) => setPlayhead(step));

  const recorder = new StudioRecorder(ctx, [master, studioBus]);

  const sampleDeck = new SampleDeck(ctx, studioBus);

  const agents = {
    bass: new BassAgent(ctx, studioBus),
    arp: new ArpAgent(ctx, studioBus),
    pad: new PadAgent(ctx, studioBus),
    strings: new StringsAgent(ctx, studioBus),
  };
  Object.values(agents).forEach((agent) => agent.setIntensity(state.agentIntensity));

  state.audio = { ctx, master, studioBus, reverb, fx, filter, voices, analyser, drums, agents, recorder, sampleDeck };
  if (!recorder.supported) recordButton.disabled = true;
  ensureVisualizer(analyser);
  return true;
}

function silence() {
  if (!state.audio) return;
  const { master, ctx } = state.audio;
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}

function applyChord(notes) {
  const { ctx, voices } = state.audio;
  const t = ctx.currentTime;
  const perVoice = 0.7 / notes.length;
  voices.forEach((voice, i) => {
    if (i < notes.length) {
      const freq = midiToFrequency(notes[i]);
      voice.osc.frequency.setTargetAtTime(freq, t, 0.04);
      voice.sub.frequency.setTargetAtTime(freq / 2, t, 0.04);
      voice.gain.gain.setTargetAtTime(perVoice, t, 0.05);
    } else {
      voice.gain.gain.setTargetAtTime(0, t, 0.05);
    }
  });
}

function applyPreset(key) {
  const preset = SYNTH_PRESETS[key];
  if (!preset) return;
  state.preset = key;
  if (!state.audio) return;
  state.audio.voices.forEach((voice) => {
    const t = state.audio.ctx.currentTime;
    voice.osc.type = preset.wave;
    voice.sub.type = preset.subWave;
    voice.osc.detune.setTargetAtTime(preset.detune, t, 0.05);
    voice.sub.detune.setTargetAtTime(-preset.detune, t, 0.05);
    voice.subGain.gain.setTargetAtTime(preset.sub, t, 0.05);
    voice.charFilter.frequency.setTargetAtTime(preset.char, t, 0.08);
  });
}

/* ---------- Studio layers ---------- */

function currentPattern() {
  return state.seqCustom || DrumMachine.patterns[drumPatternSelect.value] || DrumMachine.patterns.trap;
}

function syncStudioToState() {
  if (!state.audio) return;
  state.audio.drums.setBpm(state.bpm);
  if (state.seqCustom) state.audio.drums.setCustom(state.seqCustom);
  const shared = { chordNotes: state.chordNotes, bpm: state.bpm };
  state.audio.agents.bass.update(shared);
  state.audio.agents.arp.update(shared);
  state.audio.agents.pad.update(shared);
}

function setAgentEnabled(name, on) {
  state.agentFlags[name] = on;
  agentChips.forEach((chip) => {
    if (chip.dataset.agent === name) chip.classList.toggle('is-active', on);
  });
  if (!state.audio) return;
  if (name === 'drums') {
    const canPlay = state.running || state.mode === 'beats';
    state.audio.drums.setEnabled(on && canPlay);
  } else {
    state.audio.agents[name]?.setEnabled(on && state.running);
  }
}

/* ---------- Per-frame logic ---------- */

function updateMusic(now) {
  if (!state.audio) return;

  const chordSource = state.left.value;
  const voicingSource = state.right.value;
  const chord = voicingSource
    ? buildChord(chordSource ?? { degree: 0, minor: false }, voicingSource, state.key)
    : null;

  const signature = chord ? `${chord.notes.join(',')}|${chord.quality}` : 'none';
  if (chord && signature !== state.musicSignature) {
    state.musicSignature = signature;
    applyChord(chord.notes);
    state.chordNotes = chord.notes;
  }

  const { ctx, master, filter } = state.audio;
  const t = ctx.currentTime;
  if (now - state.lastRightSeen > HAND_LOST_MS) state.volumeTarget = 0;
  master.gain.setTargetAtTime(state.volumeTarget * MAX_VOLUME, t, 0.06);
  filter.frequency.setTargetAtTime(state.filterHz, t, 0.08);

  if (now - state.lastAgentSync > 250) {
    state.lastAgentSync = now;
    syncStudioToState();
  }

  const romanIndex = chordSource ? chordSource.degree : 0;
  const numeral = ROMAN[romanIndex];
  setReadout('chord', chordSource?.minor ? numeral.toLowerCase() : numeral);
  setReadout('quality', chord ? chord.quality : '—');
  setReadout('volume', `${Math.round(state.volumeTarget * 100)}%`);
  setReadout('filter', `${Math.round(state.filterHz)} Hz`);
}

function drawFrame(result) {
  const { width, height } = canvas;
  ctx2d.save();
  ctx2d.clearRect(0, 0, width, height);
  ctx2d.translate(width, 0);
  ctx2d.scale(-1, 1);
  ctx2d.drawImage(video, 0, 0, width, height);
  ctx2d.restore();

  if (!result?.landmarks) return;

  result.landmarks.forEach((landmarks, index) => {
    const color = index === 0 ? '#7dd3fc' : '#a78bfa';
    const px = (p) => (1 - p.x) * width;
    const py = (p) => p.y * height;

    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 2;
    HAND_BONES.forEach((bone) => {
      ctx2d.beginPath();
      bone.forEach((pointIndex, i) => {
        const p = landmarks[pointIndex];
        if (i === 0) ctx2d.moveTo(px(p), py(p));
        else ctx2d.lineTo(px(p), py(p));
      });
      ctx2d.stroke();
    });

    ctx2d.fillStyle = color;
    landmarks.forEach((p) => {
      ctx2d.beginPath();
      ctx2d.arc(px(p), py(p), 4, 0, Math.PI * 2);
      ctx2d.fill();
    });
  });
}

function applyDuoHands(lefts, rights) {
  const p2Left = lefts[1];
  if (p2Left) {
    const fingers = countExtendedFingers(p2Left);
    const patternName = PATTERN_ORDER[clamp(fingers, 0, PATTERN_ORDER.length - 1)];
    if (drumPatternSelect.value !== patternName) {
      drumPatternSelect.value = patternName;
      state.seqCustom = null;
      buildSeqGrid();
      setStatus(`Duo · beat: ${DrumMachine.patterns[patternName].name}`);
    }
  }

  const p2Right = rights[1];
  if (p2Right && state.audio) {
    const drumGain = clamp(1 - p2Right[0].y, 0.15, 1);
    state.audio.drums.out.gain.setTargetAtTime(drumGain, state.audio.ctx.currentTime, 0.08);
    const swing = clamp(Math.abs((p2Right[9].x + p2Right[13].x) / 2 - p2Right[0].x) * 0.35, 0, 0.12);
    state.audio.drums.swing = swing;
  }
}

// Sample mode gestures: left hand picks slices / pinches to scratch,
// right hand rides volume + a filter dedicated to the sample deck.
let lastSlicePlayed = -1;
let lastScrubX = null;

function applySampleHands(leftLm, rightLm) {
  const deck = state.audio?.sampleDeck;
  if (!deck?.ready) return;

  if (rightLm) {
    const right = classifyRightHand(rightLm);
    deck.setVolume(Math.max(0.2, right.volume));
    deck.setFilterHz(clamp(20000 * Math.pow(0.5, 1 - right.filterHz / 6000), 200, 20000));
  }

  if (!leftLm) {
    lastSlicePlayed = -1;
    lastScrubX = null;
    return;
  }

  // Pinch (thumb tip near index tip) + horizontal movement = scratch/scrub.
  const pinchDist = dist(leftLm[4], leftLm[8]);
  const isPinching = pinchDist < 0.07;
  if (isPinching) {
    const x = leftLm[8].x;
    if (lastScrubX !== null) {
      const dx = lastScrubX - x; // mirrored view: moving right scrubs forward
      if (Math.abs(dx) > 0.004) {
        const pos = clamp(deck.getPosition() + dx * deck.duration, 0, deck.duration);
        deck.seek(pos);
      }
    }
    lastScrubX = x;
    setStatus('Scratch…');
    return;
  }
  lastScrubX = null;

  // Finger count picks a slice pad (1-8 mapped over available slices).
  const fingers = countExtendedFingers(leftLm);
  if (fingers >= 1 && fingers <= 8) {
    const maxSlice = Math.min(deck.slices.length, 8);
    const sliceIndex = Math.min(fingers - 1, maxSlice - 1);
    if (sliceIndex !== lastSlicePlayed) {
      lastSlicePlayed = sliceIndex;
      deck.playSlice(sliceIndex, { loop: true });
      setStatus(`Slice ${sliceIndex + 1}`);
    }
  } else {
    lastSlicePlayed = -1;
  }
}

function processFrame(now) {
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;

  const result = state.handLandmarker.detectForVideo(video, now);
  drawFrame(result);

  const lefts = [];
  const rights = [];
  result.handedness.forEach((categories, i) => {
    const label = categories[0]?.categoryName;
    if (label === 'Left') lefts.push(result.landmarks[i]);
    else if (label === 'Right') rights.push(result.landmarks[i]);
  });

  const leftLm = lefts[0] ?? null;
  const rightLm = rights[0] ?? null;

  if (leftLm) {
    stabilize(state.left, classifyLeftHand(leftLm));
  } else {
    state.left.candidateKey = null;
    state.left.count = 0;
  }

  if (rightLm) {
    const right = classifyRightHand(rightLm);
    stabilize(state.right, { voicing: right.voicing, octave: right.octave });
    state.volumeTarget = right.volume;
    state.filterHz = right.filterHz;
    state.lastRightSeen = now;
  } else {
    state.right.candidateKey = null;
    state.right.count = 0;
  }

  if (state.mode === 'duo') applyDuoHands(lefts, rights);
  if (state.mode === 'sample') applySampleHands(leftLm, rightLm);

  const duoTag = state.mode === 'duo' ? `  P2 ${lefts[1] || rights[1] ? '●' : '○'}` : '';
  setStatus(`Live · L ${leftLm ? '●' : '○'}  R ${rightLm ? '●' : '○'}${duoTag}`);
  updateMusic(now);
}

function loop(now) {
  state.rafId = requestAnimationFrame(loop);
  if (!state.handLandmarker || video.readyState < 2) return;
  try {
    processFrame(now);
  } catch (error) {
    console.error('Hand tracking frame failed', error);
    stopCamera();
    setStatus('Tracking error — restart the camera');
  }
}

/* ---------- Camera lifecycle ---------- */

function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera blocked — check browser settings and Windows privacy settings (Settings > Privacy > Camera).';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'Camera is in use by another app. Close other apps using the camera and try again.';
    case 'AbortError':
      return 'Camera start was aborted. Try again.';
    default:
      return `Could not start the camera: ${error?.name || 'unknown error'}. Check browser and Windows camera permissions.`;
  }
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = {
    runningMode: 'VIDEO',
    numHands: state.mode === 'duo' ? 4 : 2,
    minHandDetectionConfidence: 0.4,
    minTrackingConfidence: 0.4,
  };
  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      ...options,
    });
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      ...options,
    });
  }
}

async function startCamera() {
  if (state.running || state.starting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera needs HTTPS or localhost — open http://localhost:5173');
    return;
  }

  const session = ++state.session;
  state.starting = true;
  setStartButton('Cancel…', { disabled: true });
  setStatus('Requesting camera…');

  try {
    const perm = await navigator.permissions?.query({ name: 'camera' });
    if (perm?.state === 'denied') {
      setStatus('Camera permission denied — allow camera for localhost in browser settings');
      stopCamera();
      return;
    }
  } catch {
    /* Permissions API unsupported — continue */
  }

  if (!ensureAudio()) setStatus('Web Audio unavailable — tracking only');

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    }
    if (session !== state.session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    syncOverlayToVideo();

    setStatus('Loading hand tracking…');
    const landmarker = await createHandLandmarker().catch((loadError) => {
      throw Object.assign(loadError, { trackingLoad: true });
    });
    if (session !== state.session) {
      landmarker.close();
      return;
    }
    state.handLandmarker = landmarker;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    state.lastVideoTime = -1;
    state.left = { candidateKey: null, count: 0, value: null };
    state.right = { candidateKey: null, count: 0, value: null };
    state.volumeTarget = 0;
    state.musicSignature = '';

    state.running = true;
    state.starting = false;
    setStartButton('Stop camera', { running: true });
    cameraIdle.classList.add('is-hidden');
    setStatus('Live · L ○  R ○');
    if (state.audio?.ctx.state === 'suspended') state.audio.ctx.resume();

    syncStudioToState();
    if (state.agentFlags.drums) setAgentEnabled('drums', true);
    ['bass', 'arp', 'pad', 'strings'].forEach((name) => {
      if (state.agentFlags[name]) state.audio.agents[name]?.setEnabled(true);
    });

    state.rafId = requestAnimationFrame(loop);
  } catch (error) {
    if (session !== state.session) return;
    console.error('Camera start failed', error);
    stopCamera();
    setStatus(
      error?.trackingLoad
        ? 'Hand tracking failed to load — check your connection'
        : describeCameraError(error)
    );
  }
}

function stopCamera() {
  state.session += 1;
  state.starting = false;
  state.running = false;

  if (state.rafId !== null) cancelAnimationFrame(state.rafId);
  state.rafId = null;

  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  video.pause();
  video.srcObject = null;

  state.handLandmarker?.close();
  state.handLandmarker = null;

  if (state.audio) {
    state.audio.drums.setEnabled(false);
    Object.values(state.audio.agents).forEach((agent) => agent.setEnabled(false));
    setPlayhead(-1);
    // Beats mode keeps the drum machine alive without the camera.
    if (state.mode === 'beats' && state.agentFlags.drums) state.audio.drums.setEnabled(true);
  }

  silence();
  if (state.audio?.ctx.state === 'running' && state.mode !== 'beats') state.audio.ctx.suspend();
  state.volumeTarget = 0;
  state.musicSignature = '';

  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  cameraIdle.classList.remove('is-hidden');
  setStartButton('Start camera');
  setStatus(state.mode === 'beats' ? 'Beat maker — drums free' : 'Camera off');
}

function toggleCamera() {
  if (state.running || state.starting) stopCamera();
  else startCamera();
}

/* ---------- Step sequencer UI ---------- */

function buildSeqGrid() {
  const pattern = currentPattern();
  seqGrid.innerHTML = '';
  DrumMachine.rows.forEach((row) => {
    for (let step = 0; step < 16; step += 1) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      cell.dataset.row = row;
      cell.dataset.step = String(step);
      if (pattern[row]?.[step]) cell.classList.add('on');
      cell.addEventListener('click', () => {
        const custom = state.seqCustom || {
          kick: [...(currentPattern().kick || [])],
          snare: [...(currentPattern().snare || [])],
          hihat: [...(currentPattern().hihat || [])],
          clap: [...(currentPattern().clap || [])],
          openhat: [...(currentPattern().openhat || new Array(16).fill(0))],
          tom: [...(currentPattern().tom || new Array(16).fill(0))],
        };
        custom[row][step] = custom[row][step] ? 0 : 1;
        state.seqCustom = custom;
        cell.classList.toggle('on');
        if (state.audio) state.audio.drums.setCustom(custom);
      });
      seqGrid.appendChild(cell);
    }
  });
}

function setPlayhead(step) {
  if (state.playheadStep === step) return;
  const prev = state.playheadStep;
  state.playheadStep = step;
  const cells = seqGrid.children;
  const toggle = (s, on) => {
    for (let row = 0; row < DrumMachine.rows.length; row += 1) {
      const idx = row * 16 + s;
      if (cells[idx]) cells[idx].classList.toggle('playhead', on);
    }
  };
  if (prev >= 0) toggle(prev, false);
  if (step >= 0) toggle(step, true);
}

/* ---------- Drawer ---------- */

function openDrawer(tab) {
  state.activeTab = tab;
  drawerTitle.textContent = DRAWER_TITLES[tab] ?? tab;
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  railBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  document.querySelectorAll('.drawer-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

function closeDrawer() {
  state.activeTab = null;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  railBtns.forEach((btn) => btn.classList.remove('is-active'));
}

/* ---------- Modes ---------- */

function applyMode(mode) {
  if (!MODES.includes(mode)) return;
  const prevMode = state._prevMode;
  state.mode = mode;
  stage.dataset.mode = mode;
  vizStage.hidden = mode !== 'cymatics';
  modeChips.forEach((chip) => chip.classList.toggle('is-active', chip.dataset.mode === mode));
  updateVizRunState();
  syncOverlayToVideo();

  // Band mode: bring the whole backing band in.
  if (mode === 'band') {
    ['drums', 'bass', 'arp', 'pad', 'strings'].forEach((name) => setAgentEnabled(name, true));
  }

  // Leaving band: clear the band so modes stay predictable.
  if (prevMode === 'band' && mode !== 'band') {
    ['drums', 'bass', 'arp', 'pad', 'strings'].forEach((name) => setAgentEnabled(name, false));
  }

  // Beats mode: free the drum machine (works without camera) and focus the sequencer.
  if (mode === 'beats') {
    ensureAudio(); // mode click is a user gesture — audio allowed
    setAgentEnabled('drums', true);
    openDrawer('beats');
    if (!state.running) setStatus('Beat maker — drums free');
  } else if (prevMode === 'beats') {
    setAgentEnabled('drums', false);
  }

  state._prevMode = mode;

  // Sample mode: import a song, slice it, scratch with your hand.
  if (mode === 'sample') {
    ensureAudio(); // user gesture — audio allowed
    openDrawer('sample');
    if (!state.running) setStatus('Sample mode — import a song');
  } else if (prevMode === 'sample') {
    // leaving sample mode — nothing to tear down, deck stays ready
  }

  // Hand count changes between solo/duo — rebuild the landmarker live if needed.
  if (state.handLandmarker && state.running) {
    state.handLandmarker.close();
    state.handLandmarker = null;
    createHandLandmarker()
      .then((lm) => {
        if (state.running) {
          state.handLandmarker = lm;
          setStatus(`Live · ${mode === 'duo' ? 'Duo' : 'Solo'} · L ○  R ○`);
        } else {
          lm.close();
        }
      })
      .catch(() => setStatus('Mode switch failed — restart the camera'));
  }
}

/* ---------- Beat browser & sample deck UI ---------- */

function buildBeatBrowser() {
  beatBrowser.innerHTML = '';
  Object.entries(DrumMachine.patterns).forEach(([key, pattern]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'beat-card';
    card.dataset.pattern = key;
    if (key === drumPatternSelect.value) card.classList.add('is-active');

    const preview = document.createElement('div');
    preview.className = 'beat-preview';
    for (let step = 0; step < 16; step += 1) {
      const cell = document.createElement('i');
      if (pattern.kick?.[step]) cell.classList.add('on');
      else if (pattern.snare?.[step] || pattern.clap?.[step]) cell.classList.add('on', 'alt');
      else if (pattern.hihat?.[step]) cell.classList.add('on');
      preview.appendChild(cell);
    }

    const label = document.createElement('strong');
    label.textContent = pattern.name;
    const genre = document.createElement('small');
    genre.textContent = pattern.genre ?? 'Beat';

    card.appendChild(genre);
    card.appendChild(label);
    card.appendChild(preview);

    card.addEventListener('click', () => {
      drumPatternSelect.value = key;
      drumPatternSelect.dispatchEvent(new Event('change'));
      beatBrowser.querySelectorAll('.beat-card').forEach((c) => c.classList.toggle('is-active', c === card));
    });
    beatBrowser.appendChild(card);
  });
}

let waveformPeaks = null;
let waveformRaf = null;

function renderWaveform() {
  const deck = state.audio?.sampleDeck;
  if (!deck?.ready) return;
  const rect = waveformCanvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  waveformCanvas.width = Math.max(1, rect.width * dpr);
  waveformCanvas.height = Math.max(1, rect.height * dpr);
  const wctx = waveformCanvas.getContext('2d');
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = rect.width;
  const H = rect.height;

  // Compute peaks (cached per buffer).
  if (!waveformPeaks) {
    const data = deck.buffer.getChannelData(0);
    const bins = Math.min(600, Math.floor(W));
    const chunk = Math.floor(data.length / bins);
    waveformPeaks = new Float32Array(bins);
    for (let i = 0; i < bins; i += 1) {
      let peak = 0;
      for (let j = 0; j < chunk; j += 16) peak = Math.max(peak, Math.abs(data[i * chunk + j] || 0));
      waveformPeaks[i] = peak;
    }
  }

  wctx.fillStyle = '#050a16';
  wctx.fillRect(0, 0, W, H);

  // Loop region highlight.
  if (deck.loopRegion) {
    const x1 = (deck.loopRegion.start / deck.duration) * W;
    const x2 = (deck.loopRegion.end / deck.duration) * W;
    wctx.fillStyle = 'rgba(125, 211, 252, 0.14)';
    wctx.fillRect(x1, 0, x2 - x1, H);
    wctx.strokeStyle = 'rgba(125, 211, 252, 0.7)';
    wctx.lineWidth = 1;
    [x1, x2].forEach((x) => {
      wctx.beginPath();
      wctx.moveTo(x, 0);
      wctx.lineTo(x, H);
      wctx.stroke();
    });
  }

  // Slice markers.
  if (deck.slices.length > 1) {
    wctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
    deck.slices.forEach((slice) => {
      const x = (slice.start / deck.duration) * W;
      wctx.beginPath();
      wctx.moveTo(x, 0);
      wctx.lineTo(x, H);
      wctx.stroke();
    });
  }

  // Waveform.
  wctx.fillStyle = '#7dd3fc';
  const bins = waveformPeaks.length;
  const binW = W / bins;
  for (let i = 0; i < bins; i += 1) {
    const h = Math.max(1, waveformPeaks[i] * (H * 0.85));
    wctx.fillRect(i * binW, (H - h) / 2, Math.max(1, binW - 0.5), h);
  }
}

function startWaveformLoop() {
  if (waveformRaf) return;
  const tick = () => {
    const deck = state.audio?.sampleDeck;
    if (deck?.ready) {
      const pos = deck.getPosition();
      const rect = waveformCanvas.getBoundingClientRect();
      waveformCursor.style.left = `${(pos / deck.duration) * rect.width}px`;
      samplePlayBtn.textContent = deck.playing ? '⏸' : '▶';
      samplePlayBtn.classList.toggle('is-on', deck.playing);
    }
    waveformRaf = requestAnimationFrame(tick);
  };
  waveformRaf = requestAnimationFrame(tick);
}

function updateSampleUI() {
  const deck = state.audio?.sampleDeck;
  if (!deck?.ready) {
    sampleEmpty.hidden = false;
    sampleDeckUI.hidden = true;
    return;
  }
  sampleEmpty.hidden = true;
  sampleDeckUI.hidden = false;
  sampleBpm.textContent = deck.bpm ? `${deck.bpm} BPM` : '— BPM';
  sliceCountEl.textContent = `${deck.slices.length} slices`;
  waveformPeaks = null; // recompute peaks for the new buffer
  renderWaveform();

  // Slice pads.
  slicePadsEl.innerHTML = '';
  deck.slices.slice(0, 16).forEach((slice, index) => {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'slice-pad';
    pad.textContent = String(index + 1);
    pad.addEventListener('click', () => {
      deck.playSlice(index, { loop: true });
      pad.classList.add('is-playing');
      setTimeout(() => pad.classList.remove('is-playing'), 220);
    });
    slicePadsEl.appendChild(pad);
  });
}

function initSampleUI() {
  sampleImport.addEventListener('click', () => sampleFile.click());

  sampleFile.addEventListener('change', async () => {
    const file = sampleFile.files?.[0];
    if (!file) return;
    if (!state.audio && !ensureAudio()) {
      setStatus('Audio unavailable — cannot decode songs');
      return;
    }
    setStatus('Decoding song…');
    try {
      const info = await state.audio.sampleDeck.loadFile(file);
      sampleName.textContent = file.name;
      updateSampleUI();
      startWaveformLoop();
      setStatus(`Loaded: ${file.name} · ${info.bpm} BPM · ${info.slices} slices`);
    } catch (err) {
      console.error('Sample load failed', err);
      setStatus('Could not decode that file — try MP3/WAV/OGG');
    }
    sampleFile.value = '';
  });

  // Waveform: click = seek, drag = set loop region.
  let dragStartX = null;
  const xToTime = (clientX) => {
    const rect = waveformCanvas.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * (state.audio?.sampleDeck?.duration || 0);
  };
  waveformCanvas.addEventListener('pointerdown', (event) => {
    dragStartX = event.clientX;
    waveformCanvas.setPointerCapture(event.pointerId);
  });
  waveformCanvas.addEventListener('pointerup', (event) => {
    const deck = state.audio?.sampleDeck;
    if (!deck?.ready || dragStartX === null) return;
    const t1 = xToTime(dragStartX);
    const t2 = xToTime(event.clientX);
    if (Math.abs(t2 - t1) < 0.25) {
      deck.seek(t2); // tap = seek
    } else {
      deck.setLoopRegion(Math.min(t1, t2), Math.max(t1, t2)); // drag = loop
    }
    renderWaveform();
    dragStartX = null;
  });

  samplePlayBtn.addEventListener('click', () => state.audio?.sampleDeck.toggle());
  sampleStopBtn.addEventListener('click', () => {
    state.audio?.sampleDeck.stop();
    renderWaveform();
  });
  sampleReverseBtn.addEventListener('click', () => {
    const deck = state.audio?.sampleDeck;
    if (!deck) return;
    deck.setReverse(!deck.isReversed);
    sampleReverseBtn.classList.toggle('is-on', deck.isReversed);
    setStatus(deck.isReversed ? 'Sample reversed' : 'Sample forward');
  });
  sampleLoopClearBtn.addEventListener('click', () => {
    state.audio?.sampleDeck.setLoopRegion(null);
    renderWaveform();
    setStatus('Loop cleared');
  });
  sampleMatchBpmBtn.addEventListener('click', () => {
    const deck = state.audio?.sampleDeck;
    if (!deck?.bpm) return;
    state.bpm = clamp(Math.round(deck.bpm), 50, 200);
    bpmInput.value = String(state.bpm);
    syncStudioToState();
    setStatus(`Drums matched to song: ${state.bpm} BPM`);
  });

  rateBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.audio?.sampleDeck.setRate(Number(btn.dataset.rate));
      rateBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  // Re-render waveform on resize.
  window.addEventListener('resize', () => {
    waveformPeaks = null;
    if (state.audio?.sampleDeck?.ready) renderWaveform();
  });
}

/* ---------- Agent brain: natural-language direction ---------- */

function applyBrainActions(actions) {
  if (!actions?.length) return;
  actions.forEach((a) => {
    switch (a.type) {
      case 'mode':
        applyMode(a.value);
        break;
      case 'pattern':
        if (DrumMachine.patterns[a.value]) {
          drumPatternSelect.value = a.value;
          drumPatternSelect.dispatchEvent(new Event('change'));
        }
        break;
      case 'preset':
        applyPreset(a.value);
        if (presetSelect.querySelector(`option[value="${a.value}"]`)) presetSelect.value = a.value;
        break;
      case 'bpmSet':
        state.bpm = clamp(Number(a.value) || state.bpm, 50, 200);
        bpmInput.value = String(state.bpm);
        syncStudioToState();
        break;
      case 'bpmDelta':
        state.bpm = clamp(state.bpm + (Number(a.value) || 0), 50, 200);
        bpmInput.value = String(state.bpm);
        syncStudioToState();
        break;
      case 'mood':
        if (state.left.value) state.left.value.minor = a.value === 'minor';
        state.musicSignature = '';
        break;
      case 'agent':
        setAgentEnabled(a.value, !!a.on);
        break;
      case 'intensity':
        state.agentIntensity = a.value;
        if (state.audio) Object.values(state.audio.agents).forEach((ag) => ag.setIntensity(a.value));
        break;
      case 'reverb':
        state.reverbWet = clamp(Number(a.value) || 0, 0, 1);
        reverbSlider.value = String(Math.round(state.reverbWet * 100));
        reverbValue.textContent = `${reverbSlider.value}%`;
        state.audio?.reverb.setWet(state.reverbWet);
        break;
      case 'groove':
        if (state.audio) state.audio.drums.swing = clamp(Number(a.value) || 0, 0, 0.2);
        break;
      case 'tuning':
        state.tuning = a.value;
        tuningSelect.value = a.value;
        state.musicSignature = '';
        break;
      case 'fills':
        if (state.audio) state.audio.drums.setFills(!!a.value);
        fillsToggle.checked = !!a.value;
        break;
      default:
        break;
    }
  });
  setStatus('Band directed');
}

/* ---------- Controls wiring ---------- */

function initControls() {
  KEY_OPTIONS.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    keySelect.appendChild(option);
  });
  keySelect.value = state.key;

  keySelect.addEventListener('change', (event) => {
    state.key = event.target.value;
    state.musicSignature = '';
    setStatus(`Key: ${state.key}`);
  });

  // Populate character presets
  Object.entries(SYNTH_PRESETS).forEach(([key, preset]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  });
  presetSelect.value = state.preset;

  presetSelect.addEventListener('change', (event) => {
    applyPreset(event.target.value);
    setStatus(`Character: ${SYNTH_PRESETS[event.target.value]?.name ?? event.target.value}`);
  });

  bpmInput.addEventListener('change', () => {
    state.bpm = clamp(Number(bpmInput.value) || 100, 50, 200);
    bpmInput.value = String(state.bpm);
    syncStudioToState();
    setStatus(`BPM: ${state.bpm}`);
  });

  drumPatternSelect.addEventListener('change', () => {
    state.seqCustom = null;
    buildSeqGrid();
    if (state.audio) {
      state.audio.drums.setPattern(drumPatternSelect.value);
      if (state.agentFlags.drums) setAgentEnabled('drums', true);
    }
    setStatus(`Beat: ${DrumMachine.patterns[drumPatternSelect.value].name}`);
  });

  grooveSelect.addEventListener('change', (event) => {
    if (state.audio) state.audio.drums.swing = Number(event.target.value) || 0;
    setStatus(`Groove: ${event.target.selectedOptions[0]?.textContent ?? 'Straight'}`);
  });

  fillsToggle.addEventListener('change', (event) => {
    if (state.audio) state.audio.drums.setFills(event.target.checked);
  });

  // Tuning (TuneJS-style tables) — retunes every chord voice + agent live.
  tuningSelect.addEventListener('change', (event) => {
    state.tuning = event.target.value;
    state.musicSignature = ''; // force chords to rebuild with the new tuning
    setStatus(`Tuning: ${TUNINGS[state.tuning]?.name ?? state.tuning}`);
  });

  // FX chain toggles.
  document.querySelectorAll('.fx-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.fx;
      const on = !chip.classList.contains('is-active');
      chip.classList.toggle('is-active', on);
      const wet = on ? 0.35 : 0;
      state.audio?.fx?.[name]?.setWet(wet);
      setStatus(`${chip.textContent}: ${on ? 'on' : 'off'}`);
    });
  });

  // Reverb wet/dry on the whole mix.
  reverbSlider.addEventListener('input', () => {
    const wet = Number(reverbSlider.value) / 100;
    state.reverbWet = wet;
    reverbValue.textContent = `${reverbSlider.value}%`;
    state.audio?.reverb.setWet(wet);
  });

  // Agent brain.
  const settings = loadBrainSettings();
  brainEndpoint.value = settings.endpoint || '';
  brainModel.value = settings.model || '';
  brainKey.value = settings.key || '';
  brainStatus.textContent = hasLLM(settings)
    ? 'LLM connected — natural language will be interpreted by the model.'
    : 'Local command parser — no API key needed.';

  brainApplyBtn.addEventListener('click', async () => {
    const instruction = brainInput.value.trim();
    if (!instruction) return;
    brainStatus.textContent = 'Thinking…';
    const s = loadBrainSettings();
    let actions = null;
    if (hasLLM(s)) {
      actions = await askLLM(s, instruction);
    }
    if (!actions) actions = parseInstruction(instruction);
    applyBrainActions(actions);
    brainStatus.textContent = hasLLM(s)
      ? `Applied: ${actions.length} action(s)${actions === parseInstruction(instruction) ? ' (local fallback)' : ''}`
      : `Applied ${actions.length} action(s) via local parser`;
  });

  brainSaveBtn.addEventListener('click', () => {
    saveBrainSettings({
      endpoint: brainEndpoint.value.trim(),
      model: brainModel.value.trim(),
      key: brainKey.value.trim(),
    });
    const s = loadBrainSettings();
    brainStatus.textContent = hasLLM(s)
      ? 'Settings saved — LLM connected.'
      : 'Settings saved — using local parser (no endpoint/key).';
  });

  // ---- Theme + accent color ----
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem('turtleTunez.theme', theme);
    themeChips.forEach((c) => c.classList.toggle('is-active', c.dataset.theme === theme));
  }

  function applyAccent(accent) {
    document.body.dataset.accent = accent;
    localStorage.setItem('turtleTunez.accent', accent);
    accentSwatches.forEach((s) => s.classList.toggle('is-active', s.dataset.accent === accent));
  }

  themeChips.forEach((c) => {
    c.addEventListener('click', () => applyTheme(c.dataset.theme));
  });
  accentSwatches.forEach((s) => {
    s.addEventListener('click', () => applyAccent(s.dataset.accent));
  });

  // Restore persisted theme/accent.
  applyTheme(localStorage.getItem('turtleTunez.theme') || 'dark');
  applyAccent(localStorage.getItem('turtleTunez.accent') || 'cyan');

  // ---- Flashlight (torch constraint + screen wash fallback) ----
  flashlightBtn.addEventListener('click', async () => {
    const on = !flashlightBtn.classList.contains('is-on');
    flashlightBtn.classList.toggle('is-on', on);
    document.body.classList.toggle('flashlight-on', on);
    flashlightBtn.textContent = on ? '🔦 Flashlight on' : '🔦 Flashlight (see in the dark)';

    // Try the real torch if the camera is running.
    if (on && state.running && state.stream) {
      const track = state.stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.();
      if (caps?.torch) {
        try {
          await track.applyConstraints({ advanced: [{ torch: true }] });
        } catch {
          /* fall back to screen wash (already applied via class) */
        }
      }
    } else if (!on && state.running && state.stream) {
      const track = state.stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({ advanced: [{ torch: false }] });
      } catch {
        /* noop */
      }
    }
  });

  // ---- Drawer placement: right rail vs bottom tab bar ----
  function applyLayout(layout) {
    document.body.classList.toggle('layout-bottom', layout === 'bottom');
    localStorage.setItem('turtleTunez.layout', layout);
    layoutChips.forEach((c) => c.classList.toggle('is-active', c.dataset.layout === layout));
  }
  layoutChips.forEach((c) => {
    c.addEventListener('click', () => applyLayout(c.dataset.layout));
  });
  applyLayout(localStorage.getItem('turtleTunez.layout') || 'right');

  // ---- Provider presets for the agent brain ----
  const PROVIDERS = {
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    grok: { endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-2-latest' },
    anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-20241022' },
    ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2' },
    custom: { endpoint: '', model: '' },
  };
  providerChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const p = PROVIDERS[chip.dataset.provider];
      if (p) {
        brainEndpoint.value = p.endpoint;
        brainModel.value = p.model;
        providerChips.forEach((c) => c.classList.toggle('is-active', c === chip));
        setStatus(`Provider: ${chip.textContent}`);
      }
    });
  });

  // ---- Test connection button ----
  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'apply-button';
  testBtn.style.marginTop = '8px';
  testBtn.textContent = 'Test connection';
  brainSaveBtn.insertAdjacentElement('afterend', testBtn);
  testBtn.addEventListener('click', async () => {
    const s = {
      endpoint: brainEndpoint.value.trim(),
      model: brainModel.value.trim(),
      key: brainKey.value.trim(),
    };
    if (!s.endpoint) {
      brainStatus.textContent = 'Enter an endpoint first.';
      return;
    }
    brainStatus.textContent = 'Testing…';
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: s.key ? `Bearer ${s.key}` : '',
        },
        body: JSON.stringify({
          model: s.model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 8,
        }),
      });
      brainStatus.textContent = res.ok ? 'Connection OK ✓' : `Connection failed (${res.status})`;
    } catch (e) {
      brainStatus.textContent = `Connection error: ${e?.message ?? e}`;
    }
  });
  euclidApply.addEventListener('click', () => {
    const pattern = euclidDrumPattern({
      kickPulses: Number(euclidKick.value) || 0,
      snarePulses: Number(euclidSnare.value) || 0,
      hatPulses: Number(euclidHat.value) || 0,
      steps: 16,
      rotation: Number(euclidRotate.value) || 0,
    });
    state.seqCustom = {
      kick: pattern.kick,
      snare: pattern.snare,
      hihat: pattern.hihat,
      clap: pattern.clap,
    };
    buildSeqGrid();
    if (state.audio) {
      state.audio.drums.setCustom(state.seqCustom);
      if (state.agentFlags.drums) setAgentEnabled('drums', true);
    }
    setStatus('Euclid pattern applied');
  });

  modeChips.forEach((chip) => {
    chip.addEventListener('click', () => applyMode(chip.dataset.mode));
  });

  railBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.activeTab === btn.dataset.tab) closeDrawer();
      else openDrawer(btn.dataset.tab);
    });
  });

  drawerClose.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeTab) closeDrawer();
  });

  agentChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      setAgentEnabled(chip.dataset.agent, !state.agentFlags[chip.dataset.agent]);
    });
  });

  intensityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = Number(btn.dataset.intensity) || 2;
      intensityBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      if (state.audio) {
        Object.values(state.audio.agents).forEach((agent) => agent.setIntensity(level));
      }
      state.agentIntensity = level;
      setStatus(`Band intensity: ${btn.textContent}`);
    });
  });

  // QWERTY performance keys (AudioKeys-style):
  // 1-7 = chord degree, space = drums on/off, Z X C V = drum one-shots.
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (event.key >= '1' && event.key <= '7') {
      const degree = Number(event.key) - 1;
      const minor = state.left.value?.minor ?? false;
      state.left.value = { degree, minor };
      state.musicSignature = '';
      setStatus(`Chord: ${minor ? 'minor ' : ''}${ROMAN[degree]}`);
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      setAgentEnabled('drums', !state.agentFlags.drums);
      setStatus(state.agentFlags.drums ? 'Drums on' : 'Drums off');
      return;
    }

    const drumKey = { KeyZ: 'kick', KeyX: 'snare', KeyC: 'hihat', KeyV: 'clap' }[event.code];
    if (drumKey && state.audio) {
      state.audio.drums.trigger(drumKey);
    }
  });

  buildSeqGrid();
  buildBeatBrowser();
  initSampleUI();

  startButton.addEventListener('click', toggleCamera);

  recordButton.addEventListener('click', async () => {
    // The click itself is a user gesture, so the audio graph may start here.
    if (!state.audio && !ensureAudio()) {
      setStatus('Recording unavailable — Web Audio blocked');
      return;
    }
    const rec = state.audio.recorder;
    if (rec.recording) {
      const result = await rec.stop();
      recordButton.classList.remove('is-recording');
      recordButton.textContent = '● Rec';
      if (result?.blob?.size) {
        const url = rec.toDownloadUrl(result.blob);
        const ext = result.type.includes('mp4') ? 'm4a' : 'webm';
        const link = document.createElement('a');
        link.href = url;
        link.download = `turtletunez-jam-${Date.now()}.${ext}`;
        link.click();
        setStatus('Recording saved to your downloads');
      } else {
        setStatus('Recording stopped — nothing captured');
      }
    } else if (rec.start()) {
      recordButton.classList.add('is-recording');
      recordButton.textContent = '■ Stop';
      setStatus('Recording your mix…');
    } else {
      setStatus('Recording not supported in this browser');
    }
  });

  video.addEventListener('loadedmetadata', syncOverlayToVideo);
  window.addEventListener('resize', syncOverlayToVideo);
  if (window.ResizeObserver) {
    new ResizeObserver(syncOverlayToVideo).observe(cameraWrap);
  }

  window.addEventListener('pagehide', () => {
    stopCamera();
    state.audio?.ctx.close();
    vizInstance?.dispose();
  });
}

initControls();
ensureVisualizer(null); // idle cymatics only runs in Cymatics mode
cameraIdle.classList.remove('is-hidden'); // camera is off — show the idle prompt

// Hash routing: #solo / #duo / #band / #beats / #cymatics
function applyModeFromHash() {
  const hashMode = window.location.hash.replace('#', '');
  applyMode(MODES.includes(hashMode) ? hashMode : 'solo');
}
window.addEventListener('hashchange', applyModeFromHash);
applyModeFromHash();
setStatus('Ready — pick a mode, then start the camera');
