// Voice input: the browser's own speech recognition, or recorded audio sent to a transcription model
// (any OpenAI-compatible /audio/transcriptions endpoint, e.g. Whisper on Groq or OpenAI, SenseVoice on SiliconFlow).
import { providerFetch, readError } from './ai/transport';
import { browserFetch } from './ai/browser-transport';
import type { Provider } from './types';

export interface VoiceSession {
  /** Stops listening and resolves with the recognized text. */
  stop(): Promise<string>;
  cancel(): void;
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionClass(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}

export const browserSpeechSupported = () => !!recognitionClass();
export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export function startBrowserSpeech(lang: string, onPartial?: (text: string) => void): VoiceSession {
  const Ctor = recognitionClass();
  if (!Ctor) throw new Error('Speech recognition is not supported in this browser');
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let final = '';
  let interim = '';
  let error: string | null = null;
  let ended: () => void = () => {};
  const done = new Promise<void>((r) => (ended = r));
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    onPartial?.(final + interim);
  };
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') error = e.error;
  };
  rec.onend = () => ended();
  rec.start();
  return {
    async stop() {
      rec.stop();
      await done;
      if (error && !final) throw new Error(error === 'network' ? 'Speech service unreachable (network)' : error);
      return (final + interim).trim();
    },
    cancel: () => rec.abort(),
  };
}

export async function startRecording(provider: Provider, model: string, language?: string): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
  recorder.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    async stop() {
      recorder.stop();
      await stopped;
      release();
      const type = recorder.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', new Blob(chunks, { type }), `voice.${ext}`);
      form.append('model', model);
      if (language) form.append('language', language);
      const res = await providerFetch(provider, '/audio/transcriptions', { method: 'POST', body: form }, browserFetch);
      if (!res.ok) throw await readError(res);
      const j = await res.json();
      return String(j.text ?? '').trim();
    },
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Suggested transcription models per preset. */
export const TRANSCRIBE_MODELS: Record<string, string> = {
  groq: 'whisper-large-v3-turbo',
  openai: 'gpt-4o-mini-transcribe',
  siliconflow: 'FunAudioLLM/SenseVoiceSmall',
  azure: 'whisper',
};
