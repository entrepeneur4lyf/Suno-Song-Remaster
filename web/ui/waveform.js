/**
 * Waveform Module
 * WaveSurfer.js integration for waveform visualization and seeking
 */

import WaveSurfer from 'wavesurfer.js';
import { formatTime } from './transport.js';

// ============================================================================
// Module State
// ============================================================================

let wavesurfer = null;
let currentBlobUrl = null;
let originalBlobUrl = null; // Store original blob URL for FX bypass
let hoverContainer = null;
let hoverElements = null;
let hoverListeners = null;
let bassEnvelope = null; // Normalized bass energy per window for coloring

// ============================================================================
// Waveform Initialization
// ============================================================================

/**
 * Initialize WaveSurfer waveform display
 * @param {AudioBuffer} audioBuffer - Audio buffer to display
 * @param {Blob} originalBlob - Original file blob for WaveSurfer
 * @param {Object} callbacks - Callback functions { onSeek, getBuffer }
 */
export function initWaveSurfer(audioBuffer, originalBlob, callbacks = {}) {
  // Cleanup previous instance
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  // Revoke previous blob URLs to prevent memory leak
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  if (originalBlobUrl) {
    URL.revokeObjectURL(originalBlobUrl);
    originalBlobUrl = null;
  }

  try {
    // Precompute bass envelope used to color the waveform
    bassEnvelope = computeBassEnvelope(audioBuffer, 2048, 200);

    // Create gradient
    const ctx = document.createElement('canvas').getContext('2d');
    const waveGradient = ctx.createLinearGradient(0, 0, 0, 80);
    waveGradient.addColorStop(0, 'rgba(188, 177, 231, 0.8)');
    waveGradient.addColorStop(0.5, 'rgba(154, 143, 209, 0.6)');
    waveGradient.addColorStop(1, 'rgba(100, 90, 160, 0.3)');

    // Create blob URL for WaveSurfer (tracked for cleanup)
    // Store as both current and original so we can switch back on FX bypass
    currentBlobUrl = URL.createObjectURL(originalBlob);
    originalBlobUrl = URL.createObjectURL(originalBlob); // Separate URL for original

    wavesurfer = WaveSurfer.create({
      container: '#waveform',
      waveColor: waveGradient,
      // Dim the played section slightly while keeping underlying bass colors visible
      progressColor: 'rgba(0, 0, 0, 0.22)',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      height: 80,
      // Avoid misleading A/B comparisons: keep waveform amplitude true to the actual audio level.
      normalize: false,
      interact: true,
      dragToSeek: true,
      url: currentBlobUrl,
      renderFunction: (peaks, canvasCtx) => renderBassColoredWaveform(peaks, canvasCtx, bassEnvelope)
    });

    // Custom hover handler (uses our known duration, not WaveSurfer's state)
    setupWaveformHover(audioBuffer.duration);

    // Mute wavesurfer - we use our own Web Audio chain
    wavesurfer.setVolume(0);

    // Log when audio is ready
    wavesurfer.on('ready', () => {
      console.log('WaveSurfer ready, duration:', wavesurfer.getDuration());
    });

    // Handle click for seeking
    wavesurfer.on('click', (relativeX) => {
      const duration = callbacks.getBuffer?.()?.duration || wavesurfer.getDuration();
      const time = relativeX * duration;
      console.log('WaveSurfer click:', relativeX, 'time:', time);
      if (callbacks.onSeek) callbacks.onSeek(time);
    });

    // Handle drag for seeking
    wavesurfer.on('drag', (relativeX) => {
      const duration = callbacks.getBuffer?.()?.duration || wavesurfer.getDuration();
      const time = relativeX * duration;
      if (callbacks.onSeek) callbacks.onSeek(time);
    });

    return wavesurfer;
  } catch (error) {
    console.error('WaveSurfer initialization failed:', error);
    wavesurfer = null;
    return null;
  }
}

/**
 * Destroy WaveSurfer instance and cleanup
 */
export function destroyWaveSurfer() {
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  if (originalBlobUrl) {
    URL.revokeObjectURL(originalBlobUrl);
    originalBlobUrl = null;
  }

  cleanupHover();
}

/**
 * Get the WaveSurfer instance
 * @returns {WaveSurfer|null}
 */
export function getWaveSurfer() {
  return wavesurfer;
}

/**
 * Switch waveform back to original (for FX bypass)
 * This reloads from the stored original blob URL instead of creating a new WAV
 */
export function showOriginalWaveform() {
  if (!wavesurfer || !originalBlobUrl) return;

  console.log('[Waveform] Switching to original waveform');
  wavesurfer.load(originalBlobUrl);
}

// ============================================================================
// Peak Extraction
// ============================================================================

/**
 * Extract peaks from audio buffer for waveform display
 * @param {AudioBuffer} audioBuffer - Source audio buffer
 * @param {number} numPeaks - Number of peaks to extract
 * @returns {number[]} Array of peak values
 */
export function extractPeaks(audioBuffer, numPeaks = 800) {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerPeak = Math.floor(channelData.length / numPeaks);
  const peaks = [];

  for (let i = 0; i < numPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }

  return peaks;
}

// ============================================================================
// Hover Functionality
// ============================================================================

/**
 * Setup waveform hover time display
 * @param {number} duration - Audio duration in seconds
 */
