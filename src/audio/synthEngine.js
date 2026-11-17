import { SCALES } from '../data/scales.js';
import { midiToHz } from '../core/pitch.js';
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
 * 실시간 16-스텝 Lookahead 스케줄러 & 마스터 이펙터 신스 엔진
 */
export class SynthEngine {
  constructor(store) {
    this.store = store;
    this.ctx = null;
    this.analyser = null;
    this.masterFilter = null;
    this.dryGain = null;
    this.wetGain = null;
    this.vinylGain = null;
    this.rainGain = null;
    this.whiteNoiseBuffer = null;

    this.timerId = null;
    this.nextNoteTime = 0;
    this.stepIndex = 0;
    this.barIndex = 0;
    this.onStepVisualCallback = null;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    this.whiteNoiseBuffer = createNoiseBuffer(this.ctx, 2.0, false);
    const pinkNoiseBuffer = createNoiseBuffer(this.ctx, 3.0, true);

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';

    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();

    const convolver = this.ctx.createConvolver();
    convolver.buffer = createImpulseResponse(this.ctx, 2.2, 2.6);

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(4, this.ctx.currentTime);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;

    this.masterFilter.connect(this.dryGain);
    this.masterFilter.connect(convolver);
    convolver.connect(this.wetGain);

    this.dryGain.connect(compressor);
    this.wetGain.connect(compressor);
    compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.#startAmbienceLoops(this.whiteNoiseBuffer, pinkNoiseBuffer);
    this.syncParameters();
  }

  #startAmbienceLoops(whiteBuf, pinkBuf) {
    const vinylSrc = this.ctx.createBufferSource();
    vinylSrc.buffer = whiteBuf;
    vinylSrc.loop = true;

    const vinylBp = this.ctx.createBiquadFilter();
    vinylBp.type = 'bandpass';
    vinylBp.frequency.value = 3200;
    vinylBp.Q.value = 2.4;

    this.vinylGain = this.ctx.createGain();
    this.vinylGain.gain.value = 0;

    vinylSrc.connect(vinylBp);
    vinylBp.connect(this.vinylGain);
    this.vinylGain.connect(this.analyser);
    vinylSrc.start();

    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = pinkBuf;
    rainSrc.loop = true;

    const rainLp = this.ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 1150;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;

    rainSrc.connect(rainLp);
    rainLp.connect(this.rainGain);
    this.rainGain.connect(this.analyser);
    rainSrc.start();
  }

  syncParameters() {
    if (!this.ctx) return;
    const { cutoff, reverb, vinyl, rain, isPlaying } = this.store.state;
    const now = this.ctx.currentTime;

    this.masterFilter.frequency.setTargetAtTime(cutoff, now, 0.03);
    const wet = reverb / 100;
    this.wetGain.gain.setTargetAtTime(wet * 0.75, now, 0.03);
    this.dryGain.gain.setTargetAtTime(1 - wet * 0.35, now, 0.03);

    const ampScale = isPlaying ? 1 : 0.25;
    this.vinylGain.gain.setTargetAtTime((vinyl / 100) * 0.045 * ampScale, now, 0.05);
    this.rainGain.gain.setTargetAtTime((rain / 100) * 0.14 * ampScale, now, 0.05);
  }

  /** 피아노롤 편집 시 해당 음을 즉시 들려준다 (재생 중이 아니어도 동작) */
  previewLead(midi) {
    this.ensureContext();
    const { waveform, mixer } = this.store.state;
    const freq = midiToHz(midi);
    triggerLead(this.ctx, this.masterFilter, freq, waveform, this.ctx.currentTime + 0.01, 0.3, mixer.lead.volume);
  }

  start(onStepVisual) {
    this.ensureContext();
    this.onStepVisualCallback = onStepVisual;
    this.stepIndex = 0;
    this.barIndex = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;

    this.store.update({ isPlaying: true }, 'playback_changed');
    this.syncParameters();

    this.timerId = window.setInterval(() => this.#scheduler(), 25);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.store.update({ isPlaying: false, currentStep: -1 }, 'playback_changed');
    this.syncParameters();
  }

  #scheduler() {
    const lookaheadSec = 0.1;
    while (this.nextNoteTime < this.ctx.currentTime + lookaheadSec) {
      this.#scheduleStep(this.stepIndex, this.barIndex, this.nextNoteTime);
      this.#advanceStep();
    }
  }

  #advanceStep() {
    const secondsPerBeat = 60.0 / this.store.state.bpm;
    const sixteenthSec = secondsPerBeat / 4;
    this.nextNoteTime += sixteenthSec;

    this.stepIndex++;
    if (this.stepIndex >= 16) {
      this.stepIndex = 0;
      this.barIndex = (this.barIndex + 1) % 4;
    }
  }

  #scheduleStep(step, bar, time) {
    const state = this.store.state;
    const { patterns, mixer, scale, waveform, bpm, leadMidi } = state;
    const scaleObj = SCALES[scale] || SCALES.F_MAJ7;
    const stepDuration = 60 / bpm / 4;

    if (patterns.kick[step] && !mixer.kick.muted) {
      triggerKick(this.ctx, this.masterFilter, time, mixer.kick.volume);
    }
    if (patterns.snare[step] && !mixer.snare.muted) {
      triggerSnare(this.ctx, this.masterFilter, this.whiteNoiseBuffer, time, mixer.snare.volume);
    }
    if (patterns.hihat[step] && !mixer.hihat.muted) {
      triggerHihat(this.ctx, this.masterFilter, this.whiteNoiseBuffer, time, mixer.hihat.volume);
    }
    if (patterns.chord[step] && !mixer.chord.muted) {
      const chordFreqs = scaleObj.chords[bar % scaleObj.chords.length];
      triggerChord(
        this.ctx,
        this.masterFilter,
        chordFreqs,
        waveform,
        time,
        stepDuration * 6.5,
        mixer.chord.volume
      );
    }
    if (patterns.lead[step] && !mixer.lead.muted) {
      const freq = midiToHz(leadMidi[step]);
      triggerLead(
        this.ctx,
        this.masterFilter,
        freq,
        waveform,
        time,
        stepDuration * 2.2,
        mixer.lead.volume
      );
    }

    const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.store.state.isPlaying) {
        this.store.update({ currentStep: step }, 'step_tick');
        if (this.onStepVisualCallback) this.onStepVisualCallback(step);
      }
    }, delayMs);
  }
}
