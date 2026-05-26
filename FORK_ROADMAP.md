# EP-133 Sample Tool Fork Roadmap

Fork: https://github.com/kristapskristaps/ep_133_sample_tool

## Implemented first

### Modern React shell

The fork now includes a modern React/Vite/Tailwind workspace in `modern/`.

The modern shell is the new primary UI direction:

- A utilitarian app frame with persistent left navigation.
- First-class tabs for `Kit`, `Sample`, `DSP`, `Archive`, and `Device`.
- Integrated dark mode with persisted theme preference.
- Shared visual tokens for buttons, panels, pads, tabs, and status surfaces.
- A production build path through `npm run modern:build`.
- Electron loads `modern/dist/index.html` when it exists, falling back to the original app if the modern build has not been generated.

The hardware runtime is currently bridged through the original bundled app in the `Device` tab. In development, Vite serves the original `data/` app under `/legacy`; in packaged Electron builds, the iframe points back to `data/index.html`. This keeps connection, transfer, and backup behavior available while the minified TE device service is gradually extracted into typed modules.

### Feature sidebar

The fork adds a single right-side `EP Tools` sidebar loaded from `data/feature-sidebar.js` and `data/feature-sidebar.css`.

The sidebar owns the visual shell and tab navigation for the added tools:

- `DSP`
- `Sample`
- `Kit`

Feature modules register their content into this sidebar instead of creating separate floating panels or bottom drawers.

### Offline DSP on transfer

The fork adds browser-side DSP controls in the `DSP` sidebar tab.

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

The fork adds a kit inspector in the `Kit` sidebar tab.

Current kit workflow:

- See the active project, active group, and all 12 pads in that group.
- See which sound id/path is assigned to each pad.
- Resolve assigned sound names from the device when available.
- Switch projects 01-09 and groups A-D.
- Drop one sample on a pad to upload and assign it.
- Drop a folder or batch of up to 12 audio files on the kit drop zone to auto-sort and assign pads.
- Play, download as WAV, or clear an assigned pad.
- Export the active group as a kit archive ZIP containing assigned pad WAV files and a `kit.json` manifest.
- Import a kit archive ZIP exported by this fork and restore its samples to the matching active-group pads.

The inspector uses a small bridge inserted into the bundled app so it can call the app's existing uploader and device service instead of reimplementing Sysex operations.

### Sampler mode

The fork adds sampler mode in the `Sample` sidebar tab.

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

### Device service extraction

- Extract the original device connection, sample transfer, and project backup calls from the bundled runtime into a typed service API.
- Replace the `Device` iframe bridge with native React controls.
- Move kit upload, archive import/export, and sampler pad assignment onto the typed service.
- Keep the legacy app as an optional troubleshooting fallback until the native service is feature complete.

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
