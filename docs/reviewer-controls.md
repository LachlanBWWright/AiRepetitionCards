# Reviewer controls

Review settings → Reviewer controls configures elapsed time, auto-advance delays,
keyboard shortcuts and touch swipes. Preferences are private workspace settings,
included in backups and synchronized across devices.

Auto-advance is off until **Start auto-advance** is selected in the reviewer. A zero
question or answer delay disables that step. The question step reveals the answer;
the answer step records the selected automatic rating (Again by default). Choose
that rating deliberately before starting. Stop auto-advance to return to manual
review. Timers pause while saving, when the app is in the background, or while
management controls prevent review. Returning to an active screen resumes the
remaining time rather than counting time spent away.

The elapsed display measures the current side. Starting or stopping auto-advance
restarts its countdown. Timed ratings use the same save workflow as manual ratings;
failed saves keep the normal retry barrier and cannot advance to another card.

Web/Electron shortcuts accept five distinct letters, numbers, or a space. Enter
also reveals the answer. Defaults retain Space/Enter to reveal and 1–4 to rate.
Shortcuts are ignored in inputs, interactive controls, dialogs and during saves.
The native app uses touch controls; external-keyboard adapter support remains a
platform limitation even though the shared preferences travel with the workspace.

Swipes are opt-in and work on the card text. Left/right actions can reveal or rate;
a hidden answer is never rated. A gesture must travel at least 80 logical pixels
and be predominantly horizontal, so ordinary scrolling is preserved. Gestures do
not replace visible rating buttons or accessible controls.

Queue settings separately control burying new, review, and learning/relearning
siblings until the next study day. Each category inherits the previous overall
bury setting until explicitly changed. Repetitions of a card already reviewed
today remain available. Presets can override these scheduling choices; reviewer
interaction preferences remain workspace-wide.
