import { describe, expect, it } from 'vitest';
import { JsonMessageStream, type StreamEvent } from './stream';

const enc = (s: string) => new TextEncoder().encode(s);

function feedChunks(stream: JsonMessageStream, bytes: Uint8Array, size: number): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(...stream.push(bytes.subarray(i, i + size)));
  return out;
}

const json = (events: StreamEvent[]) => events.filter((e) => e.kind === 'json').map((e) => (e as { value: unknown }).value);

describe('JsonMessageStream', () => {
  const lpa = JSON.stringify({ type: 'lpa', payload: { code: 0, message: 'success', dataType: 'profileList', data: [{ iccid: '8986', profileName: 'A {b} "c" \\ [d]', profileNickname: '主号🚀' }] } });
  const formatted = '{\n\t"cmd":\t"cardStatus",\n\t"cardInserted":\tfalse\n}';

  it('一次通知包含完整消息', () => {
    const s = new JsonMessageStream();
    expect(json(s.push(enc(lpa)))).toEqual([JSON.parse(lpa)]);
    expect(s.hasPending).toBe(false);
  });

  it('在每一个字节边界切分都能正确重组（含 UTF-8 多字节字符被切开）', () => {
    const bytes = enc(lpa);
    for (let size = 1; size <= 40; size++) {
      const s = new JsonMessageStream({ messageStart: null });
      expect(json(feedChunks(s, bytes, size))).toEqual([JSON.parse(lpa)]);
    }
  });

  it('固件 256 字节分段的长消息', () => {
    const big = JSON.stringify({ type: 'lpa', payload: { code: 0, message: 'success', dataType: 'profileList', data: Array.from({ length: 30 }, (_, i) => ({ iccid: `89860000000000000${i}`, icon: 'A'.repeat(300) })) } });
    const s = new JsonMessageStream();
    const events = feedChunks(s, enc(big), 256);
    expect(json(events)).toHaveLength(1);
    expect((json(events)[0] as { payload: { data: unknown[] } }).payload.data).toHaveLength(30);
  });

  it('多条连续消息在同一次通知中', () => {
    const s = new JsonMessageStream();
    const p1 = JSON.stringify({ type: 'progress', payload: { code: 0, message: 'es9p_initiate_authentication', data: 'x', step: 2, total_steps: 9 } });
    const events = s.push(enc(p1 + formatted + lpa));
    expect(json(events)).toHaveLength(3);
    expect((json(events)[1] as { cmd: string }).cmd).toBe('cardStatus');
  });

  it('cJSON_Print 的换行/制表符格式', () => {
    const s = new JsonMessageStream();
    expect(json(s.push(enc(formatted)))).toEqual([{ cmd: 'cardStatus', cardInserted: false }]);
  });

  it('字符串中的括号和转义引号不影响边界判断', () => {
    const s = new JsonMessageStream();
    const tricky = JSON.stringify({ type: 'lpa', payload: { code: -1, message: 'es9p_authenticate_client', data: 'he said "}{" \\"' } });
    expect(json(feedChunks(s, enc(tricky), 3))).toEqual([JSON.parse(tricky)]);
  });

  it('对象之外的文本作为 text 事件，不影响后续 JSON', () => {
    const s = new JsonMessageStream();
    const events = s.push(enc('garbage\r\n' + formatted));
    expect(events[0]).toEqual({ kind: 'text', text: 'garbage' });
    expect(json(events)).toHaveLength(1);
  });

  it('括号配平但不是合法 JSON → invalid', () => {
    const s = new JsonMessageStream();
    const events = s.push(enc('{"type": lpa}'));
    expect(events[0]?.kind).toBe('invalid');
  });

  it('被截断的消息在新消息开头到来时被丢弃并重新同步', () => {
    const s = new JsonMessageStream();
    const truncated = enc(lpa).subarray(0, 50);
    expect(s.push(truncated)).toEqual([]);
    expect(s.hasPending).toBe(true);
    const events = s.push(enc(formatted));
    expect(events[0]?.kind).toBe('truncated');
    expect(json(events)).toEqual([{ cmd: 'cardStatus', cardInserted: false }]);
  });

  it('续传分片不会误触发重新同步', () => {
    const s = new JsonMessageStream();
    // 第二片以 {"iccid" 开头，不是消息起始前缀
    const a = '{"type":"lpa","payload":{"code":0,"message":"success","dataType":"profileList","data":[';
    const b = '{"iccid":"1"}]}}';
    expect(s.push(enc(a))).toEqual([]);
    expect(json(s.push(enc(b)))).toHaveLength(1);
  });

  it('分片长度不符合固件 256 字节分段规律时判定为截断（即使 JSON 恰好合法）', () => {
    const s = new JsonMessageStream({ firmwareChunkSize: 256 });
    const msg = enc(JSON.stringify({ cmd: 'getElpaInfo', data: { a: 'x'.repeat(300) } }));
    // 正常：256 + 余下
    const ok = [...s.push(msg.subarray(0, 256)), ...s.push(msg.subarray(256))];
    expect(json(ok)).toHaveLength(1);
    // 模拟 MTU=185：第一片只剩 182 字节，但剩余部分恰好仍能配平
    const a = enc('{"cmd":"getElpaInfo","data":{"a":"1",');
    const b = enc('"c":"3"}}');
    const s2 = new JsonMessageStream({ firmwareChunkSize: 256 });
    const events = [...s2.push(a), ...s2.push(b)];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'truncated', reason: 'chunk-gap', chunkSizes: [a.length, b.length] });
  });

  it('flush 丢弃未完成消息', () => {
    const s = new JsonMessageStream();
    s.push(enc('{"type":"lpa","payload":{'));
    const events = s.flush();
    expect(events[0]?.kind).toBe('truncated');
    expect(s.hasPending).toBe(false);
  });

  it('超过缓冲上限时丢弃', () => {
    const s = new JsonMessageStream({ maxBuffer: 100 });
    const events = s.push(enc('{"a":"' + 'x'.repeat(200)));
    expect(events.some((e) => e.kind === 'truncated' && e.reason === 'overflow')).toBe(true);
  });
});
