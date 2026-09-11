/**
 * FrameSource Abstraction Module for SentryWing Target Tracking.
 * 
 * Provides a unified "get next frame" interface so the tracking, locking,
 * overlay, and feed publishing logic remains completely decoupled from the
 * physical video sensor (Browser Phone Camera vs. ESP32-CAM MJPEG Stream vs. Video File).
 */

/**
 * Base abstract class defining the FrameSource contract.
 */
export class FrameSource {
  constructor() {
    if (new.target === FrameSource) {
      throw new TypeError('Cannot construct FrameSource instances directly (abstract class).');
    }
  }

  /**
   * Initializes the video stream/media source.
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async init(options = {}) {
    throw new Error('init() must be implemented by concrete subclass.');
  }

  /**
   * Core extraction method: returns the next frame ready for transmission/inference.
   * @param {HTMLCanvasElement} [targetCanvas] - Optional canvas to draw onto.
   * @returns {Promise<{ blob: Blob, width: number, height: number, sourceElement: HTMLElement, timestamp: number } | null>}
   */
  async getNextFrame(targetCanvas = null) {
    throw new Error('getNextFrame() must be implemented by concrete subclass.');
  }

  /**
   * Returns the underlying renderable HTML media element (video or img) for UI display.
   * @returns {HTMLElement|null}
   */
  getMediaElement() {
    throw new Error('getMediaElement() must be implemented by concrete subclass.');
  }

  /**
   * Returns current source video dimensions.
   * @returns {{ width: number, height: number }}
   */
  getDimensions() {
    return { width: 640, height: 480 };
  }

  /**
   * Whether the stream is currently active and delivering frames.
   * @returns {boolean}
   */
  isActive() {
    return false;
  }

  /**
   * Source-specific hardware or stream capabilities (e.g., torch, facingMode, remoteUrl).
   * @returns {Object}
   */
  getCapabilities() {
    return {};
  }

  /**
   * Releases hardware sensors, stops tracks, or cancels network streams.
   */
  destroy() {
    // Override in subclass
  }
}


/**
 * Browser Camera Source (navigator.mediaDevices.getUserMedia).
 * Mobile phone rear/front camera implementation.
 */
export class UserMediaFrameSource extends FrameSource {
  constructor() {
    super();
    this.videoElement = document.createElement('video');
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.setAttribute('autoplay', 'true');
    this.videoElement.muted = true;
    this.stream = null;
    this.facingMode = 'environment';
    this.torchOn = false;
    this.torchAvailable = false;
    this._active = false;
  }

  async init({ facingMode = 'user', videoElement = null, deviceId = null } = {}) {
    this.destroy();
    this.facingMode = facingMode;
    this.deviceId = deviceId;
    if (videoElement) {
      this.videoElement = videoElement;
    }

    // Ensure secure context (required by modern browsers for getUserMedia)
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      const err = new Error(
        'Insecure Context: Browsers strictly require HTTPS or http://localhost for camera hardware access. ' +
        'If accessing via mobile phone or LAN IP, please use https://<IP>:5173.'
      );
      err.name = 'InsecureContextError';
      throw err;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error(
        'Camera API (navigator.mediaDevices.getUserMedia) is not supported or is disabled in this browser.'
      );
      err.name = 'NotSupportedError';
      throw err;
    }

    let stream;
    let lastErr = null;

