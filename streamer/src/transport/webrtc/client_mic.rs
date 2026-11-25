//! Client → host microphone uplink: WebRTC Opus track → PCM → host virtual mic.
//! On Windows, renders into Speakers (Steam Streaming Microphone) via cpal/WASAPI.
//! Failure must not tear down the game stream.
//!
//! Opus decoder and cpal::Stream are !Send; decode/render runs on a dedicated OS thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use log::warn;
use webrtc::{
    rtp_transceiver::{
        rtp_codec::RTPCodecType, rtp_receiver::RTCRtpReceiver,
        rtp_transceiver_direction::RTCRtpTransceiverDirection, RTCRtpTransceiver,
        RTCRtpTransceiverInit,
    },
    track::track_remote::TrackRemote,
};

/// Preferred: Speakers (Steam Streaming Microphone). Never match Steam Streaming Speakers (game).
const STEAM_MIC_RENDER_NEEDLE: &str = "Steam Streaming Microphone";
/// Fallback when Steam VAC has KS/PnP but no WASAPI endpoints (seen on some Win11 24H2 hosts).
const VB_CABLE_RENDER_NEEDLES: &[&str] = &["CABLE Input", "VB-Audio Virtual Cable"];
const TARGET_SAMPLE_RATE: u32 = 48_000;

#[cfg(windows)]
mod sink_pref {
    /// Written by corescripts `Save-ClientMicSinkPreference` (steam-mic | vb-cable).
    pub const CLIENT_MIC_SINK_PREF_PATH: &str = r"C:\ProgramData\nextGPU\client-mic-sink.json";

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum MicSinkKind {
        SteamMic,
        VbCable,
    }

    impl MicSinkKind {
        pub fn as_str(self) -> &'static str {
            match self {
                Self::SteamMic => "steam-mic",
                Self::VbCable => "vb-cable",
            }
        }
    }

    /// Prefer VB-Cable when preference/env says so (Steam WASAPI often broken on Win11).
    pub fn preferred_mic_sink() -> MicSinkKind {
        if let Ok(v) = std::env::var("NEXTGPU_CLIENTMIC_SINK") {
            let v = v.trim().to_ascii_lowercase();
            if v == "vb-cable" || v == "vbcable" || v == "cable" {
                return MicSinkKind::VbCable;
            }
            if v == "steam-mic" || v == "steam" {
                return MicSinkKind::SteamMic;
            }
        }
        if let Ok(raw) = std::fs::read_to_string(CLIENT_MIC_SINK_PREF_PATH) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                let sink = v
                    .get("Sink")
                    .or_else(|| v.get("sink"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if sink == "vb-cable" {
                    return MicSinkKind::VbCable;
                }
            }
        }
        MicSinkKind::SteamMic
    }
}

#[cfg(windows)]
use sink_pref::{preferred_mic_sink, MicSinkKind};

/// Seconds of PCM to capture at dump points A/B/C (see `pcm_dump`).
const PCM_DUMP_SECS: u32 = 10;

fn pcm_dump_enabled() -> bool {
    match std::env::var("NEXTGPU_CLIENTMIC_PCM_DUMP") {
        Ok(v) => {
            let v = v.trim();
            !(v.is_empty()
                || v == "0"
                || v.eq_ignore_ascii_case("false")
                || v.eq_ignore_ascii_case("off")
                || v.eq_ignore_ascii_case("no"))
        }
        // Opt-in only (set NEXTGPU_CLIENTMIC_PCM_DUMP=1 for A/B/C WAV dumps).
        Err(_) => false,
    }
}

enum MicCmd {
    Packet(Vec<u8>),
    Stop,
}

pub struct ClientMicController {
    enabled: AtomicBool,
    worker: std::sync::Mutex<Option<MicWorker>>,
}

struct MicWorker {
    tx: SyncSender<MicCmd>,
    join: Option<JoinHandle<()>>,
}

