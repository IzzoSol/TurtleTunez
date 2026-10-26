# TurtleTunez

TurtleTunez is a browser-based gesture-controlled music instrument built with Vite, MediaPipe, and the Web Audio API. It transforms a live webcam feed into a playable synth interface where each hand controls different aspects of the sound.

This project is an original creative work built for live, browser-based musical performance and experimentation. It uses third-party open-source tooling under their licensing terms, but the app architecture, design decisions, gesture mapping, and implementation were created for this project.

## High-Level Architecture

Everything runs fully client-side in the browser.

1. Webcam input
   - `getUserMedia` captures a live video stream.
   - The video is mirrored for intuitive control.
   - Audio remains local to the browser and never leaves the device.

2. Hand tracking
   - MediaPipe Hand Landmarker detects 21 3D landmarks per hand.
   - Up to two hands can be tracked in real time.
   - The model runs in `VIDEO` mode for low-latency performance.

3. Gesture classification and stabilization
   - Left hand controls harmony and chord selection.
   - Right hand controls voicing, volume, and filter movement.
   - Finger extension, wrist tilt, and handedness-aware comparisons convert gesture motion into audio state.
   - Stabilization logic prevents accidental flicker while switching chords.

4. Music theory mapping
   - A selected key provides the root note family.
   - Roman numeral degrees map to major-scale offsets.
   - The left hand chooses the quality and degree.
   - The right hand drives voicing complexity and expression.

5. Audio engine
   - Web Audio APIs generate the synth signal.
   - Oscillators feed into a WaveShaper and low-pass filter.
   - Volume changes are smoothed to avoid click artifacts.
   - The output is routed through a master gain to the speakers.

6. UI feedback
   - A mirrored camera feed displays the player’s hands.
   - Landmarks are drawn directly on a canvas overlay.
   - The interface exposes key selection, waveform selection, volume, and quality information.
   - A click-to-start control unlocks the browser audio context.

## Core interaction model

Left hand: harmony / scale degree
- Finger extension determines the active musical degree.
- Special combinations map to Roman numerals such as VI and VII.
- Wrist tilt distinguishes major vs minor quality.

Right hand: expression / voicing
- Wrist height drives volume.
- Finger count affects voicing complexity.
- Thumb extension can shift the octave.
- Horizontal tilt affects the filter sweep and resonance.

## Technology stack
- JavaScript (ES modules)
- Vite
- MediaPipe Hand Landmarker
- Web Audio API

## Local development

```bash
npm install
npm run dev
```

Then open the Vite URL in your browser and click Start camera.

## Production build

```bash
npm run build
```

## Notes

This project is designed to be a lightweight, browser-native musical instrument for real-time, gestural performance. It is intended to remain local-first, low-latency, and fully client-side.

## Commercial use

This repository is released under the MIT License for commercial use. Third-party dependencies retain their own licenses, which should be reviewed as part of any commercial deployment.

## Architecture summary

Webcam → hand tracking → gesture classification → music theory mapping → Web Audio synthesis → live UI feedback
