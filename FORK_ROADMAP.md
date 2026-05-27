# EP-133 Sample Tool Fork Roadmap

Fork: https://github.com/kristapskristaps/ep_133_sample_tool

## Implemented first

### Modern React shell

The fork now includes a modern React/Vite/Tailwind workspace in `modern/`.

The modern shell is the new primary UI direction:

- A utilitarian app frame with persistent left navigation.
- Two main workspaces: a pad-centric Project view and a device-wide Library view.
- Integrated dark mode with persisted theme preference.
- Shared visual tokens for buttons, panels, pads, tabs, and status surfaces.
- A production build path through `npm run modern:build`.
- Electron loads `modern/dist/index.html` when it exists, falling back to the original app if the modern build has not been generated.

The hardware runtime is currently bridged through the original TE bundle mounted into a hidden same-window root. This keeps connection, transfer, and backup behavior available while the minified TE device service is gradually extracted into typed modules. The original app is no longer presented as a user-facing tab or panel in the modern UI.

The modern UI now talks to typed `device` and `dsp` modules instead of reaching into `window.ep133KitBridge` directly. The current `device/legacy-engine` hook owns React polling/autoconnect state, while `device/legacy-adapter` owns every legacy bridge operation. That adapter is now the replaceable boundary for native device-service extraction.

Native device work has started behind that boundary:

- `device/native-midi` requests Web MIDI/Sysex permission, sends the standard MIDI identity request, parses TE manufacturer identity responses, and pairs EP input/output ports.
- `device/native-sysex` implements TE Sysex 7-bit packing/unpacking, request message construction, response parsing, and a request/response client.
- `device/native-file-protocol` and `device/native-file-service` implement native TE file commands for initialization, paged listing, info, chunked get/put, metadata get/set including paged metadata, deletion, and playback.
- `device/native-tree` and `device/native-device-service` implement native path/node caching plus project, group, pad, sound listing, metadata, pad assignment, playback, delete, and raw file download helpers.
- The public `@/device` facade now exports the native-only engine. It does not fall back to the hidden legacy runtime; unsupported native actions report as unsupported instead of silently using legacy code.
- Native audio upload now decodes browser-supported audio, renders 46.875 kHz 16-bit PCM, writes sound metadata, uploads to library slots, and assigns uploaded sounds to target pads. Native downloads wrap device PCM back into WAV files.

Current workspace flow:

- Select the active project and group.
- Click a pad to inspect and act on it.
- Upload audio directly to the selected pad or drop audio onto the pad.
- Open a sampling/chopping modal from the selected pad.
- Apply transfer DSP from the same workspace through `Sample Settings`.
- Import, export, and inspect the active kit from the main view.
- Switch to the Library view to manage device memory and samples by 100-slot ranges.
- Search all loaded samples while preserving the original 0-99, 100-199, 200-299 style grouping and bank filters.
- See whether a sample is used by projects such as project 5, 7, or 9 when project pad metadata is available from the connected device.

### Legacy feature sidebar

The earlier fork work added a right-side `EP Tools` sidebar loaded from `data/feature-sidebar.js` and `data/feature-sidebar.css`.

The sidebar owns the visual shell and tab navigation for the added tools:

- `DSP`
- `Sample`
- `Kit`

Feature modules register their content into this sidebar instead of creating separate floating panels or bottom drawers.

### Offline DSP on transfer

The fork adds browser-side DSP controls that are now surfaced in the modern workspace as `Sample Settings`.

Current transfer-time processing:

- Enable or bypass transfer-time DSP from the modern Project view.
- Peak normalize dropped audio before upload.
- Set the normalize target in dBFS.
- Trim leading and trailing silence with an adjustable threshold.
- Add fade-in and fade-out ramps.
- Mix stereo/multichannel files down to mono.
- Resample output to a target sample rate, defaulting to the EP device rate.
- Apply simple low-cut and high-cut filters with editable cutoff frequencies.
- Apply a gain trim after normalization.
- Generate optional reversed copies next to the original file.
- Generate optional ping-pong copies.
- Conform loops from a source BPM to a target BPM with Web Audio resampling.
- Prefix obvious filenames with kit tags like `kick_`, `snare_`, `cymb_`, `perc_`, `bass_`, `loop_`, and `sfx_`.

The implementation captures file drops before the bundled TE React app handles them, converts audio files into new WAV `File` objects, then replays the drop event. Modern Library uploads and Project pad/kit uploads also call the same DSP processor directly through the bridge. This keeps most of the upstream bundle untouched; a small bridge is patched into the bundle for kit/device integration.

Still missing for a full DSP workstation:

- Rubber Band or similar high-quality time-stretch that preserves pitch.
- Dedicated pitch-shift in semitones/cents.
- Multi-band EQ and dynamics instead of the current simple filters and gain stage.
- Waveform preview with before/after audition.
- Batch presets and per-folder processing profiles.

### Kit inspector and quick kit upload

The fork adds a kit inspector that is now represented by the main modern workspace.

Current kit workflow:

- See the active project, active group, and all 12 pads in that group.
- See which sound id/path is assigned to each pad.
- Resolve assigned sound names from the device when available.
- Switch projects 01-09 and groups A-D.
- Drop one sample on a pad to upload and assign it.
- Drop a folder or batch of up to 12 audio files on the kit drop zone to auto-sort and assign pads.
- Play, download as WAV, or clear an assigned pad.
- Browse loaded samples in the Library view, see memory usage, search across all sample banks, preview, download WAVs, and delete samples.
- Keep the original 100-sample bank separation and selectable bank filters while still filtering search results across every bank.
- Show project usage labels for sounds referenced by project pad assignments.
- Export the active group as a kit archive ZIP containing assigned pad WAV files and a `kit.json` manifest.
- Import a kit archive ZIP exported by this fork and restore its samples to the matching active-group pads.

The inspector uses a small bridge inserted into the bundled app so it can call the app's existing uploader and device service instead of reimplementing Sysex operations.

### Sampler mode

The fork adds sampler mode, now opened as a selected-pad modal from the workspace.

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

- Done: isolate the hidden compatibility runtime behind typed modern `device` and `dsp` modules.
- Done: move legacy bridge operations behind a `device/legacy-adapter` service boundary.
- Done: add native Web MIDI discovery and TE Sysex request/response primitives.
- Done: add native TE file protocol primitives and chunked get/put file service.
- Done: add native path cache and high-level native device helpers for non-audio-conversion operations.
- Done: switch the app facade to the native-only engine without legacy fallback.
- Done: add native audio upload for library and pad assignment plus native WAV download wrapping.
- Extract the original device connection, sample transfer, and project backup calls from the bundled runtime into a typed service API.
- Replace the hidden compatibility engine with native React device-service modules.
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
