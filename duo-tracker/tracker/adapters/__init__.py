"""每个数据源一个独立 adapter。tracker 类 adapter 统一接口：

    NAME: str            来源名（与 model.STATUS_MAP 的键一致）
    REGION: str | None   该站数据默认地区（名称匹配时用来缩小候选）
    fetch(client, cfg) -> list[SourceItem]
"""
from . import (duoappcheck, duoappsupport, duodiscover, duoregistry, duotoday, foldhunt,
               iphoneapplicationlist, shipeiduo, xiaoxinnote)

TRACKERS = {
    m.NAME: m for m in (shipeiduo, xiaoxinnote, duotoday, foldhunt, duoappcheck, duoappsupport,
                        duoregistry, duodiscover, iphoneapplicationlist)
}
