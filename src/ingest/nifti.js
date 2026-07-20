// Minimal NIfTI-1 reader (.nii). Parses the 348-byte header and voxel volume,
// enough to extract an activation slice for the fMRI panel. Pure client-side.
//
// Reference: https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields
// Gzipped .nii.gz is not decompressed here — ask users for uncompressed .nii,
// or a gunzip step can be added later.

const DT = {
  2: { get: (v, o) => v.getUint8(o), size: 1 },      // uint8
  4: { get: (v, o) => v.getInt16(o, true), size: 2 }, // int16
  8: { get: (v, o) => v.getInt32(o, true), size: 4 }, // int32
  16: { get: (v, o) => v.getFloat32(o, true), size: 4 }, // float32
  64: { get: (v, o) => v.getFloat64(o, true), size: 8 }, // float64
  256: { get: (v, o) => v.getInt8(o), size: 1 },     // int8
  512: { get: (v, o) => v.getUint16(o, true), size: 2 }, // uint16
};

export function parseNIfTI(buffer) {
  const view = new DataView(buffer);
  const sizeof_hdr = view.getInt32(0, true);
  const littleEndian = sizeof_hdr === 348;
  if (!littleEndian && view.getInt32(0, false) !== 348) {
    throw new Error("Not a NIfTI-1 file (bad header size).");
  }

  const dim = [];
  for (let i = 0; i < 8; i++) dim.push(view.getInt16(40 + i * 2, true));
  const datatype = view.getInt16(70, true);
  const bitpix = view.getInt16(72, true);
  const voxOffset = Math.round(view.getFloat32(108, true)) || 352;
  const sclSlope = view.getFloat32(112, true) || 1;
  const sclInter = view.getFloat32(116, true) || 0;

  const [, nx, ny, nz] = dim; // dim[0] = #dims
  const reader = DT[datatype];
  if (!reader) throw new Error(`Unsupported NIfTI datatype ${datatype}.`);

  // Pick the middle axial slice (z) of the first volume.
  const z = Math.floor((nz || 1) / 2);
  const sliceVoxels = nx * ny;
  const base = voxOffset + z * sliceVoxels * reader.size;

  const slice = new Float32Array(sliceVoxels);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < sliceVoxels; i++) {
    const raw = reader.get(view, base + i * reader.size);
    const val = raw * sclSlope + sclInter;
    slice[i] = val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  return {
    dims: { nx, ny, nz, nt: dim[4] || 1 },
    datatype,
    bitpix,
    slice,
    sliceWidth: nx,
    sliceHeight: ny,
    min,
    max,
  };
}

// Downsample a slice to an n x n grid of normalized [0,1] activations.
export function sliceToGrid(nifti, n = 8) {
  const { slice, sliceWidth: w, sliceHeight: h, min, max } = nifti;
  const range = max - min || 1;
  const grid = new Array(n * n).fill(0);
  const counts = new Array(n * n).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.min(n - 1, Math.floor((x / w) * n));
      const gy = Math.min(n - 1, Math.floor((y / h) * n));
      const gi = gy * n + gx;
      grid[gi] += (slice[y * w + x] - min) / range;
      counts[gi]++;
    }
  }
  return grid.map((s, i) => (counts[i] ? s / counts[i] : 0));
}
