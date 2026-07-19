// Anatomical regions used as network hubs. Positions are in a normalized
// brain-ish coordinate space (x: left-right, y: sup-inf, z: ant-post).
export const REGIONS = [
  { id: "pfc", name: "Prefrontal Cortex", pos: [0, 1.3, 2.6], color: "#4fd1ff", band: "beta" },
  { id: "mtr", name: "Motor Cortex", pos: [-1.6, 1.9, 0.4], color: "#7ee0ff", band: "beta" },
  { id: "som", name: "Somatosensory", pos: [1.6, 1.9, -0.2], color: "#9bd0ff", band: "beta" },
  { id: "par", name: "Parietal Lobe", pos: [0, 1.6, -2.0], color: "#b26bff", band: "alpha" },
  { id: "occ", name: "Occipital (V1)", pos: [0, 0.5, -3.4], color: "#ff8ad6", band: "alpha" },
  { id: "tmp", name: "Temporal Lobe", pos: [-2.6, -0.4, 0.6], color: "#ffcb5c", band: "theta" },
  { id: "tmr", name: "Temporal (R)", pos: [2.6, -0.4, 0.6], color: "#ffb35c", band: "theta" },
  { id: "hip", name: "Hippocampus", pos: [-1.1, -0.3, -0.6], color: "#33e0a0", band: "theta" },
  { id: "amy", name: "Amygdala", pos: [1.1, -0.6, 1.0], color: "#ff6b6b", band: "theta" },
  { id: "thl", name: "Thalamus", pos: [0, 0.2, 0.2], color: "#ffffff", band: "alpha" },
  { id: "cbl", name: "Cerebellum", pos: [0, -1.6, -2.4], color: "#8ea0c8", band: "delta" },
  { id: "bst", name: "Brainstem", pos: [0, -2.0, -0.4], color: "#c0c8e0", band: "delta" },
];

// Connectome edges (structural connectivity, simplified).
export const EDGES = [
  ["pfc", "mtr"], ["pfc", "som"], ["pfc", "par"], ["pfc", "thl"], ["pfc", "amy"],
  ["mtr", "som"], ["mtr", "thl"], ["som", "par"], ["par", "occ"], ["par", "thl"],
  ["occ", "tmp"], ["occ", "tmr"], ["tmp", "hip"], ["tmr", "hip"], ["tmp", "amy"],
  ["hip", "thl"], ["amy", "thl"], ["thl", "bst"], ["cbl", "bst"], ["cbl", "mtr"],
  ["bst", "hip"], ["par", "tmr"],
];

export const PATIENTS = [
  { id: "p1", name: "P-1042 · Healthy control", modifier: 1.0, note: "Normal resting-state rhythms." },
  { id: "p2", name: "P-2087 · Pre-surgical epilepsy", modifier: 1.6, focus: "hip", note: "Left temporal focus." },
  { id: "p3", name: "P-3311 · Motor BCI trial", modifier: 1.2, focus: "mtr", note: "Blackrock array over M1." },
  { id: "p4", name: "P-4590 · Post-stroke rehab", modifier: 0.7, focus: "som", note: "Reduced sensorimotor drive." },
];

export const EEG_CHANNELS = ["Fp1", "Fp2", "C3", "C4", "P3", "P4", "O1", "O2"];

export const BANDS = {
  delta: { freq: 2, label: "Delta" },
  theta: { freq: 6, label: "Theta" },
  alpha: { freq: 10, label: "Alpha" },
  beta: { freq: 20, label: "Beta" },
};

export const BCI_DEVICES = {
  neuralink: { channels: 1024, baseImp: 12, baseRate: 84, intents: ["cursor: →", "cursor: ↑", "click", "idle", "cursor: ←"] },
  blackrock: { channels: 96, baseImp: 45, baseRate: 62, intents: ["grasp", "reach", "rest", "extend", "pinch"] },
  openbci: { channels: 8, baseImp: 8, baseRate: 18, intents: ["blink", "jaw", "focus", "relax"] },
};
