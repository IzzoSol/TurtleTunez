// AgentBrain — natural-language direction for the band.
// Local rule-based parser works offline; optional LLM endpoint (API key)
// is supported via stored settings for richer interpretation.

const SETTINGS_KEY = 'turtleTunez.brainSettings';

export function loadBrainSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveBrainSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings || {}));
}

export function hasLLM(settings) {
  return !!(settings?.endpoint && settings?.key);
}

// Local parser: returns an array of action objects {type, ...}.
export function parseInstruction(text) {
  const t = (text || '').toLowerCase().trim();
  const actions = [];
  if (!t) return actions;

  // Mode switching
  const modeMap = {
    solo: 'solo',
    duo: 'duo',
    band: 'band',
    beats: 'beats',
    beatmaker: 'beats',
    sample: 'sample',
    cymatics: 'cymatics',
    visualizer: 'cymatics',
  };
  Object.entries(modeMap).forEach(([word, mode]) => {
    if (new RegExp(`\\b${word}\\b`).test(t)) actions.push({ type: 'mode', value: mode });
  });

  // Pattern / genre
  const patternKeys = ['trap', 'house', 'hiphop', 'lofi', 'techno', 'dnb', 'dubstep', 'garage', 'afrobeat', 'latin', 'reggae', 'rock', 'pop', 'funk', 'jazz', 'bossa', 'blues', 'ballad', 'ambient'];
  patternKeys.forEach((key) => {
    if (new RegExp(`\\b${key}\\b`).test(t)) actions.push({ type: 'pattern', value: key });
  });

  // Preset / character
  const presetMap = {
    pad: 'softPad',
    warm: 'warmPad',
    dark: 'darkPad',
    ethereal: 'ethereal',
    lead: 'brightLead',
    analog: 'analogLead',
    acid: 'acidLead',
    soft: 'softLead',
    sub: 'subBass',
    reese: 'reeseBass',
    '808': 'bass808',
    rhodes: 'rhodes',
    organ: 'organ',
    glass: 'glassKeys',
    pluck: 'synthPluck',
    bell: 'fmBell',
    vibraphone: 'vibraphone',
  };
  Object.entries(presetMap).forEach(([word, preset]) => {
    if (new RegExp(`\\b${word}\\b`).test(t)) actions.push({ type: 'preset', value: preset });
  });

  // BPM
  const faster = /\b(faster|speed up|up tempo|quicker)\b/.test(t);
  const slower = /\b(slower|slow down|down tempo|calmer)\b/.test(t);
  if (faster) actions.push({ type: 'bpmDelta', value: +15 });
  if (slower) actions.push({ type: 'bpmDelta', value: -15 });
  const bpmMatch = t.match(/\b(\d{2,3})\s*bpm\b/);
  if (bpmMatch) actions.push({ type: 'bpmSet', value: Number(bpmMatch[1]) });

  // Mood
  if (/\b(darker|dark|minor|mellow|sad)\b/.test(t)) actions.push({ type: 'mood', value: 'minor' });
  if (/\b(brighter|bright|major|happier|upbeat)\b/.test(t)) actions.push({ type: 'mood', value: 'major' });

  // Agents
  const agents = ['drums', 'bass', 'arp', 'pad', 'strings'];
  agents.forEach((a) => {
    if (new RegExp(`\\b(add|enable|turn on|bring in)\\s+${a}\\b`).test(t) || new RegExp(`\\b${a}\\s+(on|up)\\b`).test(t)) {
      actions.push({ type: 'agent', value: a, on: true });
    }
    if (new RegExp(`\\b(remove|disable|turn off|mute)\\s+${a}\\b`).test(t) || new RegExp(`\\b${a}\\s+(off|out)\\b`).test(t)) {
      actions.push({ type: 'agent', value: a, on: false });
    }
  });
  if (/\b(all agents|whole band|full band)\b/.test(t)) {
    agents.forEach((a) => actions.push({ type: 'agent', value: a, on: true }));
  }

  // Intensity
  if (/\b(busy|intense|wild|crazy)\b/.test(t)) actions.push({ type: 'intensity', value: 3 });
  if (/\b(calm|gentle|soft|sparse)\b/.test(t)) actions.push({ type: 'intensity', value: 1 });
  if (/\b(groove|normal|mid)\b/.test(t)) actions.push({ type: 'intensity', value: 2 });

  // Reverb
  const reverbMatch = t.match(/\breverb\s+(\d+)\b/);
  if (reverbMatch) actions.push({ type: 'reverb', value: Number(reverbMatch[1]) / 100 });
  if (/\b(more reverb|wet)\b/.test(t)) actions.push({ type: 'reverb', value: 0.55 });
  if (/\b(no reverb|dry)\b/.test(t)) actions.push({ type: 'reverb', value: 0 });

  // Fills
  if (/\b(fills on|add fills)\b/.test(t)) actions.push({ type: 'fills', value: true });
  if (/\b(fills off|no fills)\b/.test(t)) actions.push({ type: 'fills', value: false });

  // Groove
  if (/\b(shuffle|swing)\b/.test(t)) actions.push({ type: 'groove', value: 0.13 });
  if (/\b(straight|no swing)\b/.test(t)) actions.push({ type: 'groove', value: 0 });

  // Tuning
  if (/\b(just intonation|just tuning)\b/.test(t)) actions.push({ type: 'tuning', value: 'just' });
  if (/\b(pythagorean)\b/.test(t)) actions.push({ type: 'tuning', value: 'pythagorean' });
  if (/\b(mean.?tone)\b/.test(t)) actions.push({ type: 'tuning', value: 'meantone' });
  if (/\b(equal temperament|12.?tet)\b/.test(t)) actions.push({ type: 'tuning', value: 'equal' });

  return actions;
}

// Optional LLM call — returns parsed actions or null.
export async function askLLM(settings, instruction) {
  if (!hasLLM(settings)) return null;
  try {
    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are TurtleTunez band director. Convert the user instruction into a JSON array of actions. ' +
              'Allowed action types: mode (solo/duo/band/beats/sample/cymatics), pattern (genre key), preset (one of: softPad,warmPad,darkPad,ethereal,brightLead,analogLead,acidLead,softLead,subBass,reeseBass,bass808,rhodes,organ,glassKeys,synthPluck,fmBell,vibraphone), ' +
              'bpmSet (number), bpmDelta (number), mood (major/minor), agent ({value,on}), intensity (1/2/3), reverb (0..1), groove (0..0.2), tuning (equal/just/pythagorean/meantone), fills (boolean). ' +
              'Reply ONLY with the JSON array, no prose, no markdown.',
          },
          { role: 'user', content: instruction },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    // Strip markdown fences if any.
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
