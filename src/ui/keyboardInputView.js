import { MIDI_MAX, MIDI_MIN, midiToName } from '../core/pitch.js';

/**
 * 키보드 모드 — 컴퓨터 키보드를 피아노처럼 써서 리드 멜로디를 스텝 입력합니다.
 *
 *   건반      A S D F G H J K  = 도 레 미 파 솔 라 시 도(높은)
 *             W E   T Y U      = 도# 레# 파# 솔# 라#
 *   옥타브    Z / X  (또는 ↓ / ↑)
 *   칸 이동   → 또는 Space = 다음 칸, ← = 이전 칸, Home / End = 처음 / 끝 칸
 *   삭제      Backspace / Delete = 현재 칸의 음 지우기
 *   종료      Esc
 *
 * 키는 글자(e.key)가 아니라 물리적 위치(e.code)로 판별하므로, 한글 입력 상태에서도 동작합니다.
 */

const STEP_COUNT = 16;
const MIN_OCTAVE = 2; // C2 ~ C3
const MAX_OCTAVE = 5; // C5 ~ C6 (MIDI_MAX)
const DEFAULT_OCTAVE = 4;

// semitone: 옥타브 시작음(C)으로부터의 반음 수
const WHITE_KEYS = [
  { semitone: 0, code: 'KeyA', label: 'A' },
  { semitone: 2, code: 'KeyS', label: 'S' },
  { semitone: 4, code: 'KeyD', label: 'D' },
  { semitone: 5, code: 'KeyF', label: 'F' },
  { semitone: 7, code: 'KeyG', label: 'G' },
  { semitone: 9, code: 'KeyH', label: 'H' },
  { semitone: 11, code: 'KeyJ', label: 'J' },
  { semitone: 12, code: 'KeyK', label: 'K' },
];
// afterWhite: 몇 번째 흰 건반 오른쪽에 걸치는지
const BLACK_KEYS = [
  { semitone: 1, code: 'KeyW', label: 'W', afterWhite: 0 },
  { semitone: 3, code: 'KeyE', label: 'E', afterWhite: 1 },
  { semitone: 6, code: 'KeyT', label: 'T', afterWhite: 3 },
  { semitone: 8, code: 'KeyY', label: 'Y', afterWhite: 4 },
  { semitone: 10, code: 'KeyU', label: 'U', afterWhite: 5 },
];

const NOTE_CODES = new Map([...WHITE_KEYS, ...BLACK_KEYS].map((k) => [k.code, k.semitone]));
const baseMidiOf = (octave) => 12 * (octave + 1); // 옥타브 4 → 60 (C4)

export class KeyboardInputView {
  constructor(store, synthEngine, pianoRoll) {
    this.store = store;
    this.synth = synthEngine;
    this.pianoRoll = pianoRoll;

    this.modeBtn = document.getElementById('kbModeBtn');
    this.panel = document.getElementById('kbPanel');
    this.keysEl = document.getElementById('kbKeys');
    this.octLabel = document.getElementById('kbOctLabel');
    this.stepLabel = document.getElementById('kbStepLabel');
    this.statusEl = document.getElementById('kbStatus');
    this.autoAdvanceEl = document.getElementById('kbAutoAdvance');

    this.active = false;
    this.octave = DEFAULT_OCTAVE;
    this.step = 0;
    this.keyEls = new Map(); // semitone -> 건반 요소

    this.#buildKeys();
    this.#bindEvents();
    this.#updateLabels();
  }

  get isActive() {
    return this.active;
  }

  // ---------- 건반 UI ----------
  #buildKeys() {
    this.keysEl.textContent = '';
    const whiteWidth = 100 / WHITE_KEYS.length;

    for (const key of WHITE_KEYS) {
      this.keysEl.appendChild(this.#createKey(key, 'white'));
    }
    for (const key of BLACK_KEYS) {
      const el = this.#createKey(key, 'black');
      const blackWidth = whiteWidth * 0.62;
      el.style.width = `${blackWidth}%`;
      el.style.left = `${(key.afterWhite + 1) * whiteWidth - blackWidth / 2}%`;
      this.keysEl.appendChild(el);
    }
  }

  #createKey(key, kind) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `kb-key ${kind}`;
    el.tabIndex = -1; // 연주는 단축키로 하므로 탭 정지점에서 제외
    el.dataset.semitone = String(key.semitone);

