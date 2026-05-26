# EP-133 Sample Tool Fork Roadmap

Fork: https://github.com/kristapskristaps/ep_133_sample_tool

## Implemented first

### Offline DSP on transfer

The fork adds a browser-side `Offline DSP` panel loaded from `data/dsp.js` and `data/dsp.css`.

Current transfer-time processing:

- Peak normalize dropped audio before upload.
- Apply a gain trim after normalization.
- Generate optional reversed copies next to the original file.
- Generate optional ping-pong copies.
- Conform loops from a source BPM to a target BPM with Web Audio resampling.
- Prefix obvious filenames with kit tags like `kick_`, `snare_`, `cymb_`, `perc_`, `bass_`, `loop_`, and `sfx_`.

The implementation captures file drops before the bundled TE React app handles them, converts audio files into new WAV `File` objects, then replays the drop event. This keeps the minified upstream bundle untouched.

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

- Add a waveform modal for long loops.
- Use transient detection for marker suggestions.
- Export slices as generated WAV `File` objects.
- Drop the slice batch into the existing pad assignment path.

### Snapshot timeline

- Wrap the existing local backup flow.
- Save timestamped backup files under an app-owned snapshots directory.
- Store lightweight metadata for project number, device serial, and changed file hashes.
- Add a diff view for sample and project archive changes.
