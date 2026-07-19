import { EEG_CHANNELS, BANDS, BCI_DEVICES } from "./data.js";

// Generates physiologically-plausible synthetic signals for the demo:
// multi-band EEG traces, fMRI BOLD activation values, and BCI spike rasters.
export class SignalEngine {
  constructor() {
    this.t = 0;
    this.modifier = 1;
    this.focus = null;
    this.eegBuffers = EEG_CHANNELS.map(() => new Float32Array(180).fill(0));
    this.spikes = [];
  }

  setPatient(patient) {
    this.modifier = patient.modifier;
    this.focus = patient.focus || null;
  }

  step(dt) {
    this.t += dt;
    // shift EEG buffers and append a fresh sample per channel
    EEG_CHANNELS.forEach((ch, i) => {
      const buf = this.eegBuffers[i];
      buf.copyWithin(0, 1);
      buf[buf.length - 1] = this._eegSample(i);
    });
  }

  _eegSample(i) {
    const t = this.t;
    // mixture of bands, weighted; posterior channels favor alpha
    const posterior = i >= 4;
    const alpha = Math.sin(2 * Math.PI * BANDS.alpha.freq * t + i) * (posterior ? 0.9 : 0.4);
    const beta = Math.sin(2 * Math.PI * BANDS.beta.freq * t + i * 0.7) * 0.3;
    const theta = Math.sin(2 * Math.PI * BANDS.theta.freq * t + i * 1.3) * 0.4;
    const delta = Math.sin(2 * Math.PI * BANDS.delta.freq * t) * 0.3;
    const noise = (Math.random() - 0.5) * 0.35;
    let v = (alpha + beta + theta + delta) * 0.5 + noise;
    // epileptiform spikes for a temporal focus patient
    if (this.focus === "hip" && Math.random() < 0.004) v += 2.2;
    return v * this.modifier;
  }

  // Region activity value in [0,1] driven by band oscillation + focus boost.
  regionActivity(region) {
    const band = BANDS[region.band] || BANDS.alpha;
    const base = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (band.freq / 6) * this.t + region.pos[0]));
    const focusBoost = this.focus === region.id ? 0.4 : 0;
    return Math.min(1, (base + focusBoost) * this.modifier);
  }

  // 8x8 BOLD activation grid values [0,1].
  fmriGrid() {
    const cells = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v =
          0.5 +
          0.5 * Math.sin(this.t * 0.6 + x * 0.5) * Math.cos(this.t * 0.4 + y * 0.6);
        cells.push(Math.max(0, Math.min(1, v * this.modifier)));
      }
    }
    return cells;
  }

  dominantBand() {
    // posterior alpha dominates at rest; focus patients skew slower
    if (this.focus === "hip") return "Theta";
    return "Alpha";
  }

  // BCI telemetry for the connected device.
  bciTelemetry(deviceKey) {
    const d = BCI_DEVICES[deviceKey];
    const rate = d.baseRate + Math.sin(this.t * 2) * 8 + (Math.random() - 0.5) * 6;
    const imp = d.baseImp + Math.sin(this.t * 0.3) * 2 + (Math.random() - 0.5);
    const loss = Math.max(0, 0.4 + Math.sin(this.t * 0.7) * 0.3 + (Math.random() - 0.5) * 0.2);
    const intent = d.intents[Math.floor((this.t * 0.5) % d.intents.length)];
    return {
      rate: rate.toFixed(0),
      imp: imp.toFixed(1),
      loss: loss.toFixed(2),
      intent,
    };
  }

  // Advance a spike raster: array of {x, h} normalized positions.
  stepRaster(deviceKey) {
    const d = BCI_DEVICES[deviceKey];
    const density = d.baseRate / 200;
    for (const s of this.spikes) s.x -= 0.012;
    this.spikes = this.spikes.filter((s) => s.x > 0);
    if (Math.random() < density * 4) {
      this.spikes.push({ x: 1, h: 0.4 + Math.random() * 0.6 });
    }
    return this.spikes;
  }
}
