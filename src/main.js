import './styles.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DrumMachine } from './drum-machine.js';
import { BassAgent, ArpAgent, PadAgent } from './band-agents.js';
import { CymaticsVisualizer } from './visualizer.js';

const MEDIAPIPE_VERSION = '0.10.22';
// Use local wasm files (served from public/wasm) to avoid CDN issues
const WASM_BASE = '/wasm';
const MODEL_URL = '/hand_landmarker.task';

const VOICE_COUNT = 5;
const CONFIRM_FRAMES = 4; // consecutive frames a gesture must hold before it changes the music
const HAND_LOST_MS = 500; // right-hand loss fades volume out after this long
const MAX_VOLUME = 0.5;

const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const PITCH_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_SEMITONES = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const KEY_OPTIONS = Object.keys(KEY_SEMITONES);
const PATTERN_ORDER = ['trap', 'house', 'hiphop', 'lofi', 'techno'];

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
const keySelect = $('keySelect');
const waveformSelect = $('waveformSelect');
const statusBadge = $('statusBadge');
const drumPatternSelect = $('drumPatternSelect');
const bpmInput = $('bpmInput');
const seqGrid = $('seqGrid');
const vizCanvas = $('vizCanvas');
const duoHint = $('duoHint');
const modeChips = Array.from(document.querySelectorAll('.mode-chip'));
const agentChips = Array.from(document.querySelectorAll('.agent-chip'));

const readouts = {
  chord: $('chordValue'),
  quality: $('qualityValue'),
  volume: $('volumeValue'),
  filter: $('filterValue'),
};

// Visualizer runs even before audio starts (idle cymatics), then rebinds to the real analyser.
let vizInstance = null;
function ensureVisualizer(analyser) {
  vizInstance?.dispose();
  vizInstance = new CymaticsVisualizer(vizCanvas, analyser);
  vizInstance.start();
}

const state = {
  session: 0, // bumped on every start/stop so stale async work can detect it is outdated
  running: false,
  starting: false,
  stream: null,
  handLandmarker: null,
  rafId: null,
  lastVideoTime: -1,
  key: 'C',
  waveform: waveformSelect.value,
  audio: null, // { ctx, master, filter, voices, analyser, drums, agents, viz }
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
  agentFlags: { drums: false, bass: false, arp: false, pad: false },
  seqCustom: null, // { kick:[16], snare:[16], hihat:[16], clap:[16] }
  chordNotes: [48, 52, 55],
  playheadStep: -1,
  lastAgentSync: 0,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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

function setStartButton(label, { disabled = false } = {}) {
  startButton.textContent = label;
  startButton.disabled = disabled;
  startButton.setAttribute('aria-pressed', String(state.running));
}

/* ---------- Gesture recognition ---------- */

function isFingerExtended(lm, tipIndex) {
  // Compare distances from the wrist, so detection works for any hand rotation.
  const wrist = lm[0];
  return dist(lm[tipIndex], wrist) > dist(lm[tipIndex - 2], wrist) * 1.1;
}

function isThumbExtended(lm) {
  return dist(lm[4], lm[17]) > dist(lm[2], lm[17]) * 1.2;
}

function countExtendedFingers(lm) {
  return [8, 12, 16, 20].filter((tip) => isFingerExtended(lm, tip)).length;
}

// Left hand: fingers pick the scale degree, the hand's tilt picks major or minor.
function classifyLeftHand(lm) {
  const index = isFingerExtended(lm, 8);
  const middle = isFingerExtended(lm, 12);
  const ring = isFingerExtended(lm, 16);
  const pinky = isFingerExtended(lm, 20);
  const thumb = isThumbExtended(lm);
  const count = countExtendedFingers(lm);

  let degree;
  if (index && pinky && !middle && !ring) degree = thumb ? 6 : 5; // VII / VI
  else if (count === 0 && thumb) degree = 4; // V: thumb alone
  else degree = count <= 1 ? 0 : count - 1; // I–IV

  const tilt = lm[9].x - lm[0].x;
  return { degree, minor: tilt <= 0.04 };
}

// Right hand: fingers pick voicing, thumb shifts octave, height sets volume, tilt sets filter.
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

// Only accept a gesture after it holds for CONFIRM_FRAMES in a row, so the music doesn't flicker.
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

// Builds a diatonic chord from the key, scale degree, and mode; voicing and octave shape the notes.
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
  else if (voicing === 2) notes = [third, fifth, root + 12]; // first inversion
  else if (voicing === 3) notes = [root, third, fifth, seventh];
  else notes = [root, third, fifth, seventh, root + 12];

  const thirdInterval = (third - root) % 12;
  const fifthInterval = (fifth - root) % 12;
  let quality = 'Major';
  if (thirdInterval === 3) quality = fifthInterval === 6 ? 'Diminished' : 'Minor';

  const rootName = PITCH_NAMES[(root % 12 + 12) % 12];
  return { notes, quality: `${rootName} ${quality}` };
}

