/** 从模型的文字回复里取出 JSON：容忍 ```json 代码块和前后多余的话。 */
export function extractJson(text) {
  const s = String(text ?? '').trim();
  try {
    return JSON.parse(s);
  } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error('AI 的回复里没有可解析的 JSON');
}
