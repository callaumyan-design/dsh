import { describe, expect, it } from 'vitest'
import { describeWeather, parseWttr, weatherUrl } from '../src/core/weather'

const sample = {
  current_condition: [{ temp_C: '12', FeelsLikeC: '10', humidity: '88', weatherCode: '296', weatherDesc: [{ value: 'Light rain' }], lang_zh: [{ value: '小雨' }] }]
}

describe('weather', () => {
  it('parses wttr.in j1 and flags rain', () => {
    const w = parseWttr(sample, '北京', 1)!
    expect(w).toMatchObject({ city: '北京', desc: '小雨', tempC: 12, feelsC: 10, rainy: true, snowy: false })
    expect(describeWeather(w)).toBe('北京现在小雨，12°C（体感 10°C），出门要带伞。')
    expect(parseWttr({}, 'x', 1)).toBeNull()
    expect(weatherUrl(' 上海 ')).toBe('https://wttr.in/%E4%B8%8A%E6%B5%B7?format=j1&lang=zh')
  })
})
