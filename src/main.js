import { GENRE_PRESETS } from './data/presets.js';
import { SCALES } from './data/scales.js';
import { scaleIndexToMidi } from './core/pitch.js';
import { store } from './core/store.js';
import { GoogleAuthService } from './services/googleAuthService.js';
import { GeminiComposer } from './composer/geminiComposer.js';
import { LocalHeuristicComposer } from './composer/localHeuristicComposer.js';
import { SynthEngine } from './audio/synthEngine.js';
import { exportEightBarsToWav } from './audio/wavExporter.js';
import { exportMidi } from './audio/midiExporter.js';
import { SpectrumVisualizer } from './ui/visualizer.js';
import { SequencerView } from './ui/sequencerView.js';
import { PianoRollView } from './ui/pianoRollView.js';
import { KeyboardInputView } from './ui/keyboardInputView.js';
import { AuthModalView } from './ui/authModalView.js';

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = String(message).slice(0, 200);
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// 핵심 서비스 인스턴스 초기화
const authService = new GoogleAuthService(store);
const geminiComposer = new GeminiComposer();
const localComposer = new LocalHeuristicComposer();
const synthEngine = new SynthEngine(store);

// UI 뷰 초기화
const sequencerView = new SequencerView(store);
const pianoRoll = new PianoRollView(store, synthEngine);
const keyboardInput = new KeyboardInputView(store, synthEngine, pianoRoll);

/** 재생 위치를 시퀀서와 피아노롤에 동시에 반영 */
const onStep = (step) => {
  sequencerView.updateCurrentStep(step);
  pianoRoll.updateCurrentStep(step);
};
const authModalView = new AuthModalView(store, authService, showToast);
const visualizer = new SpectrumVisualizer(document.getElementById('spectrumCanvas'), synthEngine);

// DOM 레퍼런스
const playToggleBtn = document.getElementById('playToggleBtn');
const composeBtn = document.getElementById('composeBtn');
const moodPromptInput = document.getElementById('moodPromptInput');
const presetButtonsEl = document.getElementById('presetButtons');
const scaleSelect = document.getElementById('scaleSelect');
const waveformSelect = document.getElementById('waveformSelect');

const bpmSlider = document.getElementById('bpmSlider');
const cutoffSlider = document.getElementById('cutoffSlider');
const reverbSlider = document.getElementById('reverbSlider');
const vinylSlider = document.getElementById('vinylSlider');
const rainSlider = document.getElementById('rainSlider');

function initStaticOptions() {
  Object.values(SCALES).forEach((sc) => {
    const opt = document.createElement('option');
    opt.value = sc.id;
    opt.textContent = sc.label;
    scaleSelect.appendChild(opt);
  });

  Object.values(GENRE_PRESETS).forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.dataset.presetId = preset.id;
    btn.textContent = preset.name;
    btn.addEventListener('click', () => {
      store.applyTrackConfig(preset, 'local', preset.id);
      showToast(`프리셋 로드됨: ${preset.name}`);
    });
    presetButtonsEl.appendChild(btn);
  });
}

function syncControlsFromState() {
  const s = store.state;
  document.getElementById('trackTitleDisplay').textContent = s.title;

  const badge = document.getElementById('engineBadge');
  if (s.engineMode === 'gemini') {
    badge.textContent = 'GEMINI AI COMPOSED';
    badge.classList.add('ai-live');
  } else {
    badge.textContent = 'LOCAL ENGINE';
    badge.classList.remove('ai-live');
  }

  bpmSlider.value = String(s.bpm);
  document.getElementById('bpmValue').textContent = `${s.bpm} BPM`;

  scaleSelect.value = s.scale;
  waveformSelect.value = s.waveform;

  cutoffSlider.value = String(s.cutoff);
  document.getElementById('cutoffValue').textContent = `${s.cutoff} Hz`;

  reverbSlider.value = String(s.reverb);
  document.getElementById('reverbValue').textContent = `${s.reverb}%`;

  vinylSlider.value = String(s.vinyl);
  document.getElementById('vinylValue').textContent = `${s.vinyl}%`;

  rainSlider.value = String(s.rain);
  document.getElementById('rainValue').textContent = `${s.rain}%`;

  document.getElementById('flowPromptText').textContent = s.flowMusicPrompt;

  presetButtonsEl.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.presetId === s.activePresetId);
  });

  playToggleBtn.textContent = s.isPlaying ? '⏹ 정지' : '▶ 재생';
  playToggleBtn.classList.toggle('playing', s.isPlaying);
}

