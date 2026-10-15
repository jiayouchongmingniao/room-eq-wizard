/**
 * Room EQ Wizard (REW v5.40) - High-DPI Acoustic Graph Renderer (charts.js)
 * Renders all 11 REW analysis tabs with 1:1 REW visual styling, gridlines,
 * logarithmic/linear axes, interactive crosshair cursor readouts, and 3D projections.
 */
(function (global) {
  'use strict';

  const DSP = global.REW_DSP;
  const Charts = {};

  // Color map for Waterfall & Spectrogram (REW Classic Rainbow / Jet / Viridis)
  Charts.valueToColor = function (norm, scheme, alpha) {
    const t = Math.max(0, Math.min(1, norm));
    const a = alpha !== undefined ? alpha : 1.0;
    let r = 0, g = 0, b = 0;

    if (scheme === 'viridis') {
      r = Math.round(255 * Math.min(1, Math.max(0, 0.267 + t * (0.993 - 0.267) * Math.pow(t, 0.6))));
      g = Math.round(255 * Math.min(1, Math.max(0, 0.005 + 0.90 * Math.pow(t, 0.85))));
      b = Math.round(255 * Math.min(1, Math.max(0, 0.329 + 0.55 * Math.sin(Math.PI * t) - 0.2 * t)));
    } else if (scheme === 'thermal') {
      r = Math.round(255 * Math.min(1, t * 1.6));
      g = Math.round(255 * Math.max(0, Math.min(1, (t - 0.25) * 1.5)));
      b = Math.round(255 * Math.max(0, (t - 0.65) * 2.8));
    } else {
      // Classic REW Rainbow / Jet spectrum (Blue -> Cyan -> Green -> Yellow -> Red)
      if (t < 0.25) {
        const u = t / 0.25;
        r = 15;
        g = Math.round(180 * u);
        b = Math.round(140 + 115 * u);
      } else if (t < 0.5) {
        const u = (t - 0.25) / 0.25;
        r = Math.round(15 + 40 * u);
        g = Math.round(180 + 65 * u);
        b = Math.round(255 * (1 - u * 0.85));
      } else if (t < 0.75) {
        const u = (t - 0.5) / 0.25;
        r = Math.round(55 + 200 * u);
        g = Math.round(245 - 35 * u);
        b = Math.round(38 * (1 - u));
      } else {
        const u = (t - 0.75) / 0.25;
        r = 255;
        g = Math.round(210 * (1 - u));
        b = Math.round(35 * u);
      }
    }
    return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
  };

  /**
   * Coordinate mappers
   */
  Charts.freqToX = function (f, plotRect, fMin, fMax) {
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    const u = (Math.log10(Math.max(fMin, Math.min(fMax, f))) - logMin) / (logMax - logMin);
    return plotRect.x + u * plotRect.w;
  };

  Charts.xToFreq = function (x, plotRect, fMin, fMax) {
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    const u = Math.max(0, Math.min(1, (x - plotRect.x) / plotRect.w));
    return Math.pow(10, logMin + u * (logMax - logMin));
  };

  Charts.valToY = function (v, plotRect, vMin, vMax) {
    const u = (v - vMin) / (vMax - vMin);
    return plotRect.y + plotRect.h * (1 - u);
  };

  Charts.yToVal = function (y, plotRect, vMin, vMax) {
    const u = 1 - (y - plotRect.y) / plotRect.h;
    return vMin + u * (vMax - vMin);
  };

  /**
   * Draw logarithmic frequency grid (20 Hz to 20 kHz) like REW
   */
  Charts.drawLogFreqGrid = function (ctx, plotRect, fMin, fMax, theme, drawBottomLabels) {
    const isLight = theme === 'light';
    const majorColor = isLight ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.13)';
    const minorColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    const textColor = isLight ? '#334155' : '#9ca3af';

    const decades = [10, 100, 1000, 10000];
    ctx.save();
    ctx.lineWidth = 1;

    for (let d = 0; d < decades.length; d++) {
      const base = decades[d];
      for (let m = 1; m <= 9; m++) {
        const f = base * m;
        if (f < fMin || f > fMax) continue;
        const x = Math.round(Charts.freqToX(f, plotRect, fMin, fMax)) + 0.5;
        ctx.beginPath();
        ctx.strokeStyle = (m === 1 || m === 2 || m === 5) ? majorColor : minorColor;
        ctx.moveTo(x, plotRect.y);
        ctx.lineTo(x, plotRect.y + plotRect.h);
        ctx.stroke();
      }
    }

    if (drawBottomLabels !== false) {
      const labelFreqs = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 800, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 20000];
      ctx.fillStyle = textColor;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (let i = 0; i < labelFreqs.length; i++) {
        const lf = labelFreqs[i];
        if (lf < fMin || lf > fMax) continue;
        const x = Charts.freqToX(lf, plotRect, fMin, fMax);
        const label = lf >= 1000 ? `${lf / 1000}k` : `${lf}`;
        ctx.fillText(label, x, plotRect.y + plotRect.h + 6);
      }

      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('Frequency (Hz)', plotRect.x + plotRect.w / 2, plotRect.y + plotRect.h + 22);
    }

    ctx.restore();
  };

  /**
   * Draw Linear Y-Axis Gridlines (Left and optional Right axis)
   */
  Charts.drawLinearYGrid = function (ctx, plotRect, yMin, yMax, step, unitLabel, theme, rightAxis) {
    const isLight = theme === 'light';
    const lineColor = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.09)';
    const zeroColor = isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.24)';
    const textColor = isLight ? '#334155' : '#9ca3af';

    ctx.save();
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace';
    ctx.textBaseline = 'middle';

    const firstVal = Math.ceil(yMin / step) * step;
    for (let v = firstVal; v <= yMax + 1e-6; v += step) {
      const y = Math.round(Charts.valToY(v, plotRect, yMin, yMax)) + 0.5;
      if (y < plotRect.y - 1 || y > plotRect.y + plotRect.h + 1) continue;

      if (!rightAxis) {
        ctx.beginPath();
        ctx.strokeStyle = Math.abs(v) < 1e-6 ? zeroColor : lineColor;
        ctx.lineWidth = Math.abs(v) < 1e-6 ? 1.2 : 1;
        ctx.moveTo(plotRect.x, y);
        ctx.lineTo(plotRect.x + plotRect.w, y);
        ctx.stroke();

        ctx.fillStyle = textColor;
        ctx.textAlign = 'right';
        const formatted = Math.abs(step) < 1 ? v.toFixed(1) : `${Math.round(v)}`;
        ctx.fillText(formatted, plotRect.x - 7, y);
      } else {
        ctx.fillStyle = rightAxis.color || textColor;
        ctx.textAlign = 'left';
        const formatted = Math.abs(step) < 1 ? v.toFixed(1) : `${Math.round(v)}${rightAxis.suffix || ''}`;
        ctx.fillText(formatted, plotRect.x + plotRect.w + 7, y);
      }
    }

    // Rotated axis title
    ctx.fillStyle = rightAxis ? (rightAxis.color || textColor) : textColor;
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    if (!rightAxis) {
      ctx.translate(14, plotRect.y + plotRect.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(unitLabel, 0, 0);
    } else {
      ctx.translate(plotRect.x + plotRect.w + 46, plotRect.y + plotRect.h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(unitLabel, 0, 0);
    }
    ctx.restore();
  };

  /**
   * Draw Smooth Polyline on Frequency Grid
   */
  Charts.drawFreqTrace = function (ctx, plotRect, freqs, values, fMin, fMax, yMin, yMax, color, width, dash) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotRect.x, plotRect.y, plotRect.w, plotRect.h);
    ctx.clip();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2.0;
    if (dash) ctx.setLineDash(dash);

    let started = false;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      if (f < fMin * 0.95 || f > fMax * 1.05) continue;
      const x = Charts.freqToX(f, plotRect, fMin, fMax);
      const y = Charts.valToY(values[i], plotRect, yMin, yMax);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  /**
   * Draw Crosshair & Top-Left REW Cursor Readout Overlay
   */
  Charts.drawCrosshairAndReadout = function (ctx, plotRect, mouse, lines, theme) {
    if (!mouse || !mouse.inside) return;
    const isLight = theme === 'light';

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotRect.x, plotRect.y, plotRect.w, plotRect.h);
    ctx.clip();

    ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Vertical cursor line
    ctx.beginPath();
    ctx.moveTo(mouse.x, plotRect.y);
    ctx.lineTo(mouse.x, plotRect.y + plotRect.h);
    ctx.stroke();

    // Horizontal cursor line
    ctx.beginPath();
    ctx.moveTo(plotRect.x, mouse.y);
    ctx.lineTo(plotRect.x + plotRect.w, mouse.y);
    ctx.stroke();

    // Info panel in top-left corner of plot
    if (lines && lines.length) {
      const boxX = plotRect.x + 12;
      const boxY = plotRect.y + 10;
      const lineH = 17;
      const boxW = 248;
      const boxH = lines.length * lineH + 12;

      ctx.setLineDash([]);
      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(17, 20, 26, 0.88)';
      ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.35)' : 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 5);
      ctx.fill();
      ctx.stroke();

      ctx.font = '11.5px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = lines[i].color || (isLight ? '#0f172a' : '#e2e8f0');
        ctx.fillText(lines[i].text, boxX + 9, boxY + 6 + i * lineH);
      }
    }

    ctx.restore();
  };

  /**
   * Nearest index in DSP.FREQ_GRID for a frequency in Hz
   */
  Charts.nearestFreqIndex = function (freqHz) {
    const logMin = Math.log10(DSP.F_MIN);
    const logMax = Math.log10(DSP.F_MAX);
    const u = (Math.log10(Math.max(DSP.F_MIN, Math.min(DSP.F_MAX, freqHz))) - logMin) / (logMax - logMin);
    return Math.max(0, Math.min(DSP.NUM_FREQ_POINTS - 1, Math.round(u * (DSP.NUM_FREQ_POINTS - 1))));
  };

  /**
   * Main dispatcher: Render current active tab onto canvas
   */
  Charts.render = function (canvas, state) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const isLight = state.theme === 'light';

    // Fill graph canvas background
    ctx.fillStyle = isLight ? '#f8fafc' : '#14171c';
    ctx.fillRect(0, 0, W, H);

    const activeMeas = state.measurements.find(m => m.id === state.selectedId) || state.measurements[0];
    if (!activeMeas) {
      ctx.restore();
      return;
    }

    const plotRect = {
      x: 58,
      y: 18,
      w: Math.max(100, W - 118),
      h: Math.max(80, H - 56)
    };

    // Plot inner background
    ctx.fillStyle = isLight ? '#ffffff' : '#0f1216';
    ctx.fillRect(plotRect.x, plotRect.y, plotRect.w, plotRect.h);

    switch (state.activeTab) {
      case 'all-spl':
        Charts.renderAllSPL(ctx, plotRect, state);
        break;
      case 'spl-phase':
        Charts.renderSPLAndPhase(ctx, plotRect, activeMeas, state);
        break;
      case 'distortion':
        Charts.renderDistortion(ctx, plotRect, activeMeas, state);
        break;
      case 'impulse':
        Charts.renderImpulse(ctx, plotRect, activeMeas, state, false);
        break;
      case 'filtered-ir':
        Charts.renderImpulse(ctx, plotRect, activeMeas, state, true);
        break;
      case 'gd':
        Charts.renderGroupDelay(ctx, plotRect, activeMeas, state);
        break;
      case 'rt60':
        Charts.renderRT60(ctx, plotRect, activeMeas, state);
        break;
      case 'decay':
        Charts.renderDecay(ctx, plotRect, activeMeas, state);
        break;
      case 'waterfall':
        Charts.renderWaterfall3D(ctx, plotRect, activeMeas, state);
        break;
      case 'spectrogram':
        Charts.renderSpectrogram(ctx, plotRect, activeMeas, state);
        break;
      case 'eq':
        Charts.renderEQ(ctx, plotRect, activeMeas, state);
        break;
      default:
        Charts.renderSPLAndPhase(ctx, plotRect, activeMeas, state);
    }

    // Plot border
    ctx.strokeStyle = isLight ? '#cbd5e1' : '#2a303c';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotRect.x + 0.5, plotRect.y + 0.5, plotRect.w, plotRect.h);

    ctx.restore();
  };

  /**
   * 1. ALL SPL Tab - Compare all checked measurements + averages
   */
  Charts.renderAllSPL = function (ctx, plotRect, state) {
    const { fMin, fMax, splMin, splMax } = state.limits;
    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, splMin, splMax, 5, 'SPL (dB)', state.theme, null);

    const visibleList = state.measurements.filter(m => m.visible);
    for (let i = 0; i < visibleList.length; i++) {
      const m = visibleList[i];
      const smoothed = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, state.smoothing);
      const isSelected = m.id === state.selectedId;
      Charts.drawFreqTrace(
        ctx,
        plotRect,
        DSP.FREQ_GRID,
        smoothed,
        fMin,
        fMax,
        splMin,
        splMax,
        m.color,
        isSelected ? 2.4 : 1.6
      );
    }

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const noteInfo = DSP.freqToNoteAndWavelength(f);
      const readout = [
        { text: `Freq: ${f.toFixed(1)} Hz  [${noteInfo.note}]` },
        { text: `Wavelength: ${noteInfo.wavelengthM.toFixed(2)} m` }
      ];
      for (let i = 0; i < Math.min(6, visibleList.length); i++) {
        const m = visibleList[i];
        const smoothed = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, state.smoothing);
        readout.push({
          text: `${m.name.slice(0, 18)}: ${smoothed[idx].toFixed(1)} dB`,
          color: m.color
        });
      }
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, readout, state.theme);
    }
  };

  /**
   * 2. SPL & PHASE Tab
   */
  Charts.renderSPLAndPhase = function (ctx, plotRect, m, state) {
    const { fMin, fMax, splMin, splMax } = state.limits;
    const traces = state.traceToggles['spl-phase'];

    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, splMin, splMax, 5, 'SPL (dB)', state.theme, null);
    Charts.drawLinearYGrid(ctx, plotRect, -180, 180, 45, 'Phase (deg)', state.theme, {
      color: '#38bdf8',
      suffix: '°'
    });

    const smoothedSpl = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, state.smoothing);

    if (traces.spl) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, smoothedSpl, fMin, fMax, splMin, splMax, m.color, 2.3);
    }
    if (traces.phase) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, m.analysis.phaseWrapped, fMin, fMax, -180, 180, '#38bdf8', 1.5, [5, 3]);
    }
    if (traces.minPhase) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, m.analysis.minPhaseDeg, fMin, fMax, -180, 180, '#a78bfa', 1.4, [2, 2]);
    }
    if (traces.excessPhase) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, m.analysis.excessPhaseDeg, fMin, fMax, -180, 180, '#f472b6', 1.3);
    }
    if (traces.target) {
      const targetCurve = DSP.computeTargetCurve(state.eqConfig);
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, targetCurve, fMin, fMax, splMin, splMax, '#94a3b8', 1.6, [6, 4]);
    }

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const noteInfo = DSP.freqToNoteAndWavelength(f);
      const lines = [
        { text: `Freq: ${f.toFixed(1)} Hz (${noteInfo.note})` },
        { text: `SPL:  ${smoothedSpl[idx].toFixed(2)} dB`, color: m.color },
        { text: `Phase: ${m.analysis.phaseWrapped[idx].toFixed(1)}° (Min: ${m.analysis.minPhaseDeg[idx].toFixed(1)}°)`, color: '#38bdf8' },
        { text: `λ = ${noteInfo.wavelengthM.toFixed(2)} m (${(noteInfo.wavelengthM * 3.28084).toFixed(2)} ft)` }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 3. DISTORTION Tab (Fundamental, THD, H2..H5, Noise Floor in dB SPL or %)
   */
  Charts.renderDistortion = function (ctx, plotRect, m, state) {
    const { fMin, fMax } = state.limits;
    const dist = m.analysis.distortion;
    const traces = state.traceToggles['distortion'];
    const usePercent = state.distortionMode === 'percent';

    const yMin = usePercent ? 0 : 20;
    const yMax = usePercent ? 10 : 105;
    const yStep = usePercent ? 1 : 10;
    const yLabel = usePercent ? 'Distortion (%)' : 'Level (dB SPL)';

    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, yMin, yMax, yStep, yLabel, state.theme, null);

    function toPlotArray(dbArr) {
      if (!usePercent) return DSP.smoothResponse(DSP.FREQ_GRID, dbArr, state.smoothing);
      const out = new Float64Array(DSP.NUM_FREQ_POINTS);
      for (let i = 0; i < DSP.NUM_FREQ_POINTS; i++) {
        const diffDb = dbArr[i] - dist.fund[i];
        out[i] = Math.min(100, Math.pow(10, diffDb / 20) * 100);
      }
      return DSP.smoothResponse(DSP.FREQ_GRID, out, state.smoothing);
    }

    if (!usePercent && traces.fund) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.fund), fMin, fMax, yMin, yMax, m.color, 2.2);
    }
    if (traces.thd) {
      const thdArr = usePercent
        ? DSP.smoothResponse(DSP.FREQ_GRID, dist.thdPercent, state.smoothing)
        : toPlotArray(dist.thdDb);
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, thdArr, fMin, fMax, yMin, yMax, '#ef4444', 2.4);
    }
    if (traces.h2) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.h2), fMin, fMax, yMin, yMax, '#f59e0b', 1.7);
    }
    if (traces.h3) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.h3), fMin, fMax, yMin, yMax, '#10b981', 1.7);
    }
    if (traces.h4) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.h4), fMin, fMax, yMin, yMax, '#38bdf8', 1.4);
    }
    if (traces.h5) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.h5), fMin, fMax, yMin, yMax, '#c084fc', 1.4);
    }
    if (!usePercent && traces.noise) {
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, toPlotArray(dist.noiseFloor), fMin, fMax, yMin, yMax, '#64748b', 1.3, [4, 4]);
    }

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const fDb = dist.fund[idx];
      const h2Pct = Math.pow(10, (dist.h2[idx] - fDb) / 20) * 100;
      const h3Pct = Math.pow(10, (dist.h3[idx] - fDb) / 20) * 100;
      const h4Pct = Math.pow(10, (dist.h4[idx] - fDb) / 20) * 100;
      const lines = [
        { text: `Freq: ${f.toFixed(1)} Hz | Fund: ${fDb.toFixed(1)} dB` },
        { text: `THD:  ${dist.thdPercent[idx].toFixed(2)}% (${(dist.thdDb[idx] - fDb).toFixed(1)} dBr)`, color: '#ef4444' },
        { text: `H2:   ${h2Pct.toFixed(2)}% (${dist.h2[idx].toFixed(1)} dB)`, color: '#f59e0b' },
        { text: `H3:   ${h3Pct.toFixed(2)}% (${dist.h3[idx].toFixed(1)} dB)`, color: '#10b981' },
        { text: `H4:   ${h4Pct.toFixed(3)}% | Noise: ${dist.noiseFloor[idx].toFixed(1)} dB`, color: '#38bdf8' }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 4 & 5. IMPULSE & FILTERED IR Tabs
   */
  Charts.renderImpulse = function (ctx, plotRect, m, state, isFilteredBand) {
    const sampleRate = m.sampleRate || 48000;
    const peakIdx = m.peakIdx || 960;
    const tMinMs = state.impulseLimits.tMinMs;
    const tMaxMs = state.impulseLimits.tMaxMs;
    const unitMode = state.impulseUnitMode || 'dbfs'; // 'dbfs' (ETC) or 'percent'
    const traces = state.traceToggles['impulse'];

    const yMin = unitMode === 'percent' ? -100 : -70;
    const yMax = unitMode === 'percent' ? 100 : 5;
    const yStep = unitMode === 'percent' ? 20 : 10;
    const yTitle = unitMode === 'percent' ? 'Impulse (% FS)' : 'ETC / Schroeder (dBFS)';

    // Draw linear time X grid (ms)
    const isLight = state.theme === 'light';
    ctx.save();
    const tSpan = tMaxMs - tMinMs;
    const tStep = tSpan <= 30 ? 2 : tSpan <= 80 ? 5 : tSpan <= 200 ? 20 : 50;
    const firstT = Math.ceil(tMinMs / tStep) * tStep;

    for (let t = firstT; t <= tMaxMs + 1e-6; t += tStep) {
      const u = (t - tMinMs) / tSpan;
      const x = Math.round(plotRect.x + u * plotRect.w) + 0.5;
      ctx.beginPath();
      ctx.strokeStyle = Math.abs(t) < 1e-6
        ? (isLight ? 'rgba(239,68,68,0.5)' : 'rgba(248,113,113,0.55)')
        : (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)');
      ctx.moveTo(x, plotRect.y);
      ctx.lineTo(x, plotRect.y + plotRect.h);
      ctx.stroke();

      ctx.fillStyle = isLight ? '#334155' : '#9ca3af';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${t} ms`, x, plotRect.y + plotRect.h + 6);
    }
    ctx.fillStyle = isLight ? '#334155' : '#9ca3af';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Time relative to IR Peak (ms)', plotRect.x + plotRect.w / 2, plotRect.y + plotRect.h + 22);
    ctx.restore();

    Charts.drawLinearYGrid(ctx, plotRect, yMin, yMax, yStep, yTitle, state.theme, null);

    let irPct = m.analysis.irPercent;
    let etcDb = m.analysis.etcDb;
    let schroederDb = m.analysis.schroederDb;

    if (isFilteredBand) {
      const filt = DSP.computeFilteredIR(m.ir, sampleRate, state.filteredIrFreq || 125, 1 / 3);
      irPct = filt.filteredIr;
      etcDb = filt.etcDb;
      schroederDb = filt.schroeder;
    }

    function drawTimeSeries(arr, vMin, vMax, color, width, dash) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotRect.x, plotRect.y, plotRect.w, plotRect.h);
      ctx.clip();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1.6;
      if (dash) ctx.setLineDash(dash);

      const startSample = Math.max(0, peakIdx + Math.floor((tMinMs / 1000) * sampleRate));
      const endSample = Math.min(arr.length - 1, peakIdx + Math.ceil((tMaxMs / 1000) * sampleRate));
      const stride = Math.max(1, Math.floor((endSample - startSample) / 1600));

      let started = false;
      for (let i = startSample; i <= endSample; i += stride) {
        const tMs = ((i - peakIdx) / sampleRate) * 1000;
        const x = plotRect.x + ((tMs - tMinMs) / (tMaxMs - tMinMs)) * plotRect.w;
        const y = Charts.valToY(arr[i], plotRect, vMin, vMax);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    if (unitMode === 'percent') {
      drawTimeSeries(irPct, -100, 100, m.color, 1.7);
      if (traces.step && !isFilteredBand) {
        drawTimeSeries(m.analysis.stepResponse, -100, 100, '#38bdf8', 1.5, [4, 3]);
      }
    } else {
      drawTimeSeries(etcDb, -70, 5, m.color, 1.6);
      if (traces.schroeder) {
        drawTimeSeries(schroederDb, -70, 5, '#10b981', 2.1);
      }
    }

    if (traces.window) {
      // Map windowCurve [0..1] to top range
      drawTimeSeries(m.analysis.windowCurve, 0, 1.05, '#f59e0b', 1.5, [5, 3]);
    }

    if (state.mouse && state.mouse.inside) {
      const u = (state.mouse.x - plotRect.x) / plotRect.w;
      const tMs = tMinMs + u * (tMaxMs - tMinMs);
      const sIdx = Math.max(0, Math.min(irPct.length - 1, peakIdx + Math.round((tMs / 1000) * sampleRate)));
      const distM = (tMs / 1000) * 343.0;
      const lines = [
        { text: `Time: ${tMs.toFixed(2)} ms (${distM >= 0 ? '+' : ''}${distM.toFixed(2)} m)` },
        { text: `IR: ${irPct[sIdx].toFixed(2)} %FS | ETC: ${etcDb[sIdx].toFixed(1)} dBFS`, color: m.color },
        { text: `Schroeder Decay: ${schroederDb[sIdx].toFixed(1)} dB`, color: '#10b981' },
        { text: `Window Weight: ${(m.analysis.windowCurve[sIdx] * 100).toFixed(1)}%`, color: '#f59e0b' }
      ];
      if (isFilteredBand) {
        lines.unshift({ text: `Band-Pass Filter: 1/3 Oct @ ${state.filteredIrFreq} Hz`, color: '#38bdf8' });
      }
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 6. GROUP DELAY (GD) Tab
   */
  Charts.renderGroupDelay = function (ctx, plotRect, m, state) {
    const { fMin, fMax } = state.limits;
    const yMin = -25;
    const yMax = 45;

    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, yMin, yMax, 5, 'Group Delay (ms)', state.theme, null);

    const gdSmoothed = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.groupDelayMs, state.smoothing);
    Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, gdSmoothed, fMin, fMax, yMin, yMax, m.color, 2.2);

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const gdVal = gdSmoothed[idx];
      const periods = (gdVal / 1000) * f;
      const lines = [
        { text: `Freq: ${f.toFixed(1)} Hz` },
        { text: `Group Delay: ${gdVal.toFixed(2)} ms (${periods.toFixed(2)} cycles)`, color: m.color },
        { text: `Equiv Distance: ${((gdVal / 1000) * 343).toFixed(2)} m` }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 7. RT60 Reverberation Time Tab (EDT, T20, T30, Topt across 1/3-octave bands)
   */
  Charts.renderRT60 = function (ctx, plotRect, m, state) {
    const rt = m.analysis.rt60;
    const traces = state.traceToggles['rt60'];
    const fMin = 25;
    const fMax = 20000;
    const yMin = 0.0;
    const yMax = 1.2;

    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, yMin, yMax, 0.1, 'Reverberation Time RT60 (s)', state.theme, null);

    // Draw Target studio RT60 tolerance zone (0.25s - 0.45s)
    ctx.save();
    const yTopZone = Charts.valToY(0.45, plotRect, yMin, yMax);
    const yBotZone = Charts.valToY(0.25, plotRect, yMin, yMax);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.07)';
    ctx.fillRect(plotRect.x, yTopZone, plotRect.w, yBotZone - yTopZone);
    ctx.restore();

    function drawRTSeries(values, color, width, dash, drawMarkers) {
      Charts.drawFreqTrace(ctx, plotRect, rt.freqs, values, fMin, fMax, yMin, yMax, color, width, dash);
      if (!drawMarkers) return;
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < rt.freqs.length; i++) {
        const x = Charts.freqToX(rt.freqs[i], plotRect, fMin, fMax);
        const y = Charts.valToY(values[i], plotRect, yMin, yMax);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
    }

    if (traces.edt) drawRTSeries(rt.edt, '#38bdf8', 1.8, [5, 3], true);
    if (traces.t20) drawRTSeries(rt.t20, '#f59e0b', 1.8, null, true);
    if (traces.t30) drawRTSeries(rt.t30, '#a78bfa', 1.8, null, true);
    if (traces.topt) drawRTSeries(rt.topt, '#10b981', 2.5, null, true);

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      // Find nearest 1/3 octave band
      let bestB = 0;
      let bestDiff = 1e9;
      for (let b = 0; b < rt.freqs.length; b++) {
        const d = Math.abs(Math.log2(f / rt.freqs[b]));
        if (d < bestDiff) {
          bestDiff = d;
          bestB = b;
        }
      }
      const lines = [
        { text: `1/3 Oct Band: ${rt.freqs[bestB]} Hz  (r = ${rt.corr[bestB].toFixed(3)})` },
        { text: `Topt: ${(rt.topt[bestB] * 1000).toFixed(0)} ms (${rt.topt[bestB].toFixed(2)} s)`, color: '#10b981' },
        { text: `EDT:  ${(rt.edt[bestB] * 1000).toFixed(0)} ms | T20: ${(rt.t20[bestB] * 1000).toFixed(0)} ms`, color: '#38bdf8' },
        { text: `T30:  ${(rt.t30[bestB] * 1000).toFixed(0)} ms`, color: '#a78bfa' },
        { text: `C50: ${rt.c50[bestB].toFixed(1)} dB | C80: ${rt.c80[bestB].toFixed(1)} dB | D50: ${rt.d50[bestB].toFixed(0)}%`, color: '#f59e0b' }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 8. DECAY Tab (2D Multi-Slice Spectral Decay at 0, 20, 40, 60, 100, 160, 220, 300 ms)
   */
  Charts.renderDecay = function (ctx, plotRect, m, state) {
    const { fMin, fMax, splMin, splMax } = state.limits;
    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, splMin, splMax, 5, 'Decay Level (dB SPL)', state.theme, null);

    const wf = DSP.computeWaterfall(m, {
      timeRangeMs: state.waterfallConfig.timeRangeMs,
      numSlices: 9,
      smoothing: state.smoothing === 'none' ? '1/12' : state.smoothing
    });

    for (let s = wf.slices.length - 1; s >= 0; s--) {
      const slice = wf.slices[s];
      const norm = 1 - s / Math.max(1, wf.slices.length - 1);
      const color = s === 0 ? m.color : Charts.valueToColor(norm, state.waterfallConfig.colorScheme, 0.88);
      Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, slice.spl, fMin, fMax, splMin, splMax, color, s === 0 ? 2.4 : 1.5);
    }

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const s0 = wf.slices[0].spl[idx];
      const sMid = wf.slices[4].spl[idx];
      const sEnd = wf.slices[wf.slices.length - 1].spl[idx];
      const lines = [
        { text: `Freq: ${f.toFixed(1)} Hz` },
        { text: `0 ms Slice: ${s0.toFixed(1)} dB SPL`, color: m.color },
        { text: `${wf.slices[4].timeMs.toFixed(0)} ms Slice: ${sMid.toFixed(1)} dB (${(sMid - s0).toFixed(1)} dB)` },
        { text: `${wf.slices[wf.slices.length - 1].timeMs.toFixed(0)} ms Slice: ${sEnd.toFixed(1)} dB (${(sEnd - s0).toFixed(1)} dB)` }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 9. WATERFALL Tab - 3D Isometric Cumulative Spectral Decay (CSD) Plot
   */
  Charts.renderWaterfall3D = function (ctx, plotRect, m, state) {
    const { fMin, fMax, splMin, splMax } = state.limits;
    const cfg = state.waterfallConfig;
    const isLight = state.theme === 'light';

    const wf = DSP.computeWaterfall(m, {
      timeRangeMs: cfg.timeRangeMs,
      numSlices: cfg.numSlices,
      smoothing: state.smoothing === 'none' ? '1/12' : state.smoothing
    });

    // 3D Isometric projection bounds inside plotRect
    const depthX = cfg.skewX; // horizontal offset from front (t=max) to back (t=0)
    const depthY = cfg.skewY; // vertical offset from front (t=max) to back (t=0)

    const frontRect = {
      x: plotRect.x + Math.max(0, -depthX) + 18,
      y: plotRect.y + depthY + 14,
      w: plotRect.w - Math.abs(depthX) - 64,
      h: plotRect.h - depthY - 32
    };

    function project3D(freq, dbVal, timeMs) {
      // zNorm = 0 at back (t = 0 ms), zNorm = 1 at front (t = timeRangeMs)
      const zNorm = Math.max(0, Math.min(1, timeMs / cfg.timeRangeMs));
      const logMin = Math.log10(fMin);
      const logMax = Math.log10(fMax);
      const xNorm = (Math.log10(Math.max(fMin, Math.min(fMax, freq))) - logMin) / (logMax - logMin);
      const yNorm = Math.max(0, Math.min(1, (dbVal - splMin) / (splMax - splMin)));

      const shiftX = (1 - zNorm) * depthX;
      const shiftY = -(1 - zNorm) * depthY;

      return {
        x: frontRect.x + xNorm * frontRect.w + shiftX,
        y: frontRect.y + (1 - yNorm) * frontRect.h + shiftY
      };
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotRect.x, plotRect.y, plotRect.w, plotRect.h);
    ctx.clip();

    // Draw 3D Back Wall & Side Wall wireframe grid
    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let db = splMin; db <= splMax; db += 10) {
      const pL = project3D(fMin, db, 0);
      const pR = project3D(fMax, db, 0);
      const pFrontR = project3D(fMax, db, cfg.timeRangeMs);
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.lineTo(pFrontR.x, pFrontR.y);
      ctx.stroke();

      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      ctx.font = '10.5px -apple-system, BlinkMacSystemFont, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${db} dB`, pL.x - 6, pL.y + 3);
    }

    // Draw Z-axis time ticks on right floor edge
    const timeTicks = [0, 0.25, 0.5, 0.75, 1.0];
    ctx.font = '10.5px -apple-system, BlinkMacSystemFont, monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < timeTicks.length; i++) {
      const tMs = timeTicks[i] * cfg.timeRangeMs;
      const pFloorR = project3D(fMax, splMin, tMs);
      const pFloorL = project3D(fMin, splMin, tMs);
      ctx.beginPath();
      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
      ctx.moveTo(pFloorL.x, pFloorL.y);
      ctx.lineTo(pFloorR.x, pFloorR.y);
      ctx.stroke();
      ctx.fillStyle = isLight ? '#334155' : '#9ca3af';
      ctx.fillText(`${Math.round(tMs)} ms`, pFloorR.x + 6, pFloorR.y + 3);
    }

    // Painter's Algorithm: Draw slices from back (t = 0) to front (t = timeRangeMs)
    const M = DSP.NUM_FREQ_POINTS;
    for (let s = 0; s < wf.slices.length; s++) {
      const slice = wf.slices[s];
      const zNorm = s / Math.max(1, wf.slices.length - 1);

      ctx.beginPath();
      const pStartFloor = project3D(fMin, splMin, slice.timeMs);
      ctx.moveTo(pStartFloor.x, pStartFloor.y);

      let peakSliceDb = splMin;
      for (let i = 0; i < M; i++) {
        const f = DSP.FREQ_GRID[i];
        if (f < fMin || f > fMax) continue;
        const val = Math.max(splMin, Math.min(splMax, slice.spl[i]));
        if (val > peakSliceDb) peakSliceDb = val;
        const pt = project3D(f, val, slice.timeMs);
        ctx.lineTo(pt.x, pt.y);
      }

      const pEndFloor = project3D(fMax, splMin, slice.timeMs);
      ctx.lineTo(pEndFloor.x, pEndFloor.y);
      ctx.closePath();

      // Occlusion fill so front slices cleanly mask rear slices like REW's solid waterfall
      const levelNorm = (peakSliceDb - splMin) / (splMax - splMin);
      const fillAlpha = isLight ? 0.85 : 0.88;
      ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.9)' : 'rgba(15, 18, 22, 0.92)';
      ctx.fill();

      ctx.fillStyle = Charts.valueToColor(1 - zNorm * 0.85, cfg.colorScheme, 0.24 * fillAlpha);
      ctx.fill();

      // Stroke top ridge of slice
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < M; i++) {
        const f = DSP.FREQ_GRID[i];
        if (f < fMin || f > fMax) continue;
        const val = Math.max(splMin, Math.min(splMax, slice.spl[i]));
        const pt = project3D(f, val, slice.timeMs);
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.strokeStyle = s === 0
        ? '#ffffff'
        : Charts.valueToColor(1 - zNorm * 0.9, cfg.colorScheme, 0.95);
      ctx.lineWidth = s === 0 ? 2.2 : 1.25;
      ctx.stroke();
    }

    // Draw front frequency labels along the t = timeRangeMs front floor edge
    const labelFreqs = [20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    ctx.fillStyle = isLight ? '#334155' : '#9ca3af';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < labelFreqs.length; i++) {
      const lf = labelFreqs[i];
      if (lf < fMin || lf > fMax) continue;
      const pt = project3D(lf, splMin, cfg.timeRangeMs);
      ctx.fillText(lf >= 1000 ? `${lf / 1000}k` : `${lf}`, pt.x, pt.y + 14);
    }

    ctx.restore();

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, frontRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const s0 = wf.slices[0].spl[idx];
      const sMid = wf.slices[Math.floor(wf.slices.length / 2)].spl[idx];
      const sEnd = wf.slices[wf.slices.length - 1].spl[idx];
      const lines = [
        { text: `3D CSD Waterfall (${cfg.numSlices} slices, ${cfg.timeRangeMs} ms)` },
        { text: `Freq: ${f.toFixed(1)} Hz (${DSP.freqToNoteAndWavelength(f).note})` },
        { text: `t=0 ms: ${s0.toFixed(1)} dB | t=${(cfg.timeRangeMs / 2).toFixed(0)} ms: ${sMid.toFixed(1)} dB`, color: '#38bdf8' },
        { text: `t=${cfg.timeRangeMs} ms: ${sEnd.toFixed(1)} dB (Decay: ${(s0 - sEnd).toFixed(1)} dB)`, color: '#10b981' }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 10. SPECTROGRAM Tab - Wavelet / Multi-Resolution Time-Frequency Heatmap
   */
  Charts.renderSpectrogram = function (ctx, plotRect, m, state) {
    const { fMin, fMax } = state.limits;
    const spec = DSP.computeSpectrogram(m, {
      minTimeMs: -20,
      maxTimeMs: state.waterfallConfig.timeRangeMs || 260,
      numTimeCols: 100
    });

    const colorBarW = 18;
    const heatRect = {
      x: plotRect.x,
      y: plotRect.y,
      w: plotRect.w - colorBarW - 22,
      h: plotRect.h
    };

    Charts.drawLogFreqGrid(ctx, heatRect, fMin, fMax, state.theme, true);

    const dynamicRangeDb = 45;
    const topDb = spec.maxSpl;
    const botDb = topDb - dynamicRangeDb;

    const cols = spec.timesMs.length;
    const rows = spec.freqs.length;

    ctx.save();
    ctx.beginPath();
    ctx.rect(heatRect.x, heatRect.y, heatRect.w, heatRect.h);
    ctx.clip();

    // Render 2D Heatmap Cells (X = Frequency log scale, Y = Time ms from bottom to top or top to bottom)
    for (let r = 0; r < rows - 1; r++) {
      const f0 = spec.freqs[r];
      const f1 = spec.freqs[r + 1];
      if (f1 < fMin || f0 > fMax) continue;
      const x0 = Math.floor(Charts.freqToX(f0, heatRect, fMin, fMax));
      const x1 = Math.ceil(Charts.freqToX(f1, heatRect, fMin, fMax));
      const cellW = Math.max(1, x1 - x0);

      for (let c = 0; c < cols - 1; c++) {
        const t0 = spec.timesMs[c];
        const t1 = spec.timesMs[c + 1];
        const y0 = Math.floor(Charts.valToY(t1, heatRect, spec.minTimeMs, spec.maxTimeMs));
        const y1 = Math.ceil(Charts.valToY(t0, heatRect, spec.minTimeMs, spec.maxTimeMs));
        const cellH = Math.max(1, y1 - y0);

        const dbVal = spec.matrix[c][r];
        const norm = (dbVal - botDb) / dynamicRangeDb;
        ctx.fillStyle = Charts.valueToColor(norm, state.waterfallConfig.colorScheme, 1.0);
        ctx.fillRect(x0, y0, cellW, cellH);
      }
    }

    // Overlay Peak Energy Time Curve (Ridge) in dashed white/black
    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([5, 3]);
    for (let r = 0; r < rows; r++) {
      const x = Charts.freqToX(spec.freqs[r], heatRect, fMin, fMax);
      const y = Charts.valToY(spec.ridgeMs[r], heatRect, spec.minTimeMs, spec.maxTimeMs);
      if (r === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Draw Y-axis Time gridlines & labels
    Charts.drawLinearYGrid(ctx, heatRect, spec.minTimeMs, spec.maxTimeMs, 25, 'Time (ms)', state.theme, null);

    // Draw Right Color Scale Legend Bar
    const barX = heatRect.x + heatRect.w + 10;
    const barY = heatRect.y;
    const barH = heatRect.h;
    for (let py = 0; py < barH; py++) {
      const norm = 1 - py / barH;
      ctx.fillStyle = Charts.valueToColor(norm, state.waterfallConfig.colorScheme, 1.0);
      ctx.fillRect(barX, barY + py, colorBarW, 1.5);
    }
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(barX + 0.5, barY + 0.5, colorBarW, barH);

    ctx.fillStyle = state.theme === 'light' ? '#334155' : '#9ca3af';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
    ctx.textAlign = 'left';
    for (let d = 0; d <= dynamicRangeDb; d += 10) {
      const y = barY + (d / dynamicRangeDb) * barH;
      ctx.fillText(`-${d}dB`, barX + colorBarW + 4, y + 3);
    }

    if (state.mouse && state.mouse.inside && state.mouse.x <= heatRect.x + heatRect.w) {
      const f = Charts.xToFreq(state.mouse.x, heatRect, fMin, fMax);
      const tMs = Charts.yToVal(state.mouse.y, heatRect, spec.minTimeMs, spec.maxTimeMs);
      // Find nearest row & col
      let rIdx = 0;
      for (let r = 0; r < rows; r++) {
        if (spec.freqs[r] <= f) rIdx = r;
      }
      let cIdx = Math.max(0, Math.min(cols - 1, Math.round(((tMs - spec.minTimeMs) / (spec.maxTimeMs - spec.minTimeMs)) * (cols - 1))));
      const cellDb = spec.matrix[cIdx][rIdx];
      const lines = [
        { text: `Wavelet Spectrogram (45 dB Scale)` },
        { text: `Freq: ${f.toFixed(1)} Hz | Time: ${tMs.toFixed(1)} ms` },
        { text: `Level: ${cellDb.toFixed(1)} dB SPL (${(cellDb - topDb).toFixed(1)} dBr)`, color: '#38bdf8' },
        { text: `Peak Energy Ridge: ${spec.ridgeMs[rIdx].toFixed(1)} ms`, color: '#10b981' }
      ];
      Charts.drawCrosshairAndReadout(ctx, heatRect, state.mouse, lines, state.theme);
    }
  };

  /**
   * 11. EQ Tab - Automatic Room EQ & Biquad Parametric Filter Bank Response
   */
  Charts.renderEQ = function (ctx, plotRect, m, state) {
    const { fMin, fMax, splMin, splMax } = state.limits;
    Charts.drawLogFreqGrid(ctx, plotRect, fMin, fMax, state.theme, true);
    Charts.drawLinearYGrid(ctx, plotRect, splMin, splMax, 5, 'SPL (dB)', state.theme, null);
    Charts.drawLinearYGrid(ctx, plotRect, -20, 20, 5, 'EQ Filter Gain (dB)', state.theme, {
      color: '#f59e0b',
      suffix: ' dB'
    });

    const origSpl = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, state.smoothing === 'none' ? 'var' : state.smoothing);
    const targetCurve = DSP.computeTargetCurve(state.eqConfig);
    const filterBank = DSP.computeFilterBankResponse(m.eqFilters, m.sampleRate || 48000);
    const predictedSpl = new Float64Array(DSP.NUM_FREQ_POINTS);
    for (let i = 0; i < DSP.NUM_FREQ_POINTS; i++) {
      predictedSpl[i] = origSpl[i] + filterBank.magDb[i];
    }

    // Draw Original SPL (semi-transparent dashed)
    Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, origSpl, fMin, fMax, splMin, splMax, 'rgba(148, 163, 184, 0.65)', 1.6, [4, 3]);
    // Draw House Target Curve (blue)
    Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, targetCurve, fMin, fMax, splMin, splMax, '#38bdf8', 2.0, [6, 4]);
    // Draw Combined EQ Filter Transfer Function mapped to [-20, +20 dB]
    Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, filterBank.magDb, fMin, fMax, -20, 20, '#f59e0b', 2.0);
    // Draw Predicted Equalized SPL (bright green)
    Charts.drawFreqTrace(ctx, plotRect, DSP.FREQ_GRID, predictedSpl, fMin, fMax, splMin, splMax, '#10b981', 2.5);

    if (state.mouse && state.mouse.inside) {
      const f = Charts.xToFreq(state.mouse.x, plotRect, fMin, fMax);
      const idx = Charts.nearestFreqIndex(f);
      const lines = [
        { text: `Freq: ${f.toFixed(1)} Hz` },
        { text: `Original SPL:  ${origSpl[idx].toFixed(1)} dB`, color: '#94a3b8' },
        { text: `Target Curve:  ${targetCurve[idx].toFixed(1)} dB`, color: '#38bdf8' },
        { text: `EQ Correction: ${filterBank.magDb[idx] >= 0 ? '+' : ''}${filterBank.magDb[idx].toFixed(2)} dB`, color: '#f59e0b' },
        { text: `Predicted SPL: ${predictedSpl[idx].toFixed(1)} dB`, color: '#10b981' }
      ];
      Charts.drawCrosshairAndReadout(ctx, plotRect, state.mouse, lines, state.theme);
    }
  };

  global.REW_Charts = Charts;
})(window);
