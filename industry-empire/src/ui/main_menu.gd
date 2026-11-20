class_name MainMenu
extends Control
## Title screen: continue, new game (nation + difficulty), load, help, quit.

signal quit_to_desktop

var _body: VBoxContainer
var _pick_nation := "aster"
var _pick_diff := "normal"


func _ready() -> void:
	var deco := MenuBackdrop.new()
	deco.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(deco)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(560, 0)
	center.add_child(panel)
	_body = UI.vbox(10)
	panel.add_child(_body)
	_show_home()


func _show_home() -> void:
	UI.clear(_body)
	var t := UI.label("工业与帝国", 46, UI.ACCENT_2)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_body.add_child(t)
	var st := UI.label("INDUSTRY & EMPIRE · 离线单机大战略", 16, UI.MUTED)
	st.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_body.add_child(st)
	_body.add_child(UI.sep())
	var info := SaveSystem.slot_info("autosave")
	if not info.is_empty() and not info.get("over", false):
		_body.add_child(UI.button("继续游戏  ·  %s %s" % [info["nation"], info["date"]], func(): Session.load_slot("autosave")))
	_body.add_child(UI.button("新游戏", _show_new_game))
	_body.add_child(UI.button("读取存档", _show_load))
	_body.add_child(UI.button("游戏说明", _show_help))
	_body.add_child(UI.button("退出", func(): quit_to_desktop.emit()))
	var foot := UI.label("v%s · 无需联网 · 无广告" % GameState.GAME_VERSION, 14, UI.MUTED)
	foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_body.add_child(foot)


func _show_new_game() -> void:
	UI.clear(_body)
	_body.add_child(UI.title("选择你的国家"))
	var scen := GameData.scenario()
	var row := UI.hbox(10)
	_body.add_child(row)
	for nd in scen["nations"]:
		if not nd.get("playable", false):
			continue
		var v := UI.vbox(4)
		var nm := UI.label(nd["name"], 22, Color(nd["color"]).lightened(0.3))
		v.add_child(nm)
		v.add_child(UI.label(nd["desc"], 15, UI.MUTED, true))
		var pers: Dictionary = GameData.ai["personalities"].get(nd["personality"], {})
		v.add_child(UI.label("AI 性格：" + pers.get("name", ""), 14, UI.MUTED))
		var nid: String = nd["id"]
		var pick := UI.toggle("选择" if _pick_nation != nid else "✓ 已选择", _pick_nation == nid, func():
			_pick_nation = nid
			_show_new_game())
		v.add_child(pick)
		var c := UI.card(v, UI.PANEL_2 if _pick_nation != nid else UI.PANEL_2.lightened(0.06))
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.custom_minimum_size = Vector2(250, 0)
		row.add_child(c)
	_body.add_child(UI.label("难度", 18, UI.ACCENT_2))
	var drow := UI.hbox(8)
	for did in ["easy", "normal", "hard"]:
		var dd: Dictionary = GameData.ai["difficulty"][did]
		var b := UI.toggle(dd["name"], _pick_diff == did, func():
			_pick_diff = did
			_show_new_game(), 120)
		drow.add_child(b)
	_body.add_child(drow)
	var desc := {"easy": "AI 产出 -10%，至少 40 周内不会主动宣战。", "normal": "AI 与玩家规则完全相同，约 20 周后可能开战。", "hard": "AI 产出 +10%（同样消耗原料），更早、更积极地开战。"}
	_body.add_child(UI.label(desc[_pick_diff], 15, UI.MUTED, true))
	var brow := UI.hbox(8)
	brow.add_child(UI.button("返回", _show_home, 120))
	brow.add_child(UI.spacer())
	brow.add_child(UI.button("开始统治 ▶", func(): Session.new_game(_pick_nation, _pick_diff), 200))
	_body.add_child(brow)


func _show_load() -> void:
	UI.clear(_body)
	_body.add_child(UI.title("读取存档"))
	var any := false
	for slot in SaveSystem.SLOTS:
		var info := SaveSystem.slot_info(slot)
		if info.is_empty():
			continue
		any = true
		var nm: String = "自动存档" if slot == "autosave" else "存档 " + str(slot).substr(4)
		var txt := "%s  ·  %s  %s%s" % [nm, info["nation"], info["date"], "（已结束）" if info["over"] else ""]
		_body.add_child(UI.button(txt, func(): Session.load_slot(slot)))
	if not any:
		_body.add_child(UI.label("还没有任何存档。", 16, UI.MUTED))
	_body.add_child(UI.button("返回", _show_home))


func _show_help() -> void:
	UI.clear(_body)
	_body.add_child(UI.title("游戏说明"))
	var txt := UI.label(HelpText.TEXT, 15, UI.TEXT, true)
	var sc := UI.scroll(txt)
	sc.custom_minimum_size = Vector2(520, 380)
	_body.add_child(sc)
	_body.add_child(UI.button("返回", _show_home))


class MenuBackdrop:
	extends Control
	## Decorative low-poly map silhouette behind the menu.
	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), UI.SEA)
		var scen := GameData.scenario()
		var ms := Vector2(scen["map_size"][0], scen["map_size"][1])
		var k: float = max(size.x / ms.x, size.y / ms.y) * 1.05
		var off := (size - ms * k) * 0.5
		for p in scen["provinces"]:
			var poly := PackedVector2Array()
			for pt in p["polygon"]:
				poly.append(Vector2(pt[0], pt[1]) * k + off)
			var col := Color("3a4a3c")
			for n in scen["nations"]:
				if n["id"] == p["owner"]:
					col = Color(n["color"]).darkened(0.55)
			draw_colored_polygon(poly, col)
			poly.append(poly[0])
			draw_polyline(poly, Color(0, 0, 0, 0.4), 2.0)
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.35))
