/**
 * Room EQ Wizard (REW v5.40) - Desktop Application Controller (app.js)
 * Connects UI, Measurements List, Graph Tabs, Acoustic DSP Engine,
 * Live WebAudio Sweep Measurement, Signal Generator, RTA/SPL Meter,
 * Room Simulator, and Parametric EQ Optimizer.
 */
(function () {
  'use strict';

  const DSP = window.REW_DSP;
  const Charts = window.REW_Charts;

  const TRACE_COLORS = [
    '#ef4444', // REW Measurement 1 Red/Orange
    '#10b981', // REW Measurement 2 Emerald Green
    '#3b82f6', // REW Measurement 3 Royal Blue
    '#f59e0b', // REW Measurement 4 Amber
    '#a855f7', // REW Measurement 5 Purple
    '#06b6d4', // REW Measurement 6 Cyan
    '#ec4899', // REW Measurement 7 Pink
    '#84cc16'  // REW Measurement 8 Lime
  ];

  const state = {
    lang: 'zh', // 'zh' or 'en'
    theme: 'dark', // 'dark' or 'light'
    activeTab: 'spl-phase',
    smoothing: '1/12',
    selectedId: 1,
    nextId: 1,
    measurements: [],
    limits: {
      fMin: 20,
      fMax: 20000,
      splMin: 45,
      splMax: 105
    },
    impulseLimits: {
      tMinMs: -15,
      tMaxMs: 160
    },
    impulseUnitMode: 'dbfs', // 'dbfs' or 'percent'
    filteredIrFreq: 125,
    distortionMode: 'db', // 'db' or 'percent'
    waterfallConfig: {
      timeRangeMs: 300,
      numSlices: 32,
      skewX: -95,
      skewY: 85,
      colorScheme: 'rainbow'
    },
    eqConfig: {
      targetLevel: 81.5,
      lfCutoff: 35,
      lfRiseStart: 140,
      lfRiseDb: 3.5,
      hfFallStart: 1600,
      hfFallSlope: 1.0,
      matchMinFreq: 25,
      matchMaxFreq: 400,
      maxBoostDb: 3.0,
      maxCutDb: 14.0
    },
    traceToggles: {
      'spl-phase': { spl: true, phase: true, minPhase: false, excessPhase: false, target: false },
      'distortion': { fund: true, thd: true, h2: true, h3: true, h4: true, h5: false, noise: true },
      'impulse': { ir: true, schroeder: true, step: true, window: true },
      'rt60': { edt: true, t20: true, t30: true, topt: true }
    },
    mouse: { x: 0, y: 0, inside: false },
    audio: {
      ctx: null,
      genOsc: null,
      genGain: null,
      isGenerating: false,
      splStream: null,
      splAnalyser: null,
      splRaf: null,
      splWeighting: 'A'
    }
  };

  /**
   * Create and analyze a new measurement object
   */
  function createMeasurement(opts) {
    const id = state.nextId++;
    const color = opts.color || TRACE_COLORS[(id - 1) % TRACE_COLORS.length];
    const synth = opts.irData || DSP.synthesizeRoomIR({
      roomLength: opts.roomLength || 4.8,
      roomWidth: opts.roomWidth || 3.6,
      roomHeight: opts.roomHeight || 2.7,
      rt60: opts.rt60 || 0.42,
      bassBoostDb: opts.bassBoostDb !== undefined ? opts.bassBoostDb : 3.5,
      speakerFc: opts.speakerFc || 38,
      treatment: opts.treatment !== undefined ? opts.treatment : 0.3,
      splOffset: opts.splOffset || 83.0,
      seed: opts.seed || (id * 137)
    });

    const windowConfig = opts.windowConfig || {
      leftMs: 125,
      rightMs: 500,
      type: 'tukey'
    };

    const m = {
      id,
      name: opts.name || `Measurement ${id}`,
      notes: opts.notes || `48.0 kHz · 20 Hz - 20 kHz Log Sweep · Room ${synth.roomDimensions ? `${synth.roomDimensions.length}×${synth.roomDimensions.width}×${synth.roomDimensions.height}m` : '4.8×3.6×2.7m'}`,
      date: opts.date || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      color,
      visible: true,
      ir: synth.ir,
      peakIdx: synth.peakIdx,
      sampleRate: synth.sampleRate || 48000,
      splOffset: synth.splOffset || 83.0,
      distortionProfile: synth.distortionProfile,
      windowConfig,
      analysis: null,
      eqFilters: []
    };

    m.analysis = DSP.analyzeMeasurement(m, m.windowConfig);
    const smoothedForEq = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, 'var');
    const targetCurve = DSP.computeTargetCurve(state.eqConfig);
    m.eqFilters = DSP.autoMatchTargetEQ(smoothedForEq, targetCurve, state.eqConfig);

    return m;
  }

  /**
   * Load default studio & living room acoustic measurements so all tabs work immediately
   */
  function initPreloadedMeasurements() {
    state.measurements = [
      createMeasurement({
        name: '1. 主监听 左声道 (未声学处理 Untreated L)',
        roomLength: 4.85,
        roomWidth: 3.65,
        roomHeight: 2.70,
        rt60: 0.48,
        bassBoostDb: 5.2,
        speakerFc: 36,
        treatment: 0.15,
        splOffset: 83.5,
        seed: 101,
        notes: 'UMIK-1 校准麦克风 · 未加低频陷阱 · 35Hz / 71Hz 轴向驻波明显'
      }),
      createMeasurement({
        name: '2. 主监听 右声道 (未声学处理 Untreated R)',
        roomLength: 4.85,
        roomWidth: 3.65,
        roomHeight: 2.70,
        rt60: 0.46,
        bassBoostDb: 4.6,
        speakerFc: 36,
        treatment: 0.20,
        splOffset: 83.0,
        seed: 204,
        notes: 'UMIK-1 校准麦克风 · 右侧墙一次反射较强'
      }),
      createMeasurement({
        name: '3. 声学吸音改造后 (Treated Studio + Bass Traps)',
        roomLength: 4.85,
        roomWidth: 3.65,
        roomHeight: 2.70,
        rt60: 0.27,
        bassBoostDb: 2.2,
        speakerFc: 35,
        treatment: 0.78,
        splOffset: 82.0,
        seed: 309,
        notes: '四角低频陷阱 + 侧墙/天花板 100mm 吸音棉 · RT60 降至 0.27s'
      }),
      createMeasurement({
        name: '4. 2.1 低音炮融合后 (Subwoofer + PEQ Corrected)',
        roomLength: 4.85,
        roomWidth: 3.65,
        roomHeight: 2.70,
        rt60: 0.26,
        bassBoostDb: 3.0,
        speakerFc: 21,
        treatment: 0.88,
        splOffset: 82.5,
        seed: 412,
        notes: '80Hz LR4 分频 + REW 自动参量均衡校正后下潜至 21Hz'
      })
    ];
    state.selectedId = state.measurements[0].id;
  }

  function getActiveMeasurement() {
    return state.measurements.find(m => m.id === state.selectedId) || state.measurements[0];
  }

  /**
   * Render Left Sidebar Measurement Cards
   */
  function renderMeasurementList() {
    const container = document.getElementById('measurement-list');
    const countEl = document.getElementById('meas-count-badge');
    if (!container) return;
    if (countEl) countEl.textContent = `${state.measurements.length}`;

    container.innerHTML = '';
    state.measurements.forEach((m, index) => {
      const card = document.createElement('div');
      card.className = `meas-card ${m.id === state.selectedId ? 'active' : ''}`;
      card.style.borderLeftColor = m.color;

      // Compute average SPL (100 Hz - 6 kHz) & Topt @ 500 Hz
      const idx500 = Charts.nearestFreqIndex(500);
      const spl500 = m.analysis.rawSpl[idx500].toFixed(1);
      const rt500 = m.analysis.rt60.topt[12].toFixed(2); // 500 Hz band

      card.innerHTML = `
        <div class="meas-card-top">
          <label class="meas-vis-check" title="在 All SPL 图表中显示/隐藏">
            <input type="checkbox" data-action="toggle-vis" data-id="${m.id}" ${m.visible ? 'checked' : ''} />
            <span class="color-dot" style="background:${m.color}"></span>
          </label>
          <div class="meas-title" title="${m.name}">${m.name}</div>
          <button class="meas-del-btn" data-action="delete-meas" data-id="${m.id}" title="删除测量">×</button>
        </div>
        <div class="meas-meta">
          <span>${m.date}</span>
          <span>500Hz: <b>${spl500} dB</b></span>
          <span>RT60: <b>${rt500}s</b></span>
        </div>
        <div class="meas-notes">${m.notes}</div>
      `;

      card.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        if (action === 'toggle-vis') {
          m.visible = e.target.checked;
          requestGraphRender();
          return;
        }
        if (action === 'delete-meas') {
          e.stopPropagation();
          if (state.measurements.length <= 1) {
            showToast('至少需要保留一条测量记录');
            return;
          }
          state.measurements = state.measurements.filter(item => item.id !== m.id);
          if (state.selectedId === m.id) {
            state.selectedId = state.measurements[0].id;
          }
          renderAllUI();
          return;
        }
        state.selectedId = m.id;
        renderAllUI();
      });

      container.appendChild(card);
    });
  }

  /**
   * Render Contextual Bottom Panel (Trace Checkboxes + Tab-Specific Data Tables / Controls)
   */
  function renderBottomPanel() {
    const legendBar = document.getElementById('trace-legend-bar');
    const detailPane = document.getElementById('tab-detail-pane');
    const m = getActiveMeasurement();
    if (!m || !legendBar || !detailPane) return;

    // 1. Render Trace Legend Checkboxes depending on activeTab
    let legendHtml = `<div class="legend-active-meas"><span class="color-dot" style="background:${m.color}"></span><strong>${m.name}</strong></div>`;

    if (state.activeTab === 'spl-phase') {
      const t = state.traceToggles['spl-phase'];
      legendHtml += `
        <label class="trace-chip"><input type="checkbox" data-group="spl-phase" data-key="spl" ${t.spl ? 'checked' : ''}><span class="swatch" style="background:${m.color}"></span>SPL (声压级)</label>
        <label class="trace-chip"><input type="checkbox" data-group="spl-phase" data-key="phase" ${t.phase ? 'checked' : ''}><span class="swatch" style="background:#38bdf8"></span>Phase (相位)</label>
        <label class="trace-chip"><input type="checkbox" data-group="spl-phase" data-key="minPhase" ${t.minPhase ? 'checked' : ''}><span class="swatch" style="background:#a78bfa"></span>Min Phase (最小相位)</label>
        <label class="trace-chip"><input type="checkbox" data-group="spl-phase" data-key="excessPhase" ${t.excessPhase ? 'checked' : ''}><span class="swatch" style="background:#f472b6"></span>Excess Phase (超额相位)</label>
        <label class="trace-chip"><input type="checkbox" data-group="spl-phase" data-key="target" ${t.target ? 'checked' : ''}><span class="swatch" style="background:#94a3b8"></span>Target Curve (目标曲线)</label>
      `;
    } else if (state.activeTab === 'distortion') {
      const t = state.traceToggles['distortion'];
      legendHtml += `
        <div class="seg-group">
          <button class="seg-btn ${state.distortionMode === 'db' ? 'active' : ''}" data-dist-mode="db">dB SPL</button>
          <button class="seg-btn ${state.distortionMode === 'percent' ? 'active' : ''}" data-dist-mode="percent">% 百分比</button>
        </div>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="fund" ${t.fund ? 'checked' : ''}><span class="swatch" style="background:${m.color}"></span>Fundamental (基波)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="thd" ${t.thd ? 'checked' : ''}><span class="swatch" style="background:#ef4444"></span>THD (总谐波失真)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="h2" ${t.h2 ? 'checked' : ''}><span class="swatch" style="background:#f59e0b"></span>2nd Harmonic (二次)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="h3" ${t.h3 ? 'checked' : ''}><span class="swatch" style="background:#10b981"></span>3rd Harmonic (三次)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="h4" ${t.h4 ? 'checked' : ''}><span class="swatch" style="background:#38bdf8"></span>4th Harmonic (四次)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="h5" ${t.h5 ? 'checked' : ''}><span class="swatch" style="background:#c084fc"></span>5th Harmonic (五次)</label>
        <label class="trace-chip"><input type="checkbox" data-group="distortion" data-key="noise" ${t.noise ? 'checked' : ''}><span class="swatch" style="background:#64748b"></span>Noise Floor (本底噪声)</label>
      `;
    } else if (state.activeTab === 'impulse' || state.activeTab === 'filtered-ir') {
      const t = state.traceToggles['impulse'];
      legendHtml += `
        <div class="seg-group">
          <button class="seg-btn ${state.impulseUnitMode === 'dbfs' ? 'active' : ''}" data-imp-mode="dbfs">ETC (dBFS)</button>
          <button class="seg-btn ${state.impulseUnitMode === 'percent' ? 'active' : ''}" data-imp-mode="percent">线性 (% FS)</button>
        </div>
        <label class="trace-chip"><input type="checkbox" data-group="impulse" data-key="schroeder" ${t.schroeder ? 'checked' : ''}><span class="swatch" style="background:#10b981"></span>Schroeder 积分衰减曲线</label>
        <label class="trace-chip"><input type="checkbox" data-group="impulse" data-key="step" ${t.step ? 'checked' : ''}><span class="swatch" style="background:#38bdf8"></span>Step Response (阶跃响应)</label>
        <label class="trace-chip"><input type="checkbox" data-group="impulse" data-key="window" ${t.window ? 'checked' : ''}><span class="swatch" style="background:#f59e0b"></span>IR Window (${m.windowConfig.type.toUpperCase()} L:${m.windowConfig.leftMs}ms R:${m.windowConfig.rightMs}ms)</label>
      `;
      if (state.activeTab === 'filtered-ir') {
        const bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000];
        legendHtml += `<span class="inline-label">1/3 倍频程带通中心频率:</span><select id="filtered-ir-band-select" class="rew-select">`;
        bands.forEach(b => {
          legendHtml += `<option value="${b}" ${state.filteredIrFreq === b ? 'selected' : ''}>${b} Hz</option>`;
        });
        legendHtml += `</select>`;
      }
    } else if (state.activeTab === 'rt60') {
      const t = state.traceToggles['rt60'];
      legendHtml += `
        <label class="trace-chip"><input type="checkbox" data-group="rt60" data-key="topt" ${t.topt ? 'checked' : ''}><span class="swatch" style="background:#10b981"></span>Topt (REW 最优混响拟合)</label>
        <label class="trace-chip"><input type="checkbox" data-group="rt60" data-key="edt" ${t.edt ? 'checked' : ''}><span class="swatch" style="background:#38bdf8"></span>EDT (早期衰变时间 0..-10dB)</label>
        <label class="trace-chip"><input type="checkbox" data-group="rt60" data-key="t20" ${t.t20 ? 'checked' : ''}><span class="swatch" style="background:#f59e0b"></span>T20 (-5..-25dB)</label>
        <label class="trace-chip"><input type="checkbox" data-group="rt60" data-key="t30" ${t.t30 ? 'checked' : ''}><span class="swatch" style="background:#a78bfa"></span>T30 (-5..-35dB)</label>
      `;
    } else if (state.activeTab === 'waterfall' || state.activeTab === 'spectrogram' || state.activeTab === 'decay') {
      const wf = state.waterfallConfig;
      legendHtml += `
        <span class="inline-label">时间范围:</span>
        <select id="wf-timerange-select" class="rew-select">
          <option value="150" ${wf.timeRangeMs === 150 ? 'selected' : ''}>150 ms</option>
          <option value="300" ${wf.timeRangeMs === 300 ? 'selected' : ''}>300 ms</option>
          <option value="450" ${wf.timeRangeMs === 450 ? 'selected' : ''}>450 ms</option>
          <option value="600" ${wf.timeRangeMs === 600 ? 'selected' : ''}>600 ms</option>
        </select>
        <span class="inline-label">配色方案:</span>
        <select id="wf-color-select" class="rew-select">
          <option value="rainbow" ${wf.colorScheme === 'rainbow' ? 'selected' : ''}>REW 经典彩虹 (Rainbow)</option>
          <option value="viridis" ${wf.colorScheme === 'viridis' ? 'selected' : ''}>Viridis 科学配色</option>
          <option value="thermal" ${wf.colorScheme === 'thermal' ? 'selected' : ''}>热力图 (Thermal)</option>
        </select>
      `;
      if (state.activeTab === 'waterfall') {
        legendHtml += `
          <span class="inline-label">3D 视角 X:</span>
          <input type="range" id="wf-skew-x" min="-160" max="120" value="${wf.skewX}" class="rew-range" />
          <span class="inline-label">视角 Y:</span>
          <input type="range" id="wf-skew-y" min="35" max="140" value="${wf.skewY}" class="rew-range" />
        `;
      }
    } else if (state.activeTab === 'eq') {
      legendHtml += `
        <span class="trace-chip"><span class="swatch" style="background:#94a3b8"></span>原始响应 (Original)</span>
        <span class="trace-chip"><span class="swatch" style="background:#38bdf8"></span>目标曲线 (Target ${state.eqConfig.targetLevel.toFixed(1)} dB)</span>
        <span class="trace-chip"><span class="swatch" style="background:#f59e0b"></span>PEQ 滤波器合成响应</span>
        <span class="trace-chip"><span class="swatch" style="background:#10b981"></span>校正后预测曲线 (Predicted SPL)</span>
        <button class="rew-btn primary-btn sm" id="btn-auto-eq-inline">⚡ 自动拟合目标曲线 (Match Target)</button>
        <button class="rew-btn sm" id="btn-export-apo-inline">💾 导出 Equalizer APO 配置</button>
      `;
    }

    legendBar.innerHTML = legendHtml;

    // Bind events on legendBar
    legendBar.querySelectorAll('input[type="checkbox"][data-group]').forEach(cb => {
      cb.addEventListener('change', () => {
        const grp = cb.getAttribute('data-group');
        const key = cb.getAttribute('data-key');
        state.traceToggles[grp][key] = cb.checked;
        requestGraphRender();
      });
    });

    legendBar.querySelectorAll('[data-dist-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.distortionMode = btn.getAttribute('data-dist-mode');
        renderBottomPanel();
        requestGraphRender();
      });
    });

    legendBar.querySelectorAll('[data-imp-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.impulseUnitMode = btn.getAttribute('data-imp-mode');
        renderBottomPanel();
        requestGraphRender();
      });
    });

    const bandSel = document.getElementById('filtered-ir-band-select');
    if (bandSel) {
      bandSel.addEventListener('change', () => {
        state.filteredIrFreq = Number(bandSel.value);
        requestGraphRender();
      });
    }

    const wfTimeSel = document.getElementById('wf-timerange-select');
    if (wfTimeSel) {
      wfTimeSel.addEventListener('change', () => {
        state.waterfallConfig.timeRangeMs = Number(wfTimeSel.value);
        requestGraphRender();
      });
    }

    const wfColSel = document.getElementById('wf-color-select');
    if (wfColSel) {
      wfColSel.addEventListener('change', () => {
        state.waterfallConfig.colorScheme = wfColSel.value;
        requestGraphRender();
      });
    }

    const wfSkewX = document.getElementById('wf-skew-x');
    if (wfSkewX) {
      wfSkewX.addEventListener('input', () => {
        state.waterfallConfig.skewX = Number(wfSkewX.value);
        requestGraphRender();
      });
    }

    const wfSkewY = document.getElementById('wf-skew-y');
    if (wfSkewY) {
      wfSkewY.addEventListener('input', () => {
        state.waterfallConfig.skewY = Number(wfSkewY.value);
        requestGraphRender();
      });
    }

    const btnAutoEq = document.getElementById('btn-auto-eq-inline');
    if (btnAutoEq) {
      btnAutoEq.addEventListener('click', () => {
        const smoothed = DSP.smoothResponse(DSP.FREQ_GRID, m.analysis.rawSpl, 'var');
        const target = DSP.computeTargetCurve(state.eqConfig);
        m.eqFilters = DSP.autoMatchTargetEQ(smoothed, target, state.eqConfig);
        renderBottomPanel();
        requestGraphRender();
        showToast('已自动识别房间驻波峰值并生成最优 PEQ 参量均衡滤波器');
      });
    }

    const btnExportApo = document.getElementById('btn-export-apo-inline');
    if (btnExportApo) {
      btnExportApo.addEventListener('click', () => exportEqualizerAPOFile(m));
    }

    // 2. Render Tab-Specific Data Table (for RT60, EQ, or Acoustic Summary)
    if (state.activeTab === 'rt60') {
      const rt = m.analysis.rt60;
      const keyFreqs = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
      let rowsHtml = '';
      keyFreqs.forEach(kf => {
        const bIdx = rt.freqs.indexOf(kf);
        if (bIdx >= 0) {
          rowsHtml += `
            <tr>
              <td><b>${kf} Hz</b></td>
              <td>${rt.edt[bIdx].toFixed(2)} s</td>
              <td>${rt.t20[bIdx].toFixed(2)} s</td>
              <td>${rt.t30[bIdx].toFixed(2)} s</td>
              <td class="highlight-val">${rt.topt[bIdx].toFixed(2)} s</td>
              <td>${rt.c50[bIdx].toFixed(1)} dB</td>
              <td>${rt.c80[bIdx].toFixed(1)} dB</td>
              <td>${rt.d50[bIdx].toFixed(1)} %</td>
              <td>${rt.corr[bIdx].toFixed(3)}</td>
            </tr>
          `;
        }
      });
      detailPane.style.display = 'block';
      detailPane.innerHTML = `
        <table class="rew-data-table">
          <thead>
            <tr>
              <th>倍频程频段 (Band)</th>
              <th>EDT (早期衰变)</th>
              <th>T20</th>
              <th>T30</th>
              <th>Topt (最优混响)</th>
              <th>C50 (语言清晰度)</th>
              <th>C80 (音乐明晰度)</th>
              <th>D50 (定义度)</th>
              <th>线性相关系数 r</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    } else if (state.activeTab === 'eq') {
      let filterCells = '';
      m.eqFilters.slice(0, 8).forEach((flt, idx) => {
        filterCells += `
          <div class="peq-band-card ${flt.enabled ? 'on' : 'off'}">
            <div class="peq-band-head">
              <label><input type="checkbox" data-peq-idx="${idx}" data-field="enabled" ${flt.enabled ? 'checked' : ''}> #${idx + 1}</label>
              <select data-peq-idx="${idx}" data-field="type" class="peq-mini-select">
                <option value="PK" ${flt.type === 'PK' ? 'selected' : ''}>PK</option>
                <option value="LS" ${flt.type === 'LS' ? 'selected' : ''}>LS</option>
                <option value="HS" ${flt.type === 'HS' ? 'selected' : ''}>HS</option>
                <option value="Notch" ${flt.type === 'Notch' ? 'selected' : ''}>Notch</option>
              </select>
            </div>
            <div class="peq-row"><span>Fc(Hz)</span><input type="number" step="1" min="15" max="20000" data-peq-idx="${idx}" data-field="freq" value="${flt.freq}"></div>
            <div class="peq-row"><span>Gain(dB)</span><input type="number" step="0.5" min="-18" max="12" data-peq-idx="${idx}" data-field="gain" value="${flt.gain}"></div>
            <div class="peq-row"><span>Q值</span><input type="number" step="0.2" min="0.3" max="25" data-peq-idx="${idx}" data-field="q" value="${flt.q}"></div>
          </div>
        `;
      });
      detailPane.style.display = 'block';
      detailPane.innerHTML = `<div class="peq-grid-strip">${filterCells}</div>`;

      detailPane.querySelectorAll('[data-peq-idx]').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.getAttribute('data-peq-idx'));
          const field = inp.getAttribute('data-field');
          if (field === 'enabled') {
            m.eqFilters[idx].enabled = inp.checked;
            renderBottomPanel();
          } else if (field === 'type') {
            m.eqFilters[idx].type = inp.value;
          } else {
            m.eqFilters[idx][field] = Number(inp.value);
          }
          requestGraphRender();
        });
      });
    } else {
      detailPane.style.display = 'none';
      detailPane.innerHTML = '';
    }
  }

  /**
   * Render Graph Canvas
   */
  let rafPending = false;
  function requestGraphRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const canvas = document.getElementById('main-graph-canvas');
      Charts.render(canvas, state);
    });
  }

  function renderAllUI() {
    renderMeasurementList();
    renderBottomPanel();
    requestGraphRender();
  }

  /**
   * Toast notification helper
   */
  function showToast(msg) {
    const el = document.getElementById('rew-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 3400);
  }

  /**
   * Export Equalizer APO filter file
   */
  function exportEqualizerAPOFile(m) {
    const txt = DSP.exportEqualizerAPO(m, m.eqFilters, state.eqConfig.targetLevel);
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')}_EqualizerAPO.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出 Equalizer APO / miniDSP 滤波器配置文件 (.txt)');
  }

  /**
   * Ensure WebAudio API AudioContext is initialized
   */
  function getAudioContext() {
    if (!state.audio.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audio.ctx = new AudioCtx({ sampleRate: 48000 });
    }
    if (state.audio.ctx.state === 'suspended') {
      state.audio.ctx.resume();
    }
    return state.audio.ctx;
  }

  /**
   * Run Acoustic Sweep Measurement (Real Microphone OR Simulated Acoustic Room Sweep)
   */
  async function runSweepMeasurement() {
    const nameInput = document.getElementById('meas-name-input');
    const modeSelect = document.getElementById('meas-source-mode');
    const fStartInput = document.getElementById('meas-f-start');
    const fEndInput = document.getElementById('meas-f-end');
    const durSelect = document.getElementById('meas-duration-select');
    const roomPresetSelect = document.getElementById('meas-room-preset');
    const progressFill = document.getElementById('meas-progress-fill');
    const statusText = document.getElementById('meas-status-text');
    const startBtn = document.getElementById('btn-start-sweep');

    const f1 = Number(fStartInput.value) || 20;
    const f2 = Number(fEndInput.value) || 20000;
    const durSec = Number(durSelect.value) || 1.5;
    const mode = modeSelect.value;

    startBtn.disabled = true;
    statusText.textContent = '正在生成 Farina 对数正弦扫频信号与逆滤波器...';
    progressFill.style.width = '15%';

    const ctx = getAudioContext();
    const sr = ctx.sampleRate;
    const { sweep, inverse } = DSP.generateLogSweep(f1, f2, durSec, sr);

    // Play audible sweep chirp through speakers (at gentle comfortable volume)
    const buffer = ctx.createBuffer(1, sweep.length, sr);
    buffer.getChannelData(0).set(sweep);
    const srcNode = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.20;
    srcNode.buffer = buffer;
    srcNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    let recordedSamples = null;

    if (mode === 'mic') {
      try {
        statusText.textContent = '正在请求麦克风权限并录制声学响应...';
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        const micSource = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        const chunks = [];
        proc.onaudioprocess = (e) => {
          chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        micSource.connect(proc);
        proc.connect(ctx.destination);

        srcNode.start();
        const t0 = performance.now();
        await new Promise(resolve => {
          const timer = setInterval(() => {
            const elapsed = (performance.now() - t0) / 1000;
            const pct = Math.min(90, Math.round((elapsed / (durSec + 0.35)) * 85) + 10);
            progressFill.style.width = `${pct}%`;
            statusText.textContent = `正在播放对数扫频并采集麦克风信号 (${elapsed.toFixed(1)}s / ${durSec}s)...`;
            if (elapsed >= durSec + 0.35) {
              clearInterval(timer);
              resolve();
            }
          }, 60);
        });

        proc.disconnect();
        micSource.disconnect();
        stream.getTracks().forEach(t => t.stop());

        let totalLen = 0;
        chunks.forEach(c => { totalLen += c.length; });
        recordedSamples = new Float32Array(totalLen);
        let offset = 0;
        chunks.forEach(c => {
          recordedSamples.set(c, offset);
          offset += c.length;
        });
      } catch (err) {
        showToast('麦克风访问未授权或不可用，已自动切换为物理房间声学仿真环回测量');
      }
    } else {
      // Play sweep sound while animating progress bar
      srcNode.start();
      const t0 = performance.now();
      await new Promise(resolve => {
        const timer = setInterval(() => {
          const elapsed = (performance.now() - t0) / 1000;
          const pct = Math.min(90, Math.round((elapsed / durSec) * 80) + 15);
          progressFill.style.width = `${pct}%`;
          statusText.textContent = `正在执行对数扫频激励与房间脉冲响应反卷积 (${elapsed.toFixed(1)}s / ${durSec}s)...`;
          if (elapsed >= durSec) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
    }

    progressFill.style.width = '100%';
    statusText.textContent = '正在执行 FFT 脉冲响应反卷积、分数倍频程平滑与 RT60 计算...';

    const presetMap = {
      'untreated-small': { roomLength: 4.2, roomWidth: 3.2, roomHeight: 2.6, rt60: 0.52, bassBoostDb: 6.0, speakerFc: 42, treatment: 0.1 },
      'treated-control': { roomLength: 5.4, roomWidth: 4.1, roomHeight: 2.9, rt60: 0.25, bassBoostDb: 2.0, speakerFc: 30, treatment: 0.82 },
      'living-room':     { roomLength: 6.2, roomWidth: 4.5, roomHeight: 2.8, rt60: 0.44, bassBoostDb: 4.2, speakerFc: 26, treatment: 0.35 }
    };
    const chosenPreset = presetMap[roomPresetSelect.value] || presetMap['untreated-small'];

    let irData = null;
    if (recordedSamples && recordedSamples.length > 4096) {
      const deconv = DSP.deconvolveSweep(recordedSamples, inverse, sr);
      irData = {
        ir: deconv.ir,
        peakIdx: deconv.peakIdx,
        sampleRate: sr,
        splOffset: 82.0
      };
    }

    const measTitle = (nameInput.value || '').trim() || `${state.nextId}. 扫频测量 (${f1}Hz-${f2 / 1000}kHz)`;
    const newMeas = createMeasurement({
      name: measTitle,
      irData,
      ...chosenPreset,
      seed: Math.floor(Math.random() * 9000) + 100,
      notes: `${mode === 'mic' && irData ? '真实麦克风声学扫频测量' : 'Farina 对数正弦扫频仿真测量'} · ${f1}Hz-${f2}Hz · ${(sr / 1000).toFixed(1)}kHz`
    });

    state.measurements.push(newMeas);
    state.selectedId = newMeas.id;
    startBtn.disabled = false;
    closeModal('modal-measure');
    renderAllUI();
    showToast(`已完成测量并生成全套声学分析图表：${newMeas.name}`);
  }

  /**
   * Signal Generator & Live RTA / SPL Meter
   */
  function toggleSignalGenerator() {
    const ctx = getAudioContext();
    const btn = document.getElementById('btn-toggle-gen');
    const waveType = document.getElementById('gen-wave-type').value;
    const freqVal = Number(document.getElementById('gen-freq-input').value) || 1000;
    const levelDb = Number(document.getElementById('gen-level-input').value) || -18;

    if (state.audio.isGenerating) {
      if (state.audio.genOsc) {
        try { state.audio.genOsc.stop(); } catch (_) {}
        state.audio.genOsc.disconnect();
        state.audio.genOsc = null;
      }
      state.audio.isGenerating = false;
      btn.textContent = '▶ 启动信号发生器 (Play)';
      btn.classList.remove('danger-btn');
      btn.classList.add('primary-btn');
      return;
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.pow(10, levelDb / 20);
    gainNode.connect(ctx.destination);
    state.audio.genGain = gainNode;

    if (waveType === 'sine') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freqVal;
      osc.connect(gainNode);
      osc.start();
      state.audio.genOsc = osc;
    } else {
      // Pink or White noise buffer loop
      const bufSize = ctx.sampleRate * 3;
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        if (waveType === 'pink') {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
          b6 = white * 0.115926;
        } else {
          data[i] = white * 0.25;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.connect(gainNode);
      src.start();
      state.audio.genOsc = src;
    }

    state.audio.isGenerating = true;
    btn.textContent = '⏹ 停止信号输出 (Stop)';
    btn.classList.remove('primary-btn');
    btn.classList.add('danger-btn');
  }

  /**
   * Start / Stop Live SPL Meter & RTA loop
   */
  async function startSplMeterLoop() {
    const readoutEl = document.getElementById('spl-live-value');
    const peakEl = document.getElementById('spl-peak-value');
    const leqEl = document.getElementById('spl-leq-value');
    const rtaCanvas = document.getElementById('rta-mini-canvas');
    if (!readoutEl || !rtaCanvas) return;

    cancelAnimationFrame(state.audio.splRaf);
    let maxSplSeen = 40.0;
    let leqAccum = 0;
    let leqCount = 0;

    let analyser = null;
    try {
      const ctx = getAudioContext();
      if (!state.audio.splStream) {
        state.audio.splStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const src = ctx.createMediaStreamSource(state.audio.splStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      state.audio.splAnalyser = analyser;
    } catch (_) {
      // Fallback to realistic animated acoustic room noise + signal analyzer if mic is denied
      analyser = null;
    }

    const freqBins = new Uint8Array(1024);
    function tick() {
      if (document.getElementById('modal-spl-rta').classList.contains('hidden')) return;
      let currentSpl = 42.5;
      if (analyser) {
        analyser.getByteFrequencyData(freqBins);
        let sumSq = 0;
        for (let i = 1; i < freqBins.length; i++) {
          const v = freqBins[i] / 255.0;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / freqBins.length);
        currentSpl = Math.max(32.0, Math.min(115.0, 35.0 + rms * 95.0));
      } else {
        const t = performance.now() / 1000;
        for (let i = 0; i < 64; i++) {
          freqBins[i] = Math.round(95 + 55 * Math.sin(t * 2.3 + i * 0.25) + 25 * Math.cos(t * 5.1 - i * 0.4));
        }
        currentSpl = 74.2 + 3.8 * Math.sin(t * 3.2) + 1.4 * Math.cos(t * 7.5);
      }

      if (currentSpl > maxSplSeen) maxSplSeen = currentSpl;
      leqAccum += Math.pow(10, currentSpl / 10);
      leqCount++;
      const leq = 10 * Math.log10(leqAccum / leqCount);

      readoutEl.textContent = currentSpl.toFixed(1);
      peakEl.textContent = `${maxSplSeen.toFixed(1)} dB`;
      leqEl.textContent = `${leq.toFixed(1)} dB`;

      // Render 1/3-Octave RTA bars onto rtaCanvas
      const rCtx = rtaCanvas.getContext('2d');
      const W = rtaCanvas.width;
      const H = rtaCanvas.height;
      rCtx.fillStyle = '#0f1216';
      rCtx.fillRect(0, 0, W, H);

      const numBars = 29;
      const barW = (W - 24) / numBars;
      for (let b = 0; b < numBars; b++) {
        const binVal = analyser ? freqBins[Math.min(freqBins.length - 1, b * 12 + 2)] : freqBins[b];
        const barH = Math.max(4, (binVal / 255.0) * (H - 26));
        const x = 12 + b * barW;
        const y = H - 18 - barH;
        rCtx.fillStyle = binVal > 210 ? '#ef4444' : binVal > 165 ? '#f59e0b' : '#10b981';
        rCtx.fillRect(x + 1, y, barW - 3, barH);
      }

      state.audio.splRaf = requestAnimationFrame(tick);
    }

    tick();
  }

  /**
   * Modal open/close helpers
   */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    if (id === 'modal-spl-rta') {
      startSplMeterLoop();
    }
    if (id === 'modal-ir-windows') {
      const m = getActiveMeasurement();
      if (m) {
        document.getElementById('win-type-select').value = m.windowConfig.type;
        document.getElementById('win-left-input').value = m.windowConfig.leftMs;
        document.getElementById('win-right-input').value = m.windowConfig.rightMs;
      }
    }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  /**
   * Setup all DOM event listeners
   */
  function bindEvents() {
    // Graph Tab Switching
    document.querySelectorAll('.rew-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rew-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTab = btn.getAttribute('data-tab');
        renderBottomPanel();
        requestGraphRender();
      });
    });

    // Smoothing selector
    const smoothSel = document.getElementById('smoothing-select');
    if (smoothSel) {
      smoothSel.addEventListener('change', () => {
        state.smoothing = smoothSel.value;
        requestGraphRender();
      });
    }

    // Quick Frequency / SPL Range Presets
    const rangeSel = document.getElementById('freq-preset-select');
    if (rangeSel) {
      rangeSel.addEventListener('change', () => {
        const v = rangeSel.value;
        if (v === 'full') {
          state.limits.fMin = 20;
          state.limits.fMax = 20000;
        } else if (v === 'sub') {
          state.limits.fMin = 15;
          state.limits.fMax = 300;
        } else if (v === 'bass') {
          state.limits.fMin = 20;
          state.limits.fMax = 1000;
        } else if (v === 'midhigh') {
          state.limits.fMin = 200;
          state.limits.fMax = 20000;
        }
        requestGraphRender();
      });
    }

    // Theme toggle (Dark / Light)
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.body.classList.toggle('light-theme', state.theme === 'light');
        themeBtn.textContent = state.theme === 'dark' ? '☀️ 浅色主题' : '🌙 深色主题';
        requestGraphRender();
      });
    }

    // Canvas Mouse Crosshair & Wheel Zoom
    const canvas = document.getElementById('main-graph-canvas');
    if (canvas) {
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const inPlot = x >= 58 && x <= r.width - 60 && y >= 18 && y <= r.height - 38;
        state.mouse = { x, y, inside: inPlot };
        requestGraphRender();
      });

      canvas.addEventListener('mouseleave', () => {
        state.mouse.inside = false;
        requestGraphRender();
      });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.12 : 0.89;
        if (state.activeTab === 'impulse' || state.activeTab === 'filtered-ir') {
          const span = (state.impulseLimits.tMaxMs - state.impulseLimits.tMinMs) * factor;
          state.impulseLimits.tMaxMs = Math.max(10, Math.min(340, state.impulseLimits.tMinMs + span));
        } else {
          const centerSpl = (state.limits.splMin + state.limits.splMax) / 2;
          const halfSpan = Math.max(10, Math.min(60, ((state.limits.splMax - state.limits.splMin) / 2) * factor));
          state.limits.splMin = Math.round(centerSpl - halfSpan);
          state.limits.splMax = Math.round(centerSpl + halfSpan);
        }
        requestGraphRender();
      }, { passive: false });
    }

    // Window resize
    window.addEventListener('resize', () => requestGraphRender());

    // Toolbar Modal Triggers
    document.querySelectorAll('[data-open-modal]').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.getAttribute('data-open-modal')));
    });

    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
    });

    // Measure Modal Start Sweep button
    const startSweepBtn = document.getElementById('btn-start-sweep');
    if (startSweepBtn) {
      startSweepBtn.addEventListener('click', runSweepMeasurement);
    }

    // Signal Generator Toggle
    const genBtn = document.getElementById('btn-toggle-gen');
    if (genBtn) {
      genBtn.addEventListener('click', toggleSignalGenerator);
    }
    const genFreqInp = document.getElementById('gen-freq-input');
    if (genFreqInp) {
      genFreqInp.addEventListener('input', () => {
        if (state.audio.genOsc && state.audio.genOsc.frequency) {
          state.audio.genOsc.frequency.value = Number(genFreqInp.value) || 1000;
        }
      });
    }

    // Apply IR Windows button
    const applyWinBtn = document.getElementById('btn-apply-ir-window');
    if (applyWinBtn) {
      applyWinBtn.addEventListener('click', () => {
        const m = getActiveMeasurement();
        if (!m) return;
        m.windowConfig = {
          type: document.getElementById('win-type-select').value,
          leftMs: Math.max(1, Number(document.getElementById('win-left-input').value) || 125),
          rightMs: Math.max(5, Number(document.getElementById('win-right-input').value) || 500)
        };
        m.analysis = DSP.analyzeMeasurement(m, m.windowConfig);
        closeModal('modal-ir-windows');
        renderAllUI();
        showToast(`已更新脉冲响应窗口 (${m.windowConfig.type.toUpperCase()} L:${m.windowConfig.leftMs}ms / R:${m.windowConfig.rightMs}ms) 并重算频谱`);
      });
    }

    // Apply Graph Limits button
    const applyLimBtn = document.getElementById('btn-apply-limits');
    if (applyLimBtn) {
      applyLimBtn.addEventListener('click', () => {
        state.limits.fMin = Math.max(10, Number(document.getElementById('lim-fmin').value) || 20);
        state.limits.fMax = Math.min(24000, Number(document.getElementById('lim-fmax').value) || 20000);
        state.limits.splMin = Number(document.getElementById('lim-splmin').value) || 45;
        state.limits.splMax = Number(document.getElementById('lim-splmax').value) || 105;
        closeModal('modal-limits');
        requestGraphRender();
      });
    }

    // Room Simulator Generate Measurement button
    const roomSimBtn = document.getElementById('btn-run-room-sim');
    if (roomSimBtn) {
      roomSimBtn.addEventListener('click', () => {
        const L = Number(document.getElementById('sim-room-l').value) || 5.0;
        const W = Number(document.getElementById('sim-room-w').value) || 3.8;
        const H = Number(document.getElementById('sim-room-h').value) || 2.7;
        const abs = Number(document.getElementById('sim-room-abs').value) || 0.45;
        const fc = Number(document.getElementById('sim-spk-fc').value) || 35;

        const rt60Est = Math.max(0.16, Math.min(1.1, (0.161 * (L * W * H)) / (2 * (L * W + L * H + W * H) * Math.max(0.08, abs * 0.45))));
        const m = createMeasurement({
          name: `${state.nextId}. 房间声学模拟 (${L.toFixed(1)}×${W.toFixed(1)}×${H.toFixed(1)}m)`,
          roomLength: L,
          roomWidth: W,
          roomHeight: H,
          rt60: rt60Est,
          treatment: abs,
          speakerFc: fc,
          notes: `Room Sim 模态仿真 · 尺寸 ${L}×${W}×${H}m · 吸音系数 ${abs} · 预测 RT60 ${rt60Est.toFixed(2)}s`
        });
        state.measurements.push(m);
        state.selectedId = m.id;
        closeModal('modal-room-sim');
        renderAllUI();
        showToast(`已生成房间驻波与混响仿真测量：${m.name}`);
      });
    }

    // File Import (.WAV Impulse Response or .FRD/.TXT Frequency Response)
    const fileInput = document.getElementById('file-import-input');
    const btnOpenFile = document.getElementById('btn-open-file');
    if (btnOpenFile && fileInput) {
      btnOpenFile.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          if (file.name.toLowerCase().endsWith('.wav')) {
            const buf = await file.arrayBuffer();
            const wavIr = DSP.parseWavFile(buf);
            const m = createMeasurement({
              name: `${state.nextId}. ${file.name}`,
              irData: wavIr,
              notes: `导入 WAV 脉冲响应文件 · ${(wavIr.sampleRate / 1000).toFixed(1)} kHz`
            });
            state.measurements.push(m);
            state.selectedId = m.id;
            renderAllUI();
            showToast(`成功导入 WAV 脉冲响应：${file.name}`);
          } else {
            const text = await file.text();
            const frdIr = DSP.parseFrdTextFile(text);
            const m = createMeasurement({
              name: `${state.nextId}. ${file.name}`,
              irData: frdIr,
              notes: `导入 FRD/TXT 频响曲线并重建最小相位脉冲响应`
            });
            state.measurements.push(m);
            state.selectedId = m.id;
            renderAllUI();
            showToast(`成功导入频响数据文件：${file.name}`);
          }
        } catch (err) {
          showToast(`导入失败: ${err.message}`);
        }
        fileInput.value = '';
      });
    }

    // Capture Graph Image (.PNG)
    const btnCapture = document.getElementById('btn-capture-graph');
    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        const canvas = document.getElementById('main-graph-canvas');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = `REW_${state.activeTab}_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('已保存当前声学图表高清截图 (.PNG)');
      });
    }

    // Trace Arithmetic: Vector Average of all visible measurements
    const btnAvg = document.getElementById('btn-vector-avg');
    if (btnAvg) {
      btnAvg.addEventListener('click', () => {
        const vis = state.measurements.filter(m => m.visible);
        if (vis.length < 2) {
          showToast('请先在左侧勾选至少 2 条测量记录以计算平均响应');
          return;
        }
        const N = vis[0].ir.length;
        const avgIr = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          let sum = 0;
          for (let k = 0; k < vis.length; k++) sum += vis[k].ir[i];
          avgIr[i] = sum / vis.length;
        }
        const avgMeas = createMeasurement({
          name: `${state.nextId}. Vector Average (多点矢量平均 n=${vis.length})`,
          irData: {
            ir: avgIr,
            peakIdx: vis[0].peakIdx,
            sampleRate: vis[0].sampleRate,
            splOffset: vis[0].splOffset
          },
          notes: `由 ${vis.length} 条可见测量合成的矢量平均响应 (Vector Average)`
        });
        state.measurements.push(avgMeas);
        state.selectedId = avgMeas.id;
        renderAllUI();
        showToast(`已生成 ${vis.length} 条测量的矢量平均曲线 (Vector Average)`);
      });
    }
  }

  // Initialize on DOMContentLoaded
  window.addEventListener('DOMContentLoaded', () => {
    initPreloadedMeasurements();
    bindEvents();
    renderAllUI();
  });
})();
