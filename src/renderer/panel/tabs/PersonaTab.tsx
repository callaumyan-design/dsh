import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../core/ipc'
import type { Persona } from '../../../core/persona/persona'
import { api } from '../../shared/api'
import { Field, Section, useToast } from '../ui'

const FIELDS: Array<[keyof Persona, string, string, number]> = [
  ['name', '名字', '它叫什么', 1],
  ['species', '物种 / 身份', '例如：软乎乎的小史莱姆、一只橘猫、来自未来的机器人', 1],
  ['userCallName', '怎么称呼你', '例如：主人、小明、哥哥', 1],
  ['personality', '性格', '性格、喜好、害怕的东西……写得越具体越像', 3],
  ['speakingStyle', '说话风格', '口癖、语气词、是否用颜文字……', 2],
  ['background', '来历 / 背景故事', '它是怎么来到你桌面上的', 3],
  ['greeting', '初次见面的问候', '第一次启动时说的话，可以用 [happy] 这样的情绪标签开头', 2],
  ['exampleDialogue', '说话示例（可选）', '几行示例对话，帮助模型找准语气', 4]
]

export function PersonaTab({ snap }: { snap: Snapshot }) {
  const [p, setP] = useState<Persona>(snap.persona)
  const toast = useToast()
  useEffect(() => setP(snap.persona), [snap.persona])
  const dirty = JSON.stringify(p) !== JSON.stringify(snap.persona)

  return (
    <Section
      title="人设"
      desc="这些设定会写进每次对话的系统提示词里。也可以导入 SillyTavern 角色卡（PNG 或 JSON）。"
      actions={
        <>
          <button
            className="btn ghost"
            onClick={async () => {
              const r = await api.personaImportCard()
              if (r.ok && r.persona) toast(`已导入角色：${r.persona.name}`)
              else if (r.error) toast(r.error, 'err')
            }}
          >
            导入角色卡
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              if (confirm('恢复成默认的团子人设？')) setP(await api.personaReset())
            }}
          >
            恢复默认
          </button>
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={async () => {
              await api.personaUpdate(p)
              toast('人设已保存')
            }}
          >
            保存
          </button>
        </>
      }
    >
      {FIELDS.map(([key, label, hint, rows]) => (
        <Field key={key} label={label}>
          {rows === 1 ? (
            <input value={p[key]} placeholder={hint} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
          ) : (
            <textarea rows={rows} value={p[key]} placeholder={hint} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
          )}
        </Field>
      ))}
    </Section>
  )
}
