# 开发进度

最后更新：2026-11-20 · 版本 0.1.0 · 引擎 Godot 4.7.2-stable

## 已完成

- **Phase 0–5 全部功能已实现**，可从新游戏一直玩到胜利/失败画面（见 PLAN.md）。
- 模拟核心：GameData（含数据校验）、GameState 与实体、城市/经济/物流/军事/战斗/外交/科技/AI/事件/胜负/回合/存档共 14 个系统。
- 界面：主菜单（继续/新游戏/读档/说明）、世界地图（政治/资源/经济/军事四种视图）、城市建造（预览、旋转、确认、取消、撤销、道路拖铺、连通显示）、经济/军队/外交/科技/日志面板、详情侧栏、提示消息、结局画面、菜单存读档。
- Android：导出配置（无任何权限）、内置中文字体、横屏、折叠屏并排布局、后台自动暂停与存档、返回键处理。

## 实际执行的测试（本次会话）

| 测试 | 命令 | 结果 |
|---|---|---|
| 自动化单元/系统测试 | `tools/run_tests.sh` | **45 项全部通过，1916 个断言，约 48 秒** |
| UI 冒烟测试（真实界面全流程） | `godot --headless --path . res://tests/ui_smoke.tscn` | **20/20 通过** |
| AI 对 AI 长局模拟 | `tools/simulate.gd -- <seed> 250` | 种子 1：第 93 周阿斯特经济胜利（期间 3 次战争、2 次和约）；种子 3：第 90 周维尔德攻占首都军事胜利 |
| 导出包启动 | `--export-pack` 后用 `--main-pack` 在项目目录外启动 | 无脚本错误，主场景加载 |
| Android 导出 | `--export-debug "Android"`、`--export-release "Android arm64"` | 生成并签名成功：通用调试包 89 MB；arm64 发布模式包 29 MB（调试密钥签名） |
| APK 检查 | `apksigner verify`、`aapt dump badging` | 签名有效；包名 com.industryempire.game；minSdk 24 / targetSdk 36；**无 uses-permission（无网络权限）** |
| 截图检查 | `tools/screenshots.tscn`（Xvfb + llvmpipe） | 1600×720（手机横屏）与 1280×1024（折叠屏展开）两种布局渲染正常 |

需求第十五节测试对应：
1 同种子同结果 → `test_same_seed_same_world`；2 资源不足不能超产 → `test_production_limited_by_inputs`、`test_no_inputs_no_output`；
3 没钱不能建造 → `test_no_money_no_build`；4 建筑不重叠 → `test_placement_rules`；5 断路后物流更新 → `test_road_cut_disconnects_production`；
6 不凭空产出 → `test_world_goods_conservation`、`test_recipes_respected_every_week`；7 缺粮缺械削弱战力 → `test_unsupplied_army_weaker_and_attrition`、`test_front_supply_limited_by_road_capacity`；
8 AI 无免费资源 → `test_ai_money_and_goods_are_accounted`；9 占领后状态正确 → `test_occupation_transfers_control`；
10 读档一致 → `test_save_load_file_and_continue_identically`、`test_roundtrip_via_binary_encoding`；11 多回合无非法状态 → `test_long_run_has_no_illegal_state`；
12 完整一局 → `test_full_game_reaches_an_end`、`test_capital_capture_wins_war`、`test_player_defeat_when_capital_held`、`test_bankruptcy_collapse`；
13 Android 无网络 → **未在真机验证**（见下）。

## 已知问题 / 未验证事项

- **没有在 Android 真机或模拟器上运行过**：本环境无法访问 Google 的 Android SDK 下载源，也没有可用的模拟器镜像。APK 已成功构建并通过签名/清单检查，但触控手感、性能、飞行模式、后台恢复需在真机上确认。双指缩放代码已实现，但只在桌面上用鼠标/触控板路径测试过。
- APK 使用调试密钥签名，仅供测试安装；正式发布需替换为自己的发布密钥库。
- 平衡只经过 AI 对 AI 模拟调整，尚未经真人试玩。普通难度下 AI 约在第 30–40 周首次宣战。
- 信息完全公开：玩家可以看到敌方省份库存。
- 世界地图在详情面板展开后不会自动重新居中（可点“全图”）。
- 只有一个场景、两座可建设城市；多国家时胜负判定中的“对手”逻辑需要扩展。
- `tools/check.sh` 只能编译检查非 UI 脚本（UI 依赖自动加载单例），UI 由 `tests/ui_smoke.tscn` 覆盖。
- 新增的 GitHub Actions 测试工作流尚未在 GitHub 上实际运行过。

## 下一阶段任务

1. 真机测试并修正触控/字号/性能问题。
2. 新手引导与目标提示。
3. 基于真人试玩的数值平衡。
4. 动画与音效、战斗结果弹窗。
5. 按 PLAN.md 的扩展方向逐步加入新系统。
