let selectedFilePath = null;
let audioContext = null;
let sourceNode = null;
let audioBuffer = null;
let isPlaying = false;
let startTime = 0;
let pauseTime = 0;
let analyser = null;

// Audio processing nodes
let gainNode = null;
let highpassNode = null;
let lowshelfNode = null;
let highshelfNode = null;
let midPeakNode = null;
let compressorNode = null;
let limiterNode = null;

// 5-band EQ nodes
let eqLowNode = null;
let eqLowMidNode = null;
let eqMidNode = null;
let eqHighMidNode = null;
let eqHighNode = null;

let isBypassed = false;
let seekUpdateInterval = null;
let isSeeking = false;

// Window Controls
document.getElementById('minimizeBtn').addEventListener('click', () => {
  window.electronAPI.minimizeWindow();
});

document.getElementById('maximizeBtn').addEventListener('click', () => {
  window.electronAPI.maximizeWindow();
});

document.getElementById('closeBtn').addEventListener('click', () => {
  window.electronAPI.closeWindow();
});

// DOM Elements
const selectFileBtn = document.getElementById('selectFile');
const changeFileBtn = document.getElementById('changeFile');
const fileZoneContent = document.getElementById('fileZoneContent');
const fileLoaded = document.getElementById('fileLoaded');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const dropZone = document.getElementById('dropZone');
const processBtn = document.getElementById('processBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusMessage = document.getElementById('statusMessage');

// Player elements
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const playIcon = document.getElementById('playIcon');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const bypassBtn = document.getElementById('bypassBtn');

// Settings
const normalizeLoudness = document.getElementById('normalizeLoudness');
const truePeakLimit = document.getElementById('truePeakLimit');
const truePeakSlider = document.getElementById('truePeakCeiling');
const ceilingValue = document.getElementById('ceilingValue');
const cleanLowEnd = document.getElementById('cleanLowEnd');
const glueCompression = document.getElementById('glueCompression');
const centerBass = document.getElementById('centerBass');
const cutMud = document.getElementById('cutMud');
const addAir = document.getElementById('addAir');
const tameHarsh = document.getElementById('tameHarsh');
const sampleRate = document.getElementById('sampleRate');
const bitDepth = document.getElementById('bitDepth');

// EQ elements
const eqLow = document.getElementById('eqLow');
const eqLowMid = document.getElementById('eqLowMid');
const eqMid = document.getElementById('eqMid');
const eqHighMid = document.getElementById('eqHighMid');
const eqHigh = document.getElementById('eqHigh');

// Mini checklist
const miniLufs = document.getElementById('mini-lufs');
const miniPeak = document.getElementById('mini-peak');
const miniFormat = document.getElementById('mini-format');

// Initialize Web Audio API
function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Create audio processing chain
function createAudioChain() {
  const ctx = initAudioContext();
  
  // Create analyser for visualization
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  
  // Create nodes
  gainNode = ctx.createGain();
  highpassNode = ctx.createBiquadFilter();
  lowshelfNode = ctx.createBiquadFilter();
  highshelfNode = ctx.createBiquadFilter();
  midPeakNode = ctx.createBiquadFilter();
  compressorNode = ctx.createDynamicsCompressor();
  limiterNode = ctx.createDynamicsCompressor();
  
  // 5-band EQ nodes
  eqLowNode = ctx.createBiquadFilter();
  eqLowMidNode = ctx.createBiquadFilter();
  eqMidNode = ctx.createBiquadFilter();
  eqHighMidNode = ctx.createBiquadFilter();
  eqHighNode = ctx.createBiquadFilter();
  
  // Configure EQ bands
  eqLowNode.type = 'lowshelf';
  eqLowNode.frequency.value = 80;
  
  eqLowMidNode.type = 'peaking';
  eqLowMidNode.frequency.value = 250;
  eqLowMidNode.Q.value = 1;
  
  eqMidNode.type = 'peaking';
  eqMidNode.frequency.value = 1000;
  eqMidNode.Q.value = 1;
  
  eqHighMidNode.type = 'peaking';
  eqHighMidNode.frequency.value = 4000;
  eqHighMidNode.Q.value = 1;
  
  eqHighNode.type = 'highshelf';
  eqHighNode.frequency.value = 12000;
  
  // Configure highpass (clean low end)
  highpassNode.type = 'highpass';
  highpassNode.frequency.value = 30;
  highpassNode.Q.value = 0.7;
  
  // Configure cut mud (250Hz cut)
  lowshelfNode.type = 'peaking';
  lowshelfNode.frequency.value = 250;
  lowshelfNode.Q.value = 1.5;
  lowshelfNode.gain.value = 0;
  
  // Configure add air (12kHz boost)
  highshelfNode.type = 'highshelf';
  highshelfNode.frequency.value = 12000;
  highshelfNode.gain.value = 0;
  
  // Configure tame harshness (4-6kHz cut)
  midPeakNode.type = 'peaking';
  midPeakNode.frequency.value = 4500;
  midPeakNode.Q.value = 1.5;
  midPeakNode.gain.value = 0;
  
  // Configure glue compressor
  compressorNode.threshold.value = -18;
  compressorNode.knee.value = 10;
  compressorNode.ratio.value = 3;
  compressorNode.attack.value = 0.02;
  compressorNode.release.value = 0.25;
  
  // Configure limiter
  limiterNode.threshold.value = -1;
  limiterNode.knee.value = 0;
  limiterNode.ratio.value = 20;
  limiterNode.attack.value = 0.001;
  limiterNode.release.value = 0.05;
  
  updateAudioChain();
  updateEQ();
}

// Update audio chain based on settings
function updateAudioChain() {
  if (!audioContext) return;
  
  // Highpass (clean low end)
  highpassNode.frequency.value = (cleanLowEnd.checked && !isBypassed) ? 30 : 1;
  
  // Cut Mud
  lowshelfNode.gain.value = (cutMud.checked && !isBypassed) ? -3 : 0;
  
  // Add Air
  highshelfNode.gain.value = (addAir.checked && !isBypassed) ? 2.5 : 0;
  
  // Tame Harshness
  midPeakNode.gain.value = (tameHarsh.checked && !isBypassed) ? -2.5 : 0;
  
  // Glue Compression
  if (glueCompression.checked && !isBypassed) {
    compressorNode.threshold.value = -18;
    compressorNode.ratio.value = 3;
  } else {
    compressorNode.threshold.value = 0;
    compressorNode.ratio.value = 1;
  }
  
  // Limiter
  if (truePeakLimit.checked && !isBypassed) {
    const ceiling = parseFloat(truePeakSlider.value);
    limiterNode.threshold.value = ceiling;
    limiterNode.ratio.value = 20;
  } else {
    limiterNode.threshold.value = 0;
    limiterNode.ratio.value = 1;
  }
}

// Connect audio chain
function connectAudioChain(source) {
  source
    .connect(highpassNode)
    .connect(eqLowNode)
    .connect(eqLowMidNode)
    .connect(eqMidNode)
    .connect(eqHighMidNode)
    .connect(eqHighNode)
    .connect(lowshelfNode)
    .connect(midPeakNode)
    .connect(highshelfNode)
    .connect(compressorNode)
    .connect(limiterNode)
    .connect(analyser)
    .connect(gainNode)
    .connect(audioContext.destination);
}

// Update 5-band EQ
function updateEQ() {
  if (!eqLowNode) return;
  
  if (isBypassed) {
    eqLowNode.gain.value = 0;
    eqLowMidNode.gain.value = 0;
    eqMidNode.gain.value = 0;
    eqHighMidNode.gain.value = 0;
    eqHighNode.gain.value = 0;
  } else {
    eqLowNode.gain.value = parseFloat(eqLow.value);
    eqLowMidNode.gain.value = parseFloat(eqLowMid.value);
    eqMidNode.gain.value = parseFloat(eqMid.value);
    eqHighMidNode.gain.value = parseFloat(eqHighMid.value);
    eqHighNode.gain.value = parseFloat(eqHigh.value);
  }
  
  // Update display values
  document.getElementById('eqLowVal').textContent = `${eqLow.value} dB`;
  document.getElementById('eqLowMidVal').textContent = `${eqLowMid.value} dB`;
  document.getElementById('eqMidVal').textContent = `${eqMid.value} dB`;
  document.getElementById('eqHighMidVal').textContent = `${eqHighMid.value} dB`;
  document.getElementById('eqHighVal').textContent = `${eqHigh.value} dB`;
}

// EQ Presets
const eqPresets = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -2, lowMid: -1, mid: 2, highMid: 3, high: 1 },
  bass: { low: 6, lowMid: 3, mid: 0, highMid: -1, high: -2 },
  bright: { low: -1, lowMid: 0, mid: 1, highMid: 3, high: 5 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -2, high: -3 },
  suno: { low: 1, lowMid: -2, mid: 1, highMid: -1, high: 2 }
};

