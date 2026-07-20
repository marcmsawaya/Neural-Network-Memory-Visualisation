// EDF / EDF+ / BDF parser (European Data Format — the de-facto clinical EEG
// interchange format). Pure client-side, no dependencies.
//
// Reference: Kemp & Olivan (2003), https://www.edfplus.info/specs/edf.html
// BDF (BioSemi) is the 24-bit variant; detected from the version byte (0xFF).

function ascii(view, offset, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s.trim();
}

export function parseEDF(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const isBDF = bytes[0] === 0xff; // BDF marker in the version field

  let p = 0;
  const read = (len) => {
    const s = ascii(view, p, len);
    p += len;
    return s;
  };

  read(8); // version (or 0xFF + "BIOSEMI")
  const patient = read(80);
  const recording = read(80);
  const startDate = read(8);
  const startTime = read(8);
  const headerBytes = parseInt(read(8), 10);
  const reserved = read(44);
  const numRecords = parseInt(read(8), 10);
  const recordDuration = parseFloat(read(8)); // seconds per data record
  const ns = parseInt(read(4), 10);

  if (!ns || ns < 1 || !isFinite(recordDuration)) {
    throw new Error("Not a valid EDF/BDF file (bad header).");
  }

  const labels = [];
  for (let i = 0; i < ns; i++) labels.push(read(16));
  for (let i = 0; i < ns; i++) read(80); // transducer
  const physDim = [];
  for (let i = 0; i < ns; i++) physDim.push(read(8));
  const physMin = [];
  for (let i = 0; i < ns; i++) physMin.push(parseFloat(read(8)));
  const physMax = [];
  for (let i = 0; i < ns; i++) physMax.push(parseFloat(read(8)));
  const digMin = [];
  for (let i = 0; i < ns; i++) digMin.push(parseFloat(read(8)));
  const digMax = [];
  for (let i = 0; i < ns; i++) digMax.push(parseFloat(read(8)));
  for (let i = 0; i < ns; i++) read(80); // prefiltering
  const samplesPerRecord = [];
  for (let i = 0; i < ns; i++) samplesPerRecord.push(parseInt(read(8), 10));
  for (let i = 0; i < ns; i++) read(32); // reserved per-signal

  // EDF+ "annotations" channel is labelled "EDF Annotations" — skip for plotting.
  const dataStart = headerBytes || p;
  const bytesPerSample = isBDF ? 3 : 2;

  // Allocate per-channel output arrays.
  const totalSamples = samplesPerRecord.map((n) => n * numRecords);
  const channels = labels.map((label, i) => ({
    label: label || `ch${i + 1}`,
    unit: physDim[i],
    sampleRate: samplesPerRecord[i] / recordDuration,
    data: new Float32Array(Math.max(0, totalSamples[i])),
    isAnnotation: /edf annotations/i.test(label),
  }));

  const recordStride = samplesPerRecord.reduce((a, n) => a + n * bytesPerSample, 0);

  for (let r = 0; r < numRecords; r++) {
    let off = dataStart + r * recordStride;
    for (let c = 0; c < ns; c++) {
      const n = samplesPerRecord[c];
      const ch = channels[c];
      const scale = (physMax[c] - physMin[c]) / (digMax[c] - digMin[c] || 1);
      for (let s = 0; s < n; s++) {
        let digital;
        if (isBDF) {
          // 24-bit little-endian signed
          const b0 = bytes[off], b1 = bytes[off + 1], b2 = bytes[off + 2];
          digital = b0 | (b1 << 8) | (b2 << 16);
          if (digital & 0x800000) digital -= 0x1000000;
          off += 3;
        } else {
          digital = view.getInt16(off, true);
          off += 2;
        }
        if (!ch.isAnnotation) {
          ch.data[r * n + s] = (digital - digMin[c]) * scale + physMin[c];
        }
      }
    }
  }

  const signalChannels = channels.filter((c) => !c.isAnnotation && c.data.length);
  const duration = numRecords * recordDuration;

  return {
    format: isBDF ? "BDF" : reserved.startsWith("EDF+") ? "EDF+" : "EDF",
    patient,
    recording,
    startDate,
    startTime,
    duration,
    numRecords,
    recordDuration,
    channels: signalChannels,
  };
}
