import { useState } from 'react'
import type { Snapshot } from '../../../core/ipc'
import { alphaBounds, IMAGE_PRESETS, removeBackground } from '../../../core/pets/imagegen'
import { api } from '../../shared/api'
import { Field, Section, Toggle, useToast } from '../ui'

/** Draw, optionally cut out the background, crop to the character and return PNG bytes. */
async function processImage(dataUrl: string, cutout: boolean): Promise<{ preview: string; bytes: Uint8Array }> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const S = 512
  const k = Math.min(S / img.naturalWidth, S / img.naturalHeight)
  const w = Math.round(img.naturalWidth * k)
  const h = Math.round(img.naturalHeight * k)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  if (cutout) removeBackground(data.data, w, h)
  ctx.putImageData(data, 0, 0)
  const box = alphaBounds(data.data, w, h) ?? { x: 0, y: 0, w, h }
  const m = 6
  const out = document.createElement('canvas')
  out.width = box.w + m * 2
  out.height = box.h + m * 2
  out.getContext('2d')!.drawImage(c, box.x, box.y, box.w, box.h, m, m, box.w, box.h)
  const blob = await new Promise<Blob>((resolve) => out.toBlob((b) => resolve(b!), 'image/png'))
  return { preview: out.toDataURL('image/png'), bytes: new Uint8Array(await blob.arrayBuffer()) }
}

export function AvatarMaker({ snap }: { snap: Snapshot }) {
  const toast = useToast()
  const g = snap.settings.imageGen
  const [desc, setDesc] = useState('一只圆滚滚的橘色小猫，戴着蓝色围巾')
  const [name, setName] = useState('')
  const [raw, setRaw] = useState<string | null>(null)
  const [cutout, setCutout] = useState(true)
  const [result, setResult] = useState<{ preview: string; bytes: Uint8Array } | null>(null)
  const [busy, setBusy] = useState(false)
  const [showApi, setShowApi] = useState(false)
  const [key, setKey] = useState('')
  const keyProvider = snap.settings.providers.find((p) => p.id === g.keyFrom)
  const keyOk = g.keyFrom === 'own' ? snap.settings.imageHasOwnKey : !!keyProvider?.hasKey
  const update = (patch: Partial<typeof g>) => void api.settingsUpdate({ imageGen: { ...g, ...patch } })

  const generate = async () => {
    setBusy(true)
    setResult(null)
    const r = await api.avatarGenerate(desc)
    if (!r.ok || !r.dataUrl) {
      setBusy(false)
      return toast(r.error ?? '生成失败', 'err')
    }
    setRaw(r.dataUrl)
    const cut = !r.transparent
    setCutout(cut)
    setResult(await processImage(r.dataUrl, cut))
    setBusy(false)
  }

  return (
    <Section
      title="✨ AI 生成形象"
      desc="描述一下想要的宠物，让图像模型画出来，自动去掉背景，变成会动的桌宠。每次生成会花一点费用（硅基流动 Kolors 约几分钱一张）。"
      actions={
        <button className="btn ghost small" onClick={() => setShowApi(!showApi)}>
          {showApi ? '收起接口设置' : '接口设置'}
        </button>
      }
    >
      {(showApi || !keyOk) && (
        <div className="provider-editor">
          {!keyOk && <p className="note">需要先配置图像接口的 API Key。</p>}
          <Field label="预设">
            <select
              value=""
              onChange={(e) => {
                const p = IMAGE_PRESETS.find((x) => x.name === e.target.value)
                if (p) update({ baseURL: p.baseURL, model: p.model, size: p.size, keyFrom: p.keyFrom, transparent: !!p.transparent })
              }}
            >
              <option value="">选择一个预设…</option>
              {IMAGE_PRESETS.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="接口地址">
            <input value={g.baseURL} onChange={(e) => update({ baseURL: e.target.value })} />
          </Field>
          <Field label="模型">
            <input value={g.model} onChange={(e) => update({ model: e.target.value })} />
          </Field>
          <Field label="API Key 来源">
            <select value={g.keyFrom} onChange={(e) => update({ keyFrom: e.target.value })}>
              <option value="own">单独填写</option>
              {snap.settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  复用「{p.name}」的 Key{p.hasKey ? '' : '（还没填）'}
                </option>
              ))}
            </select>
          </Field>
          {g.keyFrom === 'own' && (
            <Field label="图像接口 Key" hint={snap.settings.imageHasOwnKey ? '✅ 已保存' : '还没有填写'}>
              <div className="row">
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." />
                <button
                  className="btn"
                  onClick={async () => {
                    await api.setApiKey('image', key)
                    setKey('')
                    toast('已保存')
                  }}
                >
                  保存
                </button>
              </div>
            </Field>
          )}
          <Field label="直接透明背景" hint="只有 OpenAI gpt-image 系列支持；其它模型会画白底，再自动抠图">
            <Toggle checked={g.transparent} onChange={(v) => update({ transparent: v })} />
          </Field>
        </div>
      )}
      <div className="avatar-maker">
        <div className="avatar-form">
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="例如：一只穿着宇航服的小柴犬" />
          <div className="row">
            <button className="btn primary" disabled={busy || !desc.trim()} onClick={() => void generate()}>
              {busy ? '正在画…（大约 10~30 秒）' : result ? '重新生成' : '生成'}
            </button>
            {raw && (
              <label className="row small">
                <input
                  type="checkbox"
                  checked={cutout}
                  onChange={async (e) => {
                    setCutout(e.target.checked)
                    setResult(await processImage(raw, e.target.checked))
                  }}
                />
                去掉背景
              </label>
            )}
          </div>
          {result && (
            <div className="row">
              <input value={name} placeholder="给新形象起个名字" onChange={(e) => setName(e.target.value)} />
              <button
                className="btn primary"
                onClick={async () => {
                  const r = await api.packFromImageData(result.bytes, name.trim() || 'AI 宠物')
                  if (r.ok) toast(`「${r.name}」来到你的桌面啦！`)
                  else toast(r.error ?? '保存失败', 'err')
                }}
              >
                就用它
              </button>
            </div>
          )}
        </div>
        <div className="avatar-preview checker">{result ? <img src={result.preview} alt="生成的形象" /> : <span className="muted small">{busy ? '…' : '预览'}</span>}</div>
      </div>
    </Section>
  )
}
