import { SCALES } from '../data/scales.js';
import { downloadBlob, safeFileName } from '../core/download.js';
import { hzToMidi } from '../core/pitch.js';

/**
 * 현재 트랙을 표준 MIDI 파일(SMF Format 1)로 내보냅니다.
 *
 * 트랙 구성
 *   0. 컨덕터  — 곡 제목, 템포, 박자(4/4)
 *   1. Drums   — 채널 10 (GM: Kick 36 / Snare 38 / Closed Hi-Hat 42)
 *   2. Chord   — 채널 1  (코드 진행은 4마디 순환, 8마디 분량)
 *   3. Lead    — 채널 2  (피아노롤에서 편집한 멜로디)
 * 뮤트된 채널은 제외하고, 믹서 볼륨은 벨로시티로 반영합니다.
 */

const PPQ = 480; // 4분음표당 틱
const STEP_TICKS = PPQ / 4; // 1스텝 = 16분음표 = 120틱
const BARS = 8; // WAV 내보내기와 동일한 길이
const STEPS_PER_BAR = 16;

const GM_DRUM = { kick: 36, snare: 38, hihat: 42 };
const CHORD_PROGRAM = 4; // Electric Piano 1 (0-based)
const LEAD_PROGRAM = { square: 80, sawtooth: 81, sine: 89, triangle: 4 }; // GM 근사 매핑

const CHORD_TICKS = Math.round(6.5 * STEP_TICKS); // 신스 엔진의 코드 길이와 동일 비율
const LEAD_TICKS = Math.round(2.2 * STEP_TICKS); // 신스 엔진의 리드 길이와 동일 비율
const DRUM_TICKS = 60;

const velocityOf = (volume) => Math.max(1, Math.min(127, Math.round(Number(volume) * 127)));

// ---------- 바이트 유틸 ----------
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** 가변 길이 수(VLQ) 인코딩 — 델타 타임에 사용 */
function vlq(value) {
  let n = value;
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const textMeta = (type, text) => {
  const bytes = [...new TextEncoder().encode(text)];
  return [0xff, type, ...vlq(bytes.length), ...bytes];
};

// ---------- 노트 → 이벤트 ----------
/**
 * 같은 음높이가 겹치면(노트 온이 두 번 연속) 수신 측이 잘못 해석할 수 있으므로,
 * 각 노트의 길이를 같은 음높이의 다음 시작 지점까지로 제한합니다.
 */
function clampOverlaps(notes) {
  const byPitch = new Map();
  for (const note of notes) {
    if (!byPitch.has(note.pitch)) byPitch.set(note.pitch, []);
    byPitch.get(note.pitch).push(note);
  }
  const result = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    list.forEach((note, i) => {
      const next = list.slice(i + 1).find((n) => n.start > note.start);
      const end = next ? Math.min(note.start + note.len, next.start) : note.start + note.len;
      if (end > note.start && !(i > 0 && list[i - 1].start === note.start)) {
        result.push({ ...note, end });
      }
    });
  }
  return result;
}

function noteEvents(notes, channel) {
  const events = [];
  for (const n of clampOverlaps(notes)) {
    events.push({ tick: n.start, order: 1, bytes: [0x90 | channel, n.pitch, n.vel] });
    events.push({ tick: n.end, order: 0, bytes: [0x80 | channel, n.pitch, 0] }); // Note Off 가 먼저
  }
  return events;
}

function buildTrack(events, minEndTick = 0) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let lastTick = 0;
  for (const e of sorted) {
    body.push(...vlq(e.tick - lastTick), ...e.bytes);
    lastTick = e.tick;
  }
  const endTick = Math.max(lastTick, minEndTick);
  body.push(...vlq(endTick - lastTick), 0xff, 0x2f, 0x00); // End of Track
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

// ---------- 공개 API ----------
/** 상태 → SMF 바이트 (DOM 의존 없음, 테스트 용이) */
export function buildMidiBytes(state) {
  const { patterns, mixer, scale, waveform, leadMidi, bpm, title } = state;
  const scaleObj = SCALES[scale] || SCALES.F_MAJ7;
  const totalTicks = BARS * STEPS_PER_BAR * STEP_TICKS;

  const drumNotes = [];
  const chordNotes = [];
  const leadNoteList = [];

  for (let bar = 0; bar < BARS; bar++) {
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      const start = (bar * STEPS_PER_BAR + step) * STEP_TICKS;

      for (const [key, pitch] of Object.entries(GM_DRUM)) {
        if (patterns[key][step] && !mixer[key].muted) {
          drumNotes.push({ start, len: DRUM_TICKS, pitch, vel: velocityOf(mixer[key].volume) });
        }
      }
      if (patterns.chord[step] && !mixer.chord.muted) {
        const freqs = scaleObj.chords[bar % scaleObj.chords.length];
        for (const hz of freqs) {
          chordNotes.push({ start, len: CHORD_TICKS, pitch: hzToMidi(hz), vel: velocityOf(mixer.chord.volume) });
        }
      }
      if (patterns.lead[step] && !mixer.lead.muted) {
        leadNoteList.push({ start, len: LEAD_TICKS, pitch: leadMidi[step], vel: velocityOf(mixer.lead.volume) });
      }
    }
  }

  const tempo = Math.round(60000000 / bpm);
  const conductor = [
    { tick: 0, order: -3, bytes: textMeta(0x03, String(title || 'Flow Beat Studio')) },
    { tick: 0, order: -2, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
    { tick: 0, order: -1, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] }, // 4/4
  ];

  const tracks = [buildTrack(conductor, totalTicks)];

  if (drumNotes.length) {
    tracks.push(buildTrack([
      { tick: 0, order: -2, bytes: textMeta(0x03, 'Drums') },
      ...noteEvents(drumNotes, 9),
    ], totalTicks));
  }
  if (chordNotes.length) {
    tracks.push(buildTrack([
      { tick: 0, order: -2, bytes: textMeta(0x03, 'Chord') },
      { tick: 0, order: -1, bytes: [0xc0, CHORD_PROGRAM] },
      ...noteEvents(chordNotes, 0),
    ], totalTicks));
  }
  if (leadNoteList.length) {
    tracks.push(buildTrack([
      { tick: 0, order: -2, bytes: textMeta(0x03, 'Lead') },
      { tick: 0, order: -1, bytes: [0xc1, LEAD_PROGRAM[waveform] ?? LEAD_PROGRAM.triangle] },
      ...noteEvents(leadNoteList, 1),
    ], totalTicks));
  }

  const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

export function exportMidi(state) {
  const bytes = buildMidiBytes(state);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  downloadBlob(blob, `${safeFileName(state.title, 'flow-beat-track')}-8bars.mid`);
}
