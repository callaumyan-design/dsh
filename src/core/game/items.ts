import type { StatKey } from './types'

export type ItemKind = 'food' | 'drink' | 'medicine' | 'care' | 'toy' | 'gift'

export interface ItemDef {
  id: string
  name: string
  emoji: string
  kind: ItemKind
  price: number
  desc: string
  /** Consumed on use. Toys are kept and boost play instead. */
  consumable: boolean
  effects: Partial<Record<StatKey | 'affection', number>>
}

export const ITEMS: ItemDef[] = [
  { id: 'riceball', name: '饭团', emoji: '🍙', kind: 'food', price: 10, consumable: true, desc: '朴素但顶饱', effects: { satiety: 25 } },
  { id: 'fish', name: '小鱼干', emoji: '🐟', kind: 'food', price: 8, consumable: true, desc: '咔嚓咔嚓，心情也变好了', effects: { satiety: 15, mood: 5 } },
  { id: 'apple', name: '苹果', emoji: '🍎', kind: 'food', price: 6, consumable: true, desc: '一天一苹果', effects: { satiety: 10, health: 3 } },
  { id: 'cake', name: '草莓蛋糕', emoji: '🍰', kind: 'food', price: 28, consumable: true, desc: '甜食使宠快乐', effects: { satiety: 20, mood: 18 } },
  { id: 'bento', name: '豪华便当', emoji: '🍱', kind: 'food', price: 40, consumable: true, desc: '吃饱饱，长高高', effects: { satiety: 50, mood: 8, health: 5 } },
  { id: 'milk', name: '牛奶', emoji: '🥛', kind: 'drink', price: 6, consumable: true, desc: '温温的', effects: { satiety: 6, energy: 5 } },
  { id: 'coffee', name: '咖啡', emoji: '☕', kind: 'drink', price: 15, consumable: true, desc: '提神，但别喝太多', effects: { energy: 30, health: -3 } },
  { id: 'juice', name: '果汁', emoji: '🧃', kind: 'drink', price: 10, consumable: true, desc: '酸酸甜甜', effects: { mood: 8, satiety: 5 } },
  { id: 'medicine', name: '感冒药', emoji: '💊', kind: 'medicine', price: 35, consumable: true, desc: '生病时吃，有点苦', effects: { health: 40, mood: -5 } },
  { id: 'soap', name: '泡泡浴', emoji: '🧼', kind: 'care', price: 10, consumable: true, desc: '洗得香喷喷', effects: { cleanliness: 100, mood: 5 } },
  { id: 'ball', name: '弹力球', emoji: '⚽', kind: 'toy', price: 50, consumable: false, desc: '有了它，玩耍更开心', effects: { mood: 8 } },
  { id: 'flower', name: '小花', emoji: '🌼', kind: 'gift', price: 20, consumable: true, desc: '送给它，它会很感动', effects: { affection: 12, mood: 10 } }
]

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]))

export function getItem(id: string): ItemDef | undefined {
  return BY_ID.get(id)
}

export const STARTER_INVENTORY: Record<string, number> = { riceball: 3, fish: 2, milk: 2, soap: 2 }