/* ---------- Audio (created only after a user gesture) ---------- */

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

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(analyser);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = state.filterHz;
  filter.Q.value = 0.7;
  filter.connect(master);

  // A fixed pool of oscillators is retuned rather than recreated, so there are no clicks or node churn.
  const voices = Array.from({ length: VOICE_COUNT }, () => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = state.waveform;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    return { osc, gain };
  });

  const drums = new DrumMachine(ctx, master);
  drums.setBpm(state.bpm);
  drums.onStep((step) => setPlayhead(step));

  const agents = {
    bass: new BassAgent(ctx, master),
    arp: new ArpAgent(ctx, master),
    pad: new PadAgent(ctx, master),
  };

  ensureVisualizer(analyser);

  state.audio = { ctx, master, filter, voices, analyser, drums, agents };
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
      voice.osc.frequency.setTargetAtTime(midiToFrequency(notes[i]), t, 0.04);
      voice.gain.gain.setTargetAtTime(perVoice, t, 0.05);
    } else {
      voice.gain.gain.setTargetAtTime(0, t, 0.05);
    }
  });
}

function applyWaveform(type) {
  if (!state.audio) return;
  state.audio.voices.forEach((voice) => {
    voice.osc.type = type;
  });
}

/* ---------- Studio layers (drums + agents) ---------- */

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
  if (!state.audio) return;
  if (name === 'drums') {
    state.audio.drums.setEnabled(on && state.running);
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
  // The preview is mirrored like a selfie camera, so the landmarks are mirrored too.
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
  // Player 2's left hand: finger count selects the beat pattern.
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

  // Player 2's right hand: height scales the drum bus, tilt adds swing.
  const p2Right = rights[1];
  if (p2Right && state.audio) {
    const drumGain = clamp(1 - p2Right[0].y, 0.15, 1);
    state.audio.drums.out.gain.setTargetAtTime(drumGain, state.audio.ctx.currentTime, 0.08);
    const swing = clamp(Math.abs((p2Right[9].x + p2Right[13].x) / 2 - p2Right[0].x) * 0.35, 0, 0.12);
    state.audio.drums.swing = swing;
  }
}

