# Speed Test Progress Indicator — Design

**Date:** 2026-06-20
**Status:** Approved

## Problem

Users running the speed test cannot tell whether it is still running or has
finished. The only feedback today is a small grey pulsing phase line
(`SpeedTest.tsx:177`, e.g. "Measuring download speed…") and the fact that the
charts are still animating. There is no progress bar, no percentage, and no
distinct "test complete" moment — when results stop updating, nothing signals
that the test is done.

## Goal

Give the test a clear, always-visible progress state: users should know at a
glance that it is running, roughly how far along it is, and unambiguously when
it has finished.

## Non-goals (YAGNI)

- No estimated time-remaining countdown (unreliable on variable connections).
- No changes to charts, box plots, latency/bandwidth display, or result
  submission flow.
- No change to the measurement profile or endpoints — measurement accuracy is
  locked in (see project accuracy decision) and must not be touched.

## Design

### Placement
A full-width progress strip directly under the "Your Internet Speed" `<h2>`,
replacing the current small phase line at `SpeedTest.tsx:177`. It is the first
element in the results section so the running/done state is impossible to miss.
The charts below continue to animate as they do today.

### Visual states
- **Running:** phase label on the left ("Measuring download speed…"),
  percentage on the right, animated determinate bar in `cf-orange`.
- **Paused:** bar holds its position, label reads "Paused", muted color.
- **Done:** bar at 100% in green, label becomes "✓ Test complete · {duration}s"
  using the engine's real `getTotalDurationMs()`.

### Progress computation (phase-anchored)
Progress is anchored to the measurement phase, not a guessed timer, so the bar
cannot run ahead of reality or stall:

1. Add `onPhaseChange` handling to `useSpeedTest` (the engine already emits
   `PhaseChangePayload { measurementId, measurement }`). Use it together with
   the existing `currentPhase` (`type` from `onResultsChange`) to know the
   active phase: latency → download → upload → loaded-latency / finalizing.
2. Each phase maps to a progress band:
   - latency: 0–15%
   - download: 15–60%
   - upload: 60–95%
   - finalizing: 95–99%
3. Within a phase, interpolate smoothly using the count of data points already
   received (`downloadPoints` / `uploadPoints` length) so the bar moves forward
   monotonically.
4. `onFinish` snaps progress to 100% and flips to the "done" state. This is the
   guaranteed-accurate completion signal, independent of the interpolated
   estimate.

This approach is keyed on phase *type* (already available), so it is
independent of the engine's private measurement-profile length and does not
override `measurements`.

### Hook changes (`useSpeedTest.ts`)
Add to `SpeedTestState`:
- `progress: number` — 0–1, derived from phase + point counts.
- `durationMs: number | null` — from `getTotalDurationMs()` on finish.

The existing `currentPhase` remains. All progress logic lives in the hook; the
component only renders the values.

### Component changes (`SpeedTest.tsx`)
- Replace the phase line (`:177`) with a `<ProgressBar>` sub-component reading
  `progress`, `phaseLabel`, `status`, and `durationMs`.
- Retest reuses the same bar through the existing `restart()` flow.

## Testing

- Manual: run a full test in the browser; verify the bar advances monotonically
  through latency/download/upload and lands on the "✓ Test complete" state.
- Verify Pause/Resume holds and resumes the bar.
- Verify Retest resets the bar to 0 and runs again.
- Confirm measured download/upload/latency values are unchanged (accuracy
  guard).
