class_name DiplomacyPanel
extends RefCounted


static func fill(gs: GameScreen, box: VBoxContainer, s: GameState) -> void:
	var me := s.player_nation
	# pending proposals
	for pr in s.proposals:
		if pr["to"] != me:
			continue
		var v := UI.vbox(4)
		var desc := "提议签订贸易协定" if pr["type"] == "trade" else "提出和约：" + _terms_text(s, pr["terms"], pr["from"])
		v.add_child(UI.label("%s %s（%d 周内有效）" % [s.nations[pr["from"]].name, desc, int(pr["expires"]) - s.turn], 16, UI.ACCENT_2, true))
		var row := UI.hbox(6)
		var pid: int = pr["id"]
		row.add_child(UI.button("接受", func(): Session.apply(Commands.respond_proposal(Session.state, me, pid, true), "已接受"), 100))
		row.add_child(UI.button("拒绝", func(): Session.apply(Commands.respond_proposal(Session.state, me, pid, false), "已拒绝"), 100))
		v.add_child(row)
		box.add_child(UI.card(v, UI.PANEL_2.lightened(0.05)))
	for nid in s.active_nations():
		if nid == me:
			continue
		_nation_card(gs, box, s, me, nid)
	box.add_child(UI.sep())
	box.add_child(UI.label("中立地区", 18, UI.ACCENT_2))
	for pid in s.province_order:
		var p: Province = s.provinces[pid]
		if not s.nations[p.owner].is_native:
			continue
		var chk := DiplomacySystem.can_claim(s, me, pid)
		var h := UI.hbox()
		var garrison := 0.0
		for a in s.armies_in(pid, p.owner):
			garrison += a.total_strength()
		h.add_child(UI.label("%s（部落武装 %.1f 团%s）" % [p.name, garrison, "，" + s.nations[p.claim["nation"]].short_name + "并入中" if not p.claim.is_empty() else ""], 15, UI.TEXT, true))
		var b := UI.button("和平并入 ¥%d" % int(DiplomacySystem.claim_cost(s, pid)), func(): Session.apply(Commands.claim_province(Session.state, me, pid)), 160, 42)
		b.disabled = not chk["ok"]
		b.tooltip_text = chk["reason"]
		h.add_child(b)
		box.add_child(h)
	box.add_child(UI.sep())
	var prog := VictorySystem.progress(s, me)
	box.add_child(UI.label("霸权进度：控制省份 %d/%d（需 %d%%）· 科技 %d/%d · 已维持 %d/%d 周" % [prog["provinces"], prog["province_total"],
		int(float(GameData.bal("victory.hegemony.province_share", 0.85)) * 100), prog["techs"], prog["techs_needed"], prog["hegemony_weeks"], prog["hegemony_needed"]], 15, UI.INFO, true))


static func _terms_text(s: GameState, terms: Dictionary, from: String) -> String:
	if terms.get("type", "white") == "white":
		return "白色和平（恢复战前状态）"
	var parts := []
	for pid in terms.get("provinces", []):
		parts.append(s.provinces[pid].name)
	var t := ""
	if not parts.is_empty():
		t += "割让" + "、".join(parts) + "给" + s.nations[from].short_name
	if int(terms.get("reparations", 0)) > 0:
		t += ("，" if t != "" else "") + "赔款 %d" % int(terms["reparations"])
	return t


