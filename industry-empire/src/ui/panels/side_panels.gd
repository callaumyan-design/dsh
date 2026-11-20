class_name SidePanels
extends RefCounted
## Context panel contents for the selected province, army, building or city.


static func _head(gs: GameScreen, box: VBoxContainer, title: String, color := UI.ACCENT_2) -> void:
	var h := UI.hbox()
	h.add_child(UI.label(title, 22, color))
	h.add_child(UI.spacer())
	h.add_child(UI.button("×", gs.clear_selection, 44, 40))
	box.add_child(h)


static func _kv(g: GridContainer, k: String, v: String, col := UI.TEXT) -> void:
	g.add_child(UI.label(k, 15, UI.MUTED))
	g.add_child(UI.label(v, 15, col))


static func stock_grid(s: GameState, p: Province) -> GridContainer:
	var g := UI.grid(4)
	var cap := EconomySystem.storage_cap(s, p)
	for r in GameData.RESOURCE_IDS:
		var v := p.get_stock(r)
		g.add_child(UI.label(GameData.res_name(r), 15, UI.res_color(r).lightened(0.35)))
		g.add_child(UI.label("%s" % UI.num(v), 15, UI.WARN if v >= cap * 0.95 else UI.TEXT))
	return g


static func province(gs: GameScreen, box: VBoxContainer, s: GameState, p: Province) -> void:
	var owner: Nation = s.nations[p.owner]
	_head(gs, box, p.name, owner.color.lightened(0.35))
	var g := UI.grid(2)
	box.add_child(g)
	_kv(g, "归属", owner.name)
	if p.is_occupied():
		_kv(g, "控制者", s.nations[p.controller].name + "（占领中）", UI.BAD)
	_kv(g, "地形", "%s（行军 %.1f，防御 +%d%%）" % [GameData.terrain_def(p.terrain)["name"], WorldMapSystem.move_cost(s, p.id), int(float(GameData.terrain_def(p.terrain)["defense_bonus"]) * 100)])
	_kv(g, "乡村人口", UI.num(p.pop))
	var c := s.city_of(p.id)
	if c:
		_kv(g, "城市", "%s（人口 %s）" % [c.name, UI.num(c.pop)])
	_kv(g, "发展度 / 要塞", "%d / %d" % [p.development, p.fort])
	_kv(g, "稳定度", UI.num(p.stability), UI.GOOD if p.stability > 50 else UI.WARN)
	if p.damage > 0.01:
		_kv(g, "战争破坏", "%d%%" % int(p.damage * 100), UI.BAD)
	var outs := []
	for r in p.rural_output.keys():
		outs.append("%s %s" % [GameData.res_name(r), UI.num(float(p.last_output.get(r, p.rural_output[r])), 1)])
	_kv(g, "乡村产出/周", "，".join(outs) if not outs.is_empty() else "无")
	if not p.siege.is_empty():
		_kv(g, "围城", "%s %d%%" % [s.nations[p.siege["nation"]].short_name, int(p.siege["progress"])], UI.BAD)
	if not p.claim.is_empty():
		_kv(g, "和平并入", "%s，剩余 %d 周" % [s.nations[p.claim["nation"]].short_name, p.claim["weeks_left"]], UI.INFO)
	box.add_child(UI.label("库存（容量 %s）" % UI.num(EconomySystem.storage_cap(s, p)), 16, UI.ACCENT_2))
	box.add_child(stock_grid(s, p))
	var armies := s.armies_in(p.id)
	if not armies.is_empty():
		box.add_child(UI.label("驻军", 16, UI.ACCENT_2))
		for a in armies:
			var b := UI.button("%s · %s · %s" % [s.nations[a.nation].short_name, a.name, a.composition_text()], func(): gs.select_army(a.id))
			b.add_theme_font_size_override("font_size", 14)
			box.add_child(b)
	var me := s.player_nation
	box.add_child(UI.sep())
	if c and p.owner == me and p.controller == me:
		box.add_child(UI.button("进入城市建设 ▶", func(): gs.enter_city(c.id)))
	if p.owner == me and p.controller == me:
		box.add_child(UI.label("在此征兵", 16, UI.ACCENT_2))
		var row := UI.hbox(4)
		for uid in GameData.unit_order:
			var ok := MilitarySystem.recruit_province_ok(s, me, p.id, uid)
			var ud: Dictionary = GameData.units[uid]
			var b2 := UI.button("%s\n%s" % [ud["name"], GameData.cost_text(ud["cost"])], func():
				Session.apply(Commands.recruit(Session.state, me, p.id, uid, 1), "征召 1 团%s" % ud["name"]), 0, 60)
			b2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			b2.add_theme_font_size_override("font_size", 14)
			b2.disabled = not ok["ok"]
			b2.tooltip_text = ok["reason"] if not ok["ok"] else ud["desc"]
			row.add_child(b2)
		box.add_child(row)
		box.add_child(UI.label("可征召人口：%d" % MilitarySystem.manpower_available(s, me), 14, UI.MUTED))
	var claim := DiplomacySystem.can_claim(s, me, p.id)
	if s.nations[p.owner].is_native:
		if claim["ok"]:
			box.add_child(UI.button("和平并入（¥%d，%d 周）" % [int(claim["cost"]), int(GameData.bal("claims.weeks", 6))], func():
				Session.apply(Commands.claim_province(Session.state, me, p.id))))
		else:
			box.add_child(UI.label("和平并入：" + claim["reason"], 14, UI.MUTED, true))
		box.add_child(UI.label("也可派军队击败部落武装并围城征服。", 14, UI.MUTED, true))
	elif owner.is_active() and p.owner != me:
		box.add_child(UI.button("外交 / 宣战…", func(): gs._open_overlay("diplomacy")))


