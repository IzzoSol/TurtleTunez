# TurtleTunez 🐢🎵

**TurtleTunez** is a browser-based gesture-controlled music studio built with Vite, MediaPipe, and the Web Audio API. Your webcam becomes a playable instrument — one hand shapes harmony, the other sculpts expression — backed by a full studio: synthesized drums, an AI agent band, convolution reverb, euclidean rhythm generation, historical tunings, and an audio-reactive cymatics visualizer.

Everything runs fully client-side. No samples, no servers, no accounts — just hands and sound.

---

## The 5 Modes

| Mode | What it does |
|------|--------------|
| **Solo** | The classic two-hand gesture synth — full-screen camera |
| **Duo** | Two players share one webcam (4-hand tracking) — P2's left hand picks the beat, right hand rolls the drums |
| **Band** | All backing agents join you automatically: 🥁 Drums, 🎸 Bass, ✨ Arp, ☁️ Pad, 🎻 Strings |
| **Beats** | Drum machine focus — the sequencer drawer opens and drums play **without the camera** |
| **Cymatics** | The visualizer takes the full stage; the camera docks as a picture-in-picture so gestures still work |

Modes are shareable via URL hash: `#solo`, `#duo`, `#band`, `#beats`, `#cymatics`.

## Sound Engine

- **17 synth characters** (Soft/Warm/Dark/Ethereal pads, Bright/Analog/Acid/Soft leads, Sub/Reese/808 bass, Rhodes, Organ, Glass keys, FM Bell, Vibraphone) — each voice is a main + detuned sub oscillator through a character filter
- **28 beat patterns** across Trap, House, Hip-Hop, Lo-Fi, Techno, DnB, Dubstep, Garage, Afrobeat, Latin, Reggae, Rock, Pop, Funk, Jazz, Bossa, Blues, Ballad & Ambient — with groove (swing) presets and automatic bar fills
- **Step sequencer** — click any of the 64 cells to edit the pattern live; the playhead follows the beat
- **Euclid generator** — design rhythms with pulses/steps/rotation sliders (Bjorklund algorithm)
- **Agent band** — rule-based backing musicians that follow your chords and tempo, with 3 intensity levels (Calm / Groove / Busy)
- **Karplus-Strong strings** — physically-modeled plucked strings, strummed per bar
- **Convolution reverb** — impulse responses generated at runtime, wet/dry slider on the whole mix
- **4 tunings** — Equal Temperament, Just Intonation, Pythagorean, and quarter-comma mean-tone, switchable live
- **Mix recorder** — one-click ● Rec captures everything (chords, drums, agents) and downloads the take

## Gestures

**Left hand — harmony**
- Finger extension → chord degree (I–VII)
- Hand tilt → major / minor

**Right hand — expression**
- Wrist height → volume
- Finger count → voicing
- Thumb out → octave up
- Wrist tilt → filter sweep

Gestures hold for 4 frames before committing, so the music never flickers.

**Keyboard fallback (AudioKeys-style):** `1–7` chord degrees · `Space` drums on/off · `Z X C V` kick/snare/hat/clap · `Esc` close drawer.

## Visualizer

The Cymatics mode renders audio-reactive rings and spokes on a full-screen canvas — frequency bins drive ring radii, bass pulses the core glow, and hue drifts over time. It reacts to everything you play.

## Architecture

```
Webcam → MediaPipe HandLandmarker (local WASM) → gesture classification
    ↓                                              ↓
chord theory ← → 17-character voice engine → gesture filter → chord bus ┐
                                                                        ├→ reverb → analyser → speakers
28-pattern drum machine + agent band ─────────────→ studio bus ────────┘
                                                    ↓
                                        cymatics visualizer + ● recorder
```

**Dual-bus design:** your gesture volume only gates the chord voices; drums and agents route through a separate studio bus so they stay audible at all times (that's why Beats mode works without the camera).

**Local-first tracking:** MediaPipe WASM files and the hand-landmarker model ship in `public/`, served with cross-origin-isolation headers (`COOP`/`COEP`) by a tiny Node server — no CDN dependency, no "failed to load" surprises.

```
src/main.js            state, gestures, camera lifecycle, modes, wiring
src/drum-machine.js    synthesized drums, 28 patterns, scheduler, fills, swing
src/band-agents.js     Bass / Arp / Pad / Strings backing agents
src/synth-presets.js   17 synth characters
src/effects.js         runtime-generated reverb + Karplus-Strong pluck
src/euclid.js          euclidean rhythm generator
src/recorder.js        mix recorder (MediaRecorder)
src/visualizer.js      2D cymatics canvas
server.cjs             static server with COOP/COEP headers (port 5173)
```

## Local development

```bash
npm install
npm run dev        # dev server
```

For production (required for hand tracking — the headers matter):

```bash
npm run build
node server.cjs    # serves dist/ at http://127.0.0.1:5173 with COOP/COEP
```

Then open **http://127.0.0.1:5173/**, pick a mode, and press **Start camera**.

## Technology

- JavaScript (ES modules) · Vite · MediaPipe Tasks Vision · Web Audio API · Canvas 2D

## License

Released under the MIT License for commercial use. Third-party dependencies retain their own licenses.
