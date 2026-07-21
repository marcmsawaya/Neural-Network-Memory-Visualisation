// Live streaming ingestion over WebSocket. This is the bridge for real-time
// EEG / BCI feeds — e.g. Lab Streaming Layer (LSL) exposed through an
// `lsl->websocket` relay, or a device SDK that emits JSON frames.
//
// Expected message format (JSON, one object per frame):
//   { "eeg": [c0, c1, ...], "spikes": <count?>, "ts": <seconds?> }
// `eeg` is one multichannel sample; channels map by index to the display.

export class StreamClient {
  constructor({ onFrame, onStatus } = {}) {
    this.onFrame = onFrame || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.url = null;
    this.frames = 0;
  }

  connect(url) {
    this.disconnect();
    this.url = url;
    this.onStatus("connecting");
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.onStatus("error", String(e.message || e));
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => this.onStatus("connected");
    ws.onclose = () => this.onStatus("closed");
    ws.onerror = () => this.onStatus("error", "socket error");
    ws.onmessage = (ev) => {
      let frame;
      try {
        frame = typeof ev.data === "string" ? JSON.parse(ev.data) : this._decodeBinary(ev.data);
      } catch {
        return; // ignore malformed frames
      }
      if (frame && Array.isArray(frame.eeg)) {
        this.frames++;
        this.onFrame(frame);
      }
    };
  }

  // Optional binary path: Float32Array of channel samples.
  _decodeBinary(buf) {
    return { eeg: Array.from(new Float32Array(buf)) };
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
  }
}
