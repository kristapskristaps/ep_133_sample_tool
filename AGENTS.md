# Agent Context

This fork is a modern EP-133/EP-1320/EP-40 sample tool. The legacy bundled `data/` UI has been removed; the Electron app loads the React/Vite/Tailwind app from `modern/`.

Use `FORK_ROADMAP.md` for the detailed current feature map. Keep this file short and operational.

## Main Code Paths

- `modern/src/app.tsx`: primary React UI, including Project view, Library view, sampler/chopper modal, KO pad labeling, and local waveform drawing.
- `modern/src/device/native-engine.tsx`: React-facing native device engine and upload/download actions.
- `modern/src/device/native-device-service.ts`: EP filesystem/service operations such as active project/group, pad metadata, sound upload, assignment, archive import/export.
- `modern/src/device/native-file-*` and `modern/src/device/native-sysex.ts`: low-level TE file protocol and SysEx transport.
- `modern/src/dsp/settings.ts` and `modern/src/device/native-audio.ts`: transfer DSP settings and browser audio processing before upload.

## Commands

- Dev server: `npm run modern:dev`
- Production build/check: `npm run modern:build`
- Electron build/runtime still expects `modern/dist`; build before packaging/running Electron.

## Product Rules

- The pad UI must match the physical K.O. face:

```text
7 8 9
4 5 6
1 2 3
. 0 ENTER
```

- EP internal pad nodes are still `01`-`12`, mapped top-left to bottom-right:
  - `01 02 03` -> `7 8 9`
  - `04 05 06` -> `4 5 6`
  - `07 08 09` -> `1 2 3`
  - `10 11 12` -> `. 0 ENTER`
- Sampler chop assignment sequence starts from the physical selected pad and proceeds `. 0 ENTER 1 2 3 4 5 6 7 8 9`.
- Verified pad assignment metadata is only `{ sym: soundId }`. Do not guess pad-level sample start/end metadata keys.
- Current safe sampler assignment renders each chop as a separate WAV/sample and assigns those to pads.
- System/tab audio capture cannot be permanently remembered by the browser. The sampler reuses a live system capture stream only while the sampler stays open.

## Sampler Notes

- Recording is armed first and starts storing PCM only after signal is detected in the audio processing callback. Do not move this gate back to `requestAnimationFrame`; hidden tabs throttle it.
- Keyboard chop behavior:
  - `1` sets/plays the first chop at trim start.
  - Existing chop keys play existing slices.
  - Higher unused keys add later chop starts during playback.
  - Delete/Backspace removes the selected marker.
  - `R` reverses the selected/playing chop.
- Reversed chops should draw reversed waveform peaks and export reversed audio.
- Low-cut/high-cut/lo-fi preview should be audible in sampler playback when processing is enabled.

## Working Rules

- Prefer scoped changes; `modern/src/app.tsx` is large, so avoid unrelated refactors.
- Run `npm run modern:build` before finishing UI/device changes.
- Preserve user/device data safety. Avoid destructive git commands and do not clear device assignments unless explicitly requested.
- For unknown EP metadata/protocol behavior, inspect real device metadata or add explicit debug tooling before implementing assumptions.
