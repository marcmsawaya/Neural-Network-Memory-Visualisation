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

## Architecture

| File | Responsibility |
| --- | --- |
| `src/data.js` | Anatomical regions, connectome edges, patient cases, device specs |
| `src/network.js` | Three.js scene: region hubs, edges, neuron cloud, pulses, camera fly-to |
| `src/signals.js` | Synthetic EEG / fMRI / BCI signal generation |
| `src/main.js` | UI wiring, orbit/pick controls, render + panel update loop |

The signal data is synthetic and physiologically-plausible for demonstration.
Real deployments would replace `SignalEngine` with a device/data ingestion layer
(e.g. LSL, EDF/BDF EEG files, NIfTI fMRI volumes, or a BCI SDK stream).
