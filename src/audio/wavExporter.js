import { SCALES } from '../data/scales.js';
import { midiToHz } from '../core/pitch.js';
import { downloadBlob, safeFileName } from '../core/download.js';
import {
  createImpulseResponse,
  createNoiseBuffer,
  triggerChord,
  triggerHihat,
  triggerKick,
  triggerLead,
  triggerSnare,
} from './dspNodes.js';

/**
 * OfflineAudioContext 고속 렌더링 & 44바이트 표준 RIFF/WAVE 바이너리 인코더
 */
export async function exportEightBarsToWav(state) {
  const sampleRate = 44100;
  const bars = 8;
  const totalSteps = bars * 16;
  const stepDuration = 60 / state.bpm / 4;
  const totalDurationSec = totalSteps * stepDuration + 1.5;
  const totalFrames = Math.ceil(sampleRate * totalDurationSec);

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const whiteNoise = createNoiseBuffer(offlineCtx, 2.0, false);
  const pinkNoise = createNoiseBuffer(offlineCtx, 3.0, true);

  const masterFilter = offlineCtx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = state.cutoff;

  const dryGain = offlineCtx.createGain();
  const wetGain = offlineCtx.createGain();
  const wet = state.reverb / 100;
  wetGain.gain.value = wet * 0.75;
  dryGain.gain.value = 1 - wet * 0.35;

  const convolver = offlineCtx.createConvolver();
  convolver.buffer = createImpulseResponse(offlineCtx, 2.2, 2.6);

  masterFilter.connect(dryGain);
  masterFilter.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(offlineCtx.destination);
  wetGain.connect(offlineCtx.destination);

  if (state.vinyl > 0) {
    const vSrc = offlineCtx.createBufferSource();
    vSrc.buffer = whiteNoise;
    vSrc.loop = true;
    const vBp = offlineCtx.createBiquadFilter();
    vBp.type = 'bandpass';
    vBp.frequency.value = 3200;
    const vGain = offlineCtx.createGain();
    vGain.gain.value = (state.vinyl / 100) * 0.045;
    vSrc.connect(vBp);
    vBp.connect(vGain);
    vGain.connect(offlineCtx.destination);
    vSrc.start(0);
  }

  if (state.rain > 0) {
    const rSrc = offlineCtx.createBufferSource();
    rSrc.buffer = pinkNoise;
    rSrc.loop = true;
    const rLp = offlineCtx.createBiquadFilter();
    rLp.type = 'lowpass';
    rLp.frequency.value = 1150;
    const rGain = offlineCtx.createGain();
    rGain.gain.value = (state.rain / 100) * 0.14;
    rSrc.connect(rLp);
    rLp.connect(rGain);
    rGain.connect(offlineCtx.destination);
    rSrc.start(0);
  }

  const scaleObj = SCALES[state.scale] || SCALES.F_MAJ7;
  const { patterns, mixer, waveform, leadMidi } = state;

  for (let i = 0; i < totalSteps; i++) {
    const step = i % 16;
    const bar = Math.floor(i / 16);
    const time = i * stepDuration;

    if (patterns.kick[step] && !mixer.kick.muted) {
      triggerKick(offlineCtx, masterFilter, time, mixer.kick.volume);
    }
    if (patterns.snare[step] && !mixer.snare.muted) {
      triggerSnare(offlineCtx, masterFilter, whiteNoise, time, mixer.snare.volume);
    }
    if (patterns.hihat[step] && !mixer.hihat.muted) {
      triggerHihat(offlineCtx, masterFilter, whiteNoise, time, mixer.hihat.volume);
    }
    if (patterns.chord[step] && !mixer.chord.muted) {
      const chordFreqs = scaleObj.chords[bar % scaleObj.chords.length];
      triggerChord(offlineCtx, masterFilter, chordFreqs, waveform, time, stepDuration * 6.5, mixer.chord.volume);
    }
    if (patterns.lead[step] && !mixer.lead.muted) {
      const freq = midiToHz(leadMidi[step]);
      triggerLead(offlineCtx, masterFilter, freq, waveform, time, stepDuration * 2.2, mixer.lead.volume);
    }
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = encodeAudioBufferToWavBlob(renderedBuffer);

  downloadBlob(wavBlob, `${safeFileName(state.title, 'flow-beat-track')}-8bars.wav`);
}

function encodeAudioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
