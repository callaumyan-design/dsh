import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/lib/classify.js';

const c = (title, summary = '', sourceCategory = null) => classify({ title, summary, sourceCategory });

test('中文标题', () => {
  assert.equal(c('小米 17 Ultra 真机上手：徕卡长焦回归'), '数码');
  assert.equal(c('DeepSeek 发布新一代推理模型，性能对标 GPT-5'), 'AI');
  assert.equal(c('台积电 2nm 制程明年量产，苹果包下首批产能'), '芯片与硬件');
  assert.equal(c('Rust 1.95 发布，编译器速度提升 20%'), '开发者');
  assert.equal(c('SpaceX 星舰第十二次试飞成功回收助推器'), '科学与前沿');
  assert.equal(c('欧盟对某科技巨头处以 20 亿欧元反垄断罚款'), '商业与政策');
  assert.equal(c('微信上线新功能：聊天记录可跨设备同步'), '互联网');
});

test('英文标题，缩写区分大小写', () => {
  assert.equal(c('Samsung Galaxy Z TriFold review: three screens, one phone'), '数码');
  assert.equal(c('Nvidia unveils next-gen GPU for data centers'), '芯片与硬件');
  assert.equal(c('OpenAI raises $40 billion at a $300 billion valuation'), '商业与政策'); // 融资新闻：raises、valuation 压过 OpenAI
  assert.equal(c('OpenAI launches a new reasoning model for ChatGPT'), 'AI');
  assert.equal(c('Hackers breach a major retailer, exposing customer data'), '互联网');
  assert.equal(c('He said the plan was fine'), '其他'); // said、fine 这类普通词不能误中
  assert.equal(c('Tim raised his arm and shares a photo'), '其他');
});

test('判断不出来时用来源的默认门类，再没有就是“其他”', () => {
  assert.equal(c('今天的几件小事', '', '数码'), '数码');
  assert.equal(c('今天的几件小事'), '其他');
  assert.equal(c('A quiet day', '', '不存在的门类'), '其他');
});

test('来源门类在同分时起决定作用', () => {
  // “手机”（数码）和“芯片”（芯片与硬件）各 1 个，来自数码媒体时归数码
  assert.equal(c('新手机芯片曝光', '', '数码'), '数码');
  assert.equal(c('新手机芯片曝光', '', '芯片与硬件'), '芯片与硬件');
});
