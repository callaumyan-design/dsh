class_name LogPanel
extends RefCounted

const COLORS := {"war": UI.BAD, "battle": UI.WARN, "danger": UI.BAD, "tech": UI.INFO, "diplomacy": UI.ACCENT_2,
	"victory": UI.GOOD, "build": UI.GOOD, "event": UI.TEXT, "military": UI.TEXT, "info": UI.MUTED}


static func fill(gs: GameScreen, box: VBoxContainer, s: GameState) -> void:
	box.add_child(UI.label("战报", 18, UI.ACCENT_2))
	battle_reports(box, s, 8)
	box.add_child(UI.sep())
	box.add_child(UI.label("大事记", 18, UI.ACCENT_2))
	var shown := 0
	for i in range(s.events.size() - 1, -1, -1):
		var e: Dictionary = s.events[i]
		if not (e["nations"].is_empty() or e["nations"].has(s.player_nation) or e["type"] in ["war", "victory", "tech", "diplomacy"]):
			continue
		box.add_child(UI.label("[%s] %s" % [s.date_text(int(e["turn"])), e["text"]], 14, COLORS.get(e["type"], UI.TEXT), true))
		shown += 1
		if shown >= 80:
			break
	var ai_n := ""
	for nid in s.active_nations():
		if s.nations[nid].is_ai:
			ai_n = nid
	if ai_n != "":
		box.add_child(UI.sep())
		box.add_child(UI.label("情报：%s 本周动向" % s.nations[ai_n].short_name, 18, UI.ACCENT_2))
		var lg: Array = s.nations[ai_n].ai_memory.get("last_log", [])
		var visible := []
		for l in lg:
			# only public actions are reported (no market secrets)
			if str(l).begins_with("市场"):
				continue
			visible.append(l)
		box.add_child(UI.label("、".join(visible) if not visible.is_empty() else "暂无公开动向", 14, UI.MUTED, true))


static func battle_reports(box: VBoxContainer, s: GameState, count: int) -> void:
	if s.battle_reports.is_empty():
		box.add_child(UI.label("尚无战斗。", 14, UI.MUTED))
		return
	var shown := 0
	for i in range(s.battle_reports.size() - 1, -1, -1):
		var r: Dictionary = s.battle_reports[i]
		var involved: bool = r["attacker"] == s.player_nation or r["defender"] == s.player_nation
		var v := UI.vbox(2)
		v.add_child(UI.label("[%s] %s" % [s.date_text(int(r["turn"])), r["result"]], 15, UI.WARN if involved else UI.TEXT, true))
		v.add_child(UI.label("进攻方 %s：%.1f → %.1f 团 · 防守方 %s：%.1f → %.1f 团" % [s.nations[r["attacker"]].short_name, float(r["att_start"]), float(r["att_end"]),
			s.nations[r["defender"]].short_name, float(r["def_start"]), float(r["def_end"])], 13, UI.MUTED, true))
		var rounds: Array = r["rounds"]
		if not rounds.is_empty():
			var r0: Dictionary = rounds[0]
			var am: Dictionary = r0["att_mods"]
			var dm: Dictionary = r0["def_mods"]
			v.add_child(UI.label("首轮：进攻火力 %.1f（武器×%.2f 食品×%.2f 士气×%.2f 随机×%.2f）vs 防守韧性 %.1f；防守火力 %.1f（地形+%d%% 要塞+%d%%）" % [
				float(r0["att_fire"]), float(am["arms"]), float(am["food"]), float(am["morale"]), float(r0["att_rand"]), float(r0["def_tough"]),
				float(r0["def_fire"]), int(float(dm["terrain"]) * 100), int(float(dm["fort"]) * 100)], 12, UI.MUTED, true))
		box.add_child(UI.card(v))
		shown += 1
		if shown >= count:
			break
