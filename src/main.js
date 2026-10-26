import './styles.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DrumMachine } from './drum-machine.js';
import { BassAgent, ArpAgent, PadAgent } from './band-agents.js';
import { CymaticsVisualizer } from './visualizer.js';

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
const MODES = ['solo', 'duo', 'band', 'beats', 'cymatics'];
const DRAWER_TITLES = { sound: 'Sound', beats: 'Beats', agents: 'Agents', guide: 'Guide' };

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
  waveform: waveformSelect.value,
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
  agentFlags: { drums: false, bass: false, arp: false, pad: false },
  seqCustom: null,
  chordNotes: [48, 52, 55],
  playheadStep: -1,
  lastAgentSync: 0,
  activeTab: null,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
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
  master.connect(analyser);

  // Studio bus — drums and agents live here so they stay audible
  // even when the gesture volume is down (e.g. Beats mode, no camera).
  const studioBus = ctx.createGain();
  studioBus.gain.value = 0.9;
  studioBus.connect(analyser);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = state.filterHz;
  filter.Q.value = 0.7;
  filter.connect(master);

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

  const drums = new DrumMachine(ctx, studioBus);
  drums.setBpm(state.bpm);
  drums.onStep((step) => setPlayhead(step));

  const agents = {
    bass: new BassAgent(ctx, studioBus),
    arp: new ArpAgent(ctx, studioBus),
    pad: new PadAgent(ctx, studioBus),
  };

  state.audio = { ctx, master, studioBus, filter, voices, analyser, drums, agents };
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
    ['bass', 'arp', 'pad'].forEach((name) => {
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
    ['drums', 'bass', 'arp', 'pad'].forEach((name) => setAgentEnabled(name, true));
  }

  // Leaving band: clear the band so modes stay predictable.
  if (prevMode === 'band' && mode !== 'band') {
    ['drums', 'bass', 'arp', 'pad'].forEach((name) => setAgentEnabled(name, false));
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

  // Cymatics mode: visualizer front and center, camera docks as PiP.
  if (mode === 'cymatics' && !state.running) {
    setStatus('Cymatics mode — start the camera to add gestures');
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
      if (state.agentFlags.drums) setAgentEnabled('drums', true);
    }
    setStatus(`Beat: ${DrumMachine.patterns[drumPatternSelect.value].name}`);
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

  buildSeqGrid();

  startButton.addEventListener('click', toggleCamera);

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
