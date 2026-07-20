import { EEG_CHANNELS, BANDS, BCI_DEVICES } from "./data.js";

const N_DISPLAY = EEG_CHANNELS.length; // 8 waveform lanes

// Produces the EEG / fMRI / BCI signals that drive the UI. Supports three
// sources selectable at runtime:
//   - "synthetic": physiologically-plausible generated signals (demo default)
//   - "edf":       playback of a parsed EDF/EDF+/BDF recording (real EEG)
//   - "stream":    a live WebSocket feed (real-time EEG/BCI)
export class SignalEngine {
  constructor() {
    this.t = 0;
    this.modifier = 1;
    this.focus = null;
    this.eegBuffers = EEG_CHANNELS.map(() => new Float32Array(180).fill(0));
    this.spikes = [];

    this.source = "synthetic";
    this.edf = null;
    this.edfMap = [];      // display lane -> edf channel index
    this.edfScale = [];    // per-lane normalization
    this.playSample = 0;   // EDF playback cursor (in samples of lane 0)
    this.fmriGridData = null;
    this.streamBuffers = EEG_CHANNELS.map(() => new Float32Array(180).fill(0));
    this.streamScale = 1;
    this.streamSpikes = 0;
    this.lastFrameAt = 0;
  }

  setPatient(patient) {
    this.modifier = patient.modifier;
    this.focus = patient.focus || null;
  }

  /* ---------------- source selection ---------------- */

  setSource(source) {
    this.source = source;
  }

  loadEDF(edf) {
    this.edf = edf;
    // map up to N_DISPLAY channels; normalize each by a robust peak amplitude
    this.edfMap = [];
    this.edfScale = [];
    for (let i = 0; i < N_DISPLAY; i++) {
      const ci = edf.channels.length ? i % edf.channels.length : 0;
      this.edfMap.push(ci);
      const d = edf.channels[ci].data;
      let peak = 1e-6;
      const stride = Math.max(1, Math.floor(d.length / 4000));
      for (let k = 0; k < d.length; k += stride) peak = Math.max(peak, Math.abs(d[k]));
      this.edfScale.push(1 / peak);
    }
    this.playSample = 0;
    this.source = "edf";
  }

  loadFMRIGrid(grid) {
    this.fmriGridData = grid;
  }

  pushStreamFrame(frame) {
    this.lastFrameAt = performance.now();
    const eeg = frame.eeg || [];
    // adapt scale to the incoming amplitude range
    for (let i = 0; i < N_DISPLAY; i++) {
      const v = eeg[i % (eeg.length || 1)] || 0;
      this.streamScale = Math.max(this.streamScale, Math.abs(v) || 1);
      const buf = this.streamBuffers[i];
      buf.copyWithin(0, 1);
      buf[buf.length - 1] = v / this.streamScale;
    }
    if (typeof frame.spikes === "number") this.streamSpikes = frame.spikes;
  }

  channelLabels() {
    if (this.source === "edf" && this.edf) {
      return this.edfMap.map((ci) => (this.edf.channels[ci]?.label || "").slice(0, 6) || `ch`);
    }
    return EEG_CHANNELS;
  }

  /* ---------------- per-frame advance ---------------- */

  step(dt) {
    this.t += dt;
    if (this.source === "edf" && this.edf) this._stepEDF(dt);
    else if (this.source === "stream") this._stepStream();
    else this._stepSynthetic();
  }

  _stepSynthetic() {
    EEG_CHANNELS.forEach((ch, i) => {
      const buf = this.eegBuffers[i];
      buf.copyWithin(0, 1);
      buf[buf.length - 1] = this._eegSample(i);
    });
  }

  _stepEDF(dt) {
    const lane0 = this.edf.channels[this.edfMap[0]];
    const rate = lane0.sampleRate || 256;
    const nNew = Math.max(1, Math.min(64, Math.round(rate * dt)));
    const total = lane0.data.length;
    for (let s = 0; s < nNew; s++) {
      const idx = (this.playSample + s) % total;
      for (let i = 0; i < N_DISPLAY; i++) {
        const ch = this.edf.channels[this.edfMap[i]];
        const buf = this.eegBuffers[i];
        buf.copyWithin(0, 1);
        buf[buf.length - 1] = (ch.data[idx % ch.data.length] || 0) * this.edfScale[i];
      }
    }
    this.playSample = (this.playSample + nNew) % total;
  }

