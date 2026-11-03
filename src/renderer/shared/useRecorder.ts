import { useCallback, useEffect, useRef, useState } from 'react'

export interface Recording {
  data: Uint8Array
  mime: string
  ms: number
}

/** Hold-to-talk microphone recorder (MediaRecorder, webm/opus). Safe against fast taps. */
export function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const starting = useRef<Promise<void> | null>(null)
  const cancelled = useRef(false)
  const [recording, setRecording] = useState(false)

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  const start = useCallback(async () => {
    if (rec.current || starting.current) return
    cancelled.current = false
    starting.current = (async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (cancelled.current) {
        // the button was released while the permission prompt / device was still opening
        s.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current = s
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const r = new MediaRecorder(s, { mimeType: mime })
      chunks.current = []
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      r.start()
      rec.current = r
      startedAt.current = Date.now()
      setRecording(true)
    })()
    try {
      await starting.current
    } finally {
      starting.current = null
    }
  }, [])

  const stop = useCallback(async (): Promise<Recording | null> => {
    if (starting.current) {
      cancelled.current = true
      await starting.current.catch(() => {})
    }
    const r = rec.current
    rec.current = null
    setRecording(false)
    if (!r) {
      release()
      return null
    }
    return new Promise((resolve) => {
      r.onstop = async () => {
        release()
        const blob = new Blob(chunks.current, { type: r.mimeType })
        resolve({ data: new Uint8Array(await blob.arrayBuffer()), mime: r.mimeType, ms: Date.now() - startedAt.current })
      }
      r.stop()
    })
  }, [])

  // never leave the microphone open when the component goes away
  useEffect(
    () => () => {
      cancelled.current = true
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
      rec.current = null
      release()
    },
    []
  )

  return { recording, start, stop }
}
