// 线上运行环境：连接存储、执行每日流程。
import { azureStore } from './store.js';
import { createProvider } from './ai/index.js';
import { buildEdition } from './pipeline.js';
import { broadcast } from './push.js';

let storePromise;
export function getStore(env = process.env) {
  storePromise ??= azureStore(env.AzureWebJobsStorage).catch((err) => {
    storePromise = undefined; // 下次请求重试
    throw err;
  });
  return storePromise;
}

/** 生成今天这一期、保存、推送。返回一段摘要用于日志。 */
export async function runDaily({ store, env = process.env, log = console, now = new Date() } = {}) {
  store ??= await getStore(env);
  const ai = createProvider(env);
  const edition = await buildEdition({ ai, now, log });
  await store.putEdition(edition);
  const push = await broadcast(store, edition, { env, log });
  const failedSources = edition.sourceStatus.filter((s) => !s.ok).map((s) => `${s.name}（${s.error}）`);
  return {
    date: edition.date,
    stories: edition.stories.length,
    products: edition.products.length,
    github: edition.github.length,
    ai: edition.ai,
    aiErrors: edition.aiErrors,
    failedSources,
    push,
  };
}
