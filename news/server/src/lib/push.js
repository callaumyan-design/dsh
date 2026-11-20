// Web Push：每天新一期生成后，给开启了推送的设备发通知。
import * as webpush from 'web-push';

export function pushConfigured(env = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** 通知内容：今天的总览，没有就用头条标题。 */
export function notificationFor(edition) {
  const top = edition.stories?.[0]?.title;
  return {
    title: '今日科技要闻',
    body: edition.headline || top || '今天的科技新闻已更新',
    tag: `edition-${edition.date}`,
    url: `./#/day/${edition.date}`,
  };
}

/**
 * 发给所有订阅。失效的订阅（404/410）会被删除。
 * @returns {Promise<{sent: number, removed: number, failed: number}>}
 */
export async function broadcast(store, edition, { env = process.env, sender = webpush, log = console } = {}) {
  if (!pushConfigured(env)) return { sent: 0, removed: 0, failed: 0 };
  sender.setVapidDetails(env.VAPID_SUBJECT || 'mailto:noreply@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify(notificationFor(edition));
  const subs = await store.listPush();
  const result = { sent: 0, removed: 0, failed: 0 };
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sender.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 12 * 3600, urgency: 'normal' });
        result.sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await store.deletePush(sub.endpoint);
          result.removed++;
        } else {
          result.failed++;
          log.warn?.(`推送失败（HTTP ${err.statusCode ?? '?'}）`);
        }
      }
    }),
  );
  return result;
}
