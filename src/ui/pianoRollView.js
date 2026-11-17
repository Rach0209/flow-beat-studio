import { MIDI_MAX, MIDI_MIN, isBlackKey, midiToName } from '../core/pitch.js';

const STEPS = 16;

/**
 * 리드 멜로디 피아노롤 에디터 (반음 단위, C2 ~ C6)
 *
 * - 가로 16스텝 × 세로 49음(반음). 한 스텝에는 음이 하나(모노포닉)입니다.
 * - 클릭/드래그로 입력, 켜진 칸에서 시작하면 지우기 모드로 드래그
 * - 입력 시 해당 음을 바로 들려줍니다 (미리듣기)
 * - 키보드: 방향키 이동 · Enter/Space 입력·삭제 · Delete/Backspace 삭제 · PageUp/Down 옥타브 이동
 * - 상태는 store.patterns.lead(켜짐) + store.leadMidi(MIDI 음높이)를 그대로 사용하므로
 *   AI·프리셋 결과도 같은 편집기에서 보이고 수정됩니다.
 * - 키보드 모드(KeyboardInputView)가 쓰는 공개 API: setCursorStep / highlightOctave / scrollToOctave
 */
export class PianoRollView {
  constructor(store, synthEngine) {
    this.store = store;
    this.synth = synthEngine;
    this.root = document.getElementById('pianoRoll');

    this.rows = new Map(); // midi -> row 요소
    this.cells = new Map(); // midi -> 셀 배열(스텝 순)
    this.columns = Array.from({ length: STEPS }, () => []); // step -> 셀 배열
    this.shown = Array(STEPS).fill(null); // step -> 화면에 켜져 있는 midi (변경분만 갱신하기 위한 캐시)

    this.drag = null; // { mode, pointerId, x, y }
    this.focusPos = { step: 0, midi: 60 }; // roving tabindex 위치
    this.cursorStep = null; // 키보드 모드 커서 열
    this.playingStep = -1;
    this.octaveBase = null; // 강조 중인 입력 옥타브의 시작 midi

    this.#bindEvents();
  }

  renderAll() {
    this.root.textContent = '';
    this.rows.clear();
    this.cells.clear();
    this.columns = Array.from({ length: STEPS }, () => []);
    this.shown.fill(null);

    // 높은 음이 위로 오도록 위에서부터 그린다
    for (let midi = MIDI_MAX; midi >= MIDI_MIN; midi--) {
      const name = midiToName(midi);
      const black = isBlackKey(midi);

      const row = document.createElement('div');
      row.className = `pr-row${black ? ' black-row' : ''}${midi % 12 === 0 ? ' c-row' : ''}`;
      row.dataset.midi = String(midi);

      const label = document.createElement('span');
      label.className = `pr-label${black ? ' black' : ''}`;
      label.textContent = name;
      row.appendChild(label);

      const rowCells = [];
      for (let step = 0; step < STEPS; step++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `pr-cell${Math.floor(step / 4) % 2 === 1 ? ' beat-group' : ''}`;
        cell.dataset.step = String(step);
        cell.dataset.midi = String(midi);
        cell.tabIndex = -1;
        cell.setAttribute('aria-pressed', 'false');
        cell.setAttribute('aria-label', `${name}, ${step + 1}번째 스텝`);
        row.appendChild(cell);
        rowCells.push(cell);
        this.columns[step].push(cell);
      }
      this.rows.set(midi, row);
      this.cells.set(midi, rowCells);
      this.root.appendChild(row);
    }

    const focusCell = this.cells.get(this.focusPos.midi)?.[this.focusPos.step];
    if (focusCell) focusCell.tabIndex = 0;

    this.refresh();
    this.setCursorStep(this.cursorStep);
    this.highlightOctave(this.octaveBase);
    this.updateCurrentStep(this.playingStep);
  }

