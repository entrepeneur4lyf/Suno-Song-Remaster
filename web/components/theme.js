/**
 * theme.js - Design system for audio controls
 */

export const controlTheme = {
  // Functional colors for different control purposes
  functional: {
    gain: '#22c55e',
    filter: '#f59e0b',
    time: '#3b82f6',
    mix: '#a78bfa',
    pan: '#22d3ee',
    meter: '#22c55e',
    reduction: '#ef4444',
  },

  text: {
    primary: '#e5e7eb',
    secondary: '#9ca3af',
    muted: '#6b7280',
    value: '#ffffff',
  },

  // Drag behavior
  drag: {
    sensitivity: 400,       // pixels for full range (normal)
    fineSensitivity: 1600,  // pixels for full range (shift held)
    wheelStep: 0.01,        // normalized step per wheel tick
    fineWheelStep: 0.002,   // normalized step per wheel tick (shift held)
  },
};

/**
 * Calculate drag delta with sensitivity
 */
export function calculateDragValue(startValue, deltaPixels, min, max, shiftKey = false) {
  const sensitivity = shiftKey ? controlTheme.drag.fineSensitivity : controlTheme.drag.sensitivity;
  const range = max - min;
  const delta = (deltaPixels / sensitivity) * range;
  return Math.max(min, Math.min(max, startValue + delta));
}

/**
 * Calculate wheel delta with sensitivity
 */
export function calculateWheelValue(currentValue, wheelDelta, min, max, shiftKey = false) {
  const step = shiftKey ? controlTheme.drag.fineWheelStep : controlTheme.drag.wheelStep;
  const range = max - min;
  const direction = wheelDelta > 0 ? -1 : 1;
  const delta = direction * step * range;
  return Math.max(min, Math.min(max, currentValue + delta));
}

export default controlTheme;