    // Stage 1: Try requested constraints (deviceId or facingMode + ideal resolution)
    const videoConstraint = {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 }
    };
    if (this.deviceId) {
      videoConstraint.deviceId = { exact: this.deviceId };
    } else if (this.facingMode) {
      videoConstraint.facingMode = { ideal: this.facingMode };
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false
      });
    } catch (err1) {
      console.warn('Initial camera constraint failed, attempting relaxed constraints...', err1);
      lastErr = err1;

      // If user/browser explicitly blocked permission, don't continue to hammer getUserMedia
      if (err1.name === 'NotAllowedError' || err1.name === 'PermissionDeniedError') {
        throw err1;
      }

      // Stage 2: Try relaxed video constraints without strict resolution preferences
      try {
        const relaxedConstraint = this.deviceId
          ? { deviceId: { exact: this.deviceId } }
          : (this.facingMode ? { facingMode: { ideal: this.facingMode } } : true);

        stream = await navigator.mediaDevices.getUserMedia({
          video: relaxedConstraint,
          audio: false
        });
      } catch (err2) {
        console.warn('Relaxed camera constraints failed, falling back to generic video...', err2);
        lastErr = err2;

        if (err2.name === 'NotAllowedError' || err2.name === 'PermissionDeniedError') {
          throw err2;
        }

        // Stage 3: Broadest possible generic video request
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        } catch (err3) {
          console.error('All camera initialization fallbacks failed:', err3);
          throw (err3 || lastErr);
        }
      }
    }

    this.stream = stream;
    this.videoElement.srcObject = stream;
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.muted = true;
    try {
      await this.videoElement.play();
    } catch (playErr) {
      console.warn('Video element play() was deferred or caught:', playErr);
    }
    this._active = true;

    // Check torch capability
    const track = stream.getVideoTracks()[0];
    if (track && track.getCapabilities) {
      const caps = track.getCapabilities();
      this.torchAvailable = Boolean(caps.torch);
    }
  }

  async getNextFrame(targetCanvas = null) {
    if (!this._active || !this.videoElement || this.videoElement.readyState < 2) {
      return null;
    }

    const vw = this.videoElement.videoWidth || 640;
    const vh = this.videoElement.videoHeight || 480;

    // Downscale to max 640px width for optimal real-time inference speed
    const scale = Math.min(1.0, 640 / vw);
    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);

    const canvas = targetCanvas || document.createElement('canvas');
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.videoElement, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.75);
    });

    return {
      blob,
      width: targetW,
      height: targetH,
      sourceElement: this.videoElement,
      timestamp: Date.now()
    };
  }

  getMediaElement() {
    return this.videoElement;
  }

  getDimensions() {
    return {
      width: this.videoElement?.videoWidth || 640,
      height: this.videoElement?.videoHeight || 480
    };
  }

  isActive() {
    return this._active && Boolean(this.stream && this.stream.active);
  }

  getCapabilities() {
    return {
      type: 'camera',
      facingMode: this.facingMode,
      torchAvailable: this.torchAvailable,
      torchOn: this.torchOn
    };
  }

  async toggleTorch() {
    if (!this.stream || !this.torchAvailable) return false;
    const track = this.stream.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      const nextTorch = !this.torchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextTorch }]
      });
      this.torchOn = nextTorch;
      return this.torchOn;
    }
    return false;
  }

  destroy() {
    this._active = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.torchOn = false;
  }
}


/**
 * ESP32-CAM MJPEG Stream Source.
 * 
 * In Phase 2 hardware deployment, this connects directly to the ESP32-CAM
 * HTTP MJPEG video stream (e.g. http://192.168.4.1/stream or http://<esp32_ip>:81/stream).
 * Provides the identical getNextFrame() interface without altering any tracking logic.
 */
export class ESP32MjpegFrameSource extends FrameSource {
  constructor() {
    super();
    this.imgElement = new Image();
    this.imgElement.crossOrigin = 'anonymous';
    this.streamUrl = '';
    this._active = false;
    this.lastFrameTime = 0;
    this.fps = 0;
  }

  async init({ streamUrl = 'http://172.16.4.122:81/stream', imgElement = null } = {}) {
    this.destroy();
    this.streamUrl = streamUrl;
    if (imgElement) {
      this.imgElement = imgElement;
    } else if (!this.imgElement) {
      this.imgElement = new Image();
    }

    // Determine target URL for image loading:
    // If running on HTTPS or the URL is a direct remote stream,
    // route it through /api/esp32/stream?url= to bypass browser Mixed Content (HTTPS -> HTTP) and CORS blocking.
    let effectiveSrc = streamUrl;
    if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
      if (!streamUrl.includes('/api/esp32/stream')) {
        effectiveSrc = `/api/esp32/stream?url=${encodeURIComponent(streamUrl)}`;
      }
    }