impl ClientMicController {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            worker: std::sync::Mutex::new(None),
        }
    }

    pub async fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            self.stop_worker();
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub async fn stop(&self) {
        self.stop_worker();
    }

    fn stop_worker(&self) {
        let mut slot = match self.worker.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(mut worker) = slot.take() {
            let _ = worker.tx.send(MicCmd::Stop);
            if let Some(join) = worker.join.take() {
                let _ = join.join();
            }
        }
    }

    pub async fn on_track(
        self: &Arc<Self>,
        track: Arc<TrackRemote>,
        _receiver: Arc<RTCRtpReceiver>,
        _transceiver: Arc<RTCRtpTransceiver>,
    ) {
        if track.kind() != RTPCodecType::Audio {
            return;
        }
        // Browser only attaches a sendonly mic when the user enabled it; any inbound audio is client mic.
        self.enabled.store(true, Ordering::SeqCst);

        let this = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(err) = this.run_track(track).await {
                warn!("[ClientMic] track loop ended: {err:#}");
            }
            this.stop_worker();
        });
    }

    async fn run_track(&self, track: Arc<TrackRemote>) -> anyhow::Result<()> {
        #[cfg(not(windows))]
        {
            warn!("[ClientMic] host mic sink is Windows-only; draining uplink");
            loop {
                if track.read_rtp().await.is_err() {
                    break;
                }
            }
            return Ok(());
        }

        #[cfg(windows)]
        {
            let (tx, rx) = sync_channel::<MicCmd>(64);
            let join = thread::Builder::new()
                .name("client-mic".into())
                .spawn(move || mic_worker_loop(rx))
                .map_err(|e| anyhow::anyhow!("spawn client-mic worker: {e}"))?;

            {
                let mut slot = self.worker.lock().unwrap_or_else(|p| p.into_inner());
                if let Some(mut old) = slot.take() {
                    let _ = old.tx.send(MicCmd::Stop);
                    if let Some(j) = old.join.take() {
                        let _ = j.join();
                    }
                }
                *slot = Some(MicWorker {
                    tx: tx.clone(),
                    join: Some(join),
                });
            }

            loop {
                let (packet, _) = match track.read_rtp().await {
                    Ok(v) => v,
                    Err(_) => break,
                };
                if packet.payload.is_empty() {
                    continue;
                }
                match tx.try_send(MicCmd::Packet(packet.payload.to_vec())) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        // Drop on backpressure; keep stream alive.
                    }
                    Err(TrySendError::Disconnected(_)) => {
                        warn!("[ClientMic] worker disconnected");
                        break;
                    }
                }
            }

            let _ = tx.send(MicCmd::Stop);
            Ok(())
        }
    }
}

/// Diagnostic WAV dumps at Opus→PCM stages (A/B/C). Enabled by default; `NEXTGPU_CLIENTMIC_PCM_DUMP=0` to disable.
#[cfg(windows)]
mod pcm_dump {
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use log::{info, warn};

    use super::{PCM_DUMP_SECS, TARGET_SAMPLE_RATE};

    pub struct Session {
        dir: PathBuf,
        /// A — interleaved stereo i16 after Opus decode.
        after_decode_stereo: Mutex<WavPcm16>,
        /// B — mono i16 after downmix, before device queue.
        after_downmix_mono: Mutex<WavPcm16>,
        /// C — f32 interleaved as heard in the device callback (stored as i16 WAV for easy playback).
        pre_device_f32: Mutex<WavPcm16>,
    }

    struct WavPcm16 {
        path: PathBuf,
        pcm: Vec<i16>,
        channels: u16,
        max_samples: usize,
        finalized: bool,
        label: &'static str,
    }

    impl Session {
        pub fn start(device_channels: u16) -> Option<std::sync::Arc<Self>> {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("nextgpu-clientmic-pcm-{stamp}"));
            if let Err(err) = std::fs::create_dir_all(&dir) {
                warn!("[ClientMic] pcm dump mkdir failed: {err}");
                return None;
            }
            let max_frames = (TARGET_SAMPLE_RATE as usize) * (PCM_DUMP_SECS as usize);
            let ch = device_channels.max(1);
            let session = std::sync::Arc::new(Self {
                dir: dir.clone(),
                after_decode_stereo: Mutex::new(WavPcm16::new(
                    dir.join("A-after-opus-decode-stereo.wav"),
                    2,
                    max_frames * 2,
                    "A-after-opus-decode-stereo",
                )),
                after_downmix_mono: Mutex::new(WavPcm16::new(
                    dir.join("B-after-downmix-mono.wav"),
                    1,
                    max_frames,
                    "B-after-downmix-mono",
                )),
                pre_device_f32: Mutex::new(WavPcm16::new(
                    dir.join("C-pre-device-callback.wav"),
                    ch,
                    max_frames * ch as usize,
                    "C-pre-device-callback",
                )),
            });
            info!(
                "[ClientMic] pcm dump ON ({PCM_DUMP_SECS}s) dir={} A=stereo-i16 B=mono-i16 C=f32→i16/{}ch",
                dir.display(),
                ch
            );
            Some(session)
        }

