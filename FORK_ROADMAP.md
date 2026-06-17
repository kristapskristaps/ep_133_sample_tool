# EP-133 Sample Tool Fork Roadmap

Fork: https://github.com/kristapskristaps/ep_133_sample_tool

Last refreshed: 2026-06-14

## Current State

This fork has moved away from the original bundled UI. The app is now a modern React/Vite/Tailwind interface in `modern/`, loaded by Electron through `modern/dist`.

The old `data/` legacy app bundle and the modern legacy bridge files were removed. The public `@/device` facade exports the native engine only. There is no hidden legacy runtime and no silent fallback to the original app.

If `modern/dist/index.html` is missing, Electron now fails clearly and asks for `npm run modern:build` instead of falling back to legacy UI.

## Implemented

### Modern App Shell

- React/Vite/Tailwind app in `modern/`.
- Two primary views: `Project` and `Library`.
- Centered Project/Library pill tabs in the header.
- Dark mode with persisted theme preference.
- Header memory display.
- Connect button with red/yellow/green status dot.
- Auto-connect attempt on app load.
- Full-screen connection gate overlay when no EP device is connected.
- Blurred/disabled workspace behind the connection overlay.

### Native Device Engine

- Web MIDI/SysEx permission request.
- TE MIDI identity request parsing.
- EP input/output MIDI port pairing.
- Native TE SysEx request/response client with 7-bit pack/unpack helpers.
- Native TE file protocol support for:
  - init
  - file listing
  - file info
  - metadata get/set, including paged metadata
  - chunked file get/put
  - delete
  - playback
- Native path/tree cache for device nodes.
- Native service helpers for:
  - active project
  - active group
  - active pads
  - pad assignment
  - pad clearing
  - project pad metadata scanning
  - sound listing
  - playback
  - delete
  - raw download
  - WAV download wrapping
- Model/storage inference:
  - EP-133 defaults to 64 MB.
  - EP-40 and EP-1320 use 128 MB.
  - Devices already using more than 64 MB are displayed as 128 MB capacity.

### Project View

- Select project `01-09`.
- Select group `A-D`.
- View 12 pads for the active group.
- Select a pad and inspect its current assignment.
- Drop audio on a pad to upload and assign it.
- Upload audio to the selected pad.
- Play assigned pad sample.
- Download assigned pad sample as WAV.
- Clear pad assignment.
- Open sampler/chopper modal for the selected pad.
- Inspect active kit assignment count.

### Library View

- Renders all 999 addressable sound slots.
- Keeps the original 100-slot bank separation: `0-99`, `100-199`, etc.
- Search works across slot id, sample name, path, and project usage.
- Upload to next free library slot.
- Drag/drop onto an empty slot to upload there.
- Drag/drop onto an occupied slot asks for replacement confirmation.
- Sample names prefer device metadata instead of raw `.pcm` filenames.
- Hover/focus actions on occupied slots:
  - play
  - download WAV
  - delete
- Shows whether samples are referenced by projects when project pad metadata is available.
- Click a filled slot to load an on-demand waveform preview in the Library detail panel.
- Waveform previews are cached in memory for the current session.

### Native Kit Archives

- Export the active project/group as a ZIP archive.
- Archive contains a `kit.json` manifest plus one WAV per assigned pad.
- Import ZIP archives created by this fork.
- Import uploads archived WAVs to the active target and restores pad assignments by pad number.
- ZIP handling is dependency-free and currently writes/reads stored, uncompressed ZIP entries.

Limitations:

- Import is designed for archives exported by this fork.
- Deflated/compressed third-party ZIP archives are not supported yet.

### Local Snapshots

- Save a local snapshot for the active target.
- Snapshot captures active target, current pad assignments, and current library sample ids/names.
- Compare against the previous snapshot for the same target.
- Report changed pad count plus added/removed sample counts.
- Store the latest 50 snapshots in browser local storage.

Limitations:

- This is not a full TE project backup.
- Pattern/sequence data is not included yet.
- There is no timeline browser or rollback UI yet.

### Transfer DSP

DSP settings are surfaced as `Sample Settings` in the Project view and are applied before native upload.

Implemented processing:

