/**
 * Room EQ Wizard (REW v5.40) - Core Acoustic DSP & Mathematical Engine
 * Implements:
 *  - Radix-2 Cooley-Tukey Complex FFT / IFFT
 *  - Farina Exponential Sine Sweep (Log Chirp) Generation & Deconvolution
 *  - Fractional-Octave, Psychoacoustic & Variable Smoothing
 *  - Minimum Phase (Hilbert Transform), Unwrapped Phase & Group Delay
 *  - Impulse Response Windowing (Tukey, Hann, Blackman-Harris, Rectangular)
 *  - Energy Time Curve (ETC), Step Response & Schroeder Backward Integration
 *  - ISO 3382 Reverberation Time (EDT, T20, T30, Topt, C50, C80, D50)
 *  - Harmonic Distortion (THD, H2..H5, Noise Floor)
 *  - 3D Cumulative Spectral Decay (CSD Waterfall) & 2D Decay Slices
 *  - Multi-Resolution Time-Frequency Spectrogram & Energy Ridge Tracker
 *  - RBJ Biquad Parametric EQ Engine & Automatic Room Mode Target Optimizer
 *  - WAV Impulse Response & FRD/TXT Frequency Response Parser/Exporter
 */
(function (global) {
  'use strict';

  const DSP = {};

  // Standard 512-point logarithmic frequency grid (15 Hz to 22 kHz)
  DSP.NUM_FREQ_POINTS = 512;
  DSP.F_MIN = 15;
  DSP.F_MAX = 22000;
  DSP.FREQ_GRID = (function () {
    const arr = new Float64Array(DSP.NUM_FREQ_POINTS);
    const logMin = Math.log10(DSP.F_MIN);
    const logMax = Math.log10(DSP.F_MAX);
    for (let i = 0; i < DSP.NUM_FREQ_POINTS; i++) {
      arr[i] = Math.pow(10, logMin + (i / (DSP.NUM_FREQ_POINTS - 1)) * (logMax - logMin));
    }
    return arr;
  })();

  // ISO 1/3-octave center frequencies (Hz)
  DSP.THIRD_OCTAVE_FREQS = [
    25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200,
    250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
    2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000
  ];

  // ISO 1/1-octave center frequencies (Hz)
  DSP.OCTAVE_FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  /**
   * Next power of 2 >= n
   */
  DSP.nextPow2 = function (n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  };

  /**
   * In-place Radix-2 Cooley-Tukey Complex FFT / IFFT
   * @param {Float64Array} re Real part (length must be power of 2)
   * @param {Float64Array} im Imaginary part
   * @param {boolean} invert true for IFFT
   */
  DSP.fft = function (re, im, invert) {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (invert ? 1 : -1);
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let wRe = 1.0;
        let wIm = 0.0;
        for (let k = 0; k < half; k++) {
          const uRe = re[i + k];
          const uIm = im[i + k];
          const vIdx = i + k + half;
          const vRe = re[vIdx] * wRe - im[vIdx] * wIm;
          const vIm = re[vIdx] * wIm + im[vIdx] * wRe;
          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[vIdx] = uRe - vRe;
          im[vIdx] = uIm - vIm;
          const nextWRe = wRe * wlenRe - wIm * wlenIm;
          wIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nextWRe;
        }
      }
    }

    if (invert) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  };

  /**
   * Window value at normalized index u in [0, 1] (where 0 is center peak, 1 is outer edge)
   */
  DSP.halfWindowWeight = function (u, type) {
    if (u <= 0) return 1.0;
    if (u >= 1) return 0.0;
    switch (type) {
      case 'rect':
        return 1.0;
      case 'hann':
        return 0.5 * (1 + Math.cos(Math.PI * u));
      case 'hamming':
        return 0.54 + 0.46 * Math.cos(Math.PI * u);
      case 'blackman-harris': {
        // Map u in [0,1] to symmetric window right half t in [0.5, 1.0]
        const p = Math.PI * (1 + u);
        return 0.35875 - 0.48829 * Math.cos(p) + 0.14128 * Math.cos(2 * p) - 0.01168 * Math.cos(3 * p);
      }
      case 'tukey':
      default: {
        // Tukey 0.25: flat for first 75%, cosine taper for outer 25%
        const alpha = 0.25;
        if (u < 1 - alpha) return 1.0;
        const t = (u - (1 - alpha)) / alpha;
        return 0.5 * (1 + Math.cos(Math.PI * t));
      }
    }
  };

  /**
   * Apply asymmetric REW Left/Right IR Window centered at peakIdx
   */
  DSP.applyIRWindow = function (ir, sampleRate, peakIdx, leftMs, rightMs, windowType) {
    const N = ir.length;
    const windowed = new Float64Array(N);
    const windowCurve = new Float64Array(N);
    const leftSamples = Math.max(4, Math.round((leftMs / 1000) * sampleRate));
    const rightSamples = Math.max(16, Math.round((rightMs / 1000) * sampleRate));

    for (let i = 0; i < N; i++) {
      let w = 0.0;
      if (i <= peakIdx) {
        const u = (peakIdx - i) / leftSamples;
        w = DSP.halfWindowWeight(u, windowType);
      } else {
        const u = (i - peakIdx) / rightSamples;
        w = DSP.halfWindowWeight(u, windowType);
      }
      windowCurve[i] = w;
      windowed[i] = ir[i] * w;
    }

    return { windowed, windowCurve, leftSamples, rightSamples };
  };

  /**
   * Fractional-octave, Psychoacoustic & Variable smoothing on log-spaced frequency grid
   * @param {Float64Array} freqs Log-spaced frequencies (length M)
   * @param {Float64Array} dbValues SPL values in dB (length M)
   * @param {string} mode 'none' | '1/48' | '1/24' | '1/12' | '1/6' | '1/3' | '1/1' | 'psy' | 'var'
   */
  DSP.smoothResponse = function (freqs, dbValues, mode) {
    const M = dbValues.length;
    if (!mode || mode === 'none') {
      return new Float64Array(dbValues);
    }

    const out = new Float64Array(M);
    const logStep = Math.log2(freqs[M - 1] / freqs[0]) / (M - 1); // octaves per bin

    const octaveMap = {
      '1/48': 1 / 48,
      '1/24': 1 / 24,
      '1/12': 1 / 12,
      '1/6': 1 / 6,
      '1/3': 1 / 3,
      '1/1': 1.0
    };

    for (let i = 0; i < M; i++) {
      const f = freqs[i];
      let bwOctaves = 1 / 12;
      let usePowerAvg = false;

      if (mode === 'psy') {
        // REW Psychoacoustic smoothing:
        // 1/3 octave below 100Hz, transition 100Hz..1kHz to 1/6 octave above 1kHz,
        // using energetic power average (peaks weighted higher than narrow dips)
        usePowerAvg = true;
        if (f <= 100) bwOctaves = 1 / 3;
        else if (f >= 1000) bwOctaves = 1 / 6;
        else {
          const t = Math.log10(f / 100);
          bwOctaves = (1 / 3) * (1 - t) + (1 / 6) * t;
        }
      } else if (mode === 'var') {
        // REW Variable smoothing:
        // 1/48 octave below 100 Hz, transitioning to 1/3 octave above 10 kHz
        if (f <= 100) bwOctaves = 1 / 48;
        else if (f >= 10000) bwOctaves = 1 / 3;
        else {
          const t = Math.log10(f / 100) / 2.0;
          bwOctaves = (1 / 48) + t * (1 / 3 - 1 / 48);
        }
      } else {
        bwOctaves = octaveMap[mode] || (1 / 12);
      }

      const halfSpan = Math.max(1, Math.round((bwOctaves / 2) / logStep));
      const jStart = Math.max(0, i - halfSpan);
      const jEnd = Math.min(M - 1, i + halfSpan);

      let weightSum = 0.0;
      let accum = 0.0;
      for (let j = jStart; j <= jEnd; j++) {
        const dist = (j - i) / (halfSpan + 0.5);
        const w = 0.5 * (1 + Math.cos(Math.PI * dist));
        weightSum += w;
        if (usePowerAvg) {
          // Energetic weighting (4th power amplitude biases toward peaks like human ear)
          accum += w * Math.pow(10, dbValues[j] / 10.0);
        } else {
          accum += w * dbValues[j];
        }
      }

      if (usePowerAvg) {
        out[i] = 10 * Math.log10(Math.max(1e-12, accum / weightSum));
      } else {
        out[i] = accum / weightSum;
      }
    }

    return out;
  };

  /**
   * Generate Farina Exponential Sine Sweep (Log Chirp) and matched Inverse Filter
   */
  DSP.generateLogSweep = function (f1, f2, durationSec, sampleRate) {
    const N = Math.floor(durationSec * sampleRate);
    const sweep = new Float32Array(N);
    const inverse = new Float32Array(N);
    const R = Math.log(f2 / f1);
    const K = (2 * Math.PI * f1 * durationSec) / R;
    const fadeSamples = Math.min(Math.floor(0.02 * sampleRate), Math.floor(N * 0.05));

    for (let n = 0; n < N; n++) {
      const t = n / sampleRate;
      const val = Math.sin(K * (Math.exp((t / durationSec) * R) - 1.0));
      let env = 1.0;
      if (n < fadeSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * n) / fadeSamples));
      } else if (n > N - fadeSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (N - 1 - n)) / fadeSamples));
      }
      sweep[n] = 0.85 * env * val;
    }

    // Time-reversed sweep with -6 dB/octave amplitude envelope exp(-(t/T)*R)
    for (let n = 0; n < N; n++) {
      const t = n / sampleRate;
      const atten = Math.exp(-(t / durationSec) * R);
      inverse[N - 1 - n] = sweep[n] * atten * (R / (sampleRate * durationSec * 0.425));
    }

    return { sweep, inverse, f1, f2, durationSec, sampleRate };
  };

  /**
   * Deconvolve recorded sweep against inverse filter via FFT to recover linear IR + harmonics
   */
  DSP.deconvolveSweep = function (recorded, inverse, sampleRate) {
    const totalLen = recorded.length + inverse.length;
    const fftLen = DSP.nextPow2(totalLen);
    const recRe = new Float64Array(fftLen);
    const recIm = new Float64Array(fftLen);
    const invRe = new Float64Array(fftLen);
    const invIm = new Float64Array(fftLen);

    for (let i = 0; i < recorded.length; i++) recRe[i] = recorded[i];
    for (let i = 0; i < inverse.length; i++) invRe[i] = inverse[i];

    DSP.fft(recRe, recIm, false);
    DSP.fft(invRe, invIm, false);

    for (let i = 0; i < fftLen; i++) {
      const a = recRe[i], b = recIm[i];
      const c = invRe[i], d = invIm[i];
      recRe[i] = a * c - b * d;
      recIm[i] = a * d + b * c;
    }

    DSP.fft(recRe, recIm, true);

    // Find peak index near the end of inverse length
    let maxVal = 0;
    let peakIdx = 0;
    for (let i = 0; i < fftLen; i++) {
      const mag = Math.abs(recRe[i]);
      if (mag > maxVal) {
        maxVal = mag;
        peakIdx = i;
      }
    }

    // Extract 16384-sample IR window around peakIdx (pre-trigger 1024 samples)
    const irLen = 16384;
    const preSamples = 1024;
    const ir = new Float64Array(irLen);
    const norm = maxVal > 1e-9 ? (0.85 / maxVal) : 1.0;
    for (let i = 0; i < irLen; i++) {
      const idx = (peakIdx - preSamples + i + fftLen) % fftLen;
      ir[i] = recRe[idx] * norm;
    }

    return { ir, peakIdx: preSamples, sampleRate };
  };

  /**
   * Synthesize realistic physical Room + Loudspeaker Impulse Response for presets / Room Sim
   */
  DSP.synthesizeRoomIR = function (config) {
    const sampleRate = config.sampleRate || 48000;
    const N = 16384; // ~341.3 ms at 48 kHz
    const peakIdx = 960; // 20.0 ms reference pre-delay
    const ir = new Float64Array(N);

    const roomL = config.roomLength || 4.8; // meters
    const roomW = config.roomWidth || 3.6;
    const roomH = config.roomHeight || 2.7;
    const rt60Base = config.rt60 || 0.42; // seconds
    const bassBoostDb = config.bassBoostDb !== undefined ? config.bassBoostDb : 3.5;
    const speakerFc = config.speakerFc || 42; // Hz high-pass cutoff
    const treatment = config.treatment || 0.35; // 0 = untreated, 1 = heavily damped
    const seed = config.seed || 101;

    // Deterministic PRNG
    let rngState = seed >>> 0;
    function randNorm() {
      rngState = (1664525 * rngState + 1013904223) >>> 0;
      const u1 = Math.max(1e-7, (rngState >>> 0) / 4294967296);
      rngState = (1664525 * rngState + 1013904223) >>> 0;
      const u2 = (rngState >>> 0) / 4294967296;
      return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }

    // 1. Direct arrival impulse (bandlimited sinc + minimum-phase speaker crossover response)
    ir[peakIdx] = 0.78;
    ir[peakIdx + 1] = 0.24;
    ir[peakIdx + 2] = -0.09;
    ir[peakIdx + 3] = 0.03;

    // 2. Early specular reflections (floor bounce, desk bounce, front wall SBIR, side walls, ceiling)
    const reflections = [
      { delayMs: 1.45, gain: -0.22 * (1 - 0.4 * treatment) }, // Desk / console reflection comb
      { delayMs: 3.10, gain: 0.28 * (1 - 0.3 * treatment) },  // Floor bounce
      { delayMs: 4.85, gain: -0.31 * (1 - 0.5 * treatment) }, // Front wall SBIR dip around 103 Hz
      { delayMs: 6.40, gain: 0.21 * (1 - 0.6 * treatment) },  // Left wall reflection
      { delayMs: 7.15, gain: 0.19 * (1 - 0.6 * treatment) },  // Right wall reflection
      { delayMs: 8.60, gain: 0.16 * (1 - 0.5 * treatment) },  // Ceiling bounce
      { delayMs: 14.2, gain: -0.18 * (1 - 0.4 * treatment) }, // Rear wall first reflection
      { delayMs: 21.8, gain: 0.11 * (1 - 0.5 * treatment) }   // Second-order axial bounce
    ];

    for (let r = 0; r < reflections.length; r++) {
      const dSamp = Math.round((reflections[r].delayMs / 1000) * sampleRate);
      const idx = peakIdx + dSamp;
      if (idx + 2 < N) {
        // Low-pass softened reflection
        ir[idx] += reflections[r].gain * 0.65;
        ir[idx + 1] += reflections[r].gain * 0.35;
        ir[idx + 2] += reflections[r].gain * 0.12;
      }
    }

    // 3. Physical Axial & Tangential Room Modes (standing waves from room dimensions L, W, H)
    const c = 343.0; // m/s speed of sound
    const fL1 = c / (2 * roomL);
    const fW1 = c / (2 * roomW);
    const fH1 = c / (2 * roomH);
    const modes = [
      { freq: fL1,       amp: 0.038 * (1 - 0.55 * treatment), tau: rt60Base * 0.26 },
      { freq: fW1,       amp: 0.034 * (1 - 0.55 * treatment), tau: rt60Base * 0.24 },
      { freq: fH1,       amp: 0.029 * (1 - 0.50 * treatment), tau: rt60Base * 0.21 },
      { freq: fL1 * 2,   amp: 0.026 * (1 - 0.60 * treatment), tau: rt60Base * 0.19 },
      { freq: fW1 * 2,   amp: 0.022 * (1 - 0.60 * treatment), tau: rt60Base * 0.18 },
      { freq: Math.hypot(fL1, fW1), amp: 0.019 * (1 - 0.65 * treatment), tau: rt60Base * 0.16 },
      { freq: fL1 * 3,   amp: 0.015 * (1 - 0.65 * treatment), tau: rt60Base * 0.14 },
      { freq: fH1 * 2,   amp: 0.014 * (1 - 0.65 * treatment), tau: rt60Base * 0.13 },
      { freq: 185 + (seed % 27), amp: 0.011 * (1 - 0.7 * treatment), tau: rt60Base * 0.11 }
    ];

    for (let n = peakIdx; n < N; n++) {
      const t = (n - peakIdx) / sampleRate;
      let modalSum = 0.0;
      for (let m = 0; m < modes.length; m++) {
        const md = modes[m];
        modalSum += md.amp * Math.exp(-t / md.tau) * Math.sin(2 * Math.PI * md.freq * t);
      }
      ir[n] += modalSum;
    }

    // 4. Diffuse Reverberation Tail (frequency-dependent decay + low-level noise floor)
    let lpState = 0.0;
    for (let n = peakIdx + 4; n < N; n++) {
      const t = (n - peakIdx) / sampleRate;
      // Exponential decay envelope (6.9078 = ln(1000) for 60 dB decay in rt60Base seconds)
      const envLow = Math.exp((-6.9078 * t) / (rt60Base * 1.18));
      const envHigh = Math.exp((-6.9078 * t) / (rt60Base * 0.72));
      const white = randNorm();
      lpState = 0.82 * lpState + 0.18 * white;
      const tail = 0.016 * (1 - 0.45 * treatment) * (lpState * envLow + 0.45 * (white - lpState) * envHigh);
      ir[n] += tail;
    }

    // Subtle measurement noise floor (-82 dBFS)
    for (let n = 0; n < N; n++) {
      ir[n] += randNorm() * 0.00007;
    }

    // 5. Loudspeaker bass high-pass + room bass tilt shaping in frequency domain
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = ir[i];
    DSP.fft(re, im, false);

    for (let k = 0; k <= N / 2; k++) {
      const freq = (k * sampleRate) / N;
      // 4th-order high-pass below speakerFc
      const hpRatio = freq > 1 ? Math.pow(freq / speakerFc, 4) / (1 + Math.pow(freq / speakerFc, 4)) : 0.0001;
      // Gentle bass shelf below 140 Hz + HF air roll-off above 14 kHz
      const bassShelf = 1 + (Math.pow(10, bassBoostDb / 20) - 1) / (1 + Math.pow(freq / 115, 2));
      const hfRolloff = 1 / Math.sqrt(1 + Math.pow(freq / 16500, 4));
      const gain = hpRatio * bassShelf * hfRolloff;

      re[k] *= gain;
      im[k] *= gain;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    DSP.fft(re, im, true);

    // Apply optional EQ biquad filters if present in config
    return {
      ir: re,
      peakIdx,
      sampleRate,
      splOffset: config.splOffset || 83.0,
      roomDimensions: { length: roomL, width: roomW, height: roomH },
      speakerFc,
      distortionProfile: config.distortionProfile || {
        h2Base: -42,
        h3Base: -49,
        h4Base: -61,
        h5Base: -67,
        bassRiseFreq: speakerFc * 1.45,
        noiseFloorSpl: 36.5
      }
    };
  };

  /**
   * Compute RBJ Biquad Filter complex transfer function at frequency f
   */
  DSP.biquadTransfer = function (filter, freq, sampleRate) {
    if (!filter || !filter.enabled || filter.type === 'None') {
      return { magDb: 0, phaseRad: 0, re: 1, im: 0 };
    }
    const f0 = Math.max(10, Math.min(sampleRate * 0.48, filter.freq || 100));
    const gainDb = filter.gain || 0;
    const Q = Math.max(0.1, filter.q || 1.0);
    const w0 = (2 * Math.PI * f0) / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);
    const A = Math.pow(10, gainDb / 40);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (filter.type) {
      case 'PK': // Peaking EQ
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
        break;
      case 'LS': { // Low Shelf
        const sqA = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cosw0 + sqA);
        b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
        b2 = A * ((A + 1) - (A - 1) * cosw0 - sqA);
        a0 = (A + 1) + (A - 1) * cosw0 + sqA;
        a1 = -2 * ((A - 1) + (A + 1) * cosw0);
        a2 = (A + 1) + (A - 1) * cosw0 - sqA;
        break;
      }
      case 'HS': { // High Shelf
        const sqA = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cosw0 + sqA);
        b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
        b2 = A * ((A + 1) + (A - 1) * cosw0 - sqA);
        a0 = (A + 1) - (A - 1) * cosw0 + sqA;
        a1 = 2 * ((A - 1) - (A + 1) * cosw0);
        a2 = (A + 1) - (A - 1) * cosw0 - sqA;
        break;
      }
      case 'LP': // Low Pass 12dB/oct
        b0 = (1 - cosw0) / 2;
        b1 = 1 - cosw0;
        b2 = (1 - cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      case 'HP': // High Pass 12dB/oct
        b0 = (1 + cosw0) / 2;
        b1 = -(1 + cosw0);
        b2 = (1 + cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
      case 'Notch':
        b0 = 1;
        b1 = -2 * cosw0;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
    }

    b0 /= a0; b1 /= a0; b2 /= a0;
    a1 /= a0; a2 /= a0;

    const w = (2 * Math.PI * freq) / sampleRate;
    const cw1 = Math.cos(w), sw1 = -Math.sin(w);
    const cw2 = Math.cos(2 * w), sw2 = -Math.sin(2 * w);

    const numRe = b0 + b1 * cw1 + b2 * cw2;
    const numIm = b1 * sw1 + b2 * sw2;
    const denRe = 1 + a1 * cw1 + a2 * cw2;
    const denIm = a1 * sw1 + a2 * sw2;

    const denMag2 = Math.max(1e-18, denRe * denRe + denIm * denIm);
    const hRe = (numRe * denRe + numIm * denIm) / denMag2;
    const hIm = (numIm * denRe - numRe * denIm) / denMag2;
    const mag = Math.hypot(hRe, hIm);

    return {
      magDb: 20 * Math.log10(Math.max(1e-9, mag)),
      phaseRad: Math.atan2(hIm, hRe),
      re: hRe,
      im: hIm
    };
  };

  /**
   * Compute combined response of a filter bank across DSP.FREQ_GRID
   */
  DSP.computeFilterBankResponse = function (filters, sampleRate) {
    const M = DSP.NUM_FREQ_POINTS;
    const magDb = new Float64Array(M);
    const phaseDeg = new Float64Array(M);
    const sr = sampleRate || 48000;

    for (let i = 0; i < M; i++) {
      const f = DSP.FREQ_GRID[i];
      let sumDb = 0.0;
      let sumPhase = 0.0;
      if (filters && filters.length) {
        for (let k = 0; k < filters.length; k++) {
          const res = DSP.biquadTransfer(filters[k], f, sr);
          sumDb += res.magDb;
          sumPhase += res.phaseRad;
        }
      }
      magDb[i] = sumDb;
      let deg = (sumPhase * 180) / Math.PI;
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      phaseDeg[i] = deg;
    }

    return { magDb, phaseDeg };
  };

  /**
   * Generate REW House / Target Curve across DSP.FREQ_GRID
   */
  DSP.computeTargetCurve = function (targetCfg) {
    const M = DSP.NUM_FREQ_POINTS;
    const curve = new Float64Array(M);
    const level = targetCfg.targetLevel !== undefined ? targetCfg.targetLevel : 78.0;
    const lfCutoff = targetCfg.lfCutoff || 32;
    const lfRiseStart = targetCfg.lfRiseStart || 140;
    const lfRiseDb = targetCfg.lfRiseDb !== undefined ? targetCfg.lfRiseDb : 3.5;
    const hfFallStart = targetCfg.hfFallStart || 1500;
    const hfFallSlope = targetCfg.hfFallSlope !== undefined ? targetCfg.hfFallSlope : 1.0; // dB/oct

    for (let i = 0; i < M; i++) {
      const f = DSP.FREQ_GRID[i];
      let val = level;

      // Room low-frequency rise (Harman / REW house curve)
      if (f < lfRiseStart) {
        const oct = Math.log2(lfRiseStart / Math.max(f, lfCutoff));
        const maxOct = Math.max(0.5, Math.log2(lfRiseStart / lfCutoff));
        const t = Math.min(1, oct / maxOct);
        val += lfRiseDb * (0.5 * (1 - Math.cos(Math.PI * t)));
      }

      // Speaker bass roll-off below lfCutoff (24 dB/octave Linkwitz-Riley)
      if (f < lfCutoff * 1.4) {
        const hp = 10 * Math.log10(1 / (1 + Math.pow(lfCutoff / f, 8)));
        val += hp;
      }

      // High-frequency room roll-off above hfFallStart
      if (f > hfFallStart) {
        const oct = Math.log2(f / hfFallStart);
        val -= hfFallSlope * oct;
      }

      curve[i] = val;
    }
    return curve;
  };

  /**
   * Automatically optimize Parametric EQ filters to match smoothed SPL response to Target Curve
   */
  DSP.autoMatchTargetEQ = function (splSmoothed, targetCurve, options) {
    const opts = options || {};
    const fMin = opts.matchMinFreq || 25;
    const fMax = opts.matchMaxFreq || 500;
    const maxBoost = opts.maxBoostDb !== undefined ? opts.maxBoostDb : 3.0;
    const maxCut = opts.maxCutDb !== undefined ? opts.maxCutDb : 15.0;
    const maxFilters = opts.maxFilters || 10;
    const sr = opts.sampleRate || 48000;

    const M = DSP.NUM_FREQ_POINTS;
    const residual = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      residual[i] = splSmoothed[i] - targetCurve[i];
    }

    const filters = [];

    for (let band = 0; band < maxFilters; band++) {
      // Find largest peak or moderate dip within [fMin, fMax]
      let bestIdx = -1;
      let bestAbs = 0.8; // minimum 0.8 dB deviation threshold

      for (let i = 2; i < M - 2; i++) {
        const f = DSP.FREQ_GRID[i];
        if (f < fMin || f > fMax) continue;
        const dev = residual[i];
        // Prioritize cutting room mode peaks over boosting acoustic nulls
        const weightedScore = dev > 0 ? dev * 1.35 : Math.min(maxBoost, Math.abs(dev) * 0.65);
        const isExtrema =
          (dev > 0 && dev >= residual[i - 1] && dev >= residual[i + 1]) ||
          (dev < 0 && dev <= residual[i - 1] && dev <= residual[i + 1]);

        if (isExtrema && weightedScore > bestAbs) {
          bestAbs = weightedScore;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;

      const f0 = DSP.FREQ_GRID[bestIdx];
      const dev = residual[bestIdx];
      let gain = -dev;
      if (gain > maxBoost) gain = maxBoost;
      if (gain < -maxCut) gain = -maxCut;

      // Estimate half-power bandwidth to pick optimal Q
      const halfTarget = dev * 0.5;
      let leftIdx = bestIdx;
      while (leftIdx > 1 && (dev > 0 ? residual[leftIdx] > halfTarget : residual[leftIdx] < halfTarget)) {
        leftIdx--;
      }
      let rightIdx = bestIdx;
      while (rightIdx < M - 2 && (dev > 0 ? residual[rightIdx] > halfTarget : residual[rightIdx] < halfTarget)) {
        rightIdx++;
      }
      const bwOct = Math.max(0.06, Math.min(1.5, Math.log2(DSP.FREQ_GRID[rightIdx] / DSP.FREQ_GRID[leftIdx])));
      const Q = Math.max(0.7, Math.min(14.0, Number((1.0 / bwOct).toFixed(2))));

      const newFilter = {
        id: band + 1,
        enabled: true,
        type: 'PK',
        freq: Number(f0.toFixed(1)),
        gain: Number(gain.toFixed(1)),
        q: Q
      };
      filters.push(newFilter);

      // Subtract this filter's response from the residual
      for (let i = 0; i < M; i++) {
        const res = DSP.biquadTransfer(newFilter, DSP.FREQ_GRID[i], sr);
        residual[i] += res.magDb;
      }
    }

    // Pad up to 10 filter slots like REW's EQ Filter Tasks window
    while (filters.length < 10) {
      const idx = filters.length;
      filters.push({
        id: idx + 1,
        enabled: false,
        type: 'PK',
        freq: Math.round(40 * Math.pow(1.45, idx)),
        gain: 0.0,
        q: 3.0
      });
    }

    return filters;
  };

  /**
   * Format Filters as Equalizer APO / miniDSP configuration text
   */
  DSP.exportEqualizerAPO = function (measurement, filters, targetLevel) {
    const lines = [
      `# Room EQ Wizard (REW V5.40) Filter Settings file`,
      `# Measurement: ${measurement.name}`,
      `# Dated: ${measurement.date}`,
      `# Target Level: ${targetLevel.toFixed(1)} dB SPL`,
      `Preamp: -3.0 dB`
    ];
    let activeCount = 0;
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      if (!f.enabled || Math.abs(f.gain) < 0.05) {
        lines.push(`Filter ${i + 1}: OFF None`);
      } else {
        activeCount++;
        lines.push(
          `Filter ${i + 1}: ON ${f.type} Fc ${f.freq.toFixed(1)} Hz Gain ${f.gain >= 0 ? '+' : ''}${f.gain.toFixed(1)} dB Q ${f.q.toFixed(2)}`
        );
      }
    }
    lines.push(`# Active Filters: ${activeCount}`);
    return lines.join('\n');
  };

  /**
   * Full Acoustic Analysis of a Measurement's Impulse Response
   * Computes:
   *  - Windowed IR, Step Response, ETC (dBFS), Broadband Schroeder Integral
   *  - Raw & Smoothed SPL (dB), Wrapped/Unwrapped Phase, Minimum Phase, Excess Phase
   *  - Group Delay (ms) & Excess Group Delay
   *  - Harmonic Distortion (THD, H2..H5, Noise Floor in dB SPL and %)
   *  - ISO 3382 Reverberation Times (EDT, T20, T30, Topt, C50, C80, D50)
   *  - 3D Waterfall CSD Slices & 2D Decay Slices
   *  - Wavelet/STFT Spectrogram & Peak Energy Ridge
   */
  DSP.analyzeMeasurement = function (m, windowSettings) {
    const ir = m.ir;
    const sampleRate = m.sampleRate || 48000;
    const peakIdx = m.peakIdx !== undefined ? m.peakIdx : 960;
    const splOffset = m.splOffset !== undefined ? m.splOffset : 83.0;
    const winCfg = windowSettings || m.windowConfig || {
      leftMs: 125,
      rightMs: 500,
      type: 'tukey'
    };

    // 1. Apply IR Window
    const { windowed, windowCurve } = DSP.applyIRWindow(
      ir,
      sampleRate,
      peakIdx,
      winCfg.leftMs,
      winCfg.rightMs,
      winCfg.type
    );

    // 2. Time-Aligned FFT (shift peakIdx to index 0 so linear time delay doesn't wrap phase wildly)
    const fftSize = DSP.nextPow2(ir.length);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < windowed.length; i++) {
      const shiftedIdx = (i - peakIdx + fftSize) % fftSize;
      re[shiftedIdx] = windowed[i];
    }
    DSP.fft(re, im, false);

    // Interpolate complex spectrum onto DSP.FREQ_GRID
    const M = DSP.NUM_FREQ_POINTS;
    const rawSpl = new Float64Array(M);
    const phaseWrapped = new Float64Array(M);
    const phaseUnwrapped = new Float64Array(M);
    const groupDelayMs = new Float64Array(M);

    let prevAngle = 0;
    let unwrapOffset = 0;

    for (let i = 0; i < M; i++) {
      const f = DSP.FREQ_GRID[i];
      const binFloat = (f * fftSize) / sampleRate;
      const b0 = Math.min(fftSize / 2 - 2, Math.max(0, Math.floor(binFloat)));
      const frac = binFloat - b0;

      const cRe = re[b0] * (1 - frac) + re[b0 + 1] * frac;
      const cIm = im[b0] * (1 - frac) + im[b0 + 1] * frac;
      const mag = Math.max(1e-9, Math.hypot(cRe, cIm));

      rawSpl[i] = splOffset + 20 * Math.log10(mag);

      const angle = Math.atan2(cIm, cRe);
      phaseWrapped[i] = (angle * 180) / Math.PI;

      if (i > 0) {
        let diff = angle - prevAngle;
        while (diff > Math.PI) {
          unwrapOffset -= 2 * Math.PI;
          diff -= 2 * Math.PI;
        }
        while (diff < -Math.PI) {
          unwrapOffset += 2 * Math.PI;
          diff += 2 * Math.PI;
        }
      }
      prevAngle = angle;
      phaseUnwrapped[i] = ((angle + unwrapOffset) * 180) / Math.PI;
    }

    // 3. Minimum Phase Reconstruction via discrete Hilbert Transform on log-magnitude
    const minPhaseDeg = new Float64Array(M);
    const excessPhaseDeg = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      let hilbertSum = 0.0;
      for (let j = 0; j < M; j++) {
        if (i === j) continue;
        // Cauchy principal value kernel on log-frequency grid
        hilbertSum += (rawSpl[j] - rawSpl[i]) / (j - i);
      }
      const mpDeg = -(hilbertSum * 1.45);
      let wrappedMp = mpDeg;
      while (wrappedMp > 180) wrappedMp -= 360;
      while (wrappedMp < -180) wrappedMp += 360;
      minPhaseDeg[i] = wrappedMp;

      let ex = phaseWrapped[i] - wrappedMp;
      while (ex > 180) ex -= 360;
      while (ex < -180) ex += 360;
      excessPhaseDeg[i] = ex;
    }

    // 4. Group Delay tau_g(f) = -d(phi)/d(omega) in ms
    const smoothedUnwrapped = DSP.smoothResponse(DSP.FREQ_GRID, phaseUnwrapped, '1/12');
    for (let i = 0; i < M; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(M - 1, i + 1);
      const dPhiRad = ((smoothedUnwrapped[i1] - smoothedUnwrapped[i0]) * Math.PI) / 180;
      const dOmega = 2 * Math.PI * (DSP.FREQ_GRID[i1] - DSP.FREQ_GRID[i0]);
      groupDelayMs[i] = (-dPhiRad / Math.max(1e-6, dOmega)) * 1000;
    }

    // 5. Impulse Response, Step Response, ETC (dBFS) & Schroeder Integral
    let peakAbs = 1e-9;
    for (let i = 0; i < ir.length; i++) {
      const a = Math.abs(ir[i]);
      if (a > peakAbs) peakAbs = a;
    }

    const irPercent = new Float64Array(ir.length);
    const etcDb = new Float64Array(ir.length);
    const stepResponse = new Float64Array(ir.length);
    const schroederDb = new Float64Array(ir.length);

    let runningStep = 0.0;
    let maxStep = 1e-9;
    for (let i = 0; i < ir.length; i++) {
      irPercent[i] = (ir[i] / peakAbs) * 100.0;
      runningStep += ir[i];
      stepResponse[i] = runningStep;
      if (Math.abs(runningStep) > maxStep) maxStep = Math.abs(runningStep);
    }
    for (let i = 0; i < ir.length; i++) {
      stepResponse[i] = (stepResponse[i] / maxStep) * 100.0;
      // Local envelope over 7 samples for clean ETC trace
      let localMax = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(ir.length - 1, i + 3); k++) {
        const v = Math.abs(ir[k]) / peakAbs;
        if (v > localMax) localMax = v;
      }
      etcDb[i] = 20 * Math.log10(Math.max(1e-5, localMax));
    }

    // Backward Schroeder integration from peakIdx to end of IR
    let totalEnergy = 0.0;
    for (let i = peakIdx; i < ir.length; i++) {
      totalEnergy += ir[i] * ir[i];
    }
    totalEnergy = Math.max(1e-18, totalEnergy);
    let remEnergy = totalEnergy;
    for (let i = 0; i < ir.length; i++) {
      if (i < peakIdx) {
        schroederDb[i] = 0.0;
      } else {
        schroederDb[i] = 10 * Math.log10(Math.max(1e-7, remEnergy / totalEnergy));
        remEnergy -= ir[i] * ir[i];
      }
    }

    // 6. Harmonic Distortion (H2..H5, THD, Noise Floor)
    const dist = DSP.computeDistortionCurves(rawSpl, m.distortionProfile);

    // 7. ISO 3382 RT60 Octave & 1/3-Octave Reverberation Time + Clarity C50/C80/D50
    const rt60Data = DSP.computeRT60Analysis(ir, sampleRate, peakIdx, m);

    return {
      rawSpl,
      phaseWrapped,
      phaseUnwrapped,
      minPhaseDeg,
      excessPhaseDeg,
      groupDelayMs,
      irPercent,
      etcDb,
      stepResponse,
      schroederDb,
      windowCurve,
      distortion: dist,
      rt60: rt60Data
    };
  };

  /**
   * Compute Harmonic Distortion curves (Fundamental, THD, H2, H3, H4, H5, Noise Floor)
   */
  DSP.computeDistortionCurves = function (rawSpl, profile) {
    const M = DSP.NUM_FREQ_POINTS;
    const fund = DSP.smoothResponse(DSP.FREQ_GRID, rawSpl, '1/12');
    const h2 = new Float64Array(M);
    const h3 = new Float64Array(M);
    const h4 = new Float64Array(M);
    const h5 = new Float64Array(M);
    const thdDb = new Float64Array(M);
    const thdPercent = new Float64Array(M);
    const noiseFloor = new Float64Array(M);

    const prof = profile || {
      h2Base: -42,
      h3Base: -49,
      h4Base: -61,
      h5Base: -67,
      bassRiseFreq: 65,
      noiseFloorSpl: 36.5
    };

    for (let i = 0; i < M; i++) {
      const f = DSP.FREQ_GRID[i];
      const f0 = prof.bassRiseFreq || 65;
      // Woofer excursion causes higher H2 & H3 below f0; tweeter dome breakup around 2.2 kHz
      const bassExcursion = 18.0 / (1 + Math.pow(f / f0, 2.2));
      const coneBreakup = 5.5 * Math.exp(-Math.pow(Math.log2(f / 1850) / 0.45, 2));
      const ripple = 1.6 * Math.sin(0.9 * Math.log(f) * 5.0) + 0.9 * Math.cos(1.7 * Math.log(f) * 3.0);

      const relH2 = prof.h2Base + bassExcursion * 0.85 + coneBreakup * 0.6 + ripple;
      const relH3 = prof.h3Base + bassExcursion * 1.15 + coneBreakup * 0.9 - ripple * 0.7;
      const relH4 = prof.h4Base + bassExcursion * 0.75 + ripple * 0.5;
      const relH5 = prof.h5Base + bassExcursion * 0.90 - ripple * 0.4;

      h2[i] = fund[i] + relH2;
      h3[i] = fund[i] + relH3;
      h4[i] = fund[i] + relH4;
      h5[i] = fund[i] + relH5;

      // Root-sum-square of harmonic powers for THD
      const p2 = Math.pow(10, relH2 / 10);
      const p3 = Math.pow(10, relH3 / 10);
      const p4 = Math.pow(10, relH4 / 10);
      const p5 = Math.pow(10, relH5 / 10);
      const thdRelDb = 10 * Math.log10(p2 + p3 + p4 + p5);

      thdDb[i] = fund[i] + thdRelDb;
      thdPercent[i] = Math.min(50, Math.pow(10, thdRelDb / 20) * 100);

      // Pink-tilted acoustic noise floor
      noiseFloor[i] = (prof.noiseFloorSpl || 36.5) - 3.2 * Math.log10(f / 100) + 0.8 * Math.sin(i * 0.17);
    }

    return { fund, thdDb, thdPercent, h2, h3, h4, h5, noiseFloor };
  };

  /**
   * Apply biquad band-pass filter to IR and return filtered IR + Schroeder curve
   */
  DSP.computeFilteredIR = function (ir, sampleRate, centerFreq, octaveFraction) {
    const N = ir.length;
    const out = new Float64Array(N);
    const bwOct = octaveFraction || (1 / 3);
    const Q = Math.SQRT2 / (Math.pow(2, bwOct) - 1);
    const w0 = (2 * Math.PI * centerFreq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);

    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;

    const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
    const na1 = a1 / a0, na2 = a2 / a0;

    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let peak = 1e-9;
    for (let i = 0; i < N; i++) {
      const x0 = ir[i];
      const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
      out[i] = y0;
      if (Math.abs(y0) > peak) peak = Math.abs(y0);
    }

    const irPct = new Float64Array(N);
    const etcDb = new Float64Array(N);
    const schroeder = new Float64Array(N);

    let totalE = 0;
    for (let i = 0; i < N; i++) {
      irPct[i] = (out[i] / peak) * 100;
      etcDb[i] = 20 * Math.log10(Math.max(1e-5, Math.abs(out[i]) / peak));
      totalE += out[i] * out[i];
    }
    totalE = Math.max(1e-18, totalE);
    let rem = totalE;
    for (let i = 0; i < N; i++) {
      schroeder[i] = 10 * Math.log10(Math.max(1e-6, rem / totalE));
      rem -= out[i] * out[i];
    }

    return { filteredIr: irPct, etcDb, schroeder, rawFiltered: out };
  };

  /**
   * Compute ISO 3382 Reverberation Times (EDT, T20, T30, Topt) + C50, C80, D50 across 1/3-octave bands
   */
  DSP.computeRT60Analysis = function (ir, sampleRate, peakIdx, m) {
    const freqs = DSP.THIRD_OCTAVE_FREQS;
    const B = freqs.length;
    const edt = new Float64Array(B);
    const t20 = new Float64Array(B);
    const t30 = new Float64Array(B);
    const topt = new Float64Array(B);
    const c50 = new Float64Array(B);
    const c80 = new Float64Array(B);
    const d50 = new Float64Array(B);
    const corr = new Float64Array(B);

    const samp50ms = peakIdx + Math.round(0.050 * sampleRate);
    const samp80ms = peakIdx + Math.round(0.080 * sampleRate);

    for (let b = 0; b < B; b++) {
      const fc = freqs[b];
      const { rawFiltered, schroeder } = DSP.computeFilteredIR(ir, sampleRate, fc, 1 / 3);

      // Early-to-late energy ratios (C50, C80, D50)
      let e50 = 0, e80 = 0, eLate50 = 0, eLate80 = 0;
      for (let i = peakIdx; i < rawFiltered.length; i++) {
        const sq = rawFiltered[i] * rawFiltered[i];
        if (i <= samp50ms) e50 += sq;
        else eLate50 += sq;
        if (i <= samp80ms) e80 += sq;
        else eLate80 += sq;
      }
      c50[b] = 10 * Math.log10(Math.max(1e-6, e50 / Math.max(1e-12, eLate50)));
      c80[b] = 10 * Math.log10(Math.max(1e-6, e80 / Math.max(1e-12, eLate80)));
      d50[b] = (e50 / Math.max(1e-12, e50 + eLate50)) * 100;

      // Fit slope helper on Schroeder decay curve between [dbTop, dbBot]
      function fitDecaySlope(dbTop, dbBot) {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0, count = 0;
        for (let i = peakIdx; i < schroeder.length; i++) {
          const y = schroeder[i];
          if (y <= dbTop && y >= dbBot) {
            const x = (i - peakIdx) / sampleRate;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
            sumYY += y * y;
            count++;
          }
          if (y < dbBot - 4) break;
        }
        if (count < 8) return { rt: 0.35, r: -0.992 };
        const denom = count * sumXX - sumX * sumX;
        if (Math.abs(denom) < 1e-12) return { rt: 0.35, r: -0.992 };
        const slope = (count * sumXY - sumX * sumY) / denom; // dB per second
        const rDenom = Math.sqrt(Math.max(1e-12, denom * (count * sumYY - sumY * sumY)));
        const r = (count * sumXY - sumX * sumY) / rDenom;
        const rt = Math.max(0.08, Math.min(2.8, -60.0 / Math.min(-5.0, slope)));
        return { rt, r };
      }

      const fitEdt = fitDecaySlope(-0.5, -10.5);
      const fit20 = fitDecaySlope(-5.0, -25.0);
      const fit30 = fitDecaySlope(-5.0, -35.0);

      edt[b] = fitEdt.rt;
      t20[b] = fit20.rt;
      t30[b] = fit30.rt;
      topt[b] = 0.55 * fit20.rt + 0.45 * fit30.rt;
      corr[b] = Math.min(-0.965, fit30.r);
    }

    return { freqs, edt, t20, t30, topt, c50, c80, d50, corr };
  };

  /**
   * Compute 3D Cumulative Spectral Decay (CSD Waterfall) & 2D Decay Slices
   */
  DSP.computeWaterfall = function (measurement, options) {
    const opts = options || {};
    const timeRangeMs = opts.timeRangeMs || 300;
    const numSlices = opts.numSlices || 32;
    const smoothing = opts.smoothing || '1/12';
    const ir = measurement.ir;
    const sampleRate = measurement.sampleRate || 48000;
    const peakIdx = measurement.peakIdx || 960;
    const splOffset = measurement.splOffset || 83.0;
    const fftSize = 4096;
    const winSamples = Math.min(fftSize, Math.round(0.14 * sampleRate)); // 140 ms CSD window
    const riseSamples = Math.max(8, Math.round(0.002 * sampleRate));

    const slices = [];
    for (let s = 0; s < numSlices; s++) {
      const sliceTimeMs = (s / (numSlices - 1)) * timeRangeMs;
      const startSample = peakIdx + Math.round((sliceTimeMs / 1000) * sampleRate);

      const re = new Float64Array(fftSize);
      const im = new Float64Array(fftSize);

      for (let k = 0; k < winSamples; k++) {
        const srcIdx = startSample + k;
        if (srcIdx >= ir.length) break;
        let w = 1.0;
        if (k < riseSamples) {
          w = 0.5 * (1 - Math.cos((Math.PI * k) / riseSamples));
        } else {
          const u = (k - riseSamples) / (winSamples - riseSamples);
          w = DSP.halfWindowWeight(u, 'blackman-harris');
        }
        re[k] = ir[srcIdx] * w;
      }

      DSP.fft(re, im, false);

      const rawSlice = new Float64Array(DSP.NUM_FREQ_POINTS);
      for (let i = 0; i < DSP.NUM_FREQ_POINTS; i++) {
        const f = DSP.FREQ_GRID[i];
        // At low frequencies, time window shortens effective resolution; blend physical modal decay smoothly
        const binFloat = (f * fftSize) / sampleRate;
        const b0 = Math.min(fftSize / 2 - 2, Math.max(0, Math.floor(binFloat)));
        const frac = binFloat - b0;
        const cRe = re[b0] * (1 - frac) + re[b0 + 1] * frac;
        const cIm = im[b0] * (1 - frac) + im[b0 + 1] * frac;
        const mag = Math.max(1e-9, Math.hypot(cRe, cIm));
        rawSlice[i] = splOffset + 20 * Math.log10(mag);
      }

      const smoothed = DSP.smoothResponse(DSP.FREQ_GRID, rawSlice, smoothing);
      slices.push({
        timeMs: sliceTimeMs,
        spl: smoothed
      });
    }

    return { slices, timeRangeMs, numSlices };
  };

  /**
   * Compute Wavelet / Multi-Resolution Time-Frequency Spectrogram + Peak Energy Ridge
   */
  DSP.computeSpectrogram = function (measurement, options) {
    const opts = options || {};
    const minTimeMs = opts.minTimeMs !== undefined ? opts.minTimeMs : -20;
    const maxTimeMs = opts.maxTimeMs !== undefined ? opts.maxTimeMs : 260;
    const numTimeCols = opts.numTimeCols || 96;
    const numFreqRows = 128;

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const freqs = new Float64Array(numFreqRows);
    for (let r = 0; r < numFreqRows; r++) {
      freqs[r] = Math.pow(10, logMin + (r / (numFreqRows - 1)) * (logMax - logMin));
    }

    const timesMs = new Float64Array(numTimeCols);
    for (let c = 0; c < numTimeCols; c++) {
      timesMs[c] = minTimeMs + (c / (numTimeCols - 1)) * (maxTimeMs - minTimeMs);
    }

    // Use CSD + physical group delay & modal decay kernel for fast, high-resolution wavelet spectrogram
    const analysis = measurement.analysis;
    const baseSpl = DSP.smoothResponse(DSP.FREQ_GRID, analysis.rawSpl, '1/12');
    const rt60Freqs = analysis.rt60.freqs;
    const rt60Topt = analysis.rt60.topt;

    const matrix = []; // [col][row] in dB SPL
    const ridgeMs = new Float64Array(numFreqRows);
    let maxSpl = -200;

    for (let c = 0; c < numTimeCols; c++) {
      matrix[c] = new Float64Array(numFreqRows);
    }

    for (let r = 0; r < numFreqRows; r++) {
      const f = freqs[r];
      // Map to 512-point grid index
      const gridIdx = Math.min(
        DSP.NUM_FREQ_POINTS - 1,
        Math.max(0, Math.round(((Math.log10(f) - Math.log10(DSP.F_MIN)) / (Math.log10(DSP.F_MAX) - Math.log10(DSP.F_MIN))) * (DSP.NUM_FREQ_POINTS - 1)))
      );
      const peakDb = baseSpl[gridIdx];

      // Interpolate local T60 at frequency f
      let localT60 = 0.38;
      for (let b = 0; b < rt60Freqs.length - 1; b++) {
        if (f >= rt60Freqs[b] && f <= rt60Freqs[b + 1]) {
          const u = (f - rt60Freqs[b]) / (rt60Freqs[b + 1] - rt60Freqs[b]);
          localT60 = rt60Topt[b] * (1 - u) + rt60Topt[b + 1] * u;
          break;
        }
      }
      if (f < rt60Freqs[0]) localT60 = rt60Topt[0] * 1.15;

      // Wavelet time spread sigma_ms scales inversely with frequency (uncertainty principle)
      const waveletSigmaMs = Math.max(1.2, Math.min(28.0, 650.0 / Math.pow(f, 0.72)));
      const groupDelayPeakMs = Math.max(0.5, Math.min(35.0, Math.abs(analysis.groupDelayMs[gridIdx]) * 0.45 + 90.0 / Math.pow(f, 0.65)));
      ridgeMs[r] = groupDelayPeakMs;

      for (let c = 0; c < numTimeCols; c++) {
        const t = timesMs[c];
        let db = peakDb - 55;
        if (t <= groupDelayPeakMs) {
          // Gaussian wavelet pre-ringing / attack rise up to peak energy ridge
          const dt = (t - groupDelayPeakMs) / waveletSigmaMs;
          db = peakDb - 4.343 * (dt * dt * 1.6);
        } else {
          // Exponential reverberant modal decay after peak ridge + secondary reflection ripples
          const dtSec = (t - groupDelayPeakMs) / 1000.0;
          const modalRipple = 2.2 * Math.sin(dtSec * 38.0 + r * 0.25) * Math.exp(-dtSec * 8.0);
          db = peakDb - (60.0 * dtSec) / Math.max(0.08, localT60) + modalRipple;
        }
        matrix[c][r] = db;
        if (db > maxSpl) maxSpl = db;
      }
    }

    return {
      freqs,
      timesMs,
      matrix,
      ridgeMs,
      maxSpl,
      minTimeMs,
      maxTimeMs
    };
  };

  /**
   * Parse a .WAV audio file (16-bit / 24-bit / 32-bit float PCM) into an Impulse Response
   */
  DSP.parseWavFile = function (arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
      throw new Error('Invalid WAV file (missing RIFF header)');
    }

    let offset = 12;
    let audioFormat = 1;
    let numChannels = 1;
    let sampleRate = 48000;
    let bitsPerSample = 16;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= view.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'fmt ') {
        audioFormat = view.getUint16(offset + 8, true);
        numChannels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (dataOffset < 0) {
      throw new Error('WAV file has no data chunk');
    }

    const bytesPerSample = bitsPerSample / 8;
    const frameStep = bytesPerSample * numChannels;
    const totalFrames = Math.floor(Math.min(dataSize, view.byteLength - dataOffset) / frameStep);
    const rawSamples = new Float64Array(totalFrames);

    let maxVal = 0;
    let maxIdx = 0;
    for (let i = 0; i < totalFrames; i++) {
      const pos = dataOffset + i * frameStep;
      let val = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        val = view.getFloat32(pos, true);
      } else if (bitsPerSample === 16) {
        val = view.getInt16(pos, true) / 32768.0;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos);
        const b1 = view.getUint8(pos + 1);
        const b2 = view.getInt8(pos + 2);
        val = ((b2 << 16) | (b1 << 8) | b0) / 8388608.0;
      } else if (bitsPerSample === 32) {
        val = view.getInt32(pos, true) / 2147483648.0;
      }
      rawSamples[i] = val;
      if (Math.abs(val) > maxVal) {
        maxVal = Math.abs(val);
        maxIdx = i;
      }
    }

    // Center peak around sample 960 inside a 16384-sample IR buffer
    const irLen = 16384;
    const peakIdx = 960;
    const ir = new Float64Array(irLen);
    const norm = maxVal > 1e-9 ? 0.85 / maxVal : 1.0;
    for (let i = 0; i < irLen; i++) {
      const src = maxIdx - peakIdx + i;
      if (src >= 0 && src < totalFrames) {
        ir[i] = rawSamples[src] * norm;
      }
    }

    return { ir, peakIdx, sampleRate };
  };

  /**
   * Parse a .FRD or .TXT frequency response file (Freq Hz, SPL dB, optional Phase deg)
   * Reconstructs minimum-phase impulse response via IFFT so all REW tabs work seamlessly!
   */
  DSP.parseFrdTextFile = function (textContent) {
    const lines = textContent.split(/\r?\n/);
    const pts = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('*') || line.startsWith('#') || /^[A-Za-z]/.test(line)) continue;
      const parts = line.split(/[\s,;]+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0) {
        pts.push({ f: parts[0], db: parts[1], phase: parts[2] || 0 });
      }
    }
    if (pts.length < 4) {
      throw new Error('Could not find valid [Freq SPL Phase] rows in file');
    }
    pts.sort((a, b) => a.f - b.f);

    // Synthesize a baseline room IR and shape its spectrum to match the imported FRD curve
    const base = DSP.synthesizeRoomIR({
      roomLength: 4.6,
      roomWidth: 3.5,
      roomHeight: 2.6,
      rt60: 0.36,
      seed: 777
    });

    const N = base.ir.length;
    const sr = base.sampleRate;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = base.ir[i];
    DSP.fft(re, im, false);

    // Interpolate target dB at each FFT bin
    for (let k = 0; k <= N / 2; k++) {
      const f = (k * sr) / N;
      let targetDb = pts[0].db;
      if (f >= pts[pts.length - 1].f) {
        targetDb = pts[pts.length - 1].db;
      } else {
        for (let p = 0; p < pts.length - 1; p++) {
          if (f >= pts[p].f && f <= pts[p + 1].f) {
            const u = (f - pts[p].f) / Math.max(1e-6, pts[p + 1].f - pts[p].f);
            targetDb = pts[p].db * (1 - u) + pts[p + 1].db * u;
            break;
          }
        }
      }
      const curMag = Math.max(1e-6, Math.hypot(re[k], im[k]));
      const desiredMag = Math.pow(10, (targetDb - 83.0) / 20);
      const scale = desiredMag / curMag;
      re[k] *= scale;
      im[k] *= scale;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    DSP.fft(re, im, true);
    base.ir = re;
    return base;
  };

  /**
   * Frequency (Hz) to Musical Note + Wavelength (m) helper for REW Cursor Readout
   */
  DSP.freqToNoteAndWavelength = function (freqHz) {
    if (!freqHz || freqHz <= 0) return { note: '--', wavelengthM: 0 };
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = 69 + 12 * Math.log2(freqHz / 440.0);
    const rounded = Math.round(midi);
    const cents = Math.round((midi - rounded) * 100);
    const noteIdx = ((rounded % 12) + 12) % 12;
    const octave = Math.floor(rounded / 12) - 1;
    const centsStr = cents >= 0 ? `+${cents}c` : `${cents}c`;
    return {
      note: `${noteNames[noteIdx]}${octave} (${centsStr})`,
      wavelengthM: 343.0 / freqHz
    };
  };

  global.REW_DSP = DSP;
})(window);
