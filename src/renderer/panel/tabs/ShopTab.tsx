import type { ItemKind } from '../../../core/game/items'
import type { Snapshot } from '../../../core/ipc'
import { api } from '../../shared/api'
import { Section, useToast } from '../ui'

const KIND_LABEL: Record<ItemKind, string> = { food: '食物', drink: '饮料', medicine: '药品', care: '清洁', toy: '玩具', gift: '礼物' }
const EFFECT_LABEL: Record<string, string> = { satiety: '饱食', mood: '心情', energy: '精力', cleanliness: '清洁', health: '健康', affection: '好感' }

export function ShopTab({ snap }: { snap: Snapshot }) {
  const toast = useToast()
  const g = snap.game
  const buy = async (itemId: string, count = 1) => {
    const r = await api.gameAction({ type: 'buy', itemId, count })
    toast(r.message, r.ok ? 'ok' : 'err')
  }
  return (
    <Section title="小卖部" desc={`余额 🪙 ${g.coins}。金币来自打工、签到和升级奖励。`}>
      <div className="shop-grid">
        {snap.items.map((i) => {
          const owned = g.inventory[i.id] ?? 0
          const soldOut = !i.consumable && owned > 0
          return (
            <div key={i.id} className="shop-item">
              <div className="shop-emoji">{i.emoji}</div>
              <div className="shop-body">
                <div className="shop-title">
                  {i.name} <span className="pill">{KIND_LABEL[i.kind]}</span>
                </div>
                <div className="muted small">{i.desc}</div>
                <div className="effects">
                  {Object.entries(i.effects).map(([k, v]) => (
                    <span key={k} className={v >= 0 ? 'up' : 'down'}>
                      {EFFECT_LABEL[k]} {v >= 0 ? '+' : ''}
                      {v}
                    </span>
                  ))}
                </div>
                <div className="row between">
                  <span>
                    🪙 {i.price} {owned > 0 && <span className="muted small">已有 {owned}</span>}
                  </span>
                  <span className="row">
                    <button className="btn small" disabled={soldOut || g.coins < i.price} onClick={() => void buy(i.id)}>
                      {soldOut ? '已拥有' : '买 1 个'}
                    </button>
                    {i.consumable && (
                      <button className="btn small ghost" disabled={g.coins < i.price * 5} onClick={() => void buy(i.id, 5)}>
                        ×5
                      </button>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
