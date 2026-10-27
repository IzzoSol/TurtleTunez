// StudioRecorder — captures the master mix (chords + drums + agents)
// to a downloadable file using MediaRecorder.

export class StudioRecorder {
  constructor(ctx, sources) {
    this.ctx = ctx;
    this.dest = ctx.createMediaStreamDestination();
    (sources || []).forEach((node) => node.connect(this.dest));
    this.recorder = null;
    this.chunks = [];
    this._url = null;
    this._mime = this._pickMime();
  }

  _pickMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) {
        return mime;
      }
    }
    return '';
  }

  get supported() {
    return typeof MediaRecorder !== 'undefined';
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  start() {
    if (!this.supported || this.recording) return false;
    this.chunks = [];
    const options = this._mime ? { mimeType: this._mime } : undefined;
    try {
      this.recorder = new MediaRecorder(this.dest.stream, options);
    } catch {
      return false;
    }
    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    this.recorder.start(500);
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        const type = this._mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        resolve({ blob, type });
      };
      this.recorder.stop();
    });
  }

  // Returns a download URL (and revokes the previous one).
  toDownloadUrl(blob) {
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = URL.createObjectURL(blob);
    return this._url;
  }

  dispose() {
    if (this.recording) this.recorder.stop();
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = null;
  }
}
