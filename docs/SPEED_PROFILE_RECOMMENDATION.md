# Speed test → stream profile recommendation

This document defines how Moonlight’s **profile gate** maps `speed_result` from the NextGPU API to a recommended streaming preset (`performance`, `balance`, or `quality`).

## Data source

| Field | Source |
|--------|--------|
| `publicIP`, `computer_name` | Host `domain.txt`, read by the Moonlight server at startup. |
| `speed_result` | Stored on the machine record when the user rents from the dashboard. The dashboard runs a **download-only** Cloudflare speed test and POSTs Mbps to `/updateCurrentUsed` (see `nextGPU-assets/src/lib/speedtest/BACKEND.md`). |
| Browser → Moonlight | `GET /api/machine-info` (same origin, no CORS). |
| Moonlight → NextGPU | `GET {machine_info_api_base}/getMachineInfor?publicIP=…&computer_name=…` (server-side in `src/api/machine_info.rs`). |

The profile gate **does not** run a new speed test. The browser **polls** `/api/machine-info` up to 5 times (1 s apart) because `speed_result` can arrive shortly after the stream tab opens.

## Profile presets (product)

From `web/stream_profile_presets.ts`:

| Profile ID | Resolution | Default stream bitrate | Tier max |
|------------|------------|------------------------|----------|
| `performance` | 1080p (Full HD) | 20 Mbps | 50 Mbps |
| `balance` | 1440p (2K) | 40 Mbps | 70 Mbps |
| `quality` | 4K | 60 Mbps | 120 Mbps |

## Mapping rule

Let **S** = measured download speed in Mbps (`speed_result`).

1. If `S` is missing, not a number, or not finite → recommend **`balance`** (safe default).
2. Otherwise:

| Condition | Recommended profile | Rationale |
|-----------|---------------------|-----------|
| **S < 60** | `performance` | Weaker link; 1080p / 20 Mbps default. |
| **60 ≤ S ≤ 150** | `balance` | Mid-range; 2K / 40 Mbps default. |
| **S > 150** | `quality` | Strong link; 4K / 60 Mbps default. |

## Implementation

- Proxy: `get_machine_info` in `src/api/machine_info.rs`
- Mapping: `profileIdFromSpeedMbps()` in `web/profile_recommendation.ts`
- Constants: `SPEED_THRESHOLD_PERFORMANCE_MBPS = 60`, `SPEED_THRESHOLD_QUALITY_MBPS = 150`
- UI: `web/component/stream_profile_gate.ts` shows Mbps when available and badges the recommended card.

## Tuning

Adjust 60 and 150 after production telemetry. Document any change here and in code constants together.
