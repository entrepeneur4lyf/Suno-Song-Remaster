const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;
const previewDir = path.join(os.tmpdir(), 'spotify-worthy-preview');

if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 800,
    minWidth: 1000,
    minHeight: 750,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#080808',
    icon: path.join(__dirname, 'image.png')
  });

  mainWindow.loadFile('index.html');
}

// Window control handlers
ipcMain.handle('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow.close();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// File selection dialog
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] }]
  });
  return result.filePaths[0] || null;
});

// Save file dialog
ipcMain.handle('save-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'WAV File', extensions: ['wav'] }]
  });
  return result.filePath || null;
});

// Two-pass loudness normalization
async function analyzeLoudness(inputPath) {
  return new Promise((resolve, reject) => {
    let output = '';
    ffmpeg(inputPath)
      .audioFilters('loudnorm=I=-14:TP=-2:LRA=11:print_format=json')
      .format('null')
      .on('stderr', (line) => { output += line; })
      .on('end', () => {
        try {
          const jsonMatch = output.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
          if (jsonMatch) {
            const stats = JSON.parse(jsonMatch[0]);
            resolve(stats);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      })
      .on('error', () => resolve(null))
      .save('-');
  });
}

// Process audio file
ipcMain.handle('process-audio', async (event, { inputPath, outputPath, settings }) => {
  const ceiling = settings.truePeakCeiling || -1.0;
  
  let loudnessStats = null;
  if (settings.normalizeLoudness) {
    mainWindow.webContents.send('processing-progress', 5);
    loudnessStats = await analyzeLoudness(inputPath);
  }
  
  return new Promise((resolve, reject) => {
    const filters = [];
    
    // 1. High-pass filter (clean low end)
    if (settings.cleanLowEnd) {
      filters.push('highpass=f=30');
    }
    
    // 2. Center bass frequencies
    if (settings.centerBass) {
      filters.push('crossfeed=strength=0.3');
    }
    
    // 3. 5-band EQ
    if (settings.eqLow && settings.eqLow !== 0) {
      filters.push(`equalizer=f=80:t=h:w=100:g=${settings.eqLow}`);
    }
    if (settings.eqLowMid && settings.eqLowMid !== 0) {
      filters.push(`equalizer=f=250:t=q:w=1:g=${settings.eqLowMid}`);
    }
    if (settings.eqMid && settings.eqMid !== 0) {
      filters.push(`equalizer=f=1000:t=q:w=1:g=${settings.eqMid}`);
    }
    if (settings.eqHighMid && settings.eqHighMid !== 0) {
      filters.push(`equalizer=f=4000:t=q:w=1:g=${settings.eqHighMid}`);
    }
    if (settings.eqHigh && settings.eqHigh !== 0) {
      filters.push(`equalizer=f=12000:t=h:w=2000:g=${settings.eqHigh}`);
    }
    
    // 4. Cut mud (250Hz)
    if (settings.cutMud) {
      filters.push('equalizer=f=250:t=q:w=1.5:g=-3');
    }
    
    // 4. Tame harshness (4-6kHz)
    if (settings.tameHarsh) {
      filters.push('equalizer=f=4000:t=q:w=2:g=-2');
      filters.push('equalizer=f=6000:t=q:w=1.5:g=-1.5');
    }
    
    // 5. Add air (12kHz)
    if (settings.addAir) {
      filters.push('treble=g=2.5:f=12000:t=s');
    }
    
    // 6. Glue compression
    if (settings.glueCompression) {
      filters.push('acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1');
    }
    
    // 7. Loudness normalization
    if (settings.normalizeLoudness) {
      if (loudnessStats) {
        filters.push(
          `loudnorm=I=-14:TP=-2:LRA=11:` +
          `measured_I=${loudnessStats.input_i}:` +
          `measured_TP=${loudnessStats.input_tp}:` +
          `measured_LRA=${loudnessStats.input_lra}:` +
          `measured_thresh=${loudnessStats.input_thresh}:` +
          `linear=true`
        );
      } else {
        filters.push('loudnorm=I=-14:TP=-2:LRA=20:linear=false');
      }
    }
    
    // 8. Final limiter
    if (settings.truePeakLimit) {
      const limitLinear = Math.pow(10, ceiling / 20);
      filters.push(`alimiter=limit=${limitLinear}:attack=0.1:release=50`);
    }

    let command = ffmpeg(inputPath);
    
    if (filters.length > 0) {
      command = command.audioFilters(filters);
    }
    
    const bitDepth = settings.bitDepth || 16;
    const sampleRate = settings.sampleRate || 44100;
    
    command
      .audioCodec('pcm_s' + bitDepth + 'le')
      .audioFrequency(sampleRate)
      .audioChannels(2)
      .format('wav')
      .on('progress', (progress) => {
        const actualProgress = settings.normalizeLoudness ? 10 + (progress.percent * 0.9) : progress.percent;
        mainWindow.webContents.send('processing-progress', actualProgress || 0);
      })
      .on('end', () => resolve({ success: true }))
      .on('error', (err) => reject({ success: false, error: err.message }))
      .save(outputPath);
  });
});

// Analyze audio file
ipcMain.handle('analyze-audio', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject({ error: err.message });
        return;
      }
      
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      resolve({
        duration: metadata.format.duration,
        bitRate: metadata.format.bit_rate,
        sampleRate: audioStream?.sample_rate,
        channels: audioStream?.channels,
        codec: audioStream?.codec_name,
        format: metadata.format.format_name
      });
    });
  });
});

// Cleanup on exit
app.on('before-quit', () => {
  try {
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
    }
  } catch (e) {}
});
