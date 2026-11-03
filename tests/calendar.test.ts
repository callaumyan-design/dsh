import { describe, expect, it } from 'vitest'
import { anniversaryOn, describeSpecialDays, festivalOn, specialGreeting } from '../src/core/calendar'

describe('calendar', () => {
  it('fixed and lunar festivals', () => {
    expect(festivalOn(new Date(2026, 0, 1))?.name).toBe('元旦')
    expect(festivalOn(new Date(2026, 1, 16))?.name).toBe('除夕')
    expect(festivalOn(new Date(2026, 1, 17))?.name).toBe('春节')
    expect(festivalOn(new Date(2026, 2, 3))?.name).toBe('元宵节')
    expect(festivalOn(new Date(2026, 8, 25))?.name).toBe('中秋节')
    expect(festivalOn(new Date(2028, 0, 25))?.name).toBe('除夕')
    expect(festivalOn(new Date(2026, 10, 3))).toBeNull()
  })

  it('anniversaries', () => {
    const created = new Date(2026, 10, 3, 15).getTime()
    expect(anniversaryOn(new Date(2026, 10, 3, 9), created)).toBeNull()
    expect(anniversaryOn(new Date(2026, 10, 10), created)?.name).toBe('相识 7 天')
    expect(anniversaryOn(new Date(2027, 1, 11), created)?.name).toBe('相识 100 天')
    expect(anniversaryOn(new Date(2027, 10, 3), created)?.name).toBe('相识 1 周年')
  })

  it('prompt lines and daily greeting key', () => {
    const created = new Date(2026, 5, 17).getTime()
    expect(describeSpecialDays(new Date(2026, 8, 25), created)).toEqual(['今天是中秋节。', '今天是你和对方相识 100 天的纪念日。'])
    expect(specialGreeting(new Date(2026, 8, 25), created)?.key).toBe('2026-09-25:anniv-100d')
    expect(specialGreeting(new Date(2026, 8, 26), created)).toBeNull()
  })
})