    const shortcut = document.createElement('kbd');
    shortcut.className = 'kb-shortcut';
    shortcut.textContent = key.label;

    const note = document.createElement('span');
    note.className = 'kb-note';
    note.dataset.semitone = String(key.semitone);

    el.append(shortcut, note);
    this.keyEls.set(key.semitone, el);
    return el;
  }

  /** 현재 옥타브에 맞춰 건반의 음 이름(C4, D#4 …) 갱신 */
  #updateKeyNames() {
    const base = baseMidiOf(this.octave);
    for (const [semitone, el] of this.keyEls) {
      const name = midiToName(base + semitone);
      el.querySelector('.kb-note').textContent = name;
      el.setAttribute('aria-label', `${name}`);
    }
  }

  #updateLabels() {
    const base = baseMidiOf(this.octave);
    this.octLabel.textContent = `옥타브 ${this.octave} (${midiToName(base)}–${midiToName(base + 12)})`;
    this.stepLabel.textContent = `STEP ${String(this.step + 1).padStart(2, '0')} / ${STEP_COUNT}`;
    this.#updateKeyNames();
  }

  #announce(message) {
    this.statusEl.textContent = message;
  }

  // ---------- 상태 변경 ----------
  #setActive(on) {
    this.active = on;
    this.panel.classList.toggle('hidden', !on);
    this.modeBtn.setAttribute('aria-pressed', String(on));
    this.modeBtn.classList.toggle('kb-mode-on', on);

    if (on) {
      this.pianoRoll.setCursorStep(this.step);
      this.pianoRoll.highlightOctave(baseMidiOf(this.octave));
      this.pianoRoll.scrollToOctave(baseMidiOf(this.octave));
      // 버튼에 포커스가 남아 있으면 Space 가 버튼을 다시 누르므로 패널로 옮긴다
      this.panel.focus({ preventScroll: true });
      this.#announce('키보드 모드 켜짐. A S D F G H J K 로 입력, Z/X 옥타브, 화살표로 칸 이동, Esc 종료');
    } else {
      this.pianoRoll.setCursorStep(null);
      this.pianoRoll.highlightOctave(null);
      this.#releaseAll();
      this.#announce('키보드 모드 꺼짐');
      this.modeBtn.focus({ preventScroll: true });
    }
  }

  #setOctave(octave) {
    const next = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave));
    if (next === this.octave) return;
    this.octave = next;
    this.#updateLabels();
    this.pianoRoll.highlightOctave(baseMidiOf(next));
    this.pianoRoll.scrollToOctave(baseMidiOf(next));
    this.#announce(`옥타브 ${next}`);
  }

  #setStep(step) {
    this.step = Math.min(STEP_COUNT - 1, Math.max(0, step));
    this.#updateLabels();
    this.pianoRoll.setCursorStep(this.step);
  }

  // ---------- 입력 동작 ----------
  #noteOn(semitone) {
    const midi = baseMidiOf(this.octave) + semitone;
    if (midi < MIDI_MIN || midi > MIDI_MAX) return;

    const targetStep = this.step;
    this.store.setLeadNote(targetStep, midi);
    this.synth.previewLead(midi);
    this.#announce(`${midiToName(midi)} 입력, ${targetStep + 1}번째 칸`);

    if (this.autoAdvanceEl.checked) this.#setStep(targetStep + 1);
  }

  #clearStep() {
    this.store.clearLeadStep(this.step);
    this.#announce(`${this.step + 1}번째 칸 비움`);
  }

  #press(semitone) {
    this.keyEls.get(semitone)?.classList.add('pressed');
  }

  #release(semitone) {
    this.keyEls.get(semitone)?.classList.remove('pressed');
  }

  #releaseAll() {
    for (const el of this.keyEls.values()) el.classList.remove('pressed');
  }

  // ---------- 키 처리 ----------
  /** 글자 입력 필드(텍스트·선택 상자 등)에서는 단축키를 가로채지 않는다 */
  #isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('textarea, select, [contenteditable="true"]')) return true;
    const input = target.closest('input');
    return Boolean(input) && !['range', 'checkbox', 'radio', 'button'].includes(input.type);
  }

  #isModalOpen() {
    const modal = document.getElementById('authModal');
    return Boolean(modal) && !modal.classList.contains('hidden');
  }

  #shouldHandle(e) {
    return this.active && !e.ctrlKey && !e.metaKey && !e.altKey && !this.#isModalOpen() && !this.#isTypingTarget(e.target);
  }

  #onKeyDown(e) {
    if (!this.#shouldHandle(e)) return;

    // 슬라이더 위에서는 방향키가 슬라이더 조작이므로 건드리지 않는다
    const onRange = e.target instanceof HTMLInputElement && e.target.type === 'range';
    const isNote = NOTE_CODES.has(e.code);

    let handled = true;
    if (isNote) {
      if (!e.repeat) {
        const semitone = NOTE_CODES.get(e.code);
        this.#press(semitone);
        this.#noteOn(semitone);
      }
    } else {
      switch (e.code) {
        case 'KeyZ':
          this.#setOctave(this.octave - 1);
          break;
        case 'KeyX':
          this.#setOctave(this.octave + 1);
          break;
        case 'ArrowDown':
          if (onRange) return;
          this.#setOctave(this.octave - 1);
          break;
        case 'ArrowUp':
          if (onRange) return;
          this.#setOctave(this.octave + 1);
          break;
        case 'ArrowRight':
          if (onRange) return;
          this.#setStep(this.step + 1);
          break;
        case 'Space':
          this.#setStep(this.step + (e.shiftKey ? -1 : 1));
          break;
        case 'ArrowLeft':
          if (onRange) return;
          this.#setStep(this.step - 1);
          break;
        case 'Home':
          this.#setStep(0);
          break;
        case 'End':
          this.#setStep(STEP_COUNT - 1);
          break;
        case 'Backspace':
        case 'Delete':
          this.#clearStep();
          break;
        case 'Escape':
          this.#setActive(false);
          break;
        default:
          handled = false;
      }
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation(); // 피아노롤 셀의 자체 방향키 처리와 중복되지 않도록
    }
  }

  #onKeyUp(e) {
    if (!this.active) return;
    if (NOTE_CODES.has(e.code)) this.#release(NOTE_CODES.get(e.code));
    // Space 는 keyup 에서 포커스된 버튼의 click 을 일으키므로 함께 막는다
    if (e.code === 'Space' && this.#shouldHandle(e)) e.preventDefault();
  }

  #bindEvents() {
    this.modeBtn.addEventListener('click', () => this.#setActive(!this.active));

    // 캡처 단계에서 처리해 다른 요소(피아노롤 셀 등)의 키 처리보다 먼저 가로챈다
    document.addEventListener('keydown', (e) => this.#onKeyDown(e), true);
    document.addEventListener('keyup', (e) => this.#onKeyUp(e), true);
    window.addEventListener('blur', () => this.#releaseAll());

    // 화면 건반 클릭/터치
    this.keysEl.addEventListener('pointerdown', (e) => {
      const el = e.target instanceof Element ? e.target.closest('.kb-key') : null;
      if (!el) return;
      e.preventDefault();
      const semitone = Number(el.dataset.semitone);
      this.#press(semitone);
      this.#noteOn(semitone);
    });
    const releasePointer = (e) => {
      const el = e.target instanceof Element ? e.target.closest('.kb-key') : null;
      if (el) this.#release(Number(el.dataset.semitone));
      else this.#releaseAll();
    };
    this.keysEl.addEventListener('pointerup', releasePointer);
    this.keysEl.addEventListener('pointerleave', () => this.#releaseAll());
    this.keysEl.addEventListener('pointercancel', () => this.#releaseAll());

    // 패널의 버튼들
    document.getElementById('kbOctDown').addEventListener('click', () => this.#setOctave(this.octave - 1));
    document.getElementById('kbOctUp').addEventListener('click', () => this.#setOctave(this.octave + 1));
    document.getElementById('kbPrevStep').addEventListener('click', () => this.#setStep(this.step - 1));
    document.getElementById('kbNextStep').addEventListener('click', () => this.#setStep(this.step + 1));

    // 피아노롤을 마우스로 누르면 그 열로 커서를 옮긴다
    this.pianoRoll.root.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      const cell = e.target instanceof Element ? e.target.closest('.pr-cell') : null;
      if (cell) this.#setStep(Number(cell.dataset.step));
    });
  }
}
