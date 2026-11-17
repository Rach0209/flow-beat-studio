/**
 * Web Audio API 기반 신디사이저 DSP 팩토리 모듈
 */
export function createNoiseBuffer(ctx, durationSec = 2.0, pink = false) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (!pink) {
      data[i] = white;
    } else {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

export function createImpulseResponse(ctx, durationSec = 2.2, decay = 2.5) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const impulse = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      channelData[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return impulse;
}

export function triggerKick(ctx, destination, time, volume = 0.85) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';

  osc.frequency.setValueAtTime(148, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);

  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);

  osc.connect(gain);
  gain.connect(destination);

  osc.start(time);
  osc.stop(time + 0.34);
}

export function triggerSnare(ctx, destination, noiseBuffer, time, volume = 0.7) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1850, time);
  filter.Q.setValueAtTime(0.8, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(volume * 0.85, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.19);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(destination);

  noise.start(time);
  noise.stop(time + 0.2);

  const osc = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(190, time);
  osc.frequency.exponentialRampToValueAtTime(95, time + 0.09);

  bodyGain.gain.setValueAtTime(volume * 0.45, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);

  osc.connect(bodyGain);
  bodyGain.connect(destination);

  osc.start(time);
  osc.stop(time + 0.12);
}

export function triggerHihat(ctx, destination, noiseBuffer, time, volume = 0.5) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(7400, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * 0.45, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.065);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(destination);

  noise.start(time);
  noise.stop(time + 0.075);
}

export function triggerChord(ctx, destination, freqs, waveform, time, durationSec, volume = 0.6) {
  const voiceGain = volume / Math.max(1, freqs.length) * 0.72;

  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, time);
    osc.detune.setValueAtTime((idx - 1.5) * 4.5, time);

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(voiceGain, time + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0008, time + durationSec);

    osc.connect(env);
    env.connect(destination);

    osc.start(time);
    osc.stop(time + durationSec + 0.03);
  });
}

export function triggerLead(ctx, destination, freq, waveform, time, durationSec, volume = 0.55) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = waveform === 'sawtooth' ? 'triangle' : waveform;
  osc.frequency.setValueAtTime(freq * 2, time);

  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(volume * 0.42, time + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0008, time + durationSec * 0.9);

  osc.connect(env);
  env.connect(destination);

  osc.start(time);
  osc.stop(time + durationSec);
}