function setupWaveformHover(duration) {
  const container = document.querySelector('#waveform');
  if (!container) return;

  // Clean up existing hover elements
  cleanupHover();

  // Store new container reference
  hoverContainer = container;

  // Create hover line
  const line = document.createElement('div');
  line.style.cssText = `
    position: absolute;
    top: 0;
    height: 100%;
    width: 1px;
    background: rgba(255, 255, 255, 0.5);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 10;
  `;
  container.style.position = 'relative';
  container.appendChild(line);

  // Create hover label
  const label = document.createElement('div');
  label.style.cssText = `
    position: absolute;
    top: 2px;
    background: #1a1a1a;
    color: #BCB1E7;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 2px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 11;
    white-space: nowrap;
  `;
  container.appendChild(label);

  hoverElements = { line, label };

  // Mouse move handler
  const moveHandler = (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const relX = Math.max(0, Math.min(1, x / rect.width));
    const time = relX * duration;

    // Format time
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    label.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Position elements
    line.style.left = `${x}px`;
    line.style.opacity = '1';

    // Position label (flip to left side if near right edge)
    const labelWidth = label.offsetWidth;
    if (x + labelWidth + 5 > rect.width) {
      label.style.left = `${x - labelWidth - 2}px`;
    } else {
      label.style.left = `${x + 2}px`;
    }
    label.style.opacity = '1';
  };

  // Mouse leave handler
  const leaveHandler = () => {
    line.style.opacity = '0';
    label.style.opacity = '0';
  };

  container.addEventListener('mousemove', moveHandler);
  container.addEventListener('mouseleave', leaveHandler);

  // Store references for cleanup
  hoverListeners = { move: moveHandler, leave: leaveHandler };
}

/**
 * Cleanup hover elements and listeners
 */
function cleanupHover() {
  if (hoverElements) {
    hoverElements.line.remove();
    hoverElements.label.remove();
    hoverElements = null;
  }

  if (hoverContainer && hoverListeners) {
    hoverContainer.removeEventListener('mousemove', hoverListeners.move);
    hoverContainer.removeEventListener('mouseleave', hoverListeners.leave);
    hoverListeners = null;
  }
}

// ============================================================================
// Progress Updates
// ============================================================================

/**
 * Update WaveSurfer progress cursor position
 * @param {number} time - Current time in seconds
 * @param {number} duration - Total duration in seconds
 */
export function updateWaveSurferProgress(time, duration) {
  if (!wavesurfer || !duration) return;
  const progress = time / duration;
  wavesurfer.seekTo(Math.min(1, Math.max(0, progress)));
}

/**
 * Update waveform display with a different audio buffer (e.g., original vs processed)
 * @param {AudioBuffer} audioBuffer - New audio buffer to display
 */
export function updateWaveformBuffer(audioBuffer) {
  if (!wavesurfer) return;

  // Create WAV blob from AudioBuffer
  const blob = audioBufferToWavBlob(audioBuffer);

  // Recompute bass envelope so colors match the new audio content
  bassEnvelope = computeBassEnvelope(audioBuffer, 2048, 200);

  // Revoke old URL and create new one
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
  }
  currentBlobUrl = URL.createObjectURL(blob);

  // Load new audio into WaveSurfer (it will extract its own peaks)
  wavesurfer.load(currentBlobUrl);

  console.log('[Waveform] Updated with new buffer, duration:', audioBuffer.duration);
}

/**
 * Convert AudioBuffer to WAV Blob for WaveSurfer
 * @param {AudioBuffer} buffer - Source audio buffer
 * @returns {Blob} WAV blob
 */
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      // Use symmetric scaling for consistency across encoders
      const intSample = Math.round(sample * 32767);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ============================================================================
// Bass-Aware Coloring Helpers
// ============================================================================

// Compute a normalized bass energy envelope using a simple one-pole low-pass
// filter and RMS per window. The envelope length controls the color resolution.
function computeBassEnvelope(audioBuffer, points = 2048, cutoffHz = 200) {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(channel.length / points));

  // One-pole low-pass (RC) filter coefficient
  const alpha = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);

  let low = 0;
  const envelope = [];

  for (let i = 0; i < points; i++) {
    const start = i * windowSize;
    const end = Math.min(channel.length, start + windowSize);

    let sumSq = 0;
    let count = 0;

    for (let j = start; j < end; j++) {
      low = low + (1 - alpha) * (channel[j] - low);
      const bassSample = Math.abs(low);
      sumSq += bassSample * bassSample;
      count++;
    }

    const rms = count ? Math.sqrt(sumSq / count) : 0;
    envelope.push(rms);
  }

  // Normalize to 0..1
  const max = Math.max(...envelope, 1e-6);
  return envelope.map((v) => v / max);
}

function renderBassColoredWaveform(peaks, ctx, envelope) {
  if (!peaks || !peaks.length) return;

  const left = peaks[0];
  const right = peaks[1] || left;
  const length = Math.min(left?.length || 0, right?.length || left?.length || 0);
  if (!length) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const halfH = height / 2;
  const step = width / length;

  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < length; i++) {
    const bass = sampleEnvelope(envelope, i / Math.max(1, length - 1));
    const [r, g, b] = lerpColor([59, 130, 246], [239, 68, 68], bass); // blue -> red

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
    const x = i * step;

    const leftAmp = Math.min(halfH, Math.abs(left[i]) * halfH);
    ctx.fillRect(x, halfH - leftAmp, Math.max(1, step), leftAmp);

    const rightAmp = Math.min(halfH, Math.abs(right[i]) * halfH);
    ctx.fillRect(x, halfH, Math.max(1, step), rightAmp);
  }
}

function sampleEnvelope(envelope, t) {
  if (!envelope || !envelope.length) return 0;
  const clamped = Math.max(0, Math.min(1, t));
  const idx = Math.min(envelope.length - 1, Math.floor(clamped * (envelope.length - 1)));
  return envelope[idx];
}

function lerpColor(from, to, t) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}