static func _nation_card(gs: GameScreen, box: VBoxContainer, s: GameState, me: String, nid: String) -> void:
	var n: Nation = s.nations[nid]
	var v := UI.vbox(6)
	var h := UI.hbox()
	h.add_child(UI.label(n.name, 22, n.color.lightened(0.35)))
	h.add_child(UI.spacer())
	var rel := s.get_relation(me, nid)
	h.add_child(UI.label("关系 %s" % UI.signed(rel), 18, UI.GOOD if rel > 20 else (UI.BAD if rel < -20 else UI.TEXT)))
	v.add_child(h)
	var pers: Dictionary = GameData.ai["personalities"].get(n.personality, {})
	v.add_child(UI.label("性格：%s · 国库约 ¥%d · 战力 %s · 省份 %d · 科技 %d" % [pers.get("name", "?"), int(round(n.treasury / 50.0) * 50),
		UI.num(MilitarySystem.nation_power(s, nid), 1), s.provinces_owned(nid).size(), n.techs.size()], 14, UI.MUTED, true))
	var tr := []
	for t in s.treaties:
		if (t["a"] == me and t["b"] == nid) or (t["a"] == nid and t["b"] == me):
			match t["type"]:
				"trade":
					tr.append("贸易协定")
				"truce":
					tr.append("停战（剩余 %d 周）" % (int(t["end"]) - s.turn))
				"reparations":
					tr.append("赔款 ¥%s/周（%s支付，剩 %d 周）" % [UI.num(float(t["per_week"]), 1), s.nations[t["a"]].short_name, int(t["weeks_left"])])
	v.add_child(UI.label("条约：" + ("、".join(tr) if not tr.is_empty() else "无"), 15))
	var w := s.find_war(me, nid)
	if w.is_empty():
		var row := UI.hbox(6)
		if s.has_treaty("trade", me, nid):
			row.add_child(UI.button("终止贸易协定", func(): Session.apply(Commands.cancel_trade(Session.state, me, nid)), 150))
		else:
			row.add_child(UI.button("提议贸易协定", func():
				var r := Commands.propose_trade(Session.state, me, nid)
				if r.get("ok", false):
					Session.apply(r, "对方接受了贸易协定" if r.get("accepted", false) else "")
				else:
					Session.apply(r), 150))
		v.add_child(row)
		v.add_child(UI.label("宣战（选择战争目标）：", 15, UI.ACCENT_2))
		var row2 := HFlowContainer.new()
		for pid in s.provinces_owned(nid):
			var chk := DiplomacySystem.can_declare_war(s, me, nid, pid)
			var b := UI.button("以%s为目标" % s.provinces[pid].name, func():
				Session.apply(Commands.declare_war(Session.state, me, nid, pid), "战争爆发！"), 0, 42)
			b.disabled = not chk["ok"]
			b.tooltip_text = chk["reason"]
			row2.add_child(b)
		v.add_child(row2)
		var chk2 := DiplomacySystem.can_declare_war(s, me, nid, n.capital)
		if not chk2["ok"]:
			v.add_child(UI.label(chk2["reason"], 14, UI.WARN, true))
	else:
		var score := DiplomacySystem.score_for(w, me)
		v.add_child(UI.label("战争中（目标：%s）· 战争分数 %s · 战斗 %d 场 · 我方厌战 %d" % [s.provinces[w["goal"]].name, UI.signed(score), int(w["battles"]), int(s.nations[me].war_exhaustion)], 16, UI.BAD, true))
		v.add_child(UI.bar(score + 100.0, 200.0, UI.GOOD if score >= 0 else UI.BAD, 10))
		v.add_child(UI.button("提出白色和平", func():
			var r := Commands.propose_peace(Session.state, me, nid, {"type": "white"})
			_peace_feedback(r)))
		# demands
		var occ := []
		for pid in s.provinces_owned(nid):
			if s.provinces[pid].controller == me and n.capital != pid:
				occ.append(pid)
		gs.peace_provinces = gs.peace_provinces.filter(func(x): return occ.has(x))
		v.add_child(UI.label("索取条件（只能索取已占领的省份）：", 15, UI.ACCENT_2))
		var row3 := HFlowContainer.new()
		for pid in occ:
			var on: bool = gs.peace_provinces.has(pid)
			row3.add_child(UI.toggle("%s（%d分）" % [s.provinces[pid].name, int(DiplomacySystem.peace_cost_province(s, pid))], on, func():
				if gs.peace_provinces.has(pid):
					gs.peace_provinces.erase(pid)
				else:
					gs.peace_provinces.append(pid)
				gs._build_overlay(), 0))
		if occ.is_empty():
			row3.add_child(UI.label("尚未占领可索取的省份。", 14, UI.MUTED))
		v.add_child(row3)
		var row4 := UI.hbox(6)
		row4.add_child(UI.label("赔款 %d" % gs.peace_reparations, 15))
		row4.add_child(UI.button("-100", func():
			gs.peace_reparations = max(0, gs.peace_reparations - 100)
			gs._build_overlay(), 70, 40))
		row4.add_child(UI.button("+100", func():
			gs.peace_reparations += 100
			gs._build_overlay(), 70, 40))
		v.add_child(row4)
		var terms := {"type": "demand", "provinces": gs.peace_provinces.duplicate(), "reparations": gs.peace_reparations}
		var chk3 := DiplomacySystem.validate_terms(s, w, me, terms)
		v.add_child(UI.label("条款需要 %d 分，当前 %d 分%s" % [int(ceil(float(chk3.get("cost", 0.0)))), int(score), "" if chk3["ok"] else "：" + chk3["reason"]], 14, UI.GOOD if chk3["ok"] else UI.WARN, true))
		var pb := UI.button("提出和约", func():
			var r2 := Commands.propose_peace(Session.state, me, nid, terms)
			if r2.get("accepted", false):
				gs.peace_provinces = []
				gs.peace_reparations = 0
			_peace_feedback(r2))
		pb.disabled = not chk3["ok"] or (gs.peace_provinces.is_empty() and gs.peace_reparations == 0)
		v.add_child(pb)
	box.add_child(UI.card(v))


static func _peace_feedback(r: Dictionary) -> void:
	if not r.get("ok", false):
		Session.apply(r)
	elif r.get("accepted", false):
		Session.apply(r, "对方接受了和约，战争结束。")
	else:
		Session.toast.emit(r.get("reason", "对方拒绝了提议"), "warn")
		Session.state_changed.emit()
