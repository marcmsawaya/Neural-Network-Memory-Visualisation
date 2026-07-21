// Builds a valid EDF file in memory (real EDF bytes) so the app can demo the
// full ingestion path — parseEDF() runs on this exactly as it would on a file
// from disk. Not synthetic-signal shortcutting: it exercises the real parser.

function pad(s, len) {
  s = String(s);
  return (s.length > len ? s.slice(0, len) : s + " ".repeat(len - s.length));
}

export function buildSampleEDF() {
  const ns = 8;
  const fs = 256; // Hz
  const recDur = 1; // s
  const numRecords = 12;
  const samplesPerRec = fs * recDur;
  const labels = ["Fp1", "Fp2", "C3", "C4", "P3", "P4", "O1", "O2"];
  const digMin = -32768, digMax = 32767;
  const physMin = -250, physMax = 250; // µV

  const headerBytes = 256 + ns * 256;
  const dataBytes = numRecords * ns * samplesPerRec * 2;
  const buf = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buf);
  let p = 0;
  const put = (s, len) => {
    const t = pad(s, len);
    for (let i = 0; i < len; i++) view.setUint8(p + i, t.charCodeAt(i));
    p += len;
  };

  put("0", 8); // version
  put("X NeuroVoyage demo patient", 80);
  put("Startdate 01-JAN-2026 demo synthetic-clinical", 80);
  put("01.01.26", 8);
  put("12.00.00", 8);
  put(headerBytes, 8);
  put("EDF+C", 44);
  put(numRecords, 8);
  put(recDur, 8);
  put(ns, 4);

  labels.forEach((l) => put(l, 16));
  for (let i = 0; i < ns; i++) put("AgAgCl", 80); // transducer
  for (let i = 0; i < ns; i++) put("uV", 8);
  for (let i = 0; i < ns; i++) put(physMin, 8);
  for (let i = 0; i < ns; i++) put(physMax, 8);
  for (let i = 0; i < ns; i++) put(digMin, 8);
  for (let i = 0; i < ns; i++) put(digMax, 8);
  for (let i = 0; i < ns; i++) put("HP:0.1Hz LP:70Hz", 80);
  for (let i = 0; i < ns; i++) put(samplesPerRec, 8);
  for (let i = 0; i < ns; i++) put("", 32);

  // data: posterior channels (O1/O2) get strong ~10 Hz alpha; add a spike burst
  const scale = (digMax - digMin) / (physMax - physMin);
  for (let r = 0; r < numRecords; r++) {
    for (let c = 0; c < ns; c++) {
      const posterior = c >= 6;
      for (let s = 0; s < samplesPerRec; s++) {
        const t = r + s / fs;
        const alpha = Math.sin(2 * Math.PI * 10 * t) * (posterior ? 60 : 15);
        const beta = Math.sin(2 * Math.PI * 20 * t + c) * 8;
        const noise = (Math.random() - 0.5) * 12;
        let uv = alpha + beta + noise;
        if (r >= 6 && c === 4 && s % 200 < 3) uv += 180; // epileptiform burst on P3
        const digital = Math.max(digMin, Math.min(digMax, Math.round((uv - physMin) * scale + digMin)));
        view.setInt16(p, digital, true);
        p += 2;
      }
    }
  }
  return buf;
}
