import * as THREE from "three";
import { NeuralNetwork } from "./network.js";
import { SignalEngine } from "./signals.js";
import { GameOfLife, STRATEGY } from "./gol.js";
import { parseEDF } from "./ingest/edf.js";
import { parseNIfTI, sliceToGrid } from "./ingest/nifti.js";
import { StreamClient } from "./ingest/stream.js";
import { buildSampleEDF } from "./ingest/sample.js";
import { REGIONS, PATIENTS, EEG_CHANNELS, BCI_DEVICES } from "./data.js";

const net = new NeuralNetwork(document.getElementById("scene"));
const sig = new SignalEngine();
const gol = new GameOfLife(48, 48);

let mode = "eeg";
let bciConnected = false;
let bciDevice = "neuralink";
let activeRegion = null;
let golPaused = false;
let golLink = true;
let golDrive = 0.5;

/* ---------- UI: patient selector ---------- */
const patientSelect = document.getElementById("patientSelect");
PATIENTS.forEach((p) => {
  const o = document.createElement("option");
  o.value = p.id;
  o.textContent = p.name;
  patientSelect.appendChild(o);
});
function applyPatient(id) {
  const p = PATIENTS.find((x) => x.id === id);
  sig.setPatient(p);
  document.getElementById("regionInfo").textContent = `Patient: ${p.note}`;
}
patientSelect.addEventListener("change", (e) => applyPatient(e.target.value));
applyPatient(PATIENTS[0].id);

/* ---------- UI: region list ---------- */
const regionList = document.getElementById("regionList");
REGIONS.forEach((r) => {
  const el = document.createElement("div");
  el.className = "region-item";
  el.dataset.id = r.id;
  el.innerHTML = `<span class="dot" style="background:${r.color}"></span><span>${r.name}</span><span class="bar"></span>`;
  el.addEventListener("click", () => selectRegion(r.id));
  regionList.appendChild(el);
});

function selectRegion(id) {
  activeRegion = id;
  net.focusRegion(id);
  document.querySelectorAll(".region-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
  const r = REGIONS.find((x) => x.id === id);
  document.getElementById("regionInfo").textContent = `Region: ${r.name} · rhythm ${r.band}`;
}

/* ---------- UI: data source (real ingestion) ---------- */
const edfInfo = document.getElementById("edfInfo");
const wsInfo = document.getElementById("wsInfo");
let wsState = "idle";
const stream = new StreamClient({
  onFrame: (f) => {
    sig.pushStreamFrame(f);
    // refresh the frame counter about 4x/s without spamming the DOM
    if (stream.frames % 64 === 0) wsInfo.textContent = `Stream ${wsState} · ${stream.frames} frames`;
  },
  onStatus: (s, detail) => {
    wsState = s;
    wsInfo.textContent = detail ? `Stream ${s}: ${detail}` : `Stream ${s} · ${stream.frames} frames`;
  },
});

function setSource(src) {
  sig.setSource(src);
  document.querySelectorAll(".stog").forEach((b) => b.classList.toggle("active", b.dataset.src === src));
  document.querySelectorAll(".src-pane").forEach((p) => (p.hidden = p.dataset.pane !== src));
  document.getElementById("srcStatus").textContent = `Source: ${src}`;
}
document.querySelectorAll(".stog").forEach((btn) => {
  btn.addEventListener("click", () => setSource(btn.dataset.src));
});

async function ingestEDF(arrayBuffer, name) {
  try {
    const edf = parseEDF(arrayBuffer);
    sig.loadEDF(edf);
    setSource("edf");
    edfInfo.textContent = `${name}: ${edf.format} · ${edf.channels.length} ch · ${edf.channels[0]?.sampleRate?.toFixed(0)} Hz · ${edf.duration.toFixed(0)}s`;
  } catch (err) {
    edfInfo.textContent = `Error: ${err.message}`;
  }
}

document.getElementById("edfFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) ingestEDF(await file.arrayBuffer(), file.name);
});
document.getElementById("loadSample").addEventListener("click", () => {
  ingestEDF(buildSampleEDF(), "sample.edf");
});
document.getElementById("niiFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const nii = parseNIfTI(await file.arrayBuffer());
    sig.loadFMRIGrid(sliceToGrid(nii, 8));
    edfInfo.textContent = `${file.name}: NIfTI ${nii.dims.nx}×${nii.dims.ny}×${nii.dims.nz}`;
  } catch (err) {
    edfInfo.textContent = `Error: ${err.message}`;
  }
});
document.getElementById("wsConnect").addEventListener("click", () => {
  const url = document.getElementById("wsUrl").value.trim();
  setSource("stream");
  stream.connect(url);
});

