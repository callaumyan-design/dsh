import { useState } from 'react'
import type { PetAnimState } from '../../../core/game/types'
import { stageOf } from '../../../core/game/engine'
import type { Snapshot } from '../../../core/ipc'
import type { BlobAccessory } from '../../../core/settings'
import { api } from '../../shared/api'
import { PetView } from '../../shared/PetView'
import { Field, Section, Toggle, useToast } from '../ui'

const ACCESSORIES: Array<[BlobAccessory, string]> = [
  ['none', '无'],
  ['bow', '蝴蝶结'],
  ['leaf', '小嫩芽'],
  ['crown', '王冠'],
  ['glasses', '眼镜'],
  ['cat-ears', '猫耳']
]
const COLORS = ['#8fd3ff', '#ffb3c7', '#b8f2a6', '#ffe08a', '#c9b8ff', '#ffc89a', '#e8e8f0']
const PREVIEW_STATES: PetAnimState[] = ['idle', 'walk', 'happy', 'talk', 'think', 'eat', 'sleep', 'sad', 'work', 'play']

export function AppearanceTab({ snap }: { snap: Snapshot }) {
  const toast = useToast()
  const a = snap.settings.appearance
  const [preview, setPreview] = useState<PetAnimState>('idle')
  const update = (patch: Partial<typeof a>) => void api.settingsUpdate({ appearance: { ...a, ...patch } })
  const current = snap.packs.find((p) => p.id === a.packId) ?? snap.packs[0]
  const stage = stageOf(snap.game.level)

  return (
    <div className="stack">
      <Section
        title="形象包"
        desc={
          <>
            把形象包文件夹放进「形象包目录」后点“重新扫描”。支持 <b>Codex Pet 格式</b>（pet.json + 8×9 精灵图，可直接用 Petdex 等社区的宠物）和
            <b> 逐状态素材</b>（GIF / APNG / WebP / PNG 序列帧 / 透明 WebM），格式说明见 docs/PET_PACK.md。
          </>
        }
        actions={
          <>
            <button
              className="btn primary"
              title="选一张透明背景的 PNG / GIF / WebP，自动加上呼吸、蹦跳等动作"
              onClick={async () => {
                const r = await api.packImport('image')
                if (r.ok) toast(`「${r.name}」来到你的桌面啦！`)
                else if (r.error) toast(r.error, 'err')
              }}
            >
              用一张图片做宠物
            </button>
            <button
              className="btn"
              onClick={async () => {
                const r = await api.packImport('zip')
                if (r.ok) toast(`已导入「${r.name}」${r.warnings?.length ? `（${r.warnings.length} 个提示）` : ''}`)
                else if (r.error) toast(r.error, 'err')
              }}
            >
              导入 .zip
            </button>
            <button
              className="btn"
              onClick={async () => {
                const r = await api.packImport('folder')
                if (r.ok) toast(`已导入「${r.name}」`)
                else if (r.error) toast(r.error, 'err')
              }}
            >
              导入文件夹
            </button>
            <button className="btn ghost" onClick={() => void api.openPacksFolder()}>
              打开形象包目录
            </button>
            <button
              className="btn"
              onClick={async () => {
                const list = await api.packsReload()
                toast(`找到 ${list.length} 个形象`)
              }}
            >
              重新扫描
            </button>
          </>
        }
      >
        <div className="pack-grid">
          {snap.packs.map((p) => (
            <button key={p.id} className={`pack ${p.id === a.packId ? 'active' : ''}`} onClick={() => void api.packSelect(p.id)}>
              <div className="pack-preview">
                <PetView pack={p} state="idle" emotion={null} appearance={a} stage={stage} width={110} height={110 * (p.height / p.width)} />
              </div>
              <div className="pack-name">{p.name}</div>
              <div className="muted small">
                {p.kind === 'builtin' ? '内置' : p.kind === 'codex' ? 'Codex 格式' : '逐状态素材'}
                {p.author ? ` · ${p.author}` : ''}
              </div>
              {p.warnings.length > 0 && <div className="warn-text small" title={p.warnings.join('\n')}>⚠ {p.warnings.length} 个问题</div>}
            </button>
          ))}
        </div>
      </Section>

      <Section title="预览动作" desc="看看当前形象在各种状态下的样子（缺少的动作会自动用相近的代替）。">
        <div className="preview-row">
          <div className="preview-stage">
            {current && <PetView pack={current} state={preview} emotion={null} appearance={a} stage={stage} width={current.width} height={current.height} />}
          </div>
          <div className="chips">
            {PREVIEW_STATES.map((s) => (
              <button key={s} className={`chip ${preview === s ? 'active' : ''}`} onClick={() => setPreview(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="外观设置">
        <Field label="大小" hint={`${Math.round(a.scale * 100)}%（幼年和少年阶段会再小一点）`}>
          <input type="range" min={0.5} max={2} step={0.05} value={a.scale} onChange={(e) => update({ scale: Number(e.target.value) })} />
        </Field>
        <Field label="透明度" hint={`${Math.round((a.opacity ?? 1) * 100)}%`}>
          <input type="range" min={0.2} max={1} step={0.05} value={a.opacity ?? 1} onChange={(e) => update({ opacity: Number(e.target.value) })} />
        </Field>
        <Field label="自己到处走">
          <Toggle checked={a.walkEnabled} onChange={(v) => update({ walkEnabled: v })} />
        </Field>
        {current?.kind === 'builtin' && (
          <>
            <Field label="团子的颜色">
              <div className="row">
                {COLORS.map((c) => (
                  <button key={c} className={`swatch ${a.blobColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => update({ blobColor: c })} aria-label={c} />
                ))}
                <input type="color" value={a.blobColor} onChange={(e) => update({ blobColor: e.target.value })} />
              </div>
            </Field>
            <Field label="饰品">
              <div className="chips">
                {ACCESSORIES.map(([k, label]) => (
                  <button key={k} className={`chip ${a.blobAccessory === k ? 'active' : ''}`} onClick={() => update({ blobAccessory: k })}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
      </Section>
    </div>
  )
}
