class_name TechPanel
extends RefCounted


static func fill(gs: GameScreen, box: VBoxContainer, s: GameState) -> void:
	var me := s.player_nation
	var n: Nation = s.nations[me]
	var rp := TechnologySystem.weekly_points(s, me)
	box.add_child(UI.label("科研产出 %s 点/周（基础 + 城市人口 + 投入 ¥%d/周）· 储备 %s 点" % [UI.num(rp, 1), int(TechnologySystem.funding_cost(n)), UI.num(n.research_bank, 1)], 16, UI.TEXT, true))
	if n.research_target == "":
		box.add_child(UI.label("尚未选择研究方向，科研点数会先储备起来。", 15, UI.WARN))
	var cols := UI.hbox(10)
	box.add_child(cols)
	for branch in ["经济", "工业", "军事"]:
		var col := UI.vbox(8)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.add_child(UI.label(branch, 20, UI.ACCENT_2))
		for tid in GameData.tech_order:
			var t: Dictionary = GameData.techs[tid]
			if t["branch"] != branch:
				continue
			var v := UI.vbox(3)
			var done: bool = n.techs.has(tid)
			var can: bool = TechnologySystem.can_research(s, me, tid)
			var active: bool = n.research_target == tid
			v.add_child(UI.label(t["name"], 18, UI.GOOD if done else (UI.INFO if active else UI.TEXT)))
			v.add_child(UI.label(t["desc"], 13, UI.MUTED, true))
			var prog := float(n.research_progress.get(tid, 0.0))
			v.add_child(UI.bar(prog, float(t["cost"]), UI.GOOD if done else UI.INFO, 8))
			var reqs := []
			for r in t["requires"]:
				reqs.append(GameData.techs[r]["name"])
			var status := "已完成" if done else ("研究中 %d/%d" % [int(prog), int(t["cost"])] if active else ("%d 点" % int(t["cost"]) + ("（需：" + "、".join(reqs) + "）" if not reqs.is_empty() else "")))
			v.add_child(UI.label(status, 13, UI.TEXT))
			if not done:
				var b := UI.button("研究" if not active else "研究中…", func(): Session.apply(Commands.set_research(Session.state, me, tid)), 0, 40)
				b.disabled = not can or active
				v.add_child(b)
			col.add_child(UI.card(v, UI.PANEL_2.lightened(0.05) if active else UI.PANEL_2))
		cols.add_child(col)