        pub fn push_after_decode_stereo(&self, interleaved_lr: &[i16]) {
            if let Ok(mut w) = self.after_decode_stereo.lock() {
                w.push_i16(interleaved_lr);
            }
        }

        pub fn push_after_downmix_mono(&self, mono: &[i16]) {
            if let Ok(mut w) = self.after_downmix_mono.lock() {
                w.push_i16(mono);
            }
        }

        /// Device callback: interleaved f32 in [-1, 1].
        pub fn push_pre_device_f32(&self, interleaved: &[f32]) {
            if let Ok(mut w) = self.pre_device_f32.lock() {
                if w.full() {
                    return;
                }
                let mut tmp = Vec::with_capacity(interleaved.len());
                for &s in interleaved {
                    let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                    tmp.push(v);
                }
                w.push_i16(&tmp);
            }
        }

        pub fn finish(&self) {
            if let Ok(mut w) = self.after_decode_stereo.lock() {
                w.finalize();
            }
            if let Ok(mut w) = self.after_downmix_mono.lock() {
                w.finalize();
            }
            if let Ok(mut w) = self.pre_device_f32.lock() {
                w.finalize();
            }
            info!(
                "[ClientMic] pcm dump finished dir={} (A/B/C wav). Compare in Audacity / ASR.",
                self.dir.display()
            );
        }
    }

    impl WavPcm16 {
        fn new(path: PathBuf, channels: u16, max_samples: usize, label: &'static str) -> Self {
            Self {
                path,
                pcm: Vec::with_capacity(max_samples.min(48000 * 2)),
                channels: channels.max(1),
                max_samples,
                finalized: false,
                label,
            }
        }

        fn full(&self) -> bool {
            self.finalized || self.pcm.len() >= self.max_samples
        }

        fn push_i16(&mut self, samples: &[i16]) {
            if self.full() || samples.is_empty() {
                return;
            }
            let room = self.max_samples.saturating_sub(self.pcm.len());
            let n = samples.len().min(room);
            self.pcm.extend_from_slice(&samples[..n]);
            if self.pcm.len() >= self.max_samples {
                self.finalize();
            }
        }

        fn finalize(&mut self) {
            if self.finalized {
                return;
            }
            self.finalized = true;
            if self.pcm.is_empty() {
                warn!("[ClientMic] pcm dump {} empty (no samples)", self.label);
                return;
            }
            match write_wav_pcm16(&self.path, TARGET_SAMPLE_RATE, self.channels, &self.pcm) {
                Ok(()) => info!(
                    "[ClientMic] pcm dump {} wrote {} samples ({} ch) → {}",
                    self.label,
                    self.pcm.len(),
                    self.channels,
                    self.path.display()
                ),
                Err(err) => warn!("[ClientMic] pcm dump {} write failed: {err}", self.label),
            }
        }
    }

    fn write_wav_pcm16(
        path: &PathBuf,
        sample_rate: u32,
        channels: u16,
        pcm: &[i16],
    ) -> std::io::Result<()> {
        let mut f = File::create(path)?;
        let data_bytes = (pcm.len() * 2) as u32;
        let byte_rate = sample_rate * channels as u32 * 2;
        let block_align = channels * 2;
        // RIFF header
        f.write_all(b"RIFF")?;
        f.write_all(&(36 + data_bytes).to_le_bytes())?;
        f.write_all(b"WAVE")?;
        f.write_all(b"fmt ")?;
        f.write_all(&16u32.to_le_bytes())?; // PCM fmt chunk size
        f.write_all(&1u16.to_le_bytes())?; // audio format PCM
        f.write_all(&channels.to_le_bytes())?;
        f.write_all(&sample_rate.to_le_bytes())?;
        f.write_all(&byte_rate.to_le_bytes())?;
        f.write_all(&block_align.to_le_bytes())?;
        f.write_all(&16u16.to_le_bytes())?; // bits per sample
        f.write_all(b"data")?;
        f.write_all(&data_bytes.to_le_bytes())?;
        for s in pcm {
            f.write_all(&s.to_le_bytes())?;
        }
        Ok(())
    }
}

