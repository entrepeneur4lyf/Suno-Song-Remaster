class EQVisualizer {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.canvas = null;
        this.ctx = null;
        this.sampleRate = 48000; // Default, will be updated
        
        // Configuration
        this.minFreq = 20;
        this.maxFreq = 20000;
        this.bars = 64; // Number of frequency bands from 20Hz to 20kHz
        this.useLogScale = true;
        this.smoothing = false;
        this.smoothingBuffer = [];
        this.style = 'bars'; // 'bars' or 'curve'

        // Color mode: 'gradient' (default) or 'linear'
        this.colorMode = 'gradient';

        // Colors pulled from CSS variables (matches LUFS meter colors)
        const styles = getComputedStyle(document.documentElement);
        this.colors = {
            green: styles.getPropertyValue('--meter-green')?.trim() || '#22c55e',
            yellow: styles.getPropertyValue('--meter-yellow')?.trim() || '#eab308',
            red: styles.getPropertyValue('--meter-red')?.trim() || '#ef4444',
            bg: styles.getPropertyValue('--eq-bg')?.trim() || '#1a1a1a'
        };
        
        // Try to initialize
        this.init();
    }
        setColorMode(mode) {
            // mode: 'gradient' (default) or 'linear'
            this.colorMode = mode === 'linear' ? 'linear' : 'gradient';
        }
    
    init() {
        this.canvas = document.getElementById(this.canvasId);
        if (!this.canvas) {
            console.warn(`EQ Visualizer: Canvas element with id "${this.canvasId}" not found`);
            return false;
        }
        this.ctx = this.canvas.getContext('2d');
        
        // Set canvas resolution to match CSS dimensions with device pixel ratio
        if (!this.ensureCanvasSize()) {
            console.warn('EQ Visualizer: Canvas dimensions not ready, will retry on first draw');
            return false;
        }

        console.log(`EQ Visualizer initialized: ${this.canvas.width}x${this.canvas.height}`);
        return true;
    }

    ensureCanvasSize() {
        if (!this.canvas || !this.ctx) return false;

        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        const dpr = window.devicePixelRatio || 1;
        const displayWidth = Math.round(rect.width);
        const displayHeight = Math.round(rect.height);
        const renderWidth = Math.round(rect.width * dpr);
        const renderHeight = Math.round(rect.height * dpr);

        const needsResize = this.canvas.width !== renderWidth || this.canvas.height !== renderHeight;

        if (needsResize) {
            // Update CSS size explicitly to keep layout stable
            this.canvas.style.width = `${displayWidth}px`;
            this.canvas.style.height = `${displayHeight}px`;

            // Set actual render size and reset transform for crisp drawing
            this.canvas.width = renderWidth;
            this.canvas.height = renderHeight;
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        return true;
    }
    
    setSampleRate(sampleRate) {
        this.sampleRate = sampleRate;
        console.log(`EQ Visualizer sample rate set to: ${sampleRate}`);
    }

    setScale(mode) {
        this.useLogScale = mode === 'log';
    }

    setBars(count) {
        this.bars = Math.max(16, Math.min(256, parseInt(count) || 64));
        this.smoothingBuffer = [];
    }

    setSmoothing(enabled) {
        this.smoothing = enabled;
        if (!enabled) this.smoothingBuffer = [];
    }

    setStyle(style) {
        this.style = style === 'curve' ? 'curve' : 'bars';
    }

    draw(frequencyData) {
        // Reinitialize if needed
        if (!this.canvas || !this.ctx) {
            if (!this.init()) return;
        }
        
        // Ensure canvas is correctly sized for device pixel ratio
        if (!this.ensureCanvasSize()) return;
        
        const width = this.canvas.getBoundingClientRect().width;
        const height = this.canvas.getBoundingClientRect().height;
        
        const barWidth = width / this.bars;
        const binCount = frequencyData.length;
        
        // Clear canvas
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, width, height);
        
        // Draw vertical grid lines at labeled frequencies
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1;
        const labelFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        labelFreqs.forEach(freq => {
            const freqRatio = this.useLogScale
                ? (Math.log10(freq) - Math.log10(this.minFreq)) / (Math.log10(this.maxFreq) - Math.log10(this.minFreq))
                : (freq - this.minFreq) / (this.maxFreq - this.minFreq);
            const x = freqRatio * width;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height - 15);
            this.ctx.stroke();
        });
        
        // Collect magnitude data for all bars
        const magnitudes = [];
        const positions = [];
        
        for (let i = 0; i < this.bars; i++) {
            // Map bar index to frequency range (log or linear)
            const freqRatio = i / (this.bars - 1);
            const freq = this.useLogScale
                ? Math.pow(10, Math.log10(this.minFreq) + freqRatio * (Math.log10(this.maxFreq) - Math.log10(this.minFreq)))
                : this.minFreq + freqRatio * (this.maxFreq - this.minFreq);
            
            // Map frequency to FFT bin
            const nyquist = this.sampleRate / 2;
            const binIndex = Math.floor((freq / nyquist) * binCount);
            
            // Get magnitude for this frequency
            let magnitude = binIndex < binCount ? frequencyData[binIndex] : 0;
            
            // Apply smoothing if enabled
            if (this.smoothing) {
                if (!this.smoothingBuffer[i]) this.smoothingBuffer[i] = magnitude;
                this.smoothingBuffer[i] = this.smoothingBuffer[i] * 0.7 + magnitude * 0.3;
                magnitude = this.smoothingBuffer[i];
            }
            
            magnitudes.push(magnitude);
            positions.push(i * barWidth + barWidth / 2);
        }
        
        if (this.style === 'curve') {
            this.drawCurve(positions, magnitudes, width, height);
        } else {
            this.drawBars(positions, magnitudes, width, height, barWidth);
        }
        
        // Draw frequency labels
        this.ctx.fillStyle = '#888';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'center';
        
        labelFreqs.forEach(freq => {
            const freqRatio = this.useLogScale
                ? (Math.log10(freq) - Math.log10(this.minFreq)) / (Math.log10(this.maxFreq) - Math.log10(this.minFreq))
                : (freq - this.minFreq) / (this.maxFreq - this.minFreq);
            const x = freqRatio * width;
            
            let label = freq >= 1000 ? `${freq/1000}k` : `${freq}`;
            this.ctx.fillText(label, x, height - 3);
        });
    }
    
    drawBars(positions, magnitudes, width, height, barWidth) {
        if (this.colorMode === 'linear') {
            // Draw each bar with a color based on its height (green → orange → red)
            for (let i = 0; i < positions.length; i++) {
                const normalized = magnitudes[i] / 255;
                let color;
                if (normalized < 0.5) {
                    // Green to orange
                    const t = normalized / 0.5;
                    color = this._lerpColor(this.colors.green, this.colors.yellow, t);
                } else {
                    // Orange to red
                    const t = (normalized - 0.5) / 0.5;
                    color = this._lerpColor(this.colors.yellow, this.colors.red, t);
                }
                const normalizedHeight = normalized * height;
                this.ctx.fillStyle = color;
                this.ctx.fillRect(
                    positions[i] - barWidth / 2 + 1,
                    height - normalizedHeight,
                    barWidth - 2,
                    normalizedHeight
                );
            }
        } else {
            // Default: vertical gradient for all bars
            const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, this.colors.green);
            gradient.addColorStop(0.75, this.colors.green);
            gradient.addColorStop(0.75, this.colors.yellow);
            gradient.addColorStop(0.9, this.colors.yellow);
            gradient.addColorStop(0.9, this.colors.red);
            gradient.addColorStop(1, this.colors.red);
            for (let i = 0; i < positions.length; i++) {
                const normalizedHeight = (magnitudes[i] / 255) * height;
                this.ctx.fillStyle = gradient;
                this.ctx.fillRect(
                    positions[i] - barWidth / 2 + 1,
                    height - normalizedHeight,
                    barWidth - 2,
                    normalizedHeight
                );
            }
        }
    }
    
    drawCurve(positions, magnitudes, width, height) {
        if (positions.length < 2) return;
        // Calculate curve points
        const points = [];
        for (let i = 0; i < positions.length; i++) {
            const normalizedHeight = (magnitudes[i] / 255) * height;
            points.push({
                x: positions[i],
                y: height - normalizedHeight,
                magnitude: magnitudes[i] / 255
            });
        }

        if (this.colorMode === 'linear') {
            // Draw curve in segments with colors based on peak height
            // Fill area under curve first
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                
                // Calculate control points for smooth bezier curve
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                
                // Color based on average magnitude of the segment
                const avgMagnitude = (p1.magnitude + p2.magnitude) / 2;
                let color;
                if (avgMagnitude < 0.5) {
                    const t = avgMagnitude / 0.5;
                    color = this._lerpColor(this.colors.green, this.colors.yellow, t);
                } else {
                    const t = (avgMagnitude - 0.5) / 0.5;
                    color = this._lerpColor(this.colors.yellow, this.colors.red, t);
                }
                
                // Draw filled segment
                this.ctx.beginPath();
                this.ctx.moveTo(p1.x, height);
                this.ctx.lineTo(p1.x, p1.y);
                this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
                this.ctx.lineTo(p2.x, height);
                this.ctx.closePath();
                this.ctx.fillStyle = color;
                this.ctx.fill();
            }
            
            // Draw stroke on top for definition
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        } else {
            // Default: vertical gradient
            const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, this.colors.green);
            gradient.addColorStop(0.75, this.colors.green);
            gradient.addColorStop(0.75, this.colors.yellow);
            gradient.addColorStop(0.9, this.colors.yellow);
            gradient.addColorStop(0.9, this.colors.red);
            gradient.addColorStop(1, this.colors.red);

            // Draw filled bezier curve
            this.ctx.beginPath();
            this.ctx.moveTo(0, height);
            this.ctx.lineTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            this.ctx.lineTo(width, height);
            this.ctx.closePath();
            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Draw stroke on top for definition
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
            this.ctx.strokeStyle = this.colors.green;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    }
        // Helper: interpolate between two hex colors (returns hex string)
        _lerpColor(a, b, t) {
            // a, b: hex color strings (e.g. #22c55e)
            // t: 0..1
            const ah = a.replace('#', '');
            const bh = b.replace('#', '');
            const ar = parseInt(ah.substring(0, 2), 16);
            const ag = parseInt(ah.substring(2, 4), 16);
            const ab = parseInt(ah.substring(4, 6), 16);
            const br = parseInt(bh.substring(0, 2), 16);
            const bg = parseInt(bh.substring(2, 4), 16);
            const bb = parseInt(bh.substring(4, 6), 16);
            const rr = Math.round(ar + (br - ar) * t);
            const rg = Math.round(ag + (bg - ag) * t);
            const rb = Math.round(ab + (bb - ab) * t);
            return `#${((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1)}`;
        }
    
    clear() {
        if (!this.canvas || !this.ctx) return;
        if (!this.ensureCanvasSize()) return;
        const width = this.canvas.getBoundingClientRect().width;
        const height = this.canvas.getBoundingClientRect().height;
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, width, height);
    }
}

// Export the EQVisualizer class
export default EQVisualizer;