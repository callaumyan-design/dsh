/**
 * Emotion tags: the model starts its reply with e.g. "[happy]". We strip known tags
 * from the visible text (also while streaming) and use them to drive animations.
 * Works with every provider because it needs no function calling.
 */
import type { PetAnimState } from '../game/types'

export type Emotion = 'neutral' | 'happy' | 'excited' | 'sad' | 'angry' | 'surprised' | 'shy' | 'sleepy' | 'love' | 'thinking'

export const EMOTIONS: Emotion[] = ['neutral', 'happy', 'excited', 'sad', 'angry', 'surprised', 'shy', 'sleepy', 'love', 'thinking']

const ALIASES: Record<string, Emotion> = {
  neutral: 'neutral', calm: 'neutral', 平静: 'neutral', 普通: 'neutral',
  happy: 'happy', joy: 'happy', 开心: 'happy', 高兴: 'happy', 快乐: 'happy',
  excited: 'excited', 兴奋: 'excited', 激动: 'excited',
  sad: 'sad', 难过: 'sad', 伤心: 'sad', 委屈: 'sad',
  angry: 'angry', mad: 'angry', 生气: 'angry', 愤怒: 'angry',
  surprised: 'surprised', surprise: 'surprised', 惊讶: 'surprised', 吃惊: 'surprised',
  shy: 'shy', 害羞: 'shy', 羞: 'shy',
  sleepy: 'sleepy', tired: 'sleepy', 困: 'sleepy', 困倦: 'sleepy',
  love: 'love', 喜欢: 'love', 爱: 'love', 心动: 'love',
  thinking: 'thinking', think: 'thinking', 思考: 'thinking', 疑惑: 'thinking'
}

export function normalizeEmotion(tag: string): Emotion | null {
  return ALIASES[tag.trim().toLowerCase()] ?? null
}

export const EMOTION_ANIM: Record<Emotion, PetAnimState> = {
  neutral: 'talk',
  happy: 'happy',
  excited: 'jump',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  shy: 'shy',
  sleepy: 'sleep',
  love: 'happy',
  thinking: 'think'
}

const TAG_RE = /[[【]\s*([a-zA-Z]{2,12}|[一-龥]{1,4})\s*[\]】]/g
/** Longest possible tag, used to decide how long to hold back an unclosed "[". */
const MAX_TAG_LEN = 16

/** Remove known emotion tags from a finished text. Returns the first emotion found. */
export function stripEmotionTags(text: string): { text: string; emotion: Emotion | null } {
  let emotion: Emotion | null = null
  const out = text.replace(TAG_RE, (full, tag: string) => {
    const e = normalizeEmotion(tag)
    if (!e) return full
    emotion ??= e
    return ''
  })
  return { text: out.replace(/^\s+/, ''), emotion }
}

/**
 * Incremental version for streaming. push() returns text that is safe to display now;
 * a possibly-incomplete "[xx" at the end is held back until it is resolved.
 */
export class EmotionStreamParser {
  private pending = ''
  private started = false
  emotion: Emotion | null = null

  push(delta: string): { text: string; emotion: Emotion | null } {
    this.pending += delta
    const holdFrom = this.findHoldIndex(this.pending)
    const ready = this.pending.slice(0, holdFrom)
    this.pending = this.pending.slice(holdFrom)
    return this.emit(ready)
  }

  flush(): { text: string; emotion: Emotion | null } {
    const rest = this.pending
    this.pending = ''
    return this.emit(rest)
  }

  private emit(chunk: string): { text: string; emotion: Emotion | null } {
    if (!chunk) return { text: '', emotion: this.emotion }
    let text = chunk.replace(TAG_RE, (full, tag: string) => {
      const e = normalizeEmotion(tag)
      if (!e) return full
      this.emotion ??= e
      return ''
    })
    // Drop whitespace that only separated the leading tag from the reply.
    if (!this.started) {
      text = text.replace(/^\s+/, '')
      if (text) this.started = true
    }
    return { text, emotion: this.emotion }
  }

  /** Index from which text must be held back (an opening bracket with no close yet). */
  private findHoldIndex(s: string): number {
    const lastOpen = Math.max(s.lastIndexOf('['), s.lastIndexOf('【'))
    if (lastOpen < 0) return s.length
    const after = s.slice(lastOpen)
    if (/[\]】]/.test(after)) return s.length
    if (after.length > MAX_TAG_LEN) return s.length
    return lastOpen
  }
}
