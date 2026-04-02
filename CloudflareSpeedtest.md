# @cloudflare/speedtest

A JavaScript module to measure the quality of a client's Internet connection.
Powers the Cloudflare speedtest app at https://speed.cloudflare.com

> **Warning:** The public TURN server for Packet Loss testing is deprecated and
> will be discontinued soon. See the Packet Loss section for details.

---

## Installation

```bash
npm install @cloudflare/speedtest
```

---

## Quick Start

```js
import SpeedTest from '@cloudflare/speedtest';

new SpeedTest().onFinish = results => console.log(results.getSummary());
```

---

## How It Works

The module performs test requests against the Cloudflare edge network and relies
on the `PerformanceResourceTiming` browser API to extract timing results.
It characterizes the connection via download/upload bandwidth, latency, and
packet loss.

> Note: Measurement results are collected by Cloudflare on completion for
> aggregated Internet quality insights.

---

## Instantiation

```js
new SpeedTest({ configOptions })
```

All config options are optional — they all have defaults.

### Config Options

| Option                        | Description                                                                                  | Default                                |
|-------------------------------|----------------------------------------------------------------------------------------------|----------------------------------------|
| `autoStart`                   | Automatically start measurements on instantiation                                            | `true`                                 |
| `downloadApiUrl`              | URL for download GET requests                                                                | `https://speed.cloudflare.com/__down`  |
| `uploadApiUrl`                | URL for upload POST requests                                                                 | `https://speed.cloudflare.com/__up`    |
| `turnServerUri`               | URI of the TURN server for packet loss                                                       | `turn.cloudflare.com:3478`             |
| `turnServerCredsApiUrl`       | URI returning TURN credentials (JSON with `username` and `credential` keys)                  | -                                      |
| `turnServerUser`              | TURN server username                                                                         | -                                      |
| `turnServerPass`              | TURN server password                                                                         | -                                      |
| `measurements`                | Custom measurement sequence (see Measurement Config)                                         | See defaults below                     |
| `measureDownloadLoadedLatency`| Measure latency simultaneously with downloads                                                | `true`                                 |
| `measureUploadLoadedLatency`  | Measure latency simultaneously with uploads                                                  | `true`                                 |
| `loadedLatencyThrottle`       | Interval between loaded latency requests (ms)                                                | `400`                                  |
| `bandwidthFinishRequestDuration` | Min duration (ms) to reach before halting further same-direction measurements             | `1000`                                 |
| `bandwidthAbortRequestDuration`  | Min duration (ms) to reach before aborting test early. `0` = disabled.                   | `0`                                    |
| `estimatedServerTime`         | Fixed value (ms) subtracted from TTFB if no `server-timing` header is present               | `10`                                   |
| `latencyPercentile`           | Percentile (0–1) used to calculate latency from a set of measurements                       | `0.5`                                  |
| `bandwidthPercentile`         | Percentile (0–1) used to calculate bandwidth from a set of measurements                     | `0.9`                                  |
| `bandwidthMinRequestDuration` | Min request duration (ms) for a measurement to be used in bandwidth calculation             | `10`                                   |
| `loadedRequestMinDuration`    | Min request duration (ms) to consider it loading the connection                             | `250`                                  |
| `loadedLatencyMaxPoints`      | Max data points to keep for loaded latency (latest ones are kept when exceeded)             | `20`                                   |

---

## Attributes

| Attribute            | Description                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| `results: Results`   | Current test results. May be incomplete if the test is still running.       |
| `isRunning: boolean` | Whether the test engine is currently running.                               |
| `isFinished: boolean`| Whether all measurements are done and results are final.                    |

---

## Methods

| Method       | Description                                                              |
|--------------|--------------------------------------------------------------------------|
| `play()`     | Starts or resumes measurements. No-op if already running or finished.    |
| `pause()`    | Pauses measurements. No-op if already paused or finished.                |
| `restart()`  | Clears results and restarts measurements from the beginning.             |

---

## Events

| Event               | Arguments          | Description                                                                 |
|---------------------|--------------------|-----------------------------------------------------------------------------|
| `onRunningChange`   | `running: boolean` | Fires when the engine starts or stops. Current state passed as argument.    |
| `onResultsChange`   | `{ type: string }` | Fires when any result changes. Measurement type included in the argument.   |
| `onFinish`          | `results: Results` | Fires when all measurements finish. Final results object passed as argument.|
| `onError`           | `error: string`    | Fires when an error occurs. Error details passed as argument.               |

---

## Measurement Configuration

Customize the tests performed (and their order) with the `measurements` option.
Pass an array of objects, each with a `type` field plus type-specific fields.

### Default Sequence