  /** DOM 을 다시 만들지 않고, 바뀐 스텝만 반영 (드래그·포커스 유지) */
  refresh() {
    const { patterns, leadMidi } = this.store.state;
    for (let step = 0; step < STEPS; step++) {
      const next = patterns.lead[step] ? leadMidi[step] : null;
      const prev = this.shown[step];
      if (prev === next) continue;
      this.#setCellOn(prev, step, false);
      this.#setCellOn(next, step, true);
      this.shown[step] = next;
    }
  }

  #setCellOn(midi, step, on) {
    if (midi == null) return;
    const cell = this.cells.get(midi)?.[step];
    if (!cell) return;
    cell.classList.toggle('active', on);
    cell.setAttribute('aria-pressed', String(on));
  }

  updateCurrentStep(step) {
    if (this.playingStep >= 0) this.#toggleColumn(this.playingStep, 'playing-col', false);
    this.playingStep = step;
    if (step >= 0) this.#toggleColumn(step, 'playing-col', true);
  }

  #toggleColumn(step, className, on) {
    for (const cell of this.columns[step] ?? []) cell.classList.toggle(className, on);
  }

  // ---------- 키보드 모드용 공개 API ----------
  /** 입력 커서 열 표시 (null 이면 해제) */
  setCursorStep(step) {
    if (this.cursorStep !== null) this.#toggleColumn(this.cursorStep, 'cursor-col', false);
    this.cursorStep = step;
    if (step !== null) this.#toggleColumn(step, 'cursor-col', true);
  }

  /** 건반이 입력하는 1옥타브(base ~ base+12) 줄을 강조 (null 이면 해제) */
  highlightOctave(baseMidi) {
    if (this.octaveBase !== null) {
      for (let m = this.octaveBase; m <= this.octaveBase + 12; m++) this.rows.get(m)?.classList.remove('in-octave');
    }
    this.octaveBase = baseMidi;
    if (baseMidi !== null) {
      for (let m = baseMidi; m <= baseMidi + 12; m++) this.rows.get(m)?.classList.add('in-octave');
    }
  }

  /** 해당 옥타브(base ~ base+12)가 화면 위쪽에 보이도록 스크롤 */
  scrollToOctave(baseMidi) {
    const top = this.rows.get(Math.min(MIDI_MAX, baseMidi + 12));
    if (top) this.root.scrollTop = Math.max(0, top.offsetTop - 4);
  }

  /** 현재 켜진 음들의 중간 높이가 화면 가운데 오도록 스크롤 (없으면 C4 부근) */
  scrollToNotes() {
    const { patterns, leadMidi } = this.store.state;
    const active = leadMidi.filter((_, i) => patterns.lead[i]);
    const center = active.length ? Math.round((Math.min(...active) + Math.max(...active)) / 2) : 62;
    const row = this.rows.get(Math.min(MIDI_MAX, Math.max(MIDI_MIN, center)));
    if (row) this.root.scrollTop = Math.max(0, row.offsetTop - this.root.clientHeight / 2);
  }

  // ---------- 편집 ----------
  #isOn(step, midi) {
    const { patterns, leadMidi } = this.store.state;
    return Boolean(patterns.lead[step]) && leadMidi[step] === midi;
  }

  #paint(step, midi) {
    if (this.#isOn(step, midi)) return;
    this.store.setLeadNote(step, midi);
    this.synth.previewLead(midi);
  }

  #erase(step, midi) {
    if (this.#isOn(step, midi)) this.store.clearLeadStep(step);
  }

  #applyDrag(step, midi) {
    if (this.drag.mode === 'paint') this.#paint(step, midi);
    else this.#erase(step, midi);
  }

  #toggle(step, midi) {
    if (this.#isOn(step, midi)) this.#erase(step, midi);
    else this.#paint(step, midi);
  }

  #setFocusPos(step, midi) {
    const prev = this.cells.get(this.focusPos.midi)?.[this.focusPos.step];
    if (prev) prev.tabIndex = -1;
    this.focusPos = { step, midi };
    const next = this.cells.get(midi)?.[step];
    if (next) next.tabIndex = 0;
    return next;
  }

  #focusCell(step, midi) {
    const cell = this.#setFocusPos(step, midi);
    if (!cell) return;
    cell.focus();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  #cellFromEvent(e) {
    return e.target instanceof Element ? e.target.closest('.pr-cell') : null;
  }

  #bindEvents() {
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const cell = this.#cellFromEvent(e);
      if (!cell) return;
      e.preventDefault(); // 텍스트 선택 방지
      const step = Number(cell.dataset.step);
      const midi = Number(cell.dataset.midi);

      this.#setFocusPos(step, midi);
      this.drag = {
        mode: this.#isOn(step, midi) ? 'erase' : 'paint',
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      };
      try {
        this.root.setPointerCapture?.(e.pointerId);
      } catch {
        /* 이미 끝난 포인터 등: 캡처 없이도 편집은 계속 동작 */
      }
      this.#applyDrag(step, midi);
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;

      // 빠르게 드래그하면 pointermove 가 칸마다 오지 않으므로, 이전 위치와 현재 위치 사이를
      // 일정 간격으로 보간해 지나간 칸을 모두 처리한다.
      const { x: x0, y: y0 } = this.drag;
      const dist = Math.hypot(e.clientX - x0, e.clientY - y0);
      const samples = Math.max(1, Math.ceil(dist / 6));
      for (let i = 1; i <= samples; i++) {
        const x = x0 + ((e.clientX - x0) * i) / samples;
        const y = y0 + ((e.clientY - y0) * i) / samples;
        // 포인터 캡처 중에는 e.target 이 root 이므로 좌표로 셀을 찾는다
        const el = document.elementFromPoint(x, y);
        const cell = el instanceof Element && this.root.contains(el) ? el.closest('.pr-cell') : null;
        if (cell) this.#applyDrag(Number(cell.dataset.step), Number(cell.dataset.midi));
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });

    const endDrag = (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) this.drag = null;
    };
    this.root.addEventListener('pointerup', endDrag);
    this.root.addEventListener('pointercancel', endDrag);
    this.root.addEventListener('lostpointercapture', endDrag);

    // 키보드(Enter/Space)로 발생한 click 만 처리: 포인터 click 은 detail >= 1 이므로 무시
    this.root.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      const cell = this.#cellFromEvent(e);
      if (!cell) return;
      this.#toggle(Number(cell.dataset.step), Number(cell.dataset.midi));
    });

    this.root.addEventListener('keydown', (e) => {
      const cell = this.#cellFromEvent(e);
      if (!cell) return;
      let step = Number(cell.dataset.step);
      let midi = Number(cell.dataset.midi);

      switch (e.key) {
        case 'ArrowLeft': step = Math.max(0, step - 1); break;
        case 'ArrowRight': step = Math.min(STEPS - 1, step + 1); break;
        case 'ArrowUp': midi = Math.min(MIDI_MAX, midi + 1); break;
        case 'ArrowDown': midi = Math.max(MIDI_MIN, midi - 1); break;
        case 'PageUp': midi = Math.min(MIDI_MAX, midi + 12); break;
        case 'PageDown': midi = Math.max(MIDI_MIN, midi - 12); break;
        case 'Home': step = 0; break;
        case 'End': step = STEPS - 1; break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          this.store.clearLeadStep(step);
          return;
        default:
          return;
      }
      e.preventDefault();
      this.#focusCell(step, midi);
    });

    this.root.addEventListener('focusin', (e) => {
      const cell = this.#cellFromEvent(e);
      if (!cell) return;
      const step = Number(cell.dataset.step);
      const midi = Number(cell.dataset.midi);
      if (step !== this.focusPos.step || midi !== this.focusPos.midi) this.#setFocusPos(step, midi);
    });
  }
}
