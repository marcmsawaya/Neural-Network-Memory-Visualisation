# NeuroVoyage — Clinical Neural Network Explorer

> This is the BRAIN! Fly through the neural network and watch memory and
> signals move across it in real time.

NeuroVoyage is a browser-based visualization platform that renders the brain as
a navigable 3D neural network (connectome) and overlays live signal modalities
used in hospitals and brain–computer-interface (BCI) research:

- **3D fly-through connectome** — orbit, zoom, click any region to fly to it and
  watch signal-propagation pulses travel along structural connections.
- **EEG** — 8-channel multi-band waveform monitor (delta/theta/alpha/beta) with
  epileptiform events for a pre-surgical epilepsy patient.
- **fMRI (BOLD)** — voxel activation heat-map driven by regional activity.
- **BCI link** — connect a simulated **Neuralink N1**, **Blackrock Utah Array**,
  or **OpenBCI Cyton** stream and view firing rate, impedance, packet loss,
  decoded intent, and a live spike raster.
- **Patient cases** — healthy control, pre-surgical epilepsy, motor-BCI trial,
  and post-stroke rehab, each shaping the network's dynamics.
- **GOL — Game of Life / game-theory AI** — a spatial evolutionary-game engine.
  In *Econ* mode every cell is an economic agent playing the Prisoner's Dilemma
  (T>R>P>S payoffs) against its neighbors and imitating the best-earning strategy
  (spatial replicator / best-response dynamics), converging to cooperative,
  coexistence, or defective-Nash regimes. A classic *Conway* mode is included.
  Cooperation level couples back into the network as a global activity drive.
- **Real data ingestion** — switch the **Data Source** from *Synthetic* to
  *Recording* (load a real `.edf`/`.bdf` EEG file or `.nii` fMRI volume) or
  *Live* (connect a WebSocket EEG/BCI feed). Loaded signals drive the EEG lanes,
  fMRI heat-map, dominant-band estimate, and 3D network activity directly.

Intended as a research / demonstration front-end for advancing EEG and fMRI
tooling and for prototyping alongside Neuralink and Blackrock Neurotech systems.
**Not for diagnostic use.**

## Getting started

```bash
npm install
npm run dev      # start the dev server (Vite)
npm run build    # production build into dist/
npm run preview  # preview the production build
```

## Data ingestion

The **Data Source** panel selects where signals come from:

| Source | Input | Notes |
| --- | --- | --- |
| Synthetic | — | physiologically-plausible generated signals (default demo) |
| Recording | `.edf` / `.bdf` EEG, `.nii` fMRI | parsed fully client-side, no upload to any server |
| Live | WebSocket URL | real-time JSON frames `{"eeg":[...],"spikes":n}` |

- **EEG** uses a standards-compliant EDF / EDF+ / BDF reader (`src/ingest/edf.js`):
  16-bit EDF and 24-bit BDF, per-signal scaling, EDF+ annotation channels skipped.
  The *Load sample EEG* button builds a real EDF byte-stream in memory and runs it
  through the same parser.
- **fMRI** uses a NIfTI-1 reader (`src/ingest/nifti.js`) that extracts the central
  axial slice and downsamples it to the activation grid.
- **Live** feeds connect via `src/ingest/stream.js`. Lab Streaming Layer (LSL)
  outlets can be bridged to a WebSocket with the included example:

  ```bash
  pip install pylsl websockets
  python tools/lsl_bridge.py --stream-type EEG --port 8765   # real LSL outlet
  python tools/lsl_bridge.py --demo --port 8765              # synthetic test feed
  ```
  then set the app's WebSocket URL to `ws://localhost:8765` and click *Connect stream*.

Privacy: recording files are parsed entirely in the browser; nothing is uploaded.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/data.js` | Anatomical regions, connectome edges, patient cases, device specs |
| `src/network.js` | Three.js scene: region hubs, edges, neuron cloud, pulses, camera fly-to |
| `src/signals.js` | Signal engine: synthetic + real (EDF playback, stream, NIfTI) sources |
| `src/ingest/edf.js` | EDF / EDF+ / BDF EEG file parser |
| `src/ingest/nifti.js` | NIfTI-1 fMRI volume reader + slice→grid downsampler |
| `src/ingest/stream.js` | Live WebSocket EEG/BCI stream client |
| `src/gol.js` | GOL engine: Conway + spatial game-theory (Prisoner's Dilemma) AI |
| `src/main.js` | UI wiring, orbit/pick controls, render + panel update loop |
| `tools/lsl_bridge.py` | Example LSL→WebSocket bridge for live feeds |
