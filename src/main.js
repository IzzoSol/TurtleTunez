import './styles.css';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const keySelect = document.getElementById('keySelect');
const waveformSelect = document.getElementById('waveformSelect');
const chordValue = document.getElementById('chordValue');
const qualityValue = document.getElementById('qualityValue');
const volumeValue = document.getElementById('volumeValue');
const filterValue = document.getElementById('filterValue');
const statusBadge = document.getElementById('statusBadge');

const KEY_OPTIONS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
const KEY_SEMITONES = {
  A: 9,
  Bb: 10,
  B: 11,
  C: 0,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  Gb: 6,
  G: 7,
  Ab: 8,
};

const state = {
  audioContext: null,
  masterGain: null,
  handLandmarker: null,
  activeOscillators: [],
  currentChord: 'I',
  currentMode: 'major',
  currentVolume: 0.12,
  currentFilter: 1200,
  currentWaveform: 'triangle',
  key: 'C',
  lastChordKey: null,
  lastChordTime: 0,
  streamStarted: false,
  stream: null,
  animationFrameId: null,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getRootMidi(key) {
  const base = KEY_SEMITONES[key] || 0;
  return 60 + base;
}

function getMajorThird(rootMidi) {
  return rootMidi + 4;
}

function getMinorThird(rootMidi) {
  return rootMidi + 3;
}

function getChordNotes(rootMidi, mode, voicingQuality) {
  const root = rootMidi;
  const third = mode === 'major' ? getMajorThird(root) : getMinorThird(root);
  const fifth = root + 7;
  const seventh = mode === 'major' ? root + 11 : root + 10;

  if (voicingQuality === 1) return [root, fifth, root + 12, third];
  if (voicingQuality === 2) return [third, root + 12, fifth, root + 7];
  if (voicingQuality === 3) return [root, third, fifth, seventh, root + 12];
  if (voicingQuality === 4) return [root, third, fifth, seventh, root + 12, root + 17];

  return [root, third, fifth, root + 12];
}

function ensureAudio() {
  if (!state.audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      updateStatus('Web Audio unavailable');
      return false;
    }

    state.audioContext = new AudioCtor();
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.25;
    state.masterGain.connect(state.audioContext.destination);
  }

  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }

  return true;
}

function stopActiveOscillators() {
  state.activeOscillators.forEach((voice) => {
    try {
      voice.oscillator.stop();
    } catch (error) {
      // no-op
    }
  });
  state.activeOscillators = [];
}

function renderSynth() {
  if (!state.audioContext || !state.masterGain) return;

  stopActiveOscillators();

  const rootMidi = getRootMidi(state.key);
  const voicingQuality = clamp(Math.round(state.currentVolume * 4), 1, 4);
  const chordNotes = getChordNotes(rootMidi, state.currentMode, voicingQuality);

  chordValue.textContent = state.currentChord;
  qualityValue.textContent = state.currentMode === 'major' ? 'Major' : 'Minor';
  volumeValue.textContent = `${Math.round(state.currentVolume * 100)}%`;
  filterValue.textContent = `${Math.round((state.currentFilter / 5000) * 100)}%`;

  const gainPerVoice = 0.18 / Math.max(1, chordNotes.length);

  chordNotes.forEach((noteMidi) => {
    const oscillator = state.audioContext.createOscillator();
    const gainNode = state.audioContext.createGain();
    const filterNode = state.audioContext.createBiquadFilter();

    oscillator.type = state.currentWaveform;
    oscillator.frequency.value = midiToFrequency(noteMidi);

    filterNode.type = 'lowpass';
    filterNode.frequency.value = state.currentFilter;
    filterNode.Q.value = 0.7;

    gainNode.gain.value = 0.0001;
    gainNode.gain.setTargetAtTime(gainPerVoice, state.audioContext.currentTime, 0.08);

    oscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(state.masterGain);

    oscillator.start();
    state.activeOscillators.push({ oscillator, gainNode });

    gainNode.gain.setTargetAtTime(0.0001, state.audioContext.currentTime + 0.14, 0.12);
    setTimeout(() => {
      try {
        oscillator.stop();
      } catch (error) {
        // no-op
      }
    }, 180);
  });
}

function updateStatus(message) {
  statusBadge.textContent = message;
}

function isFingerExtended(landmarks, tipIndex) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[tipIndex - 2];
  return tip.y < pip.y;
}

function isThumbExtended(landmarks) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  return thumbTip.x < thumbIp.x + 0.04;
}

function classifyLeftHand(hand) {
  const landmarks = hand.landmarks;
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];

  let extendedCount = 0;
  if (isFingerExtended(landmarks, 8)) extendedCount += 1;
  if (isFingerExtended(landmarks, 12)) extendedCount += 1;
  if (isFingerExtended(landmarks, 16)) extendedCount += 1;
  if (isFingerExtended(landmarks, 20)) extendedCount += 1;

  const thumbExtended = isThumbExtended(landmarks);
  const indexPinky = isFingerExtended(landmarks, 8) && isFingerExtended(landmarks, 20) && !isFingerExtended(landmarks, 12) && !isFingerExtended(landmarks, 16);
  const indexPinkyThumb = indexPinky && thumbExtended;

  let roman = 'I';
  if (extendedCount === 1) roman = 'I';
  if (extendedCount === 2) roman = 'II';
  if (extendedCount === 3) roman = 'III';
  if (extendedCount === 4) roman = 'IV';
  if (extendedCount === 5) roman = 'V';
  if (indexPinky) roman = 'VI';
  if (indexPinkyThumb) roman = 'VII';

  const tilt = middleMcp.x - wrist.x;
  const mode = tilt > 0.04 ? 'major' : 'minor';

  return { roman, mode };
}

