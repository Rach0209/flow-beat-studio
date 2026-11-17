import { GENRE_PRESETS } from '../data/presets.js';
import { clampMidi, isValidMidi, scaleIndexToMidi } from './pitch.js';
import { DEFAULT_MODEL, isValidModelId, safeStorage, sanitizeUserProfile } from './security.js';

function loadStoredProfile() {
  try {
    return sanitizeUserProfile(JSON.parse(safeStorage.get(STORAGE_KEYS.USER_PROFILE) || 'null'));
  } catch {
    return null; // 손상된 저장값은 무시
  }
}

function loadStoredModel() {
  const stored = safeStorage.get(STORAGE_KEYS.MODEL);
  return isValidModelId(stored) ? stored : DEFAULT_MODEL;
}

const STORAGE_KEYS = {
  API_KEY: 'fbs_gemini_api_key',
  MODEL: 'fbs_gemini_model',
  CLIENT_ID: 'fbs_google_client_id',
  USER_PROFILE: 'fbs_google_user_profile',
};

/**
 * 단순하고 예측 가능한 Pub/Sub 중앙 상태 스토어
 */
class AppStore {
  constructor() {
    const initial = structuredClone(GENRE_PRESETS.lofi);
    this.state = {
      isPlaying: false,
      currentStep: -1,
      activePresetId: 'lofi',
      engineMode: 'local',

      title: initial.title,
      bpm: initial.bpm,
      scale: initial.scale,
      waveform: initial.waveform,
      cutoff: initial.cutoff,
      reverb: initial.reverb,
      vinyl: initial.vinyl,
      rain: initial.rain,
      patterns: initial.patterns,
      // 리드 멜로디는 MIDI 노트 번호(60=C4)로 저장. 프리셋의 스케일 음 번호는 여기서 변환한다.
      leadMidi: initial.leadNotes.map((i) => scaleIndexToMidi(initial.scale, i)),
      flowMusicPrompt: initial.flowMusicPrompt,

      mixer: {
        kick:  { volume: 0.85, muted: false },
        snare: { volume: 0.72, muted: false },
        hihat: { volume: 0.52, muted: false },
        chord: { volume: 0.62, muted: false },
        lead:  { volume: 0.58, muted: false },
      },

      auth: {
        geminiApiKey: safeStorage.get(STORAGE_KEYS.API_KEY) || '',
        geminiModel: loadStoredModel(),
        googleClientId: safeStorage.get(STORAGE_KEYS.CLIENT_ID) || '',
        userProfile: loadStoredProfile(),
      },
    };

    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(eventType = 'state_change') {
    for (const listener of this.listeners) {
      listener(this.state, eventType);
    }
  }

  update(patch, eventType = 'state_change') {
    Object.assign(this.state, patch);
    this.notify(eventType);
  }

  applyTrackConfig(trackData, engineMode = 'local', presetId = null) {
    this.state.title = trackData.title || 'Untitled AI Track';
    this.state.bpm = trackData.bpm;
    this.state.scale = trackData.scale;
    this.state.waveform = trackData.waveform;
    this.state.cutoff = trackData.cutoff;
    this.state.reverb = trackData.reverb;
    this.state.vinyl = trackData.vinyl;
    this.state.rain = trackData.rain;
    this.state.patterns = structuredClone(trackData.patterns);
    // AI·프리셋은 스케일 음 번호(leadNotes)를, 저장/복원 데이터는 leadMidi 를 줄 수 있다.
    this.state.leadMidi = Array.isArray(trackData.leadMidi)
      ? trackData.leadMidi.map((m) => clampMidi(m))
      : trackData.leadNotes.map((i) => scaleIndexToMidi(trackData.scale, i));
    this.state.flowMusicPrompt = trackData.flowMusicPrompt || '';
    this.state.engineMode = engineMode;
    this.state.activePresetId = presetId;
    this.notify('track_loaded');
  }

  toggleStep(trackKey, stepIdx) {
    const current = this.state.patterns[trackKey][stepIdx];
    this.state.patterns[trackKey][stepIdx] = current ? 0 : 1;
    this.state.activePresetId = null;
    this.notify('pattern_updated');
  }

  /** 피아노롤·키보드 모드: 스텝에 음을 입력 (켜짐 + MIDI 음높이). 한 스텝에는 음이 하나. */
  setLeadNote(step, midi) {
    if (!Number.isInteger(step) || step < 0 || step > 15) return;
    if (!isValidMidi(midi)) return;
    this.state.patterns.lead[step] = 1;
    this.state.leadMidi[step] = midi;
    this.state.activePresetId = null;
    this.notify('pattern_updated');
  }

  /** 피아노롤: 스텝의 음을 끈다 (저장된 음 높이는 유지) */
  clearLeadStep(step) {
    if (!Number.isInteger(step) || step < 0 || step > 15) return;
    if (!this.state.patterns.lead[step]) return;
    this.state.patterns.lead[step] = 0;
    this.state.activePresetId = null;
    this.notify('pattern_updated');
  }

  setTrackVolume(trackKey, volume) {
    this.state.mixer[trackKey].volume = Number(volume);
    this.notify('mixer_updated');
  }

  toggleTrackMute(trackKey) {
    this.state.mixer[trackKey].muted = !this.state.mixer[trackKey].muted;
    this.notify('mixer_updated');
  }

  saveGeminiCredentials(apiKey, model) {
    const cleanKey = apiKey.trim();
    const safeModel = isValidModelId(model) ? model : DEFAULT_MODEL;
    this.state.auth.geminiApiKey = cleanKey;
    this.state.auth.geminiModel = safeModel;
    if (cleanKey) {
      safeStorage.set(STORAGE_KEYS.API_KEY, cleanKey);
    } else {
      safeStorage.remove(STORAGE_KEYS.API_KEY);
    }
    safeStorage.set(STORAGE_KEYS.MODEL, safeModel);
    this.notify('auth_updated');
  }

  saveGoogleClientId(clientId) {
    const cleanId = clientId.trim();
    this.state.auth.googleClientId = cleanId;
    if (cleanId) {
      safeStorage.set(STORAGE_KEYS.CLIENT_ID, cleanId);
    } else {
      safeStorage.remove(STORAGE_KEYS.CLIENT_ID);
    }
    this.notify('auth_updated');
  }

  setUserProfile(profile) {
    const clean = sanitizeUserProfile(profile);
    this.state.auth.userProfile = clean;
    if (clean) {
      safeStorage.set(STORAGE_KEYS.USER_PROFILE, JSON.stringify(clean));
    } else {
      safeStorage.remove(STORAGE_KEYS.USER_PROFILE);
    }
    this.notify('auth_updated');
  }
}

export const store = new AppStore();