static func army(gs: GameScreen, box: VBoxContainer, s: GameState, a: Army) -> void:
	var n: Nation = s.nations[a.nation]
	_head(gs, box, a.name, n.color.lightened(0.35))
	var mine := a.nation == s.player_nation
	var g := UI.grid(2)
	box.add_child(g)
	_kv(g, "所属", n.name)
	_kv(g, "位置", s.provinces[a.province].name)
	_kv(g, "编制", a.composition_text())
	_kv(g, "兵力", "%d 人（%.1f 团）" % [a.men(), a.total_strength()])
	var mm := MilitarySystem.max_morale(s, a)
	box.add_child(UI.label("士气 %d%%" % int(a.morale / max(mm, 0.01) * 100), 15, UI.MUTED))
	box.add_child(UI.bar(a.morale, mm, UI.GOOD if a.morale > mm * 0.4 else UI.BAD))
	if mine or s.nations[a.nation].is_native == false:
		var need := a.weekly_need()
		var g2 := UI.grid(2)
		box.add_child(g2)
		_kv(g2, "每周需求", "食品 %s · 武器 %s" % [UI.num(need["food"], 1), UI.num(need["arms"], 1)])
		_kv(g2, "随军补给", "食品 %s · 武器 %s" % [UI.num(float(a.supply["food"]), 1), UI.num(float(a.supply["arms"]), 1)])
		var fr := float(a.supply_ratio.get("food", 1.0))
		var ar := float(a.supply_ratio.get("arms", 1.0))
		_kv(g2, "上周补给满足", "食品 %d%% · 武器 %d%%" % [int(fr * 100), int(ar * 100)], UI.GOOD if fr > 0.99 and ar > 0.99 else UI.BAD)
		if a.starving_weeks > 0:
			_kv(g2, "断粮", "%d 周（持续减员）" % a.starving_weeks, UI.BAD)
		var est := CombatSystem.side_factors(s, [a], a.province, false, 0.0)
		_kv(g2, "火力修正", "武器 ×%.2f · 食品 ×%.2f · 士气 ×%.2f" % [est["arms_f"], est["food_f"], est["morale_f"]])
	if not a.path.is_empty():
		var names := []
		for pid in a.path:
			names.append(s.provinces[pid].name)
		var cost := WorldMapSystem.move_cost(s, a.path[0])
		box.add_child(UI.label("行军：%s（下一站进度 %d%%）" % [" → ".join(names), int(a.move_progress / cost * 100)], 15, UI.INFO, true))
	if not mine:
		return
	box.add_child(UI.sep())
	box.add_child(UI.label("点击地图上的目标省份下达行军命令；点击敌军即进攻其所在省份。", 14, UI.MUTED, true))
	var row := UI.hbox(4)
	row.add_child(UI.button("停止", func(): Session.apply(Commands.stop_army(Session.state, a.nation, a.id)), 80))
	row.add_child(UI.button("拆分", func():
		var r := Commands.split_army(Session.state, a.nation, a.id)
		if Session.apply(r):
			gs.select_army(r["army_id"]), 80))
	if s.armies_in(a.province, a.nation).size() > 1:
		row.add_child(UI.button("合并", func():
			var r2 := Commands.merge_armies(Session.state, a.nation, a.province)
			if Session.apply(r2):
				gs.select_army(r2["army_id"]), 80))
	box.add_child(row)
	var row2 := UI.hbox(4)
	for uid in GameData.unit_order:
		if float(a.units.get(uid, 0.0)) >= 1.0:
			row2.add_child(UI.button("解散1团%s" % GameData.units[uid]["name"], func():
				Session.apply(Commands.disband(Session.state, a.nation, a.id, uid, 1.0), "已解散，士兵返乡"), 0, 40))
	box.add_child(row2)


static func building(gs: GameScreen, box: VBoxContainer, s: GameState, c: City, b: Building) -> void:
	var d: Dictionary = b.def()
	var h := UI.hbox()
	h.add_child(UI.label("%s %s" % [d["glyph"], d["name"]], 22, UI.ACCENT_2))
	h.add_child(UI.spacer())
	h.add_child(UI.button("×", func():
		gs.city_view.selected_building = 0
		gs.refresh(), 44, 40))
	box.add_child(h)
	box.add_child(UI.label(d["desc"], 14, UI.MUTED, true))
	var g := UI.grid(2)
	box.add_child(g)
	var connected := CitySystem.building_connected(c, b.id)
	_kv(g, "状态", b.status if b.status != "" else "—", UI.GOOD if b.status.begins_with("正常") else UI.WARN)
	_kv(g, "位置 / 尺寸", "(%d,%d) %d×%d" % [b.x, b.y, b.size().x, b.size().y])
	if d.get("needs_connection", false):
		_kv(g, "物流", "已连通仓库" if connected else "未连通！需道路接入仓库", UI.GOOD if connected else UI.BAD)
	if d["workers"] > 0:
		_kv(g, "工人", "%d / %d" % [b.workers, d["workers"]], UI.GOOD if b.workers >= d["workers"] else UI.WARN)
	if d.has("site"):
		_kv(g, "地块效率", "%d%%" % int(CitySystem.site_factor(c, b) * 100))
	if d["stage"] >= 0:
		_kv(g, "开工率", "%d%%" % int(b.activity * 100))
		var ins := []
		for r in b.last_in.keys():
			ins.append("%s %s" % [GameData.res_name(r), UI.num(float(b.last_in[r]), 1)])
		var outs := []
		for r in b.last_out.keys():
			outs.append("%s %s" % [GameData.res_name(r), UI.num(float(b.last_out[r]), 1)])
		if not ins.is_empty():
			_kv(g, "上周消耗", "，".join(ins))
		_kv(g, "上周产出", "，".join(outs) if not outs.is_empty() else "无")
		var nominal := []
		for r in d["inputs"].keys():
			nominal.append("%s%s" % [GameData.res_name(r), UI.num(float(d["inputs"][r]))])
		var nominal_o := []
		for r in d["outputs"].keys():
			nominal_o.append("%s%s" % [GameData.res_name(r), UI.num(float(d["outputs"][r]))])
		_kv(g, "标准配方", ("+".join(nominal) + " → " if not nominal.is_empty() else "") + "+".join(nominal_o))
	if int(d.get("housing", 0)) > 0:
		_kv(g, "人口容量", str(d["housing"]) if connected else "0（未连通）")
	if float(d.get("storage", 0)) > 0:
		_kv(g, "库存容量", "+%d / 每种资源" % int(d["storage"]))
	_kv(g, "维护费", "¥%s/周" % UI.num(float(d["upkeep"]), 1))
	if b.damage > 0.0:
		_kv(g, "损坏", "%d%%（每周自动修复）" % int(b.damage * 100), UI.BAD)
	box.add_child(UI.sep())
	var row := UI.hbox(6)
	if d["stage"] >= 0 or d["workers"] > 0:
		row.add_child(UI.button("停用" if b.enabled else "启用", func():
			Session.apply(Commands.toggle_building(Session.state, Session.state.player_nation, c.id, b.id)), 100))
	row.add_child(UI.button("拆除（退还 50% 材料）", func():
		if Session.apply(Commands.demolish(Session.state, Session.state.player_nation, c.id, b.id), "已拆除"):
			gs.city_view.selected_building = 0
			gs.refresh()))
	box.add_child(row)


