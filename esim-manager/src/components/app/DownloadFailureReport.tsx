import { CardSim, ClipboardList, Usb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/session';
import type { Route } from '@/hooks/useRoute';

/**
 * 下载失败后的事后核对与建议。数据来自失败后自动执行的只读命令
 * （lpac profile list、lpac notification list）。
 */
export function DownloadFailureReport({ navigate }: { navigate: (r: Route, query?: string) => void }) {
  const report = useSession((s) => s.lastDownload);
  if (!report || report.ok) return null;
  const loadStage = report.failedStage === 'es10b_load_bound_profile_package';
  const noResult = loadStage && (report.error?.includes('unknown,unknown') ?? false);
  const installNotices = report.notificationsAfter?.filter((n) => n.operation === 'install') ?? [];
  const smdpStage = report.failedStage?.startsWith('es9p_') ?? false;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm" data-testid="download-report">
      <div className="flex items-center gap-2 font-medium">
        <ClipboardList className="size-4" /> 失败后的自动核对（只读）
      </div>
      <ul className="space-y-1.5">
        <li>
          卡上新出现的 Profile：
          {report.iccidsBefore === null ? (
            '下载前没有读取过列表，无法比较'
          ) : report.newProfiles.length > 0 ? (
            <span className="font-medium text-warning-foreground dark:text-warning">
              {report.newProfiles.map((p) => p.nickname ?? p.profileName ?? p.serviceProviderName ?? '未命名').join('、')}——虽然报告失败，卡上却出现了新 Profile，请去 Profiles 页面核对
            </span>
          ) : (
            '没有'
          )}
        </li>
        {loadStage && (
          <li>
            卡片记录的安装结果通知：
            {report.notificationsAfter === null ? '未能读取' : installNotices.length > 0 ? `${installNotices.length} 条（建议在 Profiles 页面发送给运营商，让 SM-DP+ 知道这次安装的结果）` : '没有'}
          </li>
        )}
      </ul>

      {noResult && (
        <div className="space-y-2">
          <p className="rounded-md border border-primary/20 bg-accent/50 p-2.5 text-foreground/90">
            已有一例实测：同一张卡、同一个激活码，在读卡器上（本应用和微信小程序都一样）停在这一步，换到安卓手机用 EasyEUICC 则安装成功。也就是说卡片和 Profile 都没问题，问题出在 eLPA 2.x 固件把 Profile 包写入卡片的环节。
            遇到这种情况，可以先用手机下载，再把卡插回读卡器，用本工具做启用、改名、删除等管理操作。
          </p>
          <div className="font-medium">建议的下一步</div>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <span className="text-foreground">先别连续重试。</span>第 6 步成功说明 SM-DP+ 已经把 Profile 包发了出来；有的服务商允许重复下载，有的会把激活码标记为“已下载”。重试前最好先问一下服务商。
            </li>
            <li>看看卡的剩余空间（仪表盘“剩余存储”）。有些卡空间不足时返回的不是标准结果，固件就只能报 unknown。</li>
            <li>
              用 USB 线把读卡器接到电脑，在“诊断 → USB 串口日志”里记录一次下载过程。固件会输出每一条 APDU 和卡片的状态字，能看出到底是哪一步、什么原因失败。
            </li>
            <li>如果手边有安卓手机（EasyEUICC / OpenEUICC 等）或 PC/SC 读卡器（lpac / EasyLPAC 等），把这张卡放进去用同一个激活码试一次：成功说明是读卡器固件的问题；失败也能拿到卡片给出的具体原因。</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => navigate('diagnostics', 'tab=serial')}>
              <Usb /> 打开 USB 串口日志
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('profiles')}>
              <CardSim /> 查看 Profiles
            </Button>
          </div>
        </div>
      )}
      {smdpStage && <p className="text-muted-foreground">这一步失败发生在与 SM-DP+ 通信时，卡片还没有被写入。常见原因：激活码已使用或过期、与这张卡的 EID 不匹配、读卡器网络不稳定。</p>}
    </div>
  );
}
