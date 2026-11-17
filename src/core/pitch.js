import { SCALES } from '../data/scales.js';

/**
 * 음높이 유틸 — 리드 멜로디는 MIDI 노트 번호(60 = C4)로 저장합니다.
 * (AI·프리셋이 주는 "스케일 음 번호 0..7"은 불러올 때 이 번호로 변환)
 */

/** 피아노롤·건반이 다루는 범위: C2 ~ C6 */
export const MIDI_MIN = 36;
export const MIDI_MAX = 84;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

export const clampMidi = (midi) => Math.min(MIDI_MAX, Math.max(MIDI_MIN, Math.round(Number(midi))));

export const isValidMidi = (midi) => Number.isInteger(midi) && midi >= MIDI_MIN && midi <= MIDI_MAX;

export const isBlackKey = (midi) => BLACK_KEY_CLASSES.has(((midi % 12) + 12) % 12);

export const midiToName = (midi) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const hzToMidi = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));

/** 스케일 음 번호(0..7) → MIDI 번호 */
export function scaleIndexToMidi(scaleId, index) {
  const scale = SCALES[scaleId] || SCALES.F_MAJ7;
  const len = scale.notes.length;
  const safeIndex = ((Math.round(Number(index)) % len) + len) % len;
  return clampMidi(hzToMidi(scale.notes[safeIndex]));
}
