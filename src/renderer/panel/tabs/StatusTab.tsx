import { affectionTitle, CONDITION_LABEL, expToNext, MAX_AFFECTION, STAGE_LABEL, stageOf } from '../../../core/game/engine'
import type { GameAction } from '../../../core/game/types'
import type { Snapshot } from '../../../core/ipc'
import { builtinPack } from '../../../core/pets/pack'
import { api } from '../../shared/api'
import { PetView } from '../../shared/PetView'
import { Bar, Section, useToast } from '../ui'

export function StatusTab({ snap }: { snap: Snapshot }) {
  const g = snap.game
  const toast = useToast()
  const pack = snap.packs.find((p) => p.id === snap.settings.appearance.packId) ?? builtinPack()
  const stage = stageOf(g.level)
  const run = async (action: GameAction) => {
    const r = await api.gameAction(action)
    toast(r.message || (r.ok ? '好的' : '不行哦'), r.ok ? 'ok' : 'err')
  }
  const stats: Array<[string, number, string]> = [
    ['饱食', g.stats.satiety, '#f5a623'],
    ['心情', g.stats.mood, '#ff6f91'],
    ['精力', g.stats.energy, '#4fc3f7'],
    ['清洁', g.stats.cleanliness, '#7bd88f'],
    ['健康', g.stats.health, '#e5484d']
  ]
  const inv = snap.items.filter((i) => (g.inventory[i.id] ?? 0) > 0)
  const days = Math.max(1, Math.ceil((Date.now() - g.createdAt) / 86_400_000))

  return (
    <div className="stack">
      <div className="status-hero card">
        <div className="hero-pet">
          <PetView
            pack={pack}
            state={g.asleep ? 'sleep' : snap.conditions.includes('sick') ? 'sick' : 'idle'}
            emotion={null}
            appearance={snap.settings.appearance}
            stage={stage}
            width={pack.width * 0.9}
            height={pack.height * 0.9}
          />
        </div>
        <div className="hero-info">
          <h2>
            {snap.persona.name} <span className="pill">{STAGE_LABEL[stage]}</span> <span className="pill">Lv.{g.level}</span>
          </h2>
          <p className="muted">
            {g.asleep ? '正在睡觉 · ' : ''}
            {snap.conditions.map((c) => CONDITION_LABEL[c]).join('、')} · 已陪伴 {days} 天 · 🪙 {g.coins} 金币
          </p>
          <div className="stat-grid">
            {stats.map(([label, v, color]) => (
              <div key={label} className="stat">
                <span>{label}</span>
                <Bar value={v} color={color} />
                <b>{Math.round(v)}</b>
              </div>
            ))}
            <div className="stat">
              <span>经验</span>
              <Bar value={g.exp} max={expToNext(g.level)} color="#8b7bff" />
              <b>
                {Math.round(g.exp)}/{expToNext(g.level)}
              </b>
            </div>
            <div className="stat">
              <span>好感</span>
              <Bar value={g.affection} max={MAX_AFFECTION} color="#ff8fab" />
              <b>{affectionTitle(g.affection)}</b>
            </div>
          </div>
        </div>
      </div>

      <Section title="互动" desc="打工和学习有 20 分钟冷却；生病、太累、太饿时有些事做不了。">
        <div className="actions">
          <button className="btn" onClick={() => void run({ type: 'play' })}>🎾 玩耍</button>
          <button className="btn" onClick={() => void run({ type: 'bath' })}>🛁 洗澡</button>
          {g.asleep ? (
            <button className="btn" onClick={() => void run({ type: 'wake' })}>☀️ 叫醒</button>
          ) : (
            <button className="btn" onClick={() => void run({ type: 'sleep' })}>🌙 睡觉</button>
          )}
          <button className="btn" onClick={() => void run({ type: 'work' })}>💼 打工</button>
          <button className="btn" onClick={() => void run({ type: 'study' })}>📚 学习</button>
          <button className="btn" onClick={() => void run({ type: 'checkIn' })}>📅 签到{g.checkInStreak ? `（连续 ${g.checkInStreak} 天）` : ''}</button>
        </div>
      </Section>

      <Section title="背包" desc={inv.length ? '点击物品使用' : '背包空空的，去商店买点东西吧'}>
        <div className="item-grid">
          {inv.map((i) => (
            <button key={i.id} className="item" onClick={() => void run({ type: 'use', itemId: i.id })} title={i.desc}>
              <span className="item-emoji">{i.emoji}</span>
              <span>{i.name}</span>
              <span className="item-count">×{g.inventory[i.id]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="成长记录">
        <div className="totals">
          <span>喂食 {g.totals.fed} 次</span>
          <span>玩耍 {g.totals.played} 次</span>
          <span>洗澡 {g.totals.baths} 次</span>
          <span>打工 {g.totals.worked} 次</span>
          <span>学习 {g.totals.studied} 次</span>
          <span>聊天 {g.totals.chats} 次</span>
          <span>摸摸 {g.totals.pets} 次</span>
        </div>
      </Section>
    </div>
  )
}
