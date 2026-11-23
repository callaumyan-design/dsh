// 针对 Azurite（本地 Azure Storage 模拟器）测试线上存储实现。
// 没有运行 Azurite 时跳过：AZURITE=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { azureStore } from '../src/lib/store.js';

const enabled = process.env.AZURITE === '1';

test('Azure 存储：每期、账号、密钥、会话、收藏、推送', { skip: !enabled && '未启用 Azurite' }, async () => {
  const store = await azureStore('UseDevelopmentStorage=true');
  const u1 = `u1-${Date.now()}`; // 每次用新账号，模拟器里残留的旧数据不影响结果
  await azureStore('UseDevelopmentStorage=true'); // 第二次初始化不报错（表和容器已存在）

  await store.putEdition({ date: '2026-11-20', headline: '甲', stories: [{ title: '中文标题' }], generatedAt: 'a' });
  await store.putEdition({ date: '2026-11-21', headline: '乙', stories: [], generatedAt: 'b' });
  await store.putEdition({ date: '2026-11-21', headline: '乙2', stories: [{}, {}], generatedAt: 'c' }); // 同一天重新生成
  assert.equal((await store.getLatestEdition()).headline, '乙2');
  assert.equal((await store.getEdition('2026-11-20')).stories[0].title, '中文标题');
  assert.equal(await store.getEdition('1999-01-01'), null);
  assert.deepEqual((await store.listEditions()).map((e) => [e.date, e.storyCount]), [['2026-11-21', 2], ['2026-11-20', 1]]);

  await store.createUser({ id: u1, name: '小明', createdAt: 't' });
  assert.deepEqual(await store.getUser(u1), { id: u1, name: '小明', createdAt: 't' });
  assert.equal(await store.getUser('nobody'), null);

  await store.putCredential({ id: 'cred_A-1', userId: u1, publicKey: 'AQID', counter: 0, transports: ['internal'] });
  await store.putCredential({ id: 'cred_B-2', userId: 'u2', publicKey: 'AQID', counter: 0 });
  assert.equal((await store.getCredential('cred_A-1')).counter, 0);
  assert.deepEqual((await store.listCredentials(u1)).map((c) => c.id), ['cred_A-1']);

  await store.putChallenge('ch1', { challenge: 'x', expires: Date.now() + 60000 });
  assert.equal((await store.takeChallenge('ch1')).challenge, 'x');
  assert.equal(await store.takeChallenge('ch1'), null);
  await store.putChallenge('ch2', { challenge: 'y', expires: Date.now() - 1 });
  assert.equal(await store.takeChallenge('ch2'), null);

  await store.putSession('h1', { userId: u1, expires: 1 });
  assert.equal((await store.getSession('h1')).userId, u1);
  await store.deleteSession('h1');
  await store.deleteSession('h1'); // 删除不存在的不报错
  assert.equal(await store.getSession('h1'), null);

  assert.deepEqual(await store.getState(u1), { read: [], prefs: {} });
  await store.putState(u1, { read: ['a'], prefs: { categories: ['AI'] } });
  assert.deepEqual((await store.getState(u1)).prefs.categories, ['AI']);

  await store.putBookmark(u1, { id: 's1', title: '一', url: 'https://a', savedAt: '2026-11-20T01:00:00Z' });
  await store.putBookmark(u1, { id: 's2', title: '二', url: 'https://b', savedAt: '2026-11-21T01:00:00Z' });
  assert.deepEqual((await store.listBookmarks(u1)).map((b) => b.id), ['s2', 's1']);
  await store.deleteBookmark(u1, 's2');
  assert.deepEqual((await store.listBookmarks(u1)).map((b) => b.id), ['s1']);

  await store.putPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc?x=1', keys: { p256dh: 'p', auth: 'a' } });
  assert.equal((await store.listPush()).length, 1);
  await store.deletePush('https://fcm.googleapis.com/fcm/send/abc?x=1');
  assert.equal((await store.listPush()).length, 0);
});