  _stepStream() {
    // stream frames land asynchronously in streamBuffers; mirror into display
    for (let i = 0; i < N_DISPLAY; i++) this.eegBuffers[i] = this.streamBuffers[i];
  }

  _eegSample(i) {
    const t = this.t;
    const posterior = i >= 4;
    const alpha = Math.sin(2 * Math.PI * BANDS.alpha.freq * t + i) * (posterior ? 0.9 : 0.4);
    const beta = Math.sin(2 * Math.PI * BANDS.beta.freq * t + i * 0.7) * 0.3;
    const theta = Math.sin(2 * Math.PI * BANDS.theta.freq * t + i * 1.3) * 0.4;
    const delta = Math.sin(2 * Math.PI * BANDS.delta.freq * t) * 0.3;
    const noise = (Math.random() - 0.5) * 0.35;
    let v = (alpha + beta + theta + delta) * 0.5 + noise;
    if (this.focus === "hip" && Math.random() < 0.004) v += 2.2;
    return v * this.modifier;
  }

  /* ---------------- derived quantities ---------------- */

  // Recent RMS of a display lane (used to drive regions from real data).
  _laneRMS(i) {
    const buf = this.eegBuffers[i];
    let sum = 0;
    const w = 60;
    for (let k = buf.length - w; k < buf.length; k++) sum += buf[k] * buf[k];
    return Math.sqrt(sum / w);
  }

  regionActivity(region, index = 0) {
    if (this.source !== "synthetic") {
      // map each region to a display lane and use its recent power
      const lane = index % N_DISPLAY;
      return Math.min(1, this._laneRMS(lane) * 2.2);
    }
    const band = BANDS[region.band] || BANDS.alpha;
    const base = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (band.freq / 6) * this.t + region.pos[0]));
    const focusBoost = this.focus === region.id ? 0.4 : 0;
    return Math.min(1, (base + focusBoost) * this.modifier);
  }

  fmriGrid() {
    if (this.fmriGridData) return this.fmriGridData;
    const cells = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = 0.5 + 0.5 * Math.sin(this.t * 0.6 + x * 0.5) * Math.cos(this.t * 0.4 + y * 0.6);
        cells.push(Math.max(0, Math.min(1, v * this.modifier)));
      }
    }
    return cells;
  }

  // Estimate the dominant band from the displayed data via zero-crossing rate.
  dominantBand() {
    if (this.source === "synthetic") return this.focus === "hip" ? "Theta" : "Alpha";
    const buf = this.eegBuffers[0];
    let crossings = 0;
    for (let k = 1; k < buf.length; k++) if ((buf[k - 1] < 0) !== (buf[k] < 0)) crossings++;
    // crossings over the visible window -> rough frequency bucket
    if (crossings < 6) return "Delta";
    if (crossings < 14) return "Theta";
    if (crossings < 28) return "Alpha";
    return "Beta";
  }

  bciTelemetry(deviceKey) {
    const d = BCI_DEVICES[deviceKey];
    const rate = d.baseRate + Math.sin(this.t * 2) * 8 + (Math.random() - 0.5) * 6;
    const imp = d.baseImp + Math.sin(this.t * 0.3) * 2 + (Math.random() - 0.5);
    const loss = Math.max(0, 0.4 + Math.sin(this.t * 0.7) * 0.3 + (Math.random() - 0.5) * 0.2);
    const intent = d.intents[Math.floor((this.t * 0.5) % d.intents.length)];
    return { rate: rate.toFixed(0), imp: imp.toFixed(1), loss: loss.toFixed(2), intent };
  }

  stepRaster(deviceKey) {
    const d = BCI_DEVICES[deviceKey];
    const density = this.source === "stream" && this.streamSpikes
      ? Math.min(1, this.streamSpikes / 200)
      : d.baseRate / 200;
    for (const s of this.spikes) s.x -= 0.012;
    this.spikes = this.spikes.filter((s) => s.x > 0);
    if (Math.random() < density * 4) this.spikes.push({ x: 1, h: 0.4 + Math.random() * 0.6 });
    return this.spikes;
  }
}
