// 每天北京时间 06:47 生成新一期（UTC 22:47）。也可以通过 POST /api/admin/run 手动触发。
import { app, output } from '@azure/functions';
import { runDaily } from '../lib/runtime.js';

const runQueue = output.storageQueue({ queueName: 'run-edition', connection: 'AzureWebJobsStorage' });

async function run(context, trigger) {
  const summary = await runDaily({ log: { error: (m) => context.error(m), warn: (m) => context.warn(m) } });
  context.log(`[${trigger}] 已生成 ${summary.date}：${JSON.stringify(summary)}`);
}

app.timer('daily', {
  schedule: '0 47 22 * * *',
  handler: (timer, context) => run(context, 'timer'),
});

// 手动触发：放进队列后立即返回，由队列触发的函数慢慢跑（HTTP 请求有 230 秒上限）
app.storageQueue('dailyFromQueue', {
  queueName: 'run-edition',
  connection: 'AzureWebJobsStorage',
  handler: (msg, context) => run(context, 'manual'),
});

app.http('adminRun', {
  route: 'admin/run',
  methods: ['POST'],
  authLevel: 'anonymous',
  extraOutputs: [runQueue],
  handler: async (request, context) => {
    const key = process.env.ADMIN_KEY;
    if (!key || request.headers.get('x-admin-key') !== key) return { status: 403, jsonBody: { error: '需要管理密钥' } };
    context.extraOutputs.set(runQueue, { requestedAt: new Date().toISOString() });
    return { status: 202, jsonBody: { ok: true, message: '已开始生成，几分钟后刷新查看' } };
  },
});
