# Room EQ Wizard (REW V5.40) — 跨平台声学测量与房间均衡软件复刻版

本项目 1:1 复刻了 **Room EQ Wizard (REW V5.40)** 的桌面端 UI 架构、11 大核心声学分析视图、底层数字信号处理 (DSP) 算法以及实时测量与均衡工具链，原生支持 **Windows (Windows 10 / 11)** 与 **macOS**。

---

## 一、在 Windows 上运行与打包指南

将整个 `room-eq-wizard` 文件夹复制到任意 Windows 电脑后，提供 **3 种使用方式**：

### 方式 1：免安装直接双击运行（推荐，零依赖）
直接双击运行根目录下的 **[`Start-REW-Windows.bat`](file:///Users/pom/.gemini/antigravity/scratch/room-eq-wizard/Start-REW-Windows.bat)**：
- 自动检测：若已安装 Electron 则以 Electron 桌面进程启动；若电脑上安装了 Node.js 则启动本地服务并以独立桌面窗口打开；
- **完全零环境依赖回退**：即使是一台全新、未安装任何开发环境的 Windows 电脑，脚本也会自动调用系统内置的 Microsoft Edge / Chrome `--app` 独立桌面窗口模式直接加载 [`public/index.html`](file:///Users/pom/.gemini/antigravity/scratch/room-eq-wizard/public/index.html)，拥有完整的离线 DSP 运算、本地麦克风测量与文件导入导出功能。

### 方式 2：一键打包为独立 Windows `.exe` 可执行程序
在安装了 Node.js 的 Windows 电脑上，双击运行 **[`Build-Windows-EXE.bat`](file:///Users/pom/.gemini/antigravity/scratch/room-eq-wizard/Build-Windows-EXE.bat)**（或执行 `npm install && npm run dist:win`）：
- 将在 `dist/` 目录下生成免安装单文件版 **`Room EQ Wizard (REW) 5.40.0.exe`** (Portable) 以及标准安装包。

### 方式 3：通过命令行启动
```powershell
node server.js
# 随后访问 http://127.0.0.1:4580
```

---

## 二、核心功能模块与 DSP 算法清单

1. **11 大完整分析视图（顶部 Tab 栏一键切换）**
   - **`SPL & Phase`**：频响曲线 + 相位响应（支持包裹相位、最小相位 Minimum Phase、过剩相位 Excess Phase、目标曲线对比、1/48 至 1/1 倍频程平滑、心理声学平滑 `Psychoacoustic` 与可变平滑 `Variable`）。
   - **`All SPL`**：多条测量曲线同屏叠加上色对比、勾选隐藏/显示、一键计算多点矢量/能量平均（`Vector Average`）。
   - **`Distortion`**：基波 + 总谐波失真 (`THD`) + 2 至 5 次谐波 (`H2`–`H5`) + 本底噪声 (`Noise Floor`)，支持 `dB SPL` 与 `%` 失真率双模式切换，鼠标悬停实时解算具体频点的各阶谐波占比。
   - **`Impulse`**：脉冲响应 (`% FS`)、能量时间曲线 (`ETC dBFS`)、阶跃响应 (`Step Response`)、施罗德积分曲线 (`Schroeder Integral`)，以及可调左/右窗宽与窗函数（`Tukey 0.25`、`Hann`、`Blackman-Harris`、`Rectangular`）的 IR 窗包络可视化。
   - **`Filtered IR`**：支持 `63 Hz` – `8 kHz` 倍频程带通滤波器的脉冲包络与波形分析，用于精准定位特定频段的早期反射与驻波振铃。
   - **`GD` (Group Delay)**：由解卷绕相位对频率求导计算的群延迟曲线 ($\text{ms}$) 及最小相位群延迟对比。
   - **`RT60`**：符合 ISO 3382 标准的倍频程混响时间计算，同屏对比 `EDT`（早期衰变时间）、`T20`、`T30`、`Topt` 四条曲线，并在底部面板输出包含线性回归相关系数 $r$、清晰度 $C_{50}/\text{dB}$、$C_{80}/\text{dB}$、明晰度 $D_{50}/\%$ 的完整声学参数报表。
   - **`RT60 Decay`**：多倍频程频段的施罗德反向积分衰变曲线族。
   - **`Decay`**：0 ms – 160 ms 多时间切片频谱衰减叠加图。
   - **`Waterfall` (3D CSD 累积频谱衰减瀑布图)**：支持透视倾斜角 (`X Tilt`)、高度比 (`Z Scale`)、时间跨度 (`100 ms`–`600 ms`)、平滑度与配色主题（彩虹热力、青蓝经典、琥珀纯色）实时调节的 3D 遮挡消隐瀑布图。
   - **`Spectrogram` (时频小波热力图)**：高分辨率短时傅里叶/小波时频分析图，含峰值能量脊线 (`Peak Energy Ridge`) 追踪与右侧 dB 色标尺。
   - **`EQ` (房间均衡器与自动目标拟合)**：
     - 可配置房间目标曲线（低频驻波倾斜抬升、高频滚降、目标基准 SPL）；
     - **Automatic Room Mode Matching**：自动识别房间驻波峰谷并拟合 10 段参量均衡器 (PEQ)；
     - 完整的 RBJ Biquad 滤波器引擎（支持 `PK` 峰值、`LS` 低架、`HS` 高架、`LP` 低通、`HP` 高通），实时渲染合成滤波器曲线与校正后预测频响 (`Predicted SPL`)；
     - 一键导出标准 **Equalizer APO (`.txt`)** 配置文件，可直接加载进 Windows 系统级音频均衡器 Equalizer APO 或硬件 DSP。

2. **交互式声学测量与辅助工具（顶部工具栏）**
   - **`Measure` (测量向导)**：采用 Farina 对数正弦扫频 (`Logarithmic Sine Sweep`) + 逆滤波器频域反卷积算法；支持**物理房间声学仿真扫频**与**真实 WebAudio 麦克风实时扫频采集**双模式。
   - **`SPL Meter & RTA`**：实时声压级表（支持 `dB(Z)`、`dB(A)`、`dB(C)` 计权与 Fast/Slow 时间常数）+ 1/3 倍频程实时频谱仪 + Peak Hold 峰值保持。
   - **`Generator` (信号发生器)**：内置正弦波（支持实时拖动频率滑块）、粉红噪声 (`-3 dB/oct` Paul Kellet 滤波器)、白噪声与扫频测试信号源。
   - **`Room Sim` (房间模态模拟器)**：交互式调整房间长/宽/高尺寸、墙面吸音系数、左右音箱与听音位坐标，实时计算轴向房间驻波模态并在平面图上拖拽交互，一键生成对应的仿真测量记录。
   - **`Import` (外部数据导入)**：原生支持导入 `.wav` 脉冲响应音频文件或 `.frd` / `.txt` 频响测量数据。
