const trustedOrigin = value => value === 'app://macremote' || value === 'app://macremote/';
function createDisplayCaptureHandler(getState, getSources) {
  return async (request, callback) => {
    try {
      const state = getState();
      if (!state.sessionId || !state.sourceId || request.frame !== state.frame || !trustedOrigin(request.securityOrigin) || !request.videoRequested || request.audioRequested) return callback({});
      const sources = await getSources();
      // Revocation, reload or display changes while enumeration is pending must fail closed.
      const current = getState();
      if (current.sessionId !== state.sessionId || current.sourceId !== state.sourceId || current.frame !== state.frame) return callback({});
      const source = sources.find(source => source.id === state.sourceId);
      callback(source ? { video: source } : {});
    } catch { callback({}); }
  };
}
module.exports = { createDisplayCaptureHandler };
