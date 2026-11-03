import { useCallback, useRef, useState } from 'react'

export interface Recording {
  data: Uint8Array
  mime: string
  ms: number
}

/** Hold-to-talk microphone recorder (MediaRecorder, webm/opus). */
export function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const [recording, setRecording] = useState(false)

  const start = useCallback(async () => {
    if (rec.current) return
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    stream.current = s
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const r = new MediaRecorder(s, { mimeType: mime })
    chunks.current = []
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.start()
    rec.current = r
    startedAt.current = Date.now()
    setRecording(true)
  }, [])

  const stop = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        const r = rec.current
        rec.current = null
        setRecording(false)
        if (!r) return resolve(null)
        r.onstop = async () => {
          stream.current?.getTracks().forEach((t) => t.stop())
          stream.current = null
          const blob = new Blob(chunks.current, { type: r.mimeType })
          resolve({ data: new Uint8Array(await blob.arrayBuffer()), mime: r.mimeType, ms: Date.now() - startedAt.current })
        }
        r.stop()
      }),
    []
  )

  return { recording, start, stop }
}
