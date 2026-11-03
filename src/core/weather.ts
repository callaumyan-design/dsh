/** Optional weather awareness via wttr.in (no API key). Only the user-entered city is sent. */

export interface Weather {
  city: string
  desc: string
  tempC: number
  feelsC: number
  humidity: number
  rainy: boolean
  snowy: boolean
  fetchedAt: number
}

export function weatherUrl(city: string): string {
  return `https://wttr.in/${encodeURIComponent(city.trim())}?format=j1&lang=zh`
}

export function parseWttr(json: unknown, city: string, now: number): Weather | null {
  const j = json as { current_condition?: Array<Record<string, unknown>> }
  const c = j?.current_condition?.[0]
  if (!c) return null
  const zh = (c.lang_zh as Array<{ value?: string }> | undefined)?.[0]?.value
  const en = (c.weatherDesc as Array<{ value?: string }> | undefined)?.[0]?.value ?? ''
  const desc = (zh || en || '').trim()
  const code = Number(c.weatherCode)
  const text = `${desc} ${en}`.toLowerCase()
  const rainy = /雨|rain|drizzle|shower|thunder/.test(text) || [176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359, 386, 389].includes(code)
  const snowy = /雪|snow|sleet|blizzard/.test(text) || [179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371, 392, 395].includes(code)
  const tempC = Number(c.temp_C)
  if (!Number.isFinite(tempC)) return null
  return {
    city,
    desc: desc || '未知',
    tempC,
    feelsC: Number(c.FeelsLikeC ?? tempC),
    humidity: Number(c.humidity ?? 0),
    rainy,
    snowy,
    fetchedAt: now
  }
}

export function describeWeather(w: Weather): string {
  const tips: string[] = []
  if (w.rainy) tips.push('出门要带伞')
  if (w.snowy) tips.push('路滑注意保暖')
  if (w.tempC <= 5) tips.push('很冷')
  else if (w.tempC >= 32) tips.push('很热，注意防暑')
  return `${w.city}现在${w.desc}，${Math.round(w.tempC)}°C（体感 ${Math.round(w.feelsC)}°C）${tips.length ? '，' + tips.join('，') : ''}。`
}
