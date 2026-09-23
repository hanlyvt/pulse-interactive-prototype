"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Camera, CameraOff, RotateCcw, X } from "lucide-react";

const BOTTLE_SRC =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/fles-xdbOvpaEPnIiFKGKxH6F0KuOwNwYMh.png";
const SOUND_SRC =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/pulse-open-8x4s9HQHS6HuYzgzT8RvFG7aODKVpl.mp3";

type State =
  | "setup"
  | "idle"
  | "detected"
  | "sound"
  | "reveal"
  | "fadeOut"
  | "cooldown";

const statusText: Record<State, string> = {
  setup: "NIGHT MODE STANDBY",
  idle: "SENSOR ACTIVE — WAITING FOR MOVEMENT",
  detected: "MOVEMENT DETECTED",
  sound: "A SIGNAL IN THE DARK",
  reveal: "PULSE — STILL AWAKE",
  fadeOut: "THE NIGHT REMEMBERS",
  cooldown: "RESETTING SENSOR",
};

export default function Page() {
  const [state, setState] = useState<State>("setup");
  const [sensitivity, setSensitivity] = useState(18);
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState("");
  const [assetError, setAssetError] = useState(false);
  const [soundVisible, setSoundVisible] = useState(false);
  const [devOpen, setDevOpen] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<number[]>([]);
  const sequenceIdRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8Array | null>(null);
  const consecutiveRef = useRef(0);
  const triggerLockedRef = useRef(false);
  const stateRef = useRef<State>("setup");
  const lastSampleRef = useRef(0);
  const activatingRef = useRef(false);

  const setVisualState = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
    if (process.env.NODE_ENV !== "production")
      console.log(`[PULSE] state: ${next}`);
  }, []);

  const clearAllTimers = useCallback(() => {
    sequenceIdRef.current += 1;
    timerRef.current.forEach(window.clearTimeout);
    timerRef.current = [];
  }, []);

  const cancelDetectionFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const resetExperience = useCallback(
    (nextState: State = streamRef.current ? "idle" : "setup") => {
      clearAllTimers();
      setSoundVisible(false);
      triggerLockedRef.current = false;
      previousFrameRef.current = null;
      consecutiveRef.current = 0;
      lastSampleRef.current = 0;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      setVisualState(nextState);
    },
    [cancelDetectionFrame, clearAllTimers, setVisualState],
  );

  const stopCamera = useCallback(() => {
    cancelDetectionFrame();
    resetExperience("setup");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [cancelDetectionFrame, resetExperience]);

  const runSequence = useCallback(() => {
    if (
      triggerLockedRef.current ||
      stateRef.current !== "idle" ||
      !streamRef.current
    )
      return;
    triggerLockedRef.current = true;
    clearAllTimers();
    const sequenceId = sequenceIdRef.current;
    setVisualState("detected");
    if (process.env.NODE_ENV !== "production")
      console.log("[PULSE] motion detected");

    const schedule = (delay: number, callback: () => void) => {
      timerRef.current.push(
        window.setTimeout(() => {
          if (sequenceId === sequenceIdRef.current) callback();
        }, delay),
      );
    };

    schedule(300, () => {
      setVisualState("sound");
      setSoundVisible(true);
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio
          .play()
          .then(() => {
            if (process.env.NODE_ENV !== "production")
              console.log("[PULSE] audio played");
          })
          .catch(() => undefined);
      }
    });
    schedule(650, () => {
      setSoundVisible(false);
      if (process.env.NODE_ENV !== "production") console.log("[PULSE] silence");
    });
    schedule(950, () => setVisualState("reveal"));
    schedule(11150, () => setVisualState("fadeOut"));
    schedule(13150, () => setVisualState("cooldown"));
    schedule(33150, () => {
      resetExperience("idle");
      if (process.env.NODE_ENV !== "production")
        console.log("[PULSE] detector re-armed");
    });
  }, [clearAllTimers, resetExperience, setVisualState]);

  const sampleMotion = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, 64, 48);
    const pixels = context.getImageData(0, 0, 64, 48).data;
    const current = new Uint8Array(64 * 48);
    let difference = 0;
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      const gray = Math.round(
        pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114,
      );
      current[p] = gray;
      if (previousFrameRef.current)
        difference += Math.abs(gray - previousFrameRef.current[p]);
    }
    if (previousFrameRef.current) {
      const averageDifference = difference / current.length;
      if (stateRef.current === "idle" && !triggerLockedRef.current) {
        consecutiveRef.current =
          averageDifference > sensitivity ? consecutiveRef.current + 1 : 0;
        if (consecutiveRef.current >= 3) {
          consecutiveRef.current = 0;
          previousFrameRef.current = null;
          runSequence();
          return;
        }
      } else {
        consecutiveRef.current = 0;
      }
    }
    previousFrameRef.current = current;
  }, [runSequence, sensitivity]);

  const startDetectionLoop = useCallback(() => {
    cancelDetectionFrame();
    const tick = (timestamp: number) => {
      if (!streamRef.current) return;
      if (timestamp - lastSampleRef.current >= 166) {
        lastSampleRef.current = timestamp;
        sampleMotion();
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelDetectionFrame, sampleMotion]);

  const activate = async () => {
    if (activatingRef.current || streamRef.current) return;
    activatingRef.current = true;
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera access is not available in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      resetExperience("idle");
      startDetectionLoop();
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not access your camera.",
      );
      resetExperience("setup");
    } finally {
      activatingRef.current = false;
    }
  };

  const reset = () => resetExperience();

  const exit = () => {
    stopCamera();
    setError("");
  };

  useEffect(() => () => stopCamera(), [stopCamera]);

  const dark = state === "setup" || state === "idle" || state === "cooldown";
  return (
    <main
      className={`pulse-app state-${state} ${soundVisible ? "sound-visible" : "sound-hidden"}`}
    >
      <div className="poster-frame">
        <div className="poster-noise" aria-hidden="true" />
        <div className="poster-fog" aria-hidden="true" />
        <header className="poster-mark" aria-label="PULSE">
          <span>PULSE</span>
          <i />
        </header>

        <div className="status-line" aria-live="polite">
          <span className="status-dot" />
          {statusText[state]}
        </div>

        <div className="sensor-orb" aria-hidden="true">
          <span />
        </div>
        <div className="light-cone" aria-hidden="true" />
        <div className="soundwave" aria-hidden="true">
          PTSSST.
        </div>

        <section
          className={`hero ${dark ? "hero-dark" : ""}`}
          aria-label="PULSE campaign poster"
        >
          <div className="hero-copy">
            <p className="eyebrow">PULSE / 01:37 AM</p>
            <h1>
              STILL
              <br />
              <em>AWAKE?</em>
            </h1>
            <p className="gold-line">SO ARE WE.</p>
            <p className="campaign-line">
              PULSE — FOR THE HOURS
              <br />
              THAT DON&apos;T GET SEEN.
            </p>
          </div>
          <div className="bottle-stage">
            {!assetError ? (
              <img
                src={BOTTLE_SRC}
                alt="PULSE lemon and ginger functional drink bottle"
                onError={() => setAssetError(true)}
              />
            ) : (
              <div className="bottle-placeholder">
                PULSE
                <br />
                <small>ASSET NOT FOUND</small>
              </div>
            )}
          </div>
          <div className="floor-reflection" aria-hidden="true" />
          <div className="flavour-lockup">
            <div className="qr-placeholder" aria-hidden="true">
              {Array.from({ length: 25 }).map((_, index) => (
                <i key={index} />
              ))}
            </div>
            <span>
              FIND YOUR
              <br />
              FLAVOUR
            </span>
          </div>
        </section>

        {state === "setup" && (
          <section className="setup-panel" aria-labelledby="setup-title">
            <p className="setup-kicker">STAY BALANCED</p>
            <h1 id="setup-title">
              STILL AWAKE?
              <br />
              <span>PULSE</span>
            </h1>
            <p className="setup-copy">
              Activate your camera to experience the poster. Camera input is
              used locally for movement detection only. Nothing is recorded or
              stored.
            </p>
            {error && (
              <div className="error-panel" role="alert">
                <strong>CAMERA UNAVAILABLE</strong>
                <span>{error}</span>
              </div>
            )}
            <button className="primary-cta" onClick={activate}>
              <Camera data-icon="inline-start" />
              {error ? "TRY AGAIN" : "ACTIVATE NIGHT MODE"}
              <span>↗</span>
            </button>
            <p className="privacy">
              Camera input is processed locally for movement detection.
              <br />
              No video, image or personal data is recorded, stored or sent.
            </p>
          </section>
        )}

        {state === "cooldown" && (
          <div className="cooldown-label">
            RESETTING SENSOR <span>20</span>
          </div>
        )}

        <button
          className="dev-toggle"
          onClick={() => setDevOpen((open) => !open)}
          aria-label={
            devOpen ? "Hide developer controls" : "Show developer controls"
          }
        >
          {devOpen ? "HIDE CONTROLS" : "DEV CONTROLS"}
        </button>
        {devOpen && (
          <aside className="dev-panel" aria-label="Developer controls">
            <div className="dev-heading">
              <span>DEV / NIGHT MODE</span>
              <span className="dev-state">{state}</span>
            </div>
            <label htmlFor="sensitivity">
              Motion sensitivity <output>{sensitivity}</output>
            </label>
            <input
              id="sensitivity"
              type="range"
              min="4"
              max="42"
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
            <div className="dev-actions">
              <button onClick={runSequence}>
                <AudioLines />
                TEST DETECTION
              </button>
              <button onClick={() => setShowCamera((visible) => !visible)}>
                {showCamera ? <CameraOff /> : <Camera />}
                {showCamera ? "HIDE CAMERA" : "SHOW CAMERA"}
              </button>
              <button onClick={reset}>
                <RotateCcw />
                RESET POSTER
              </button>
              <button onClick={exit}>
                <X />
                EXIT NIGHT MODE
              </button>
            </div>
            <video
              ref={videoRef}
              className={`camera-preview ${showCamera ? "is-visible" : ""}`}
              muted
              playsInline
              aria-label="Mirrored developer camera preview"
            />
            <canvas
              ref={canvasRef}
              width="64"
              height="48"
              className="hidden-canvas"
            />
          </aside>
        )}
        <audio ref={audioRef} src={SOUND_SRC} preload="auto" />
        <footer className="poster-footer">
          <span>© 2026 PULSE</span>
          <span>LEMON &amp; GINGER / 500 ML</span>
        </footer>
      </div>
    </main>
  );
}
