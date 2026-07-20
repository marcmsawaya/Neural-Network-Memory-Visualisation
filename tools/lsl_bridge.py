#!/usr/bin/env python3
"""LSL -> WebSocket bridge for NeuroVoyage "Live" ingestion.

Pulls samples from a Lab Streaming Layer (LSL) EEG/BCI outlet and rebroadcasts
them as JSON frames on a WebSocket that the browser app connects to:

    {"eeg": [c0, c1, ...], "spikes": <int?>, "ts": <float?>}

Usage:
    pip install pylsl websockets
    python tools/lsl_bridge.py --stream-type EEG --port 8765

If no LSL stream is available, pass --demo to emit a synthetic 8-channel feed
so you can exercise the app end-to-end.
"""
import argparse
import asyncio
import json
import math
import time

import websockets

try:
    from pylsl import StreamInlet, resolve_byprop
except Exception:  # pylsl optional in --demo mode
    StreamInlet = resolve_byprop = None


async def lsl_frames(stream_type):
    streams = resolve_byprop("type", stream_type, timeout=5)
    if not streams:
        raise RuntimeError(f"No LSL stream of type {stream_type!r} found.")
    inlet = StreamInlet(streams[0])
    while True:
        sample, ts = inlet.pull_sample(timeout=1.0)
        if sample is not None:
            yield {"eeg": list(sample), "ts": ts}
        await asyncio.sleep(0)


async def demo_frames():
    t0 = time.time()
    fs = 256
    while True:
        t = time.time() - t0
        eeg = [
            math.sin(2 * math.pi * 10 * t + c) * (60 if c >= 6 else 15)
            + (math.sin(2 * math.pi * 20 * t + c) * 8)
            for c in range(8)
        ]
        yield {"eeg": eeg, "spikes": int(40 + 30 * math.sin(t)), "ts": t}
        await asyncio.sleep(1 / fs)


def make_handler(source_factory):
    async def handler(ws):
        async for frame in source_factory():
            await ws.send(json.dumps(frame))
    return handler


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--stream-type", default="EEG")
    ap.add_argument("--demo", action="store_true", help="emit synthetic frames")
    args = ap.parse_args()

    factory = (lambda: demo_frames()) if args.demo else (lambda: lsl_frames(args.stream_type))
    async with websockets.serve(make_handler(factory), "0.0.0.0", args.port):
        print(f"NeuroVoyage bridge on ws://localhost:{args.port} "
              f"({'demo' if args.demo else args.stream_type})")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
