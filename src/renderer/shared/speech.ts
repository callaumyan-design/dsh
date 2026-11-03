import type { Settings } from '../../core/settings'

/** Text the speech engine should not read out: emoji, kaomoji parts, decorative symbols. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[̀-ͯ฀-๿㄰-㆏؀-ۿ☀-➿←-⇿■-◿]/g, '')
    .replace(/[~～^＾*＊]/g, '')
    .replace(/[(（]\s*[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pickVoice(name: string): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null
  const voices = speechSynthesis.getVoices()
  return (
    voices.find((v) => v.name === name) ??
    voices.find((v) => /zh[-_](CN|Hans)/i.test(v.lang)) ??
    voices.find((v) => /^zh/i.test(v.lang)) ??
    null
  )
}

export function speak(text: string, voice: Settings['voice'], force = false): void {
  if ((!voice.enabled && !force) || !('speechSynthesis' in window)) return
  const clean = cleanForSpeech(text).slice(0, 400)
  if (!clean) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(clean)
  const v = pickVoice(voice.voiceName)
  if (v) u.voice = v
  u.lang = v?.lang ?? 'zh-CN'
  u.rate = voice.rate
  u.pitch = voice.pitch
  u.volume = voice.volume
  speechSynthesis.speak(u)
}
