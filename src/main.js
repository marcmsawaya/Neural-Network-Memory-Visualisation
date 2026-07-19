import * as THREE from "three";
import { NeuralNetwork } from "./network.js";
import { SignalEngine } from "./signals.js";
import { REGIONS, PATIENTS, EEG_CHANNELS, BCI_DEVICES } from "./data.js";

const net = new NeuralNetwork(document.getElementById("scene"));
const sig = new SignalEngine();

let mode = "eeg";
let bciConnected = false;
let bciDevice = "neuralink";
let activeRegion = null;

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
  const rows = EEG_CHANNELS.length;
  const rowH = h / rows;
  ectx.font = "9px monospace";
  for (let c = 0; c < rows; c++) {
    const buf = sig.eegBuffers[c];
    const yBase = rowH * c + rowH / 2;
    ectx.fillStyle = "#5f7bb0";
    ectx.fillText(EEG_CHANNELS[c], 2, yBase - rowH / 2 + 9);
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
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  sig.step(dt);
  applyOrbit();

  // drive region activity from selected modality
  for (const r of REGIONS) {
    let a = sig.regionActivity(r);
    if (mode === "fmri") a *= 0.8 + 0.2 * Math.sin(sig.t + r.pos[2]);
    if (mode === "bci") a *= bciConnected ? 1.1 : 0.5;
    net.setActivity(r.id, a);
  }
  // occasional spontaneous pulses from the most active region
  if (Math.random() < 0.03) {
    const hot = REGIONS.reduce((m, r) => (sig.regionActivity(r) > sig.regionActivity(m) ? r : m));
    net.emitPulse(activeRegion || hot.id);
  }

  net.update(dt);

  // panels
  drawEEG();
  document.getElementById("eegBand").textContent = sig.dominantBand();

  const grid = sig.fmriGrid();
  fmriCells.forEach((cell, i) => {
    const v = grid[i];
    const hue = 220 - v * 200; // blue -> red
    cell.style.background = `hsl(${hue}, 90%, ${20 + v * 45}%)`;
  });

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