    this.imgElement.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // If timeout fires, still allow starting in case stream connects asynchronously
          this._active = true;
          resolve();
        }
      }, 5000);

      this.imgElement.onload = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this._active = true;
          resolve();
        }
      };

      this.imgElement.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this._active = false;
          try {
            this.imgElement.removeAttribute('src');
            this.imgElement.src = '';
          } catch (_) {}
          reject(new Error(`Unable to load ESP32 stream from ${this.streamUrl}. Check Wi-Fi link.`));
        }
      };

      this.imgElement.src = effectiveSrc;
    });
  }

  async getNextFrame(targetCanvas = null) {
    if (!this._active || !this.imgElement.complete || !this.imgElement.naturalWidth) {
      return null;
    }

    const vw = this.imgElement.naturalWidth || 640;
    const vh = this.imgElement.naturalHeight || 480;

    const scale = Math.min(1.0, 640 / vw);
    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);

    const canvas = targetCanvas || document.createElement('canvas');
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.imgElement, 0, 0, targetW, targetH);

    const now = Date.now();
    if (this.lastFrameTime > 0) {
      this.fps = Math.round(1000 / Math.max(1, now - this.lastFrameTime));
    }
    this.lastFrameTime = now;

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.75);
    });

    return {
      blob,
      width: targetW,
      height: targetH,
      sourceElement: this.imgElement,
      timestamp: now
    };
  }

  getMediaElement() {
    return this.imgElement;
  }

  getDimensions() {
    return {
      width: this.imgElement?.naturalWidth || 640,
      height: this.imgElement?.naturalHeight || 480
    };
  }

  isActive() {
    return this._active;
  }

  getCapabilities() {
    return {
      type: 'esp32',
      streamUrl: this.streamUrl,
      fps: this.fps
    };
  }

  destroy() {
    this._active = false;
    this.imgElement.src = '';
  }
}


/**
 * Video File Source.
 * Plays local or uploaded animal video files in a loop for repeatable testing.
 */
export class VideoFileFrameSource extends FrameSource {
  constructor() {
    super();
    this.videoElement = document.createElement('video');
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.loop = true;
    this.videoElement.muted = true;
    this.fileName = '';
    this.fileUrl = null;
    this._active = false;
  }

  async init({ file = null, url = null, fileName = '', videoElement = null } = {}) {
    this.destroy();
    if (videoElement) {
      this.videoElement = videoElement;
    }

    if (file) {
      this.fileUrl = URL.createObjectURL(file);
      this.fileName = file.name;
    } else if (url) {
      this.fileUrl = url;
      this.fileName = fileName || 'Remote Video';
    } else {
      throw new Error('VideoFileFrameSource requires either a File object or video URL.');
    }

    this.videoElement.src = this.fileUrl;
    this.videoElement.loop = true;
    this.videoElement.muted = true;
    this.videoElement.setAttribute('playsinline', 'true');
    await this.videoElement.play();
    this._active = true;
  }

  async getNextFrame(targetCanvas = null) {
    if (!this._active || !this.videoElement || this.videoElement.readyState < 2) {
      return null;
    }

    const vw = this.videoElement.videoWidth || 640;
    const vh = this.videoElement.videoHeight || 480;

    const scale = Math.min(1.0, 640 / vw);
    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);

    const canvas = targetCanvas || document.createElement('canvas');
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.videoElement, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.75);
    });

    return {
      blob,
      width: targetW,
      height: targetH,
      sourceElement: this.videoElement,
      timestamp: Date.now()
    };
  }

  getMediaElement() {
    return this.videoElement;
  }

  getDimensions() {
    return {
      width: this.videoElement?.videoWidth || 640,
      height: this.videoElement?.videoHeight || 480
    };
  }

  isActive() {
    return this._active && !this.videoElement.paused;
  }

  getCapabilities() {
    return {
      type: 'video_file',
      fileName: this.fileName,
      paused: this.videoElement?.paused ?? false
    };
  }

  togglePlayPause() {
    if (!this.videoElement) return false;
    if (this.videoElement.paused) {
      this.videoElement.play();
      return true;
    } else {
      this.videoElement.pause();
      return false;
    }
  }

  destroy() {
    this._active = false;
    if (this.fileUrl && this.fileUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.fileUrl);
    }
    this.fileUrl = null;
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
    }
  }
}


/**
 * Factory helper to instantiate the requested FrameSource.
 * @param {'camera'|'esp32'|'video'} type
 * @returns {FrameSource}
 */
export function createFrameSource(type = 'camera') {
  switch (type) {
    case 'esp32':
      return new ESP32MjpegFrameSource();
    case 'video':
      return new VideoFileFrameSource();
    case 'camera':
    default:
      return new UserMediaFrameSource();
  }
}