function processFrame(now) {
  // Only run detection when the camera has produced a new frame.
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

  // A lost hand keeps its last confirmed gesture (left) or fades out (right); re-acquiring must re-confirm.
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

  setStatus(`Live · L ${leftLm ? '●' : '○'}  R ${rightLm ? '●' : '○'}${state.mode === 'duo' ? `  P2 ${lefts[1] || rights[1] ? '●' : '○'}` : ''}`);
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
      return 'Camera blocked — check browser settings and Windows privacy settings (Settings > Privacy > Camera). Make sure your browser is allowed to access the camera.';
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
    // Some browsers lack WebGL2 for the GPU delegate; fall back to CPU.
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
  setStartButton('Cancel', { disabled: false });
  setStatus('Requesting camera…');

  // Check camera permission status first (if supported)
  try {
    const perm = await navigator.permissions?.query({ name: 'camera' });
    if (perm?.state === 'denied') {
      setStatus('Camera permission denied — open browser settings (chrome://settings/content/camera) and allow camera access for localhost');
      stopCamera();
      return;
    }
  } catch {
    // Permissions API not supported — proceed with getUserMedia
  }

  // Created inside the click handler, so browsers allow the audio context to start.
  if (!ensureAudio()) setStatus('Web Audio unavailable — tracking only');

  try {
    // Try with facingMode first, fall back to simpler constraints if blocked
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (firstErr) {
      // Some browsers/privacy settings block facingMode constraint — try without it
      console.warn('First getUserMedia attempt failed, retrying with simpler constraints', firstErr);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
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

    setStatus('Loading hand tracking…');
    const landmarker = await createHandLandmarker().catch((loadError) => {
      throw Object.assign(loadError, { trackingLoad: true });
    });
    if (session !== state.session) {
      landmarker.close();
      return;
    }
    state.handLandmarker = landmarker;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    state.lastVideoTime = -1;
    state.left = { candidateKey: null, count: 0, value: null };
    state.right = { candidateKey: null, count: 0, value: null };
    state.volumeTarget = 0;
    state.musicSignature = '';

    state.running = true;
    state.starting = false;
    setStartButton('Stop camera');
    setStatus('Live · L ○  R ○');
    if (state.audio?.ctx.state === 'suspended') state.audio.ctx.resume();

    syncStudioToState();
    if (state.agentFlags.drums) state.audio.drums.setEnabled(true);
    Object.entries(state.agentFlags).forEach(([name, on]) => {
      if (on && name !== 'drums') state.audio.agents[name]?.setEnabled(true);
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
  state.session += 1; // invalidates any start still in flight
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
  }

  silence();
  if (state.audio?.ctx.state === 'running') state.audio.ctx.suspend();
  state.volumeTarget = 0;
  state.musicSignature = '';

  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  setStartButton('Start camera');
  setStatus('Camera off');
}

function toggleCamera() {
  if (state.running || state.starting) stopCamera();
  else startCamera();
}

/* ---------- Step sequencer UI ---------- */

function buildSeqGrid() {
  const pattern = currentPattern();
  seqGrid.innerHTML = '';
  const cells = [];
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
        };
        custom[row][step] = custom[row][step] ? 0 : 1;
        state.seqCustom = custom;
        cell.classList.toggle('on');
        if (state.audio) state.audio.drums.setCustom(custom);
      });
      seqGrid.appendChild(cell);
      cells.push(cell);
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

/* ---------- Controls ---------- */

function setMode(mode) {
  state.mode = mode;
  modeChips.forEach((chip) => chip.classList.toggle('is-active', chip.dataset.mode === mode));
  duoHint.hidden = mode !== 'duo';
  // Re-create the landmarker with the new hand count on next start.
  if (state.handLandmarker) {
    state.handLandmarker.close();
    state.handLandmarker = null;
  }
  if (state.running) {
    setStatus('Restart the camera to apply the new mode');
  }
}

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

  waveformSelect.addEventListener('change', (event) => {
    state.waveform = event.target.value;
    applyWaveform(state.waveform);
    setStatus(`Waveform: ${state.waveform}`);
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
      if (state.agentFlags.drums) state.audio.drums.setEnabled(true);
    }
    setStatus(`Beat: ${DrumMachine.patterns[drumPatternSelect.value].name}`);
  });

  modeChips.forEach((chip) => {
    chip.addEventListener('click', () => setMode(chip.dataset.mode));
  });

  agentChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.agent;
      const on = !state.agentFlags[name];
      chip.classList.toggle('is-active', on);
      setAgentEnabled(name, on);
    });
  });

  buildSeqGrid();

  startButton.addEventListener('click', toggleCamera);
  window.addEventListener('pagehide', () => {
    stopCamera();
    state.audio?.ctx.close();
    vizInstance?.dispose();
  });
}

initControls();
ensureVisualizer(null); // idle cymatics before the camera starts
setStatus('Ready — start the camera to play');