/* ---------- UI: modality toggles + sliders ---------- */
document.querySelectorAll(".tog").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tog").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    mode = btn.dataset.mode;
  });
});
document.getElementById("gain").addEventListener("input", (e) => (net.gain = parseFloat(e.target.value)));
document.getElementById("speed").addEventListener("input", (e) => (net.flySpeed = parseFloat(e.target.value)));
document.getElementById("pulseToggle").addEventListener("change", (e) => (net.pulsesEnabled = e.target.checked));

/* ---------- UI: BCI ---------- */
const bciSelect = document.getElementById("bciDevice");
bciSelect.addEventListener("change", (e) => (bciDevice = e.target.value));
const connectBtn = document.getElementById("bciConnect");
connectBtn.addEventListener("click", () => {
  bciConnected = !bciConnected;
  connectBtn.classList.toggle("connected", bciConnected);
  connectBtn.textContent = bciConnected ? "Connected" : "Connect";
});

/* ---------- GOL: game-of-life / game-theory AI ---------- */
const golCanvas = document.getElementById("golCanvas");
const gctx = golCanvas.getContext("2d");
document.querySelectorAll(".gtog").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".gtog").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    gol.setMode(btn.dataset.gol);
  });
});
document.getElementById("golT").addEventListener("input", (e) => (gol.T = parseFloat(e.target.value)));
document.getElementById("golNoise").addEventListener("input", (e) => (gol.noise = parseFloat(e.target.value)));
document.getElementById("golReset").addEventListener("click", () => gol.randomize());
document.getElementById("golPerturb").addEventListener("click", () =>
  gol.injectDefectors((Math.random() * gol.cols) | 0, (Math.random() * gol.rows) | 0, 4)
);
const golPauseBtn = document.getElementById("golPause");
golPauseBtn.addEventListener("click", () => {
  golPaused = !golPaused;
  golPauseBtn.textContent = golPaused ? "Resume" : "Pause";
});
document.getElementById("golLink").addEventListener("change", (e) => (golLink = e.target.checked));

const GOL_COLORS = {
  [STRATEGY.DEAD]: [8, 18, 32],
  [STRATEGY.COOP]: [79, 209, 255],
  [STRATEGY.DEFECT]: [255, 107, 107],
};
function drawGOL() {
  const { cols, rows } = gol;
  const img = gctx.createImageData(cols, rows);
  for (let i = 0; i < gol.grid.length; i++) {
    const c = GOL_COLORS[gol.grid[i]] || GOL_COLORS[STRATEGY.DEAD];
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  // scale the tiny grid up to the canvas via an offscreen draw
  const off = drawGOL._off || (drawGOL._off = document.createElement("canvas"));
  off.width = cols; off.height = rows;
  off.getContext("2d").putImageData(img, 0, 0);
  gctx.imageSmoothingEnabled = false;
  gctx.drawImage(off, 0, 0, cols, rows, 0, 0, golCanvas.width, golCanvas.height);
}

/* ---------- fMRI grid cells ---------- */
const fmriGrid = document.getElementById("fmriGrid");
const fmriCells = [];
for (let i = 0; i < 64; i++) {
  const c = document.createElement("div");
  c.className = "fmri-cell";
  fmriGrid.appendChild(c);
  fmriCells.push(c);
}

/* ---------- pointer orbit + pick ---------- */
const canvas = document.getElementById("scene");
let dragging = false;
let px = 0, py = 0;
let theta = 0, phi = 0.2, radius = 9;
let downX = 0, downY = 0;
canvas.addEventListener("pointerdown", (e) => { dragging = true; px = downX = e.clientX; py = downY = e.clientY; });
window.addEventListener("pointerup", (e) => {
  dragging = false;
  if (Math.abs(e.clientX - downX) < 4 && Math.abs(e.clientY - downY) < 4) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    const r = net.raycastRegion(nx, ny);
    if (r) selectRegion(r.id);
  }
});
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  theta -= (e.clientX - px) * 0.005;
  phi = Math.max(-1.2, Math.min(1.2, phi + (e.clientY - py) * 0.005));
  px = e.clientX; py = e.clientY;
  net._camGoal = null;
});
canvas.addEventListener("wheel", (e) => {
  radius = Math.max(3, Math.min(20, radius + e.deltaY * 0.01));
  net._camGoal = null;
  e.preventDefault();
}, { passive: false });

function applyOrbit() {
  if (net._camGoal) return; // fly-to in progress
  net.camera.position.set(
    radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.sin(phi) + 1.0,
    radius * Math.cos(phi) * Math.cos(theta)
  );
  net._target.set(0, 0, 0);
}

