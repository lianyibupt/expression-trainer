(function (root) {
  function describeMeetingExitState(session, trainer) {
    if (trainer.isStartingRecording || trainer.isRecording || trainer.isStoppingRecording) {
      return { id: session.id, title: session.title, pending: true, reason: 'recording', artifacts: [] };
    }
    if (trainer.awaitingFinalTranscript) {
      return { id: session.id, title: session.title, pending: true, reason: 'finalizing', artifacts: [] };
    }
    if (trainer.savePromise) {
      return { id: session.id, title: session.title, pending: true, reason: 'saving', artifacts: [] };
    }
    if (trainer.reportPromise || trainer.minutesPromise) {
      return { id: session.id, title: session.title, pending: true, reason: 'generating', artifacts: [] };
    }

    const artifacts = [];
    const hasTranscriptMaterial = Boolean(
      String(trainer.fullText || '').trim() ||
      trainer.pendingAudioPath ||
      trainer.speakerSegments?.length
    );
    const transcriptSaved = trainer.savedSnapshot &&
      trainer.savedSnapshot.title === session.title &&
      trainer.savedSnapshot.transcriptRevision === trainer.transcriptRevision &&
      trainer.savedSnapshot.transcriptSource === trainer.transcriptSource;
    if (hasTranscriptMaterial && !transcriptSaved) artifacts.push('transcript');
    if (trainer.lastMinutes && trainer.savedArtifacts?.minutes !== trainer.lastMinutes) artifacts.push('minutes');
    if (trainer.lastReport && trainer.savedArtifacts?.report !== trainer.lastReport) artifacts.push('report');

    return {
      id: session.id,
      title: session.title,
      pending: artifacts.length > 0,
      reason: artifacts.length ? 'unsaved' : 'clean',
      artifacts
    };
  }

  function collectPendingMeetings(sessions) {
    return sessions
      .map(session => describeMeetingExitState(session, session.trainer))
      .filter(item => item.pending);
  }

  const exports = { describeMeetingExitState, collectPendingMeetings };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else Object.assign(root, exports);
})(globalThis);