- Enable/bypass DSP.
- Peak normalize.
- Target dBFS.
- Trim leading/trailing silence.
- Fade in/out.
- Mono mixdown.
- Output sample rate.
- Gain trim.
- Low-cut filter.
- High-cut filter.
- Reverse copy.
- Ping-pong copy.
- Source BPM to target BPM conforming through browser resampling.
- Filename auto-tagging.
- Lo-Fi mode with configurable sample rate and bit depth.

Limitations:

- BPM conforming currently changes pitch because it uses browser resampling.
- No Rubber Band/high-quality pitch-preserving time-stretch yet.
- No dedicated semitone/cents pitch shift yet.
- No multiband EQ or dynamics yet.
- No before/after waveform audition yet.

### Sampler Mode

Sampler mode opens as a modal from the selected pad.

Implemented:

- Capture shared system/tab audio when Chromium and OS permissions allow it.
- Capture microphone audio.
- Arm recording and start capture only after input audio crosses the signal gate.
- Record sampler captures as in-memory PCM through Web Audio instead of browser-encoded `MediaRecorder` blobs.
- Load a local audio file.
- Clear the loaded/recorded sample from the sampler workspace.
- Draw a waveform for the loaded/recorded audio.
- Draw live recording input level while armed or recording.
- Add manual chop markers by clicking the waveform.
- Select and drag chop markers directly on the waveform.
- Move selected chop markers with left/right arrow keys.
- Remove chop markers from the marker hover `x` or Delete/Backspace for the selected chop, with automatic renumbering.
- Generate 4, 8, or 12 equal chops.
- Autochop scores onsets across the trimmed sample, keeps the strongest spaced peaks, and shows selectable threshold plus predicted chop count.
- Keyboard chop workflow treats `1` as the sample start and `2`-`´` as later chop starts that can be added or overwritten during playback.
- Keyboard slice playback uses `1 2 3 4 5 6 7 8 9 0 ß ´` for up to 12 slices.
- Chop count is capped by the number of pads available from the selected target pad through pad 12.
- Audition individual slices before assignment.
- Sampler waveform shows slice regions, marker handles, selected markers, active slices, and playback position.
- Sampler waveform supports zoom, pan, and trim in/out handles.
- Rendered chops can be named per slice before assignment.
- Sampler modal includes compact transfer DSP controls for normalize, trim, mono, low cut, high cut, lo-fi rate/bit depth, gain, and target dB.
- Render chops as WAV files.
- Assign rendered chops to pads starting from the selected pad.

Limitations:

- System audio capture depends on the OS and Chromium picker.
- No beat-grid chopping yet.

## Not Complete Yet

### Full Project Backup / Pattern Diff

Not implemented.

Needed:

- Full project backup pull.
- Timestamped backup storage outside browser local storage.
- Device/project metadata index.
- Hash comparison between snapshots.
- Diff view for patterns, sequences, and full project metadata.
- Rollback/restore UI.

### Advanced Audio Processing

Not implemented.

Needed:

- Rubber Band or equivalent for pitch-preserving time-stretch.
- Pitch shift in semitones/cents.
- Better filters/EQ.
- Dynamics/limiting.
- Batch presets.

### Hardware Regression Pass

Still needed on real devices:

- EP-133 64 MB.
- EP-133 128 MB variant, if available.
- EP-40.
- EP-1320, if available.

Test paths:

- Autoconnect and MIDI/SysEx permission.
- Project/group switching.
- Pad upload and assignment.
- Library slot upload.
- Occupied-slot replace confirmation.
- Playback.
- WAV download.
- Delete sample.
- Pad clear.
- DSP upload variants.
- Sampler capture and chop assignment.

## How To Run

Browser dev server:

```bash
npm run modern:dev
```

Open the shown Vite URL, usually:

```text
http://localhost:5173
```

Electron against the dev server:

```bash
npm run modern:electron
```

Production-style Electron run:

```bash
npm run modern:build
npm start
```

## Immediate Next Slices

1. Add deflated ZIP import support or switch to a vetted ZIP library.
2. Add full Project backup, timeline browsing, and rollback.
3. Add high-quality pitch-preserving time-stretch/pitch-shift.
4. Add beat-grid chopping and tighter sampler hardware regression notes.
5. Add hardware regression checklist results to this file.
