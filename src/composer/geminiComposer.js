import { SCALES } from '../data/scales.js';
import { DEFAULT_MODEL, clampText, fetchWithTimeout, isValidApiKeyFormat, isValidModelId } from '../core/security.js';

const VALID_SCALES = Object.keys(SCALES);
const VALID_WAVEFORMS = ['triangle', 'sine', 'sawtooth', 'square'];

/**
 * 본인 계정의 Google AI Studio 무료 티어(Gemini API)를 호출하여
 * 무드 프롬프트를 구조화된 16-스텝 신스 작곡 JSON으로 변환하는 모듈
 */
export class GeminiComposer {
  async composeFromPrompt({ prompt, apiKey, model = DEFAULT_MODEL }) {
    if (!isValidApiKeyFormat(apiKey)) {
      throw new Error('저장된 API 키 형식이 올바르지 않습니다. 키를 다시 등록해 주세요.');
    }
    if (!isValidModelId(model)) {
      throw new Error('모델 ID 형식이 올바르지 않습니다.');
    }
    // 비용·남용 방지 및 프롬프트 길이 제한
    const userPrompt = String(prompt ?? '').trim().slice(0, 300);

    const systemPrompt = `
You are an electronic & Lo-Fi music producer engine.
Convert the user's mood/scene prompt into a structured 16-step synthesizer groove JSON.
Return ONLY valid JSON matching this exact schema:
{
  "title": "Short creative English track title",
  "bpm": 85,
  "scale": "F_MAJ7",
  "waveform": "triangle",
  "cutoff": 1800,
  "reverb": 40,
  "vinyl": 20,
  "rain": 15,
  "patterns": {
    "kick":  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0],
    "snare": [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    "hihat": [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    "chord": [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    "lead":  [0,0,1,0, 0,1,0,0, 0,1,0,0, 1,0,0,0]
  },
  "leadNotes": [0,0,4,0, 0,5,0,0, 0,6,0,0, 4,0,2,0],
  "flowMusicPrompt": "Detailed English prompt for Google Flow Music (instruments, vibe, BPM, instrumental)"
}
Constraints:
- bpm: integer 60..145
- scale: one of ${JSON.stringify(VALID_SCALES)}
- waveform: one of ${JSON.stringify(VALID_WAVEFORMS)}
- cutoff: integer 400..6000
- reverb, vinyl, rain: integer 0..100
- each array in patterns must have length 16 with values 0 or 1
- leadNotes must have length 16 with integers 0..7
`.trim();

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `${systemPrompt}\n\nUser mood request: "${userPrompt}"` }],
          },
        ],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const reason = clampText(errBody?.error?.message, 160, `Gemini API HTTP ${response.status}`);
      throw new Error(reason);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Gemini 응답에서 JSON 텍스트를 찾지 못했습니다.');
    }

    const parsed = JSON.parse(rawText);
    return this.#sanitizeTrackJson(parsed, userPrompt);
  }

  #sanitizeTrackJson(rawInput, originalPrompt) {
    const raw = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
    const clamp = (val, min, max, fallback) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };

    const normalizeBinary16 = (arr, fallback) => {
      if (!Array.isArray(arr) || arr.length !== 16) return fallback;
      return arr.map((v) => (v ? 1 : 0));
    };

    const normalizeNotes16 = (arr) => {
      if (!Array.isArray(arr) || arr.length !== 16) {
        return [0, 0, 3, 0, 0, 5, 0, 0, 0, 4, 0, 0, 2, 0, 0, 0];
      }
      return arr.map((v) => clamp(v, 0, 7, 0));
    };

    const scale = VALID_SCALES.includes(raw.scale) ? raw.scale : 'F_MAJ7';
    const waveform = VALID_WAVEFORMS.includes(raw.waveform) ? raw.waveform : 'triangle';

    return {
      title: clampText(raw.title, 60, 'Gemini AI Groove'),
      bpm: clamp(raw.bpm, 60, 145, 86),
      scale,
      waveform,
      cutoff: clamp(raw.cutoff, 350, 6500, 1900),
      reverb: clamp(raw.reverb, 0, 100, 38),
      vinyl: clamp(raw.vinyl, 0, 100, 15),
      rain: clamp(raw.rain, 0, 100, 10),
      patterns: {
        kick:  normalizeBinary16(raw.patterns?.kick,  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0]),
        snare: normalizeBinary16(raw.patterns?.snare, [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]),
        hihat: normalizeBinary16(raw.patterns?.hihat, [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),
        chord: normalizeBinary16(raw.patterns?.chord, [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0]),
        lead:  normalizeBinary16(raw.patterns?.lead,  [0,0,1,0, 0,1,0,0, 0,1,0,0, 1,0,0,0]),
      },
      leadNotes: normalizeNotes16(raw.leadNotes),
      flowMusicPrompt: clampText(
        raw.flowMusicPrompt,
        600,
        `Instrumental ambient synth track inspired by: ${originalPrompt}, warm analog textures, no vocals`
      ),
    };
  }
}