// EQ preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = eqPresets[btn.dataset.preset];
    if (preset) {
      eqLow.value = preset.low;
      eqLowMid.value = preset.lowMid;
      eqMid.value = preset.mid;
      eqHighMid.value = preset.highMid;
      eqHigh.value = preset.high;
      updateEQ();
      
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });
});

// EQ slider events
[eqLow, eqLowMid, eqMid, eqHighMid, eqHigh].forEach(slider => {
  slider.addEventListener('input', () => {
    updateEQ();
    // Remove active from presets when manually adjusting
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  });
});

// Load audio file into Web Audio API
async function loadAudioFile(filePath) {
  const ctx = initAudioContext();
  
  try {
    const response = await fetch(`file://${filePath}`);
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    createAudioChain();
    
    // Update duration display
    const duration = audioBuffer.duration;
    durationEl.textContent = formatTime(duration);
    seekBar.max = duration;
    
    playBtn.disabled = false;
    stopBtn.disabled = false;
    processBtn.disabled = false;
    
    return true;
  } catch (error) {
    console.error('Error loading audio:', error);
    return false;
  }
}

// Play audio
function playAudio() {
  if (!audioBuffer || !audioContext) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  stopAudio();
  
  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  
  connectAudioChain(sourceNode);
  
  sourceNode.onended = () => {
    if (isPlaying) {
      isPlaying = false;
      playIcon.textContent = '▶️';
      clearInterval(seekUpdateInterval);
    }
  };
  
  const offset = pauseTime;
  startTime = audioContext.currentTime - offset;
  sourceNode.start(0, offset);
  isPlaying = true;
  playIcon.textContent = '⏸️';
  
  // Update seek bar
  seekUpdateInterval = setInterval(() => {
    if (isPlaying && audioBuffer && !isSeeking) {
      const currentTime = audioContext.currentTime - startTime;
      if (currentTime >= audioBuffer.duration) {
        stopAudio();
        pauseTime = 0;
        seekBar.value = 0;
        currentTimeEl.textContent = '0:00';
      } else {
        seekBar.value = currentTime;
        currentTimeEl.textContent = formatTime(currentTime);
      }
    }
  }, 100);
}

