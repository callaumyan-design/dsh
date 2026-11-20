class_name EconomyPanel
extends RefCounted


static func fill(gs: GameScreen, box: VBoxContainer, s: GameState) -> void:
	var me := s.player_nation
	var n: Nation = s.nations[me]
	# --- policy
	var pol := UI.hbox(6)
	pol.add_child(UI.label("税制", 17, UI.ACCENT_2))
	for k in ["low", "normal", "high"]:
		var td: Dictionary = GameData.balance["tax_policies"][k]
		pol.add_child(UI.toggle("%s ×%.2f" % [td["name"], float(td["mult"])], n.tax_policy == k, func():
			Session.apply(Commands.set_tax(Session.state, me, k)), 110))
	box.add_child(pol)
	var rf := UI.hbox(6)
	rf.add_child(UI.label("科研投入", 17, UI.ACCENT_2))
	var levels: Array = GameData.bal("research.funding_levels", [0])
	for i in range(levels.size()):
		rf.add_child(UI.toggle("¥%d/周" % int(levels[i]), n.research_funding == i, func():
			Session.apply(Commands.set_research_funding(Session.state, me, i)), 90))
	box.add_child(rf)
	box.add_child(UI.label("税率影响居民满意度；科研投入每 ¥%d 产生 1 点科研。" % int(GameData.balf("research.money_per_point", 5)), 14, UI.MUTED, true))
	box.add_child(UI.sep())
	# --- finance
	var fin := UI.hbox(20)
	var inc_box := UI.vbox(2)
	var exp_box := UI.vbox(2)
	inc_box.add_child(UI.label("上周收入", 17, UI.GOOD))
	exp_box.add_child(UI.label("上周支出", 17, UI.BAD))
	var inc: Dictionary = n.finance.get("income", {})
	var ex: Dictionary = n.finance.get("expense", {})
	for k in inc.keys():
		inc_box.add_child(UI.label("%s  ¥%s" % [UI.finance_name(k), UI.num(float(inc[k]), 1)], 15))
	for k in ex.keys():
		exp_box.add_child(UI.label("%s  ¥%s" % [UI.finance_name(k), UI.num(float(ex[k]), 1)], 15))
	inc_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	exp_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	fin.add_child(inc_box)
	fin.add_child(exp_box)
	box.add_child(fin)
	var proj := EconomySystem.projected_net(s, me)
	box.add_child(UI.label("国库 ¥%s · 上周净收入 %s · 预计下周经常性收支 %s（不含施工与贸易）" % [UI.num(n.treasury), UI.signed(float(n.finance.get("net", 0))), UI.signed(proj)], 16,
		UI.BAD if proj < 0 else UI.TEXT, true))
	if n.debt_weeks > 0:
		box.add_child(UI.label("⚠ 国库赤字已持续 %d 周：生产效率 -%d%%、满意度与士气下降。连续 %d 周且负债超过 %d 将导致政府崩溃！" % [
			n.debt_weeks, int(GameData.balf("bankruptcy.efficiency_penalty", 0.2) * 100), int(GameData.bal("bankruptcy.collapse_weeks", 16)), int(-GameData.balf("bankruptcy.collapse_debt", -500))], 15, UI.BAD, true))
	var prog := VictorySystem.progress(s, me)
	box.add_child(UI.label("经济胜利进度：工业指数 %d/%d · 国库 %d/%d · 已维持 %d/%d 周" % [int(prog["industry"]), int(prog["industry_target"]),
		int(prog["treasury"]), int(prog["treasury_min"]), prog["econ_weeks"], prog["econ_weeks_needed"]], 15, UI.INFO, true))
	box.add_child(UI.bar(prog["industry"], prog["industry_target"], UI.INFO, 8))
	box.add_child(UI.sep())
	# --- resources & market
	var cap := EconomySystem.market_capacity(s, me)
	box.add_child(UI.label("资源与市场（本国市场容量 %d 单位/周，卖价为基价 %d%%，买价 %d%%）" % [int(cap),
		int(GameData.balf("market.sell_ratio", 0.8) * 100), int(GameData.balf("market.buy_ratio", 1.3) * 100)], 17, UI.ACCENT_2, true))
	var stock := EconomySystem.nation_stock(s, me)
	var bal := EconomySystem.resource_balance(s, me)
	var g := UI.grid(7)
	for h in ["资源", "库存", "上周产出", "上周消耗", "基价", "市场指令", "操作"]:
		g.add_child(UI.label(h, 14, UI.MUTED))
	for r in GameData.RESOURCE_IDS:
		g.add_child(UI.label(GameData.res_name(r), 16, UI.res_color(r).lightened(0.35)))
		g.add_child(UI.label(UI.num(stock[r]), 15))
		g.add_child(UI.label("+" + UI.num(bal[r]["prod"], 1), 15, UI.GOOD))
		g.add_child(UI.label("-" + UI.num(bal[r]["cons"], 1), 15, UI.BAD))
		g.add_child(UI.label(UI.num(GameData.res_price(r), 1), 15, UI.MUTED))
		var o: Dictionary = n.market_orders.get(r, {})
		var ot := "—"
		if not o.is_empty():
			ot = ("卖 " if o["mode"] == "sell" else "买 ") + UI.num(float(o["amount"])) + "/周"
		g.add_child(UI.label(ot, 15, UI.INFO))
		var ops := UI.hbox(2)
		var cur := float(o.get("amount", 0.0))
		var mode: String = o.get("mode", "")
		ops.add_child(UI.button("卖+2", func(): Session.apply(Commands.set_market_order(Session.state, me, r, "sell", (cur if mode == "sell" else 0.0) + 2.0)), 58, 38))
		ops.add_child(UI.button("买+2", func(): Session.apply(Commands.set_market_order(Session.state, me, r, "buy", (cur if mode == "buy" else 0.0) + 2.0)), 58, 38))
		ops.add_child(UI.button("停", func(): Session.apply(Commands.set_market_order(Session.state, me, r, "none", 0.0)), 44, 38))
		g.add_child(ops)
	box.add_child(g)
	var used := float(n.ai_memory.get("market_used", 0.0))
	box.add_child(UI.label("上周市场成交 %s 单位。卖单只出售首都现有库存；买单受国库和仓储限制。" % UI.num(used, 1), 14, UI.MUTED, true))
	box.add_child(UI.sep())
	# --- logistics
	box.add_child(UI.label("上周省际运输", 17, UI.ACCENT_2))
	var log: Array = s.transport_log.get(me, [])
	var agg := {}
	for sh in log:
		if sh["from"] == sh["to"]:
			continue
		var key: String = "%s→%s %s" % [s.provinces[sh["from"]].name, s.provinces[sh["to"]].name, GameData.res_name(sh["res"])]
		if int(sh.get("army", 0)) != 0:
			key += "（军需）"
		agg[key] = float(agg.get(key, 0.0)) + float(sh["amount"])
	if agg.is_empty():
		box.add_child(UI.label("没有运输。", 14, UI.MUTED))
	var keys := agg.keys()
	keys.sort()
	for k in keys.slice(0, 24):
		box.add_child(UI.label("· %s  %s" % [k, UI.num(agg[k], 1)], 14))
	var g2 := UI.grid(2)
	for e in s.edges:
		var pa: Province = s.provinces[e["a"]]
		var pb: Province = s.provinces[e["b"]]
		if pa.controller == me or pb.controller == me:
			g2.add_child(UI.label("%s — %s" % [pa.name, pb.name], 14, UI.MUTED))
			var ok := LogisticsSystem.node_ok(s, me, pa.id) and LogisticsSystem.node_ok(s, me, pb.id)
			g2.add_child(UI.label("容量 %s/周%s" % [UI.num(LogisticsSystem.edge_capacity(s, me, e), 1), "" if ok else "（不可用）"], 14, UI.TEXT if ok else UI.BAD))
	box.add_child(UI.label("道路容量", 16, UI.ACCENT_2))
	box.add_child(g2)
