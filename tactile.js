/**
 * Tactile Feedback System - mechanical keyboard click audio synthesis + visual micro-jiggle.
 * Self-contained module using Web Audio API and CSS transitions.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Synthesize a crisp mechanical keyboard click sound (no audio files needed)
  function playClickSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      // 1. High-frequency click transient (noise burst)
      const bufferSize = ctx.sampleRate * 0.006; // 6ms burst
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2200; // Crisp high switch-contact click
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.006);
      
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
      
      // 2. Low-frequency pop (keycap bottoming out)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.012);
      
      oscGain.gain.setValueAtTime(0.04, ctx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.012);
      
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.015);
    } catch (e) {
      console.warn('[Tactile] Web Audio click failed:', e);
    }
  }

  // Handle tactile trigger
  function triggerTactile(el) {
    playClickSound();
    
    // Trigger visual micro-jiggle (reflow reset)
    el.classList.remove('jiggle');
    void el.offsetWidth; // force browser layout recalculation
    el.classList.add('jiggle');
    
    // Automatically clean up class after animation ends
    setTimeout(() => {
      el.classList.remove('jiggle');
    }, 150);
  }

  // Monitor all click events using delegation
  const selector = 'button, .btn, input[type="submit"], input[type="button"], .tab-btn, .clickable';
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest(selector);
    if (btn) {
      triggerTactile(btn);
    }
  });
});
