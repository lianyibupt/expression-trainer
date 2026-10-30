class AppExitGate {
  constructor(notifyRenderer) {
    this.notifyRenderer = notifyRenderer;
    this.state = 'idle';
  }

  request() {
    if (this.state === 'approved') return true;
    if (this.state === 'idle') {
      this.state = 'awaiting-renderer';
      this.notifyRenderer();
    }
    return false;
  }

  approve() {
    this.state = 'approved';
  }

  rendererReady() {
    if (this.state === 'awaiting-renderer') this.notifyRenderer();
  }

  cancel() {
    if (this.state !== 'approved') this.state = 'idle';
  }
}

module.exports = { AppExitGate };