function classifyRightHand(hand) {
  const landmarks = hand.landmarks;
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const ringMcp = landmarks[13];

  let extendedFingers = 0;
  if (isFingerExtended(landmarks, 8)) extendedFingers += 1;
  if (isFingerExtended(landmarks, 12)) extendedFingers += 1;
  if (isFingerExtended(landmarks, 16)) extendedFingers += 1;
  if (isFingerExtended(landmarks, 20)) extendedFingers += 1;

  const volume = clamp((0.32 - wrist.y) / 0.22, 0.05, 0.95);
  const filterTilt = (wrist.x - (middleMcp.x + ringMcp.x) / 2) * 4000;
  const filterTarget = clamp(900 + Math.abs(filterTilt), 300, 5000);

  let voicingQuality = 1;
  if (extendedFingers >= 4) voicingQuality = 4;
  else if (extendedFingers === 3) voicingQuality = 3;
  else if (extendedFingers === 2) voicingQuality = 2;

  return { volume, filterTarget, voicingQuality, thumbExtended: isThumbExtended(landmarks) };
}

function drawLandmarks(result) {
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();

  if (!result || !result.landmarks) return;

  const connections = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [5, 9, 10, 11, 12],
    [9, 13, 14, 15, 16],
    [13, 17, 18, 19, 20],
    [0, 17, 18, 19, 20],
  ];

  result.landmarks.forEach((landmarks, index) => {
    const color = index === 0 ? '#7dd3fc' : '#a78bfa';

    connections.forEach((path) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      path.forEach((pointIndex, pointOffset) => {
        const point = landmarks[pointIndex];
        const x = point.x * width;
        const y = point.y * height;

        if (pointOffset === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });

    landmarks.forEach((point) => {
      const x = point.x * width;
      const y = point.y * height;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    const wrist = landmarks[0];
    const anchorX = wrist.x * width;
    const anchorY = wrist.y * height;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.arc(anchorX, anchorY, 18, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function detectHands() {
  if (!state.handLandmarker || !video.videoWidth) return;

  const result = state.handLandmarker.detectForVideo(video, performance.now());
  drawLandmarks(result);

  const leftIndex = result.handednesses.findIndex((hand) => hand[0]?.displayName === 'Left');
  const rightIndex = result.handednesses.findIndex((hand) => hand[0]?.displayName === 'Right');

  if (leftIndex >= 0) {
    const left = classifyLeftHand({ landmarks: result.landmarks[leftIndex] });
    const now = performance.now();
    const chordId = `${left.roman}-${left.mode}`;

    if (chordId !== state.lastChordKey || now - state.lastChordTime > 90) {
      state.lastChordKey = chordId;
      state.lastChordTime = now;
      state.currentChord = left.roman;
      state.currentMode = left.mode;
      renderSynth();
    }
  }

  if (rightIndex >= 0) {
    const right = classifyRightHand({ landmarks: result.landmarks[rightIndex] });
    state.currentVolume = clamp(right.volume, 0.05, 0.95);
    state.currentFilter = clamp(right.filterTarget, 300, 5000);
    renderSynth();
  }
}

function initKeySelect() {
  KEY_OPTIONS.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    keySelect.appendChild(option);
  });

  keySelect.value = state.key;
  keySelect.addEventListener('change', (event) => {
    state.key = event.target.value;
    updateStatus('Key changed to ' + state.key);
    renderSynth();
  });

  waveformSelect.addEventListener('change', (event) => {
    state.currentWaveform = event.target.value;
    updateStatus('Waveform set to ' + state.currentWaveform);
    renderSynth();
  });
}

async function initCamera() {
  if (!ensureAudio()) return;
  if (state.streamStarted) return;

  startButton.disabled = true;
  startButton.textContent = 'Starting...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });

    state.stream = stream;
    video.srcObject = stream;
    await video.play();

    canvas.width = 640;
    canvas.height = 480;

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    state.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });

    state.streamStarted = true;
    startButton.textContent = 'Stop camera';
    updateStatus('Tracking live');
    state.animationFrameId = requestAnimationFrame(loop);
  } catch (error) {
    console.error(error);
    updateStatus('Camera unavailable');
    startButton.textContent = 'Start camera';
  } finally {
    startButton.disabled = false;
  }
}

function stopCamera() {
  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  state.streamStarted = false;
  state.handLandmarker = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  startButton.textContent = 'Start camera';
  updateStatus('Camera off');
}

function loop() {
  detectHands();
  if (state.streamStarted) {
    state.animationFrameId = requestAnimationFrame(loop);
  }
}

startButton.addEventListener('click', () => {
  if (state.streamStarted) {
    stopCamera();
    return;
  }

  initCamera();
});

initKeySelect();
renderSynth();
updateStatus('Ready');

window.addEventListener('beforeunload', () => {
  stopActiveOscillators();
  stopCamera();
  if (state.audioContext && state.audioContext.close) {
    state.audioContext.close();
  }
});