// Pause audio
function pauseAudio() {
  if (!isPlaying) return;
  
  pauseTime = audioContext.currentTime - startTime;
  stopAudio();
}

// Stop audio
function stopAudio() {
  if (sourceNode) {
    try {
      sourceNode.stop();
      sourceNode.disconnect();
    } catch (e) {}
    sourceNode = null;
  }
  isPlaying = false;
  playIcon.textContent = '▶️';
  clearInterval(seekUpdateInterval);
}

// Seek to position
function seekTo(time) {
  pauseTime = time;
  
  if (isPlaying) {
    // Stop current source
    if (sourceNode) {
      try {
        sourceNode.stop();
        sourceNode.disconnect();
      } catch (e) {}
    }
    clearInterval(seekUpdateInterval);
    
    // Create new source and start from new position
    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    connectAudioChain(sourceNode);
    
    sourceNode.onended = () => {
      if (isPlaying) {
        isPlaying = false;
        playIcon.textContent = '▶️';
        clearInterval(seekUpdateInterval);
      }
    };
    
    startTime = audioContext.currentTime - time;
    sourceNode.start(0, time);
    
    // Restart interval
    seekUpdateInterval = setInterval(() => {
      if (isPlaying && audioBuffer && !isSeeking) {
        const currentTime = audioContext.currentTime - startTime;
        if (currentTime >= audioBuffer.duration) {
          stopAudio();
          pauseTime = 0;
          seekBar.value = 0;
          currentTimeEl.textContent = '0:00';
        } else {
          seekBar.value = currentTime;
          currentTimeEl.textContent = formatTime(currentTime);
        }
      }
    }, 100);
  } else {
    currentTimeEl.textContent = formatTime(time);
  }
}

// Format time as M:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// File selection
selectFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) {
    await loadFile(filePath);
  }
});

changeFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) {
    stopAudio();
    pauseTime = 0;
    await loadFile(filePath);
  }
});

// Load file and update UI
async function loadFile(filePath) {
  selectedFilePath = filePath;
  
  // Get file info
  const fileInfo = await window.electronAPI.analyzeAudio(filePath);
  
  // Update UI
  const name = filePath.split(/[\\/]/).pop();
  fileName.textContent = name;
  fileMeta.textContent = `${fileInfo.codec?.toUpperCase()} • ${Math.round(fileInfo.sampleRate / 1000)}kHz • ${formatTime(fileInfo.duration)}`;
  
  fileZoneContent.classList.add('hidden');
  fileLoaded.classList.remove('hidden');
  
  // Load into Web Audio
  await loadAudioFile(filePath);
  
  // Update checklist
  updateChecklist();
}

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  
  const file = e.dataTransfer.files[0];
  if (file && /\.(mp3|wav|flac|aac|m4a)$/i.test(file.name)) {
    stopAudio();
    pauseTime = 0;
    await loadFile(file.path);
  }
});

