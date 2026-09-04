# Meeting tabs and save ownership

## Approved behavior

Keep the six existing workflow stages. Add a horizontal meeting tab strip with
New meeting, editable meeting names, status, close controls, and Recent meetings.
Each meeting owns a separate workbench instance and scoped DOM. Switching the
visible workbench must not redirect recording, analysis, or saving.

Closing a tab hides it, never deletes its content or cancels its jobs. Recent
meetings can reopen it during the current app run. Refuse to close a meeting
while its microphone capture is starting, recording, or stopping. Other tabs
remain closable during background processing. Closing the last tab leaves a
fresh draft. Saved files remain durable; unsaved closed tabs are only retained
until app exit, and the UI must state this limitation.

## Identity and concurrency

Assign a UUID before initializing a recording. Only one microphone capture is
active, independently of the selected tab. Each final transcription callback
includes the original session ID. Filter progress and cancellation by job ID.
Finished recordings can continue processing while a new recording starts.
Native audio samples go only to the capture/monitor owner, never every tab.

The recording owner remains visibly identified on every tab, with Return to
recording and Stop controls. Starting another recording from a completed meeting
creates a new meeting instead of clearing the old one.

## Saving

Capture meeting identity, title, recording start/end, text version, stats, audio
path, and speaker segments before the first asynchronous save step. Bind both
the original and any subsequent report to that snapshot, even after tab switch
or close. Deduplicate pending saves per meeting. Include identity and start time
in export headers and default filenames. Reuse the meeting's own artifact folder
for subsequent explicit saves and validate metadata ownership before writing.

Do not silently overwrite manually edited text with a late ASR final result.
Retain the final result and offer an explicit adoption action. Saving a live
transcript snapshot must be labeled as such; late finalization must not silently
rewrite an exported file.

## Verification

Use deferred promises to exercise A/B final results and saves finishing in
reverse order, closing and reopening processing tabs, edited transcript handling,
and cancelling one job without cancelling another. Test recording ownership and
session ID propagation through IPC, not only source-code regexes. Validate the
rendered tab strip, close controls, scoped stage navigation, and keyboard access.