#[cfg(windows)]
fn mic_worker_loop(rx: std::sync::mpsc::Receiver<MicCmd>) {
    // WebRTC Opus is usually negotiated stereo (even for a mono mic track).
    // Decoding stereo frames with a mono decoder produces robotic / unintelligible audio.
    // Stereo decoder accepts mono packets too; we always downmix to mono for the VAC.
    let mut decoder = match opus::Decoder::new(TARGET_SAMPLE_RATE, opus::Channels::Stereo) {
        Ok(d) => d,
        Err(err) => {
            warn!("[ClientMic] opus decoder: {err}");
            while let Ok(cmd) = rx.recv() {
                if matches!(cmd, MicCmd::Stop) {
                    break;
                }
            }
            return;
        }
    };
    // 20–60 ms frames × 2 channels interleaved.
    let mut pcm_i16 = vec![0i16; (TARGET_SAMPLE_RATE / 25 * 2) as usize * 3];
    let mut mono = vec![0i16; (TARGET_SAMPLE_RATE / 25) as usize * 3];
    let mut sink = match cpal_sink::CpalSink::open_mic_render() {
        Ok(sink) => Some(sink),
        Err(err) => {
            warn!("[ClientMic] output open failed (continuing without mic): {err:#}");
            None
        }
    };
    let dump = if pcm_dump_enabled() {
        let ch = sink.as_ref().map(|s| s.channels()).unwrap_or(2);
        let session = pcm_dump::Session::start(ch);
        if let (Some(ref mut s), Some(ref d)) = (sink.as_mut(), session.as_ref()) {
            s.set_pcm_dump(std::sync::Arc::clone(d));
        }
        session
    } else {
        None
    };

    while let Ok(cmd) = rx.recv() {
        match cmd {
            MicCmd::Stop => break,
            MicCmd::Packet(payload) => {
                if sink.is_none() {
                    continue;
                }

                let per_ch = match decoder.decode(&payload, &mut pcm_i16, false) {
                    Ok(n) => n,
                    Err(err) => {
                        warn!("[ClientMic] opus decode: {err}");
                        continue;
                    }
                };

                // A — stereo i16 interleaved right after Opus decode (before downmix).
                if let Some(d) = dump.as_ref() {
                    let stereo_samples = per_ch.saturating_mul(2);
                    if pcm_i16.len() >= stereo_samples {
                        d.push_after_decode_stereo(&pcm_i16[..stereo_samples]);
                    }
                }

                // Interleaved L/R → mono (average). Mono Opus still fills usable L (and often R).
                if mono.len() < per_ch {
                    mono.resize(per_ch, 0);
                }
                for i in 0..per_ch {
                    let l = pcm_i16[i * 2] as i32;
                    let r = pcm_i16[i * 2 + 1] as i32;
                    mono[i] = ((l + r) / 2) as i16;
                }

                // B — mono i16 after downmix, before device queue.
                if let Some(d) = dump.as_ref() {
                    d.push_after_downmix_mono(&mono[..per_ch]);
                }

                if let Some(s) = sink.as_mut() {
                    if let Err(err) = s.write_mono_i16(&mono[..per_ch]) {
                        warn!("[ClientMic] write: {err:#}");
                        sink = None;
                    }
                }
            }
        }
    }

    if let Some(d) = dump {
        d.finish();
    }
}

pub async fn add_recvonly_audio_transceiver(
    peer: &webrtc::peer_connection::RTCPeerConnection,
) -> Result<(), webrtc::Error> {
    // Must pass Recvonly explicitly: webrtc-rs defaults None → Sendrecv and
    // invents a dummy local track, which breaks later video/audio renegotiation.
    let _ = peer
        .add_transceiver_from_kind(
            RTPCodecType::Audio,
            Some(RTCRtpTransceiverInit {
                direction: RTCRtpTransceiverDirection::Recvonly,
                send_encodings: vec![],
            }),
        )
        .await?;
    Ok(())
}

#[cfg(windows)]
mod cpal_sink {
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
    use std::sync::{Arc, Mutex};

