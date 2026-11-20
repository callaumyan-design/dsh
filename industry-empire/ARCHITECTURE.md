# 架构说明

## 总体分层

```
UI 层（src/ui, scenes）        —— 只读取 GameState、只通过 Commands 改变世界
   │  signals: Session.state_changed / week_advanced / toast / game_ended
Session（autoload）            —— 持有当前 GameState；周推进；自动存档；后台暂停
   │
Commands（src/systems/commands.gd）—— 玩家与 AI 共用的唯一“行动入口”，校验条件并支付真实成本
   │
模拟系统（src/systems/*，全部为无状态静态函数）
   │
领域数据（src/core/*）：GameState → Nation / Province / City / Building / Army / wars / treaties
   │
配置数据（data/*.json，由 GameData 加载并校验）
```

模拟核心不依赖任何场景节点，可在 `--headless` 下运行、测试和做 AI 对 AI 平衡模拟。

## 模块

| 模块 | 文件 | 职责 |
|---|---|---|
| GameData | core/game_data.gd | 加载 data/*.json、规范数值类型、数据校验（未知资源、负数、无产出的消耗、科技环、场景邻接等） |
| GameState | core/game_state.gd | 世界总状态、查询辅助、世界物资账本、序列化 |
| ScenarioLoader | core/scenario_loader.gd | 由场景数据构建新游戏（地块生成、预置道路与建筑、初始军队） |
| WorldMapSystem | systems/world_map_system.gd | 邻接、通行权、Dijkstra 寻路、省份价值 |
| CitySystem | systems/city_system.gd | 地块生成、占地/越界/地形校验、占用表、道路连通（BFS）、地块效率、AI 选址与补路 |
| EconomySystem | systems/economy_system.gd | 库存增减（唯一入口，写入账本）、劳动力分配、分阶段生产、人口与满意度、税收与维护、市场、财务周报 |
| LogisticsSystem | systems/logistics_system.gd | 省际运输：按优先级生成需求，沿受控、未被封锁的省份寻路，扣减道路容量 |
| MilitarySystem | systems/military_system.gd | 征兵与人口、补给消耗、断粮减员、士气、补员、行军、围城、占领、战后遣返 |
| CombatSystem | systems/combat_system.gd | 回合制战斗结算、撤退、战报、战争分数；不带随机的战力预估（供 AI/UI） |
| DiplomacySystem | systems/diplomacy_system.gd | 关系、宣战、战争分数与厌战、和约校验与执行、停战、赔款、贸易协定、提议、和平并入中立地 |
| TechnologySystem | systems/technology_system.gd | 科研点、研究进度、科技修正查询 `mod()` |
| AISystem | systems/ai_system.gd | Utility AI：分析→财政→科研→外交→建设→市场→军事 |
| VictorySystem | systems/victory_system.gd | 胜负判定（阈值全部配置化） |
| EventSystem | systems/event_system.gd | 种子随机事件（只影响金钱/满意度/士气/损坏，不凭空产生物资） |
| TurnSystem | systems/turn_system.gd | 固定顺序的每周结算 + 不变量检查 |
| SaveSystem | systems/save_system.gd | 版本化二进制存档、原子写入与备份恢复、版本迁移入口 |

## 关键数据结构

- **Province**：owner（法理所有者）与 controller（实际控制者）分离；`stock` 是该省唯一的物资库存，城市直接使用所在省份的库存——世界地图与城市地图不存在两套余额。
- **City**：`tiles`（PackedByteArray 地形码）、`buildings`（id → Building）；占用表 / 道路连通为派生数据，读档后重建。
- **Army**：各兵种的“团”数为浮点强度（伤亡逐步减少），随军补给缓冲（食品/武器），上周补给满足率，行军路径与进度。
- **wars / treaties / proposals**：简单记录字典（战争分数、停战、赔款、贸易协定、待玩家答复的 AI 提议）。

## 每周结算顺序（TurnSystem.advance）

| # | 阶段 | 说明 |
|---|---|---|
| 1 | AI 决策 | 每个 AI 国家通过 Commands 下达建造/征兵/行军/外交命令（玩家命令在两周之间随时下达） |
| 2 | 施工与修复 | 施工中的建筑剩余周数 −1；未被占领时修复损坏；清空本周撤销栈 |
| 3 | 省际物流 | 优先级：城市口粮 → 军队补给 → 工业原料 → 建材储备 → 运回首都；每条道路每周容量共享 |
| 4 | 生产 | 先乡村产出，再城市建筑按阶段 0（原料）→ 1（加工）→ 2（兵工）结算，每座建筑每周只生产一次 |
| 5 | 人口 | 消耗食品、增长/流失、满意度、乡村人口与稳定度 |
| 6 | 市场 | 首都按市场指令买卖，受市场容量、库存、国库与仓储限制 |
| 7 | 财政 | 税收、建筑维护、军队维护 |
| 8 | 科研 | 支付科研投入、累积研究点、完成科技 |
| 9 | 军队补给 | 消耗随军补给、断粮减员、士气恢复、补员 |
| 10 | 行军 | 按地形与速度推进，只能走相邻省份 |
| 11 | 战斗 | 同省敌对部队交战，失败方撤退或投降 |
| 12 | 围城与占领 | 无守军的敌方省份累积围城进度，满 100 后易手 |
| 13 | 外交 | 战争分数、厌战、关系漂移、停战到期、赔款、和平并入 |
| 14 | 随机事件 | 使用存档内的随机数状态 |
| 15 | 关账 | 生成财务周报、轮换物资账本、赤字计数 |
| 16 | 胜负判定 | |
| 17 | 周数 +1 | 随后 Session 自动存档 |

先物流后生产的原因：本周运到的原料本周即可使用；炼钢厂产出的钢铁可在同周被兵工厂使用（阶段顺序保证）。

## 物料守恒与反作弊

- 所有库存变化都经过 `EconomySystem.add_stock / remove_stock`（军队补给缓冲经 `MilitarySystem.add_supply`），并记入世界账本与国家账本。
- 测试断言：任意周期内「世界物资总量变化 == 账本合计」，且正向条目只来自 production / rural / market_buy / refund / transport_in / army_supply_in / captured_in。
- 生产按“开工率”同比消耗原料与产出：原料、劳动力、仓储任何一项不足都会按比例减产。
- AI 难度修正（ai.json）以“吞吐量”形式作用：同比增加原料消耗与产出，不会凭空造物。

## 战斗公式

每轮（每周最多 3 轮）：

```
火力 = Σ(团数 × 攻击 × (1+科技) × (1+兵种地形修正)) × 武器系数 × 食品系数 × 士气系数 × 随机(0.85~1.15)
韧性 = 平均防御 × (1 + 地形防御[守方] + 要塞×15%×(1−0.5×敌炮兵占比)[守方]) × 食品系数
损失(团) = 0.06 × 敌方火力 / 己方韧性        士气损失 = 0.04 + 0.9 × 损失/己方团数
武器系数 = 0.5 + 0.5×武器满足率    食品系数 = 0.7 + 0.3×食品满足率    士气系数 = 0.4 + 0.6×士气/最大士气
```

士气低于 0.2 的一方撤退到相邻己方省份（无路可退则投降）。所有系数写入战报，参数在 balance.json。

## AI（Utility AI）

- **经济**：计算含在建建筑的名义收支，对食品链、住宅（劳动力门槛）、基础材料、重工业、兵营、仓库打分；用 `CitySystem.find_site` 选址并自动补路；保留国库底线。
- **财政**：赤字时停科研、加税、裁撤民兵；富余时提高科研投入，满意度低时减税。
- **军事**：期望兵力 = 基础 × 性格 + 威胁 + 战争加成；用 `CombatSystem.estimate` 评估进攻目标（考虑地形、要塞、补给路线容量），胜算不足则防守最受威胁省份；断粮撤退；首都受威胁时回援。
- **外交**：贸易协定（内陆国家更看重市场容量）、和平并入或武力征服中立地、按兵力比与性格评估宣战（需要时先终止贸易协定）、按战争分数提出索地/赔款或白色和平。
- 性格（ai.json）只改变权重，不绕过任何规则。

## 存档

- 格式：魔数 + 格式版本 + 元数据字典 + 状态字典，均为 Godot 二进制 Variant 编码（浮点与 64 位随机数状态精确保存，读取时禁止对象反序列化）。
- 写入流程：写 `.tmp` → 读回校验 → 旧文件改名 `.bak` → `.tmp` 改名为正式文件；主文件损坏时自动回退到 `.bak`。
- 自动存档：每周结束、应用进入后台、关闭窗口时。手动存档：3 个存档位。
- 读档后的世界与存档前逐位相同，继续推进的结果也与未存档时完全一致（有测试）。

## Android 适配

- 渲染：GL Compatibility（OpenGL ES 3）。拉伸模式 canvas_items + expand，横屏（传感器横屏）。
- 宽度足够时详情面板与地图并排（手机横屏与折叠屏展开均可），管理面板从右侧覆盖。
- 触控：单指拖动/点击判定（拖动阈值 14px）、双指捏合缩放；按钮高度 ≥ 40–52 逻辑像素。
- `NOTIFICATION_APPLICATION_PAUSED / FOCUS_OUT` 时停止自动推进并存档；周推进有重入保护，恢复后不会重复结算。
- 不申请任何权限；无网络代码。