// Player controls
playBtn.addEventListener('click', () => {
  if (isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
});

stopBtn.addEventListener('click', () => {
  stopAudio();
  pauseTime = 0;
  seekBar.value = 0;
  currentTimeEl.textContent = '0:00';
});

seekBar.addEventListener('change', () => {
  isSeeking = false;
  seekTo(parseFloat(seekBar.value));
});

// Also update time display while dragging
seekBar.addEventListener('input', () => {
  isSeeking = true;
  currentTimeEl.textContent = formatTime(parseFloat(seekBar.value));
});

seekBar.addEventListener('mousedown', () => {
  isSeeking = true;
});

seekBar.addEventListener('mouseup', () => {
  isSeeking = false;
});

bypassBtn.addEventListener('click', () => {
  isBypassed = !isBypassed;
  bypassBtn.textContent = isBypassed ? '🔇 FX Off' : '🔊 FX On';
  bypassBtn.classList.toggle('active', isBypassed);
  updateAudioChain();
  updateEQ();
});

// Export/Process button
processBtn.addEventListener('click', async () => {
  if (!selectedFilePath) return;
  
  const outputPath = await window.electronAPI.saveFile();
  if (!outputPath) return;
  
  progressContainer.classList.remove('hidden');
  processBtn.disabled = true;
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';
  
  const settings = {
    normalizeLoudness: normalizeLoudness.checked,
    truePeakLimit: truePeakLimit.checked,
    truePeakCeiling: parseFloat(truePeakSlider.value),
    cleanLowEnd: cleanLowEnd.checked,
    glueCompression: glueCompression.checked,
    centerBass: centerBass.checked,
    cutMud: cutMud.checked,
    addAir: addAir.checked,
    tameHarsh: tameHarsh.checked,
    sampleRate: parseInt(sampleRate.value),
    bitDepth: parseInt(bitDepth.value),
    // EQ settings
    eqLow: parseFloat(eqLow.value),
    eqLowMid: parseFloat(eqLowMid.value),
    eqMid: parseFloat(eqMid.value),
    eqHighMid: parseFloat(eqHighMid.value),
    eqHigh: parseFloat(eqHigh.value)
  };
  
  try {
    const result = await window.electronAPI.processAudio({
      inputPath: selectedFilePath,
      outputPath: outputPath,
      settings: settings
    });
    if (result.success) {
      statusMessage.textContent = '✓ Export complete! Your mastered file is ready.';
      statusMessage.className = 'status-message success';
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    statusMessage.textContent = `✗ Error: ${error.message || error}`;
    statusMessage.className = 'status-message error';
  }
  
  progressContainer.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  processBtn.disabled = false;
});

// Progress handler
window.electronAPI.onProgress((progress) => {
  const percent = Math.round(progress);
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
});

// Update checklist based on settings
function updateChecklist() {
  miniLufs.classList.toggle('active', normalizeLoudness.checked);
  miniPeak.classList.toggle('active', truePeakLimit.checked);
  miniFormat.classList.toggle('active', selectedFilePath !== null);
}

// Settings change handlers
[normalizeLoudness, truePeakLimit, cleanLowEnd, glueCompression, centerBass, cutMud, addAir, tameHarsh].forEach(el => {
  el.addEventListener('change', () => {
    updateAudioChain();
    updateChecklist();
  });
});

truePeakSlider.addEventListener('input', () => {
  ceilingValue.textContent = `${truePeakSlider.value} dB`;
  updateAudioChain();
});

// Tooltip system
const tooltip = document.getElementById('tooltip');
const showTipsCheckbox = document.getElementById('showTips');
let tooltipTimeout = null;

// Load saved preference
const savedTipsPref = localStorage.getItem('showTips');
if (savedTipsPref !== null) {
  showTipsCheckbox.checked = savedTipsPref === 'true';
}

showTipsCheckbox.addEventListener('change', () => {
  localStorage.setItem('showTips', showTipsCheckbox.checked);
  if (!showTipsCheckbox.checked) {
    tooltip.classList.remove('visible');
  }
});

document.querySelectorAll('[data-tip]').forEach(el => {
  el.addEventListener('mouseenter', () => {
    if (!showTipsCheckbox.checked) return;
    
    const tipText = el.getAttribute('data-tip');
    if (!tipText) return;
    
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.textContent = tipText;
      
      const rect = el.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 8;
      
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.classList.add('visible');
      
      const tooltipRect = tooltip.getBoundingClientRect();
      
      if (left + tooltipRect.width > window.innerWidth - 20) {
        left = window.innerWidth - tooltipRect.width - 20;
      }
      if (top + tooltipRect.height > window.innerHeight - 20) {
        top = rect.top - tooltipRect.height - 8;
      }
      
      tooltip.style.left = `${Math.max(10, left)}px`;
      tooltip.style.top = `${top}px`;
    }, 400);
  });
  
  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeout);
    tooltip.classList.remove('visible');
  });
});

// Initialize
updateChecklist();
