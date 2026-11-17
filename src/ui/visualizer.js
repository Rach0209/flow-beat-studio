/**
 * HTML5 Canvas 실시간 FFT 주파수 스펙트럼 렌더러
 */
export class SpectrumVisualizer {
  constructor(canvasEl, synthEngine) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.synth = synthEngine;
    this.rafId = null;
  }

  start() {
    const render = () => {
      this.#drawFrame();
      this.rafId = requestAnimationFrame(render);
    };
    render();
  }

  #drawFrame() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, width, height);

    const analyser = this.synth.analyser;
    if (!analyser) {
      this.#drawIdleLine(ctx, width, height);
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const barCount = 48;
    const gap = 4;
    const barWidth = (width - gap * (barCount - 1)) / barCount;

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i] || 0;
      const ratio = value / 255;
      const barHeight = Math.max(4, ratio * (height - 16));
      const x = i * (barWidth + gap);
      const y = height - barHeight;

      const grad = ctx.createLinearGradient(0, y, 0, height);
      grad.addColorStop(0, '#38bdf8');
      grad.addColorStop(1, '#818cf8');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  #drawIdleLine(ctx, width, height) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }
}