/* ---------- EEG canvas ---------- */
const eegCanvas = document.getElementById("eegCanvas");
const ectx = eegCanvas.getContext("2d");
function drawEEG() {
  const w = eegCanvas.width, h = eegCanvas.height;
  ectx.clearRect(0, 0, w, h);
  const labels = sig.channelLabels();
  const rows = labels.length;
  const rowH = h / rows;
  ectx.font = "9px monospace";
  for (let c = 0; c < rows; c++) {
    const buf = sig.eegBuffers[c];
    const yBase = rowH * c + rowH / 2;
    ectx.fillStyle = "#5f7bb0";
    ectx.fillText(labels[c], 2, yBase - rowH / 2 + 9);
    ectx.beginPath();
    ectx.strokeStyle = c >= 4 ? "#b26bff" : "#4fd1ff";
    ectx.lineWidth = 1;
    for (let i = 0; i < buf.length; i++) {
      const x = 26 + (i / buf.length) * (w - 30);
      const y = yBase - buf[i] * (rowH * 0.42) * net.gain;
      i === 0 ? ectx.moveTo(x, y) : ectx.lineTo(x, y);
    }
    ectx.stroke();
  }
}

/* ---------- raster ---------- */
const raster = document.getElementById("raster");
function drawRaster(spikes) {
  raster.innerHTML = "";
  const wrap = document.createDocumentFragment();
  for (const s of spikes) {
    const d = document.createElement("div");
    d.className = "spike";
    d.style.left = `${s.x * 100}%`;
    d.style.height = `${s.h * 100}%`;
    wrap.appendChild(d);
  }
  raster.appendChild(wrap);
}

/* ---------- main loop ---------- */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
let golAcc = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  sig.step(dt);
  applyOrbit();

  // advance the GOL game-theory automaton on a fixed cadence
  golAcc += dt;
  if (!golPaused && golAcc > 0.12) {
    gol.step();
    golAcc = 0;
  }
  const golStats = gol.stats();
  golDrive = golLink ? 0.6 + golStats.coopRate * 0.8 : 1;

  // drive region activity from selected modality, modulated by GOL cooperation
  REGIONS.forEach((r, ri) => {
    let a = sig.regionActivity(r, ri);
    if (mode === "fmri") a *= 0.8 + 0.2 * Math.sin(sig.t + r.pos[2]);
    if (mode === "bci") a *= bciConnected ? 1.1 : 0.5;
    a *= golDrive;
    net.setActivity(r.id, Math.min(1, a));
  });
  // occasional spontaneous pulses from the most active region
  if (Math.random() < 0.03) {
    const hot = REGIONS.reduce((m, r, ri) => (sig.regionActivity(r, ri) > sig.regionActivity(m, REGIONS.indexOf(m)) ? r : m));
    net.emitPulse(activeRegion || hot.id);
  }

  net.update(dt);

  // panels
  drawEEG();
  document.getElementById("eegBand").textContent = sig.dominantBand();
  if (sig.source === "edf" && sig.edf) {
    document.getElementById("eegRate").textContent = `${sig.edf.channels[0].sampleRate.toFixed(0)} Hz`;
  }

  const grid = sig.fmriGrid();
  fmriCells.forEach((cell, i) => {
    const v = grid[i];
    const hue = 220 - v * 200; // blue -> red
    cell.style.background = `hsl(${hue}, 90%, ${20 + v * 45}%)`;
  });

  // GOL panel
  drawGOL();
  document.getElementById("golGen").textContent = golStats.generation;
  document.getElementById("golCoop").textContent = `${(golStats.coopRate * 100).toFixed(0)}%`;
  document.getElementById("golPay").textContent = golStats.avgPayoff.toFixed(2);
  document.getElementById("golRegime").textContent = golStats.regime;

  // BCI
  if (bciConnected) {
    const tel = sig.bciTelemetry(bciDevice);
    document.getElementById("bciRate").textContent = `${tel.rate} Hz`;
    document.getElementById("bciImp").textContent = `${tel.imp} kΩ`;
    document.getElementById("bciLoss").textContent = `${tel.loss} %`;
    document.getElementById("bciIntent").textContent = tel.intent;
    drawRaster(sig.stepRaster(bciDevice));
  }

  // fps
  fpsAcc += 1 / dt; fpsN++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    document.getElementById("fps").textContent = `${Math.round(fpsAcc / fpsN)} fps`;
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }

  requestAnimationFrame(loop);
}

// pick a default region to orient the user
selectRegion("thl");
setTimeout(() => { net._camGoal = null; }, 1500);
requestAnimationFrame(loop);
