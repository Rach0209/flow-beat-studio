import { midiToName } from '../core/pitch.js';

const TRACK_META = [
  { key: 'kick',  label: 'KICK',  color: '#38bdf8' },
  { key: 'snare', label: 'SNARE', color: '#fb7185' },
  { key: 'hihat', label: 'HIHAT', color: '#fbbf24' },
  { key: 'chord', label: 'CHORD', color: '#818cf8' },
  { key: 'lead',  label: 'LEAD',  color: '#34d399' },
];

/**
 * 5트랙 × 16스텝 인터랙티브 그리드 & 믹서 UI 컨트롤러
 */
export class SequencerView {
  constructor(store) {
    this.store = store;
    this.indicatorRow = document.getElementById('stepIndicatorRow');
    this.gridContainer = document.getElementById('sequencerGrid');
    this.stepCounterLabel = document.getElementById('stepCounterLabel');
  }

  renderAll() {
    this.#renderStepIndicators();
    this.#renderTracks();
  }

  updateCurrentStep(step) {
    const indicators = this.indicatorRow.querySelectorAll('.step-num');
    indicators.forEach((el, idx) => {
      el.classList.toggle('current', idx === step);
    });

    const pads = this.gridContainer.querySelectorAll('.step-pad');
    pads.forEach((pad) => {
      const padStep = Number(pad.dataset.step);
      pad.classList.toggle('playing-step', padStep === step);
    });

    const displayNum = step >= 0 ? String(step + 1).padStart(2, '0') : '01';
    this.stepCounterLabel.textContent = `STEP ${displayNum} / 16`;
  }

  #renderStepIndicators() {
    this.indicatorRow.innerHTML = '<div></div>';
    for (let s = 0; s < 16; s++) {
      const span = document.createElement('span');
      span.className = `step-num ${s % 4 === 0 ? 'beat-start' : ''}`;
      span.textContent = String(s + 1).padStart(2, '0');
      this.indicatorRow.appendChild(span);
    }
  }

  #renderTracks() {
    const { patterns, mixer, leadMidi } = this.store.state;

    // 전체 재렌더 시 키보드 포커스가 사라지지 않도록 포커스 위치를 기억했다가 복원
    const focusKey = document.activeElement?.dataset?.focusKey || null;

    this.gridContainer.innerHTML = '';

    for (const track of TRACK_META) {
      const row = document.createElement('div');
      row.className = 'track-row';

      const ctrl = document.createElement('div');
      ctrl.className = 'track-controls';

      const nameEl = document.createElement('span');
      nameEl.className = 'track-name';
      nameEl.style.color = track.color;
      nameEl.textContent = track.label;

      const muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.dataset.trackKey = track.key;
      muteBtn.dataset.focusKey = `mute:${track.key}`;
      muteBtn.className = `mute-btn ${mixer[track.key].muted ? 'muted' : ''}`;
      muteBtn.textContent = 'M';
      muteBtn.title = `${track.label} 음소거 전환`;
      muteBtn.setAttribute('aria-label', `${track.label} 음소거`);
      muteBtn.setAttribute('aria-pressed', String(Boolean(mixer[track.key].muted)));
      muteBtn.addEventListener('click', () => {
        this.store.toggleTrackMute(track.key);
      });

      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.dataset.focusKey = `vol:${track.key}`;
      volSlider.className = 'vol-slider';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.02';
      volSlider.value = String(mixer[track.key].volume);
      volSlider.title = `${track.label} 볼륨`;
      volSlider.setAttribute('aria-label', `${track.label} 볼륨`);
      volSlider.addEventListener('input', (e) => {
        this.store.setTrackVolume(track.key, e.target.value);
      });

      ctrl.append(nameEl, muteBtn, volSlider);
      row.appendChild(ctrl);

      for (let step = 0; step < 16; step++) {
        const isActive = Boolean(patterns[track.key][step]);
        const pad = document.createElement('button');
        pad.type = 'button';
        pad.dataset.step = String(step);
        pad.dataset.focusKey = `pad:${track.key}:${step}`;
        pad.className = [
          'step-pad',
          Math.floor(step / 4) % 2 === 1 ? 'beat-group' : '',
          isActive ? 'active' : '',
        ].join(' ');
        pad.style.setProperty('--pad-color', track.color);
        pad.setAttribute('aria-pressed', String(isActive));
        pad.setAttribute('aria-label', `${track.label} ${step + 1}번째 스텝`);

        if (track.key === 'lead' && isActive) {
          pad.textContent = midiToName(leadMidi[step]);
        }

        pad.addEventListener('click', () => {
          this.store.toggleStep(track.key, step);
        });

        row.appendChild(pad);
      }

      this.gridContainer.appendChild(row);
    }

    if (focusKey) {
      this.gridContainer.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  /** 믹서 변경 시 그리드를 다시 그리지 않고 음소거 버튼만 갱신 (볼륨 슬라이더 드래그 유지) */
  updateMixer() {
    const { mixer } = this.store.state;
    this.gridContainer.querySelectorAll('.mute-btn').forEach((btn) => {
      const muted = Boolean(mixer[btn.dataset.trackKey]?.muted);
      btn.classList.toggle('muted', muted);
      btn.setAttribute('aria-pressed', String(muted));
    });
  }
}
