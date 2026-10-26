import './styles.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const MEDIAPIPE_VERSION = '0.10.22';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const VOICE_COUNT = 5;
const CONFIRM_FRAMES = 4; // consecutive frames a gesture must hold before it changes the music
const HAND_LOST_MS = 500; // right-hand loss fades volume out after this long
const MAX_VOLUME = 0.35;

const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const PITCH_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_SEMITONES = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const KEY_OPTIONS = Object.keys(KEY_SEMITONES);

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
const readouts = {
  chord: $('chordValue'),
  quality: $('qualityValue'),
  volume: $('volumeValue'),
  filter: $('filterValue'),
};

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
  audio: null, // { ctx, master, filter, voices } created on first user gesture
  left: { candidateKey: null, count: 0, value: null },
  right: { candidateKey: null, count: 0, value: null },
  lastRightSeen: 0,
  volumeTarget: 0,
  filterHz: 1200,
  musicSignature: '',
  badgeText: '',
  readoutText: {},
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
    volume: clamp((0.6 - wrist.y) / 0.5, 0, 1),
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
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

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

  state.audio = { ctx, master, filter, voices };
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
  }

  const { ctx, master, filter } = state.audio;
  const t = ctx.currentTime;
  if (now - state.lastRightSeen > HAND_LOST_MS) state.volumeTarget = 0;
  master.gain.setTargetAtTime(state.volumeTarget * MAX_VOLUME, t, 0.06);
  filter.frequency.setTargetAtTime(state.filterHz, t, 0.08);

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

function processFrame(now) {
  // Only run detection when the camera has produced a new frame.
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;

  const result = state.handLandmarker.detectForVideo(video, now);
  drawFrame(result);

  let leftLm = null;
  let rightLm = null;
  result.handedness.forEach((categories, i) => {
    const label = categories[0]?.categoryName;
    if (label === 'Left') leftLm = result.landmarks[i];
    else if (label === 'Right') rightLm = result.landmarks[i];
  });

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

  setStatus(`Live · L ${leftLm ? '●' : '○'}  R ${rightLm ? '●' : '○'}`);
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
      return 'Camera blocked — allow camera access in your browser and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'Camera is in use by another app.';
    default:
      return 'Could not start the camera.';
  }
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = {
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
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
    setStatus('Camera needs HTTPS or localhost');
    return;
  }

  const session = ++state.session;
  state.starting = true;
  setStartButton('Cancel', { disabled: false });
  setStatus('Requesting camera…');

  // Created inside the click handler, so browsers allow the audio context to start.
  if (!ensureAudio()) setStatus('Web Audio unavailable — tracking only');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
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

/* ---------- Controls ---------- */

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

  startButton.addEventListener('click', toggleCamera);
  window.addEventListener('pagehide', () => {
    stopCamera();
    state.audio?.ctx.close();
  });
}

initControls();
setStatus('Ready — start the camera to play');