    use anyhow::{anyhow, bail, Context, Result};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{SampleFormat, SampleRate, Stream, StreamConfig};

    use super::{
        pcm_dump, preferred_mic_sink, MicSinkKind, STEAM_MIC_RENDER_NEEDLE, TARGET_SAMPLE_RATE,
        VB_CABLE_RENDER_NEEDLES,
    };

    pub struct CpalSink {
        _stream: Stream,
        tx: SyncSender<Vec<f32>>,
        channels: u16,
        /// Shared with the output callback for dump point C (set after stream build).
        pcm_dump: Arc<Mutex<Option<Arc<pcm_dump::Session>>>>,
    }

    impl CpalSink {
        pub fn channels(&self) -> u16 {
            self.channels
        }
        pub fn set_pcm_dump(&self, dump: Arc<pcm_dump::Session>) {
            if let Ok(mut slot) = self.pcm_dump.lock() {
                *slot = Some(dump);
            }
        }

        fn find_steam_render(devices: &[cpal::Device]) -> Option<(cpal::Device, String)> {
            for d in devices {
                if let Ok(n) = d.name() {
                    if n.contains(STEAM_MIC_RENDER_NEEDLE) && !n.contains("Steam Streaming Speakers")
                    {
                        return Some((d.clone(), n));
                    }
                }
            }
            None
        }

        fn find_vb_cable_render(devices: &[cpal::Device]) -> Option<(cpal::Device, String)> {
            for needle in VB_CABLE_RENDER_NEEDLES {
                for d in devices {
                    if let Ok(n) = d.name() {
                        // Prefer exact CABLE Input; skip CABLE Output (capture-only name).
                        if n.contains(needle) && !n.contains("CABLE Output") {
                            return Some((d.clone(), n));
                        }
                    }
                }
            }
            None
        }

        /// Ordered candidates: prefer VB-Cable when sink pref/env says so; always keep the other as fallback.
        fn mic_render_candidates(
            host: &cpal::Host,
        ) -> Result<Vec<(MicSinkKind, cpal::Device, String)>> {
            let devices: Vec<_> = host.output_devices().context("output_devices")?.collect();
            let names: Vec<String> = devices.iter().filter_map(|d| d.name().ok()).collect();
            let prefer = preferred_mic_sink();

            let steam = Self::find_steam_render(&devices);
            let cable = Self::find_vb_cable_render(&devices);
            let mut out = Vec::new();
            match prefer {
                MicSinkKind::VbCable => {
                    if let Some((d, n)) = cable {
                        out.push((MicSinkKind::VbCable, d, n));
                    }
                    if let Some((d, n)) = steam {
                        out.push((MicSinkKind::SteamMic, d, n));
                    }
                }
                MicSinkKind::SteamMic => {
                    if let Some((d, n)) = steam {
                        out.push((MicSinkKind::SteamMic, d, n));
                    }
                    if let Some((d, n)) = cable {
                        out.push((MicSinkKind::VbCable, d, n));
                    }
                }
            }
            if out.is_empty() {
                return Err(anyhow!(
                    "no mic render device (tried Steam Streaming Microphone, then {:?}); outputs={:?}",
                    VB_CABLE_RENDER_NEEDLES,
                    names
                ));
            }
            Ok(out)
        }