function bindEvents() {
  playToggleBtn.addEventListener('click', () => {
    if (store.state.isPlaying) {
      synthEngine.stop();
    } else {
      synthEngine.start(onStep);
    }
  });

  composeBtn.addEventListener('click', async () => {
    const prompt = moodPromptInput.value.trim().slice(0, 300);
    if (!prompt) {
      showToast('원하는 음악 분위기나 장면을 입력해 주세요.');
      return;
    }

    composeBtn.disabled = true;
    composeBtn.textContent = '⏳ 작곡 중...';

    try {
      const { geminiApiKey, geminiModel } = store.state.auth;
      if (geminiApiKey) {
        const aiTrack = await geminiComposer.composeFromPrompt({
          prompt,
          apiKey: geminiApiKey,
          model: geminiModel,
        });
        store.applyTrackConfig(aiTrack, 'gemini', null);
        showToast(`Gemini AI(${geminiModel})가 새 트랙을 작곡했습니다!`);
      } else {
        const localTrack = localComposer.composeFromPrompt(prompt);
        store.applyTrackConfig(localTrack, 'local', null);
        showToast('로컬 엔진으로 트랙 생성됨 (상단에서 Google 무료 연동 가능)');
      }

      if (!store.state.isPlaying) {
        synthEngine.start(onStep);
      }
    } catch (err) {
      console.warn('Gemini 호출 오류, 로컬 엔진으로 자동 폴백:', err);
      const fallbackTrack = localComposer.composeFromPrompt(prompt);
      store.applyTrackConfig(fallbackTrack, 'local', null);
      showToast(`API 한도/오류로 로컬 엔진 전환: ${err.message}`);
    } finally {
      composeBtn.disabled = false;
      composeBtn.textContent = '✨ AI 트랙 생성';
    }
  });

  bpmSlider.addEventListener('input', (e) => {
    store.update({ bpm: Number(e.target.value), activePresetId: null }, 'param_updated');
  });
  scaleSelect.addEventListener('change', (e) => {
    store.update({ scale: e.target.value, activePresetId: null }, 'param_updated');
  });
  waveformSelect.addEventListener('change', (e) => {
    store.update({ waveform: e.target.value, activePresetId: null }, 'param_updated');
  });
  cutoffSlider.addEventListener('input', (e) => {
    store.update({ cutoff: Number(e.target.value) }, 'param_updated');
    synthEngine.syncParameters();
  });
  reverbSlider.addEventListener('input', (e) => {
    store.update({ reverb: Number(e.target.value) }, 'param_updated');
    synthEngine.syncParameters();
  });
  vinylSlider.addEventListener('input', (e) => {
    store.update({ vinyl: Number(e.target.value) }, 'param_updated');
    synthEngine.syncParameters();
  });
  rainSlider.addEventListener('input', (e) => {
    store.update({ rain: Number(e.target.value) }, 'param_updated');
    synthEngine.syncParameters();
  });

  document.getElementById('clearPatternBtn').addEventListener('click', () => {
    const empty = {
      kick: Array(16).fill(0),
      snare: Array(16).fill(0),
      hihat: Array(16).fill(0),
      chord: Array(16).fill(0),
      lead: Array(16).fill(0),
    };
    store.update({ patterns: empty, activePresetId: null }, 'pattern_updated');
  });

  document.getElementById('randomizeLeadBtn').addEventListener('click', () => {
    // 현재 스케일의 음(0..7번)에서 무작위로 16개를 뽑아 MIDI 음높이로 변환
    const scaleId = store.state.scale;
    const newMidi = Array.from({ length: 16 }, () => scaleIndexToMidi(scaleId, Math.floor(Math.random() * 8)));
    store.update({ leadMidi: newMidi, activePresetId: null }, 'pattern_updated');
    showToast('멜로디 음계 시퀀스가 변주되었습니다.');
  });

  document.getElementById('copyFlowPromptBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(store.state.flowMusicPrompt);
      showToast('Google Flow Music용 영문 프롬프트가 클립보드에 복사되었습니다.');
    } catch {
      // 권한 거부·비보안 컨텍스트 등: 사용자가 직접 복사할 수 있도록 안내
      showToast('클립보드 접근이 거부되었습니다. 프롬프트 텍스트를 직접 선택해 복사해 주세요.');
    }
  });

  document.getElementById('exportWavBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '⏳ WAV 렌더링 중...';
    try {
      await exportEightBarsToWav(store.state);
      showToast('8마디 고음질 스테레오 WAV 파일이 저장되었습니다.');
    } catch (err) {
      console.error('WAV 내보내기 실패:', err);
      showToast('WAV 내보내기에 실패했습니다. 브라우저 메모리/지원 여부를 확인해 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 8마디 WAV 저장';
    }
  });

  document.getElementById('exportMidiBtn').addEventListener('click', () => {
    try {
      exportMidi(store.state);
      showToast('MIDI 파일(.mid)이 저장되었습니다. (드럼·코드·리드 트랙, 8마디)');
    } catch (err) {
      console.error('MIDI 내보내기 실패:', err);
      showToast('MIDI 내보내기에 실패했습니다.');
    }
  });
}

store.subscribe((state, eventType) => {
  if (eventType === 'step_tick') {
    onStep(state.currentStep);
    return;
  }

  syncControlsFromState();

  if (eventType === 'playback_changed') {
    onStep(state.currentStep); // 정지 시 재생 위치 표시 해제
  }
  if (eventType === 'track_loaded' || eventType === 'pattern_updated') {
    pianoRoll.refresh();
  }
  if (eventType === 'track_loaded' && !keyboardInput.isActive) {
    pianoRoll.scrollToNotes(); // 새 트랙의 음들이 보이도록 (키보드 모드 중에는 입력 옥타브 유지)
  }

  if (eventType === 'track_loaded' || eventType === 'pattern_updated') {
    sequencerView.renderAll();
    synthEngine.syncParameters();
  }

  if (eventType === 'mixer_updated') {
    sequencerView.updateMixer();
  }

  if (eventType === 'auth_updated') {
    authModalView.syncUI();
  }
});

initStaticOptions();
bindEvents();
syncControlsFromState();
sequencerView.renderAll();
pianoRoll.renderAll();
pianoRoll.scrollToNotes();
visualizer.start();

// compat.js 가 모듈 로드 성공 여부를 판단하는 플래그
window.__fbsReady = true;
