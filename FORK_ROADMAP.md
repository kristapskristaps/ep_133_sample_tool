# EP-133 Sample Tool Fork Roadmap

Fork: https://github.com/kristapskristaps/ep_133_sample_tool

## Implemented first

### Offline DSP on transfer

The fork adds a browser-side `Offline DSP` panel loaded from `data/dsp.js` and `data/dsp.css`.

Current transfer-time processing:

- Peak normalize dropped audio before upload.
- Set the normalize target in dBFS.
- Trim leading and trailing silence with an adjustable threshold.
- Add fade-in and fade-out ramps.
- Mix stereo/multichannel files down to mono.
- Resample output to a target sample rate, defaulting to the EP device rate.
- Apply simple low-cut and high-cut filters.
- Apply a gain trim after normalization.
- Generate optional reversed copies next to the original file.
- Generate optional ping-pong copies.
- Conform loops from a source BPM to a target BPM with Web Audio resampling.
- Prefix obvious filenames with kit tags like `kick_`, `snare_`, `cymb_`, `perc_`, `bass_`, `loop_`, and `sfx_`.

The implementation captures file drops before the bundled TE React app handles them, converts audio files into new WAV `File` objects, then replays the drop event. This keeps most of the upstream bundle untouched; a small bridge is patched into the bundle for kit/device integration.

Still missing for a full DSP workstation:

- Rubber Band or similar high-quality time-stretch that preserves pitch.
- Dedicated pitch-shift in semitones/cents.
- Multi-band EQ and dynamics instead of the current simple filters and gain stage.
- Waveform preview with before/after audition.
- Batch presets and per-folder processing profiles.

### Kit inspector and quick kit upload

The fork adds a `Kit Inspector` panel loaded from `data/kit-inspector.js` and `data/kit-inspector.css`.

Current kit workflow:

- See the active project, active group, and all 12 pads in that group.
- See which sound id/path is assigned to each pad.
- Resolve assigned sound names from the device when available.
- Switch projects 01-09 and groups A-D.
- Drop one sample on a pad to upload and assign it.
- Drop a folder or batch of up to 12 audio files on the kit drop zone to auto-sort and assign pads.
- Play, download as WAV, or clear an assigned pad.

The inspector uses a small bridge inserted into the bundled app so it can call the app's existing uploader and device service instead of reimplementing Sysex operations.

### Sampler mode

The fork adds a `Sample` drawer loaded from `data/sampler.js` and `data/sampler.css`.

Current sampler workflow:

- Capture shared system/tab audio when the browser/Electron runtime exposes it through screen sharing.
- Capture microphone audio as a fallback.
- Load an existing local audio file for slicing.
- Draw a waveform preview in the browser.
- Add manual chop markers by clicking the waveform.
- Generate equal 4, 8, or 12-way chops.
- Suggest transient chops with simple amplitude-onset detection.
- Render chops as WAV files.
- Assign rendered chops directly to active pads starting from a chosen pad.

System audio capture depends on the Chromium/WebRTC picker and host OS permissions. On some systems the user must choose a tab/window/screen with audio sharing enabled; on others only microphone capture may be available.

## Next feature slices

### High-quality pitch and time processing

The current BPM conforming is Web Audio resampling, so it changes pitch. For production-quality time-stretching, add a local processing service:

- FastAPI endpoint for dropped audio files.
- `rubberband` CLI or library integration for time-stretch and pitch-shift.
- `ffmpeg` fallback for format conversion.
- Renderer integration through the same `data/dsp.js` drop interception layer.

### Kit builder

- Add an editable pad assignment preview before upload.
- Add per-pad choke and MIDI-related metadata controls once the relevant device metadata is confirmed.
- Add save/load kit templates.

### Sample chopping

- Improve marker editing with draggable markers and per-slice audition.
- Add zoom and trim handles.
- Add beat-grid chopping from BPM.
- Add per-slice naming before upload.

### Snapshot timeline

- Wrap the existing local backup flow.
- Save timestamped backup files under an app-owned snapshots directory.
- Store lightweight metadata for project number, device serial, and changed file hashes.
- Add a diff view for sample and project archive changes.