        fn try_open_device(device: &cpal::Device, _device_name: &str) -> Result<Self> {
            let supported = device
                .default_output_config()
                .context("default_output_config")?;
            let sample_format = supported.sample_format();
            let default_cfg = supported.config();
            let mut config: StreamConfig = default_cfg;
            // Prefer 48 kHz shared mode to match Opus decode rate / VAC Studio Quality.
            config.sample_rate = SampleRate(TARGET_SAMPLE_RATE);
            let channels = config.channels;

            let (tx, rx): (SyncSender<Vec<f32>>, Receiver<Vec<f32>>) = sync_channel(8);
            let mut pending: Vec<f32> = Vec::new();
            let pcm_dump_slot: Arc<Mutex<Option<Arc<pcm_dump::Session>>>> =
                Arc::new(Mutex::new(None));
            let pcm_dump_cb = Arc::clone(&pcm_dump_slot);

            let err_fn = |err| warn_cpal(err);
            let stream = match sample_format {
                SampleFormat::F32 => device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _| {
                        fill_output(data, &rx, &mut pending, &pcm_dump_cb);
                    },
                    err_fn,
                    None,
                )?,
                SampleFormat::I16 => {
                    let pcm_dump_cb = Arc::clone(&pcm_dump_slot);
                    device.build_output_stream(
                        &config,
                        move |data: &mut [i16], _| {
                            let mut fbuf = vec![0f32; data.len()];
                            fill_output(&mut fbuf, &rx, &mut pending, &pcm_dump_cb);
                            for (o, s) in data.iter_mut().zip(fbuf.iter()) {
                                *o = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            }
                        },
                        err_fn,
                        None,
                    )?
                }
                SampleFormat::U16 => {
                    let pcm_dump_cb = Arc::clone(&pcm_dump_slot);
                    device.build_output_stream(
                        &config,
                        move |data: &mut [u16], _| {
                            let mut fbuf = vec![0f32; data.len()];
                            fill_output(&mut fbuf, &rx, &mut pending, &pcm_dump_cb);
                            for (o, s) in data.iter_mut().zip(fbuf.iter()) {
                                *o = ((s.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16;
                            }
                        },
                        err_fn,
                        None,
                    )?
                }
                other => bail!("unsupported sample format: {other:?}"),
            };

            stream.play().context("stream.play")?;

            Ok(Self {
                _stream: stream,
                tx,
                channels,
                pcm_dump: pcm_dump_slot,
            })
        }

        pub fn open_mic_render() -> Result<Self> {
            let host = cpal::default_host();
            let candidates = Self::mic_render_candidates(&host)?;
            let mut last_err: Option<anyhow::Error> = None;
            for (kind, device, name) in candidates {
                match Self::try_open_device(&device, &name) {
                    Ok(sink) => return Ok(sink),
                    Err(err) => {
                        log::warn!(
                            "[ClientMic] open failed sink={} device='{name}': {err:#}; trying next",
                            kind.as_str()
                        );
                        last_err = Some(err);
                    }
                }
            }
            Err(last_err.unwrap_or_else(|| anyhow!("no mic render device opened")))
        }

        pub fn write_mono_i16(&mut self, mono: &[i16]) -> Result<()> {
            if mono.is_empty() {
                return Ok(());
            }
            let ch = self.channels as usize;
            let mut interleaved = Vec::with_capacity(mono.len() * ch.max(1));
            for &s in mono {
                let f = (s as f32) / (i16::MAX as f32);
                if ch <= 1 {
                    interleaved.push(f);
                } else {
                    interleaved.push(f);
                    interleaved.push(f);
                    for _ in 2..ch {
                        interleaved.push(0.0);
                    }
                }
            }
            match self.tx.try_send(interleaved) {
                Ok(()) => Ok(()),
                Err(TrySendError::Full(_)) => Ok(()), // drop on backpressure
                Err(TrySendError::Disconnected(_)) => Err(anyhow!("audio output disconnected")),
            }
        }
    }

    fn fill_output(
        data: &mut [f32],
        rx: &Receiver<Vec<f32>>,
        pending: &mut Vec<f32>,
        pcm_dump: &Arc<Mutex<Option<Arc<pcm_dump::Session>>>>,
    ) {
        let mut out_i = 0;
        while out_i < data.len() {
            if pending.is_empty() {
                match rx.try_recv() {
                    Ok(chunk) => *pending = chunk,
                    Err(_) => {
                        for s in &mut data[out_i..] {
                            *s = 0.0;
                        }
                        // C — dump what the callback actually outputs (including underrun zeros).
                        if let Ok(guard) = pcm_dump.try_lock() {
                            if let Some(d) = guard.as_ref() {
                                d.push_pre_device_f32(data);
                            }
                        }
                        return;
                    }
                }
            }
            let n = (data.len() - out_i).min(pending.len());
            data[out_i..out_i + n].copy_from_slice(&pending[..n]);
            pending.drain(..n);
            out_i += n;
        }
        // C — f32 buffer about to be played by WASAPI/cpal.
        if let Ok(guard) = pcm_dump.try_lock() {
            if let Some(d) = guard.as_ref() {
                d.push_pre_device_f32(data);
            }
        }
    }

    fn warn_cpal(err: cpal::StreamError) {
        log::warn!("[ClientMic] cpal stream error: {err}");
    }
}
