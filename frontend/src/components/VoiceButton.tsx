import { useRef, useState } from "react";
import { transcribeAudio } from "../lib/api";
import { getSpeechRecognition } from "../lib/speech";

export function VoiceButton({
  disabled,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function toggle() {
    if (disabled) return;
    if (listening) {
      recRef.current?.stop();
      mediaRef.current?.state === "recording" && mediaRef.current.stop();
      recRef.current = null;
      setListening(false);
      return;
    }
    const Ctor = getSpeechRecognition();
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = "zh-CN";
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const text = last?.[0]?.transcript?.trim();
        if (text) onTranscript(text);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => {
        recRef.current = null;
        setListening(false);
      };
      recRef.current = rec;
      rec.start();
      setListening(true);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const ext = blob.type.includes("mp4") ? "audio.mp4" : "audio.webm";
      void transcribeAudio(blob, ext)
        .then((res) => {
          if (res.text.trim()) onTranscript(res.text.trim());
        })
        .finally(() => setListening(false));
    };
    mediaRef.current = recorder;
    recorder.start();
    setListening(true);
  }

  return (
    <button
      type="button"
      className={`voice-btn ${listening ? "listening" : ""}`}
      onClick={() => void toggle()}
      disabled={disabled}
      aria-label={listening ? "停止录音" : "语音输入"}
      title={listening ? "停止" : "语音输入"}
    >
      {listening ? "●" : "🎤"}
    </button>
  );
}