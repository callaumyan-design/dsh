class_name MilitaryPanel
extends RefCounted


static func fill(gs: GameScreen, box: VBoxContainer, s: GameState) -> void:
	var me := s.player_nation
	var n: Nation = s.nations[me]
	box.add_child(UI.label("可征召人口 %d · 在役 %d 人 · 军队维护 ¥%s/周 · 武器库存 %s" % [MilitarySystem.manpower_available(s, me),
		MilitarySystem.men_in_service(s, me), UI.num(EconomySystem.army_upkeep(s, me), 1), UI.num(EconomySystem.nation_stock(s, me)["arms"])], 16, UI.TEXT, true))
	# recruitment
	box.add_child(UI.label("征兵", 18, UI.ACCENT_2))
	var provs := UI.hbox(4)
	var owned := []
	for pid in s.provinces_owned(me):
		if s.provinces[pid].controller == me:
			owned.append(pid)
	if gs.recruit_province == "" or not owned.has(gs.recruit_province):
		gs.recruit_province = n.capital if owned.has(n.capital) else (owned[0] if not owned.is_empty() else "")
	for pid in owned:
		provs.add_child(UI.toggle(s.provinces[pid].name, gs.recruit_province == pid, func():
			gs.recruit_province = pid
			gs._build_overlay(), 90))
	box.add_child(provs)
	if gs.recruit_province != "":
		var row := UI.hbox(6)
		for uid in GameData.unit_order:
			var ud: Dictionary = GameData.units[uid]
			var ok := MilitarySystem.recruit_province_ok(s, me, gs.recruit_province, uid)
			var v := UI.vbox(2)
			v.add_child(UI.label("%s %s" % [ud["glyph"], ud["name"]], 18, UI.ACCENT_2))
			v.add_child(UI.label("攻 %.1f 防 %.1f 士气 %.1f 速度 %.2f 攻城 %.1f" % [ud["attack"], ud["defense"], ud["max_morale"], ud["speed"], ud["siege"]], 13, UI.MUTED, true))
			v.add_child(UI.label("费用 %s · 人口 %d · 维护 ¥%s" % [GameData.cost_text(ud["cost"]), int(ud["manpower"]), UI.num(float(ud["upkeep"]), 1)], 13, UI.TEXT, true))
			v.add_child(UI.label("补给/周：食品 %.2f 武器 %.2f" % [float(ud["supply"]["food"]), float(ud["supply"]["arms"])], 13, UI.MUTED))
			v.add_child(UI.label(ud["desc"], 13, UI.MUTED, true))
			var b := UI.button("征召 1 团", func():
				Session.apply(Commands.recruit(Session.state, me, gs.recruit_province, uid, 1), "征召 1 团%s" % ud["name"]))
			b.disabled = not ok["ok"]
			v.add_child(b)
			if not ok["ok"]:
				v.add_child(UI.label(ok["reason"], 13, UI.WARN, true))
			var c := UI.card(v)
			c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(c)
		box.add_child(row)
	box.add_child(UI.sep())
	box.add_child(UI.label("部队", 18, UI.ACCENT_2))
	for a in s.armies_of(me):
		var v2 := UI.vbox(2)
		var h := UI.hbox()
		h.add_child(UI.label("%s · %s" % [a.name, s.provinces[a.province].name], 17, UI.TEXT))
		h.add_child(UI.spacer())
		h.add_child(UI.button("在地图上选中", func(): gs.select_army(a.id), 130, 40))
		v2.add_child(h)
		var mm := MilitarySystem.max_morale(s, a)
		var path_txt := ""
		if not a.path.is_empty():
			path_txt = " · 目标 " + s.provinces[a.path[-1]].name
		v2.add_child(UI.label("%s · %d 人 · 士气 %d%% · 补给 食%d%% 械%d%%%s" % [a.composition_text(), a.men(), int(a.morale / max(mm, 0.01) * 100),
			int(float(a.supply_ratio["food"]) * 100), int(float(a.supply_ratio["arms"]) * 100), path_txt], 14, UI.MUTED, true))
		box.add_child(UI.card(v2))
	if s.armies_of(me).is_empty():
		box.add_child(UI.label("没有部队！敌人随时可能入侵。", 15, UI.BAD))
	box.add_child(UI.sep())
	box.add_child(UI.label("军事对比", 18, UI.ACCENT_2))
	for nid in s.active_nations():
		box.add_child(UI.label("%s：战力 %s · %d 团" % [s.nations[nid].name, UI.num(MilitarySystem.nation_power(s, nid), 1), int(_regs(s, nid))], 15))
	box.add_child(UI.label("最近战报", 18, UI.ACCENT_2))
	LogPanel.battle_reports(box, s, 6)


static func _regs(s: GameState, nid: String) -> float:
	var t := 0.0
	for a in s.armies_of(nid):
		t += a.total_strength()
	return t