```js
[
  { type: 'latency',  numPackets: 1 },                              // initial latency estimation
  { type: 'download', bytes: 1e5,   count: 1, bypassMinDuration: true }, // initial download estimation
  { type: 'latency',  numPackets: 20 },
  { type: 'download', bytes: 1e5,   count: 9 },
  { type: 'download', bytes: 1e6,   count: 8 },
  { type: 'upload',   bytes: 1e5,   count: 8 },
  { type: 'packetLoss', numPackets: 1e3, responsesWaitTime: 3000 },
  { type: 'upload',   bytes: 1e6,   count: 6 },
  { type: 'download', bytes: 1e7,   count: 6 },
  { type: 'upload',   bytes: 1e7,   count: 4 },
  { type: 'download', bytes: 2.5e7, count: 4 },
  { type: 'upload',   bytes: 2.5e7, count: 4 },
  { type: 'download', bytes: 1e8,   count: 3 },
  { type: 'upload',   bytes: 5e7,   count: 3 },
  { type: 'download', bytes: 2.5e8, count: 2 }
]
```

### `latency`

| Field        | Required | Description                                                                                          |
|--------------|----------|------------------------------------------------------------------------------------------------------|
| `numPackets` | Yes      | Number of latency GET requests (bytes=0) to perform. Round-trip TTFB is extracted per request.       |

### `download` / `upload`

Sets are bound to a specific file size. The engine ramps up through increasing
sizes until `bandwidthMinRequestDuration` is met, after which larger sets are skipped.

| Field                | Required | Description                                                                                  | Default |
|----------------------|----------|----------------------------------------------------------------------------------------------|---------|
| `bytes`              | Yes      | File size to request/post. Bandwidth = bits / request duration (excl. server time).          | -       |
| `count`              | Yes      | Number of requests to perform for this file size.                                            | -       |
| `bypassMinDuration`  | No       | Ignore the `bandwidthMinRequestDuration` check and always run this set.                      | `false` |

### `packetLoss`

Sends UDP packets to a WebRTC TURN server round-trip and counts how many are lost.

> **Note:** You must provide your own TURN server. See `example/turn-worker` for
> a Cloudflare Worker setup using Cloudflare Realtime TURN.

| Field               | Required | Description                                                                          | Default |
|---------------------|----------|--------------------------------------------------------------------------------------|---------|
| `numPackets`        | No       | Total number of UDP packets to send.                                                 | `100`   |
| `responsesWaitTime` | No       | Time (ms) to wait after last packet reception before marking remaining as lost.      | `5000`  |
| `batchSize`         | No       | Packets per batch. If higher than `numPackets`, only one batch is sent.              | `10`    |
| `batchWaitTime`     | No       | Time (ms) to wait between batches.                                                   | `10`    |
| `connectionTimeout` | No       | Timeout (ms) for connecting to the TURN server.                                      | `5000`  |

---

## Results Object

### Summary & Latency

| Method                        | Description                                                                                      |
|-------------------------------|--------------------------------------------------------------------------------------------------|
| `getSummary()`                | High-level summary of all computed results.                                                      |
| `getUnloadedLatency()`        | Idle connection latency. Requires 1+ latency measurement.                                        |
| `getUnloadedJitter()`         | Idle jitter (avg distance between consecutive latency values). Requires 2+ measurements.         |
| `getUnloadedLatencyPoints()`  | Array of all idle latency measurements in sequence.                                              |
| `getDownLoadedLatency()`      | Latency while download-loaded. Requires `measureDownloadLoadedLatency` enabled.                  |
| `getDownLoadedJitter()`       | Jitter while download-loaded. Requires `measureDownloadLoadedLatency` and 2+ measurements.       |
| `getDownLoadedLatencyPoints()`| Array of all download-loaded latency measurements.                                               |
| `getUpLoadedLatency()`        | Latency while upload-loaded. Requires `measureUploadLoadedLatency` enabled.                      |
| `getUpLoadedJitter()`         | Jitter while upload-loaded. Requires `measureUploadLoadedLatency` and 2+ measurements.           |
| `getUpLoadedLatencyPoints()`  | Array of all upload-loaded latency measurements.                                                 |

### Bandwidth

| Method                         | Description                                                                                                      |
|--------------------------------|------------------------------------------------------------------------------------------------------------------|
| `getDownloadBandwidth()`       | Reduced download bandwidth (bps). Requires 1+ download longer than `bandwidthMinRequestDuration`.               |
| `getDownloadBandwidthPoints()` | Array of download results: `{ bytes, bps, duration, ping, measTime, serverTime, transferSize }`.                |
| `getUploadBandwidth()`         | Reduced upload bandwidth (bps). Requires 1+ upload longer than `bandwidthMinRequestDuration`.                   |
| `getUploadBandwidthPoints()`   | Array of upload results: `{ bytes, bps, duration, ping, measTime, serverTime, transferSize }`.                  |

### Packet Loss & Scores

| Method                  | Description                                                                                                   |
|-------------------------|---------------------------------------------------------------------------------------------------------------|
| `getPacketLoss()`       | Packet loss ratio (0–1). Requires a `packetLoss` measurement.                                                 |
| `getPacketLossDetails()`| Packet loss details: `{ packetLoss, totalMessages, numMessagesSent, lostMessages }`.                          |
| `getScores()`           | AIM scores for streaming, gaming, and real-time comms quality. Only available after all measurements finish.  |