static func city_summary(gs: GameScreen, box: VBoxContainer, s: GameState, c: City) -> void:
	var p: Province = s.provinces[c.province_id]
	box.add_child(UI.label(c.name, 22, UI.ACCENT_2))
	var g := UI.grid(2)
	box.add_child(g)
	var cap := CitySystem.housing_capacity(c)
	_kv(g, "人口 / 容量", "%s / %s" % [UI.num(c.pop), UI.num(cap)], UI.WARN if c.pop >= cap - 1 else UI.TEXT)
	var lt := int(c.stats.get("labor_total", 0))
	var lu := int(c.stats.get("labor_used", 0))
	var ld := int(c.stats.get("labor_demand", 0))
	_kv(g, "劳动力（已用/总数）", "%d / %d" % [lu, lt], UI.BAD if ld > lt else UI.TEXT)
	if ld > lt:
		_kv(g, "岗位缺工", "%d 人 → 建住宅" % (ld - lt), UI.BAD)
	_kv(g, "满意度", UI.num(c.satisfaction), UI.GOOD if c.satisfaction >= 55 else (UI.WARN if c.satisfaction >= 35 else UI.BAD))
	var fn := float(c.stats.get("food_need", 0.0))
	var fg := float(c.stats.get("food_got", 0.0))
	_kv(g, "口粮（上周）", "%s / %s" % [UI.num(fg, 1), UI.num(fn, 1)], UI.GOOD if fg >= fn - 0.01 else UI.BAD)
	_kv(g, "人口变化", UI.signed(float(c.stats.get("growth", 0.0)), 1))
	box.add_child(UI.label("城市库存（容量 %s / 种）" % UI.num(EconomySystem.storage_cap(s, p)), 16, UI.ACCENT_2))
	box.add_child(stock_grid(s, p))
	var prod: Dictionary = c.stats.get("produced", {})
	var cons: Dictionary = c.stats.get("consumed", {})
	box.add_child(UI.label("上周生产 / 消耗", 16, UI.ACCENT_2))
	var g2 := UI.grid(3)
	for r in GameData.RESOURCE_IDS:
		if float(prod.get(r, 0.0)) > 0.0 or float(cons.get(r, 0.0)) > 0.0:
			g2.add_child(UI.label(GameData.res_name(r), 15, UI.res_color(r).lightened(0.35)))
			g2.add_child(UI.label("+" + UI.num(float(prod.get(r, 0.0)), 1), 15, UI.GOOD))
			g2.add_child(UI.label("-" + UI.num(float(cons.get(r, 0.0)), 1), 15, UI.BAD))
	box.add_child(g2)
	var issues := []
	for bid in c.sorted_ids():
		var b: Building = c.buildings[bid]
		if b.type == "road" or b.status.begins_with("正常") or b.status == "":
			continue
		issues.append("%s：%s" % [b.def()["name"], b.status])
	if not issues.is_empty():
		box.add_child(UI.label("生产瓶颈", 16, UI.WARN))
		for t in issues.slice(0, 10):
			box.add_child(UI.label("· " + t, 14, UI.WARN, true))
