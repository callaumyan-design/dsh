class_name GameScreen
extends Control
## In-game screen: status bar, map views, context side panel, management
## overlays, time controls, toasts and the end-of-game screen.

signal exit_to_menu

const TOP_H := 58.0
const BOTTOM_H := 66.0

var view := "world"           # world | city
var city_id := ""
var selected_province := ""
var selected_army := 0
var selected_building := 0
var overlay := ""             # "" | economy | military | diplomacy | tech | log | menu
var peace_provinces: Array = []
var peace_reparations := 0
var recruit_province := ""

var world: WorldMapView
var city_view: CityView
var _top: PanelContainer
var _top_row: HBoxContainer
var _bottom: PanelContainer
var _bottom_row: HBoxContainer
var _side: PanelContainer
var _side_body: VBoxContainer
var _over: PanelContainer
var _over_body: VBoxContainer
var _modes: HBoxContainer
var _city_bar: PanelContainer
var _city_bar_body: VBoxContainer
var _toasts: VBoxContainer
var _end: PanelContainer
var _wide := true


func _ready() -> void:
	world = WorldMapView.new()
	add_child(world)
	world.province_tapped.connect(_on_province_tapped)
	world.army_tapped.connect(_on_army_tapped)
	city_view = CityView.new()
	city_view.visible = false
	add_child(city_view)
	city_view.building_tapped.connect(_on_building_tapped)
	city_view.preview_changed.connect(_refresh_city_bar)

	_modes = UI.hbox(4)
	add_child(_modes)
	_city_bar = PanelContainer.new()
	_city_bar_body = UI.vbox(4)
	_city_bar.add_child(_city_bar_body)
	_city_bar.visible = false
	add_child(_city_bar)

	_side = PanelContainer.new()
	var sb := UI.box(UI.PANEL, UI.BORDER, 0, 1)
	sb.content_margin_left = 14
	sb.content_margin_right = 10
	_side.add_theme_stylebox_override("panel", sb)
	_side_body = UI.vbox(6)
	_side.add_child(UI.scroll(_side_body))
	add_child(_side)
	_over = PanelContainer.new()
	var ob := UI.box(UI.PANEL, UI.BORDER, 10, 1)
	ob.content_margin_left = 14
	ob.content_margin_right = 14
	ob.content_margin_top = 12
	ob.content_margin_bottom = 12
	ob.shadow_color = Color(0, 0, 0, 0.5)
	ob.shadow_size = 12
	_over.add_theme_stylebox_override("panel", ob)
	_over_body = UI.vbox(8)
	_over.add_child(_over_body)
	_over.visible = false
	add_child(_over)

	_top = PanelContainer.new()
	_top.add_theme_stylebox_override("panel", UI.box(Color(UI.PANEL, 0.98), UI.BORDER, 0, 1))
	_top_row = UI.hbox(14)
	_top.add_child(_top_row)
	add_child(_top)
	_bottom = PanelContainer.new()
	_bottom.add_theme_stylebox_override("panel", UI.box(Color(UI.PANEL, 0.98), UI.BORDER, 0, 1))
	_bottom_row = UI.hbox(6)
	_bottom.add_child(_bottom_row)
	add_child(_bottom)

	_toasts = UI.vbox(4)
	_toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_toasts)
	_end = PanelContainer.new()
	_end.visible = false
	add_child(_end)

	resized.connect(_layout)
	Session.state_changed.connect(refresh)
	Session.toast.connect(show_toast)
	Session.week_advanced.connect(_on_week)
	Session.game_ended.connect(_on_game_end)
	rebuild_all()


func rebuild_all() -> void:
	var s: GameState = Session.state
	if s == null:
		return
	var cap: Province = s.provinces.get(s.nations[s.player_nation].capital)
	city_id = cap.city_id if cap else ""
	view = "world"
	selected_province = ""
	selected_army = 0
	overlay = ""
	_end.visible = false
	_build_bottom()
	_build_modes()
	_layout()
	refresh()
	if not s.game_over.is_empty():
		_on_game_end(s.game_over)


# ---------------------------------------------------------------- layout

func _layout() -> void:
	var w := size.x
	var h := size.y
	_wide = w >= 1180.0
	_top.position = Vector2.ZERO
	_top.size = Vector2(w, TOP_H)
	_bottom.position = Vector2(0, h - BOTTOM_H)
	_bottom.size = Vector2(w, BOTTOM_H)
	var side_w: float = clampf(w * 0.27, 340.0, 440.0)
	var map_rect := Rect2(0, TOP_H, w, h - TOP_H - BOTTOM_H)
	var side_on := _side_visible()
	if side_on and _wide:
		map_rect.size.x -= side_w
	_side.visible = side_on
	_side.position = Vector2(w - side_w, TOP_H)
	_side.size = Vector2(side_w, h - TOP_H - BOTTOM_H)
	var bar_h := 150.0
	world.position = map_rect.position
	world.size = map_rect.size
	# the city grid sits above its build toolbar so nothing is hidden
	city_view.position = map_rect.position
	city_view.size = Vector2(map_rect.size.x, max(200.0, map_rect.size.y - bar_h - 12.0))
	_modes.position = map_rect.position + Vector2(10, 10)
	_city_bar.position = Vector2(map_rect.position.x + 8, map_rect.end.y - bar_h - 8)
	_city_bar.size = Vector2(map_rect.size.x - 16, bar_h)
	var ow: float = w if not _wide else clampf(w * 0.62, 760.0, 980.0)
	ow = min(ow, w)
	_over.position = Vector2(w - ow, TOP_H)
	_over.size = Vector2(ow, h - TOP_H - BOTTOM_H)
	_toasts.position = Vector2(w * 0.5 - 260, TOP_H + 8)
	_toasts.size = Vector2(520, 10)
	_end.position = Vector2(w * 0.5 - 300, h * 0.5 - 200)
	_end.size = Vector2(600, 400)


func _side_visible() -> bool:
	if view == "city":
		return true
	return selected_province != "" or selected_army != 0


# ---------------------------------------------------------------- refresh

func refresh() -> void:
	var s: GameState = Session.state
	if s == null:
		return
	if selected_army != 0 and not s.armies.has(selected_army):
		selected_army = 0
	world.selected_province = selected_province
	world.selected_army = selected_army
	world.visible = view == "world"
	city_view.visible = view == "city"
	_modes.visible = view == "world"
	_city_bar.visible = view == "city"
	_build_top()
	_refresh_bottom_state()
	_build_side()
	if view == "city":
		var c: City = s.cities.get(city_id)
		if c and city_view.selected_building != 0 and not c.buildings.has(city_view.selected_building):
			city_view.selected_building = 0
		_refresh_city_bar()
	if overlay != "":
		_build_overlay()
	_layout()
	world.queue_redraw()
	city_view.queue_redraw()


func _build_top() -> void:
	UI.clear(_top_row)
	var s: GameState = Session.state
	var n: Nation = s.nations[s.player_nation]
	var chip := ColorRect.new()
	chip.color = n.color
	chip.custom_minimum_size = Vector2(14, 30)
	_top_row.add_child(chip)
	_top_row.add_child(UI.label(n.short_name, 20, UI.ACCENT_2))
	_top_row.add_child(UI.label(s.date_text(), 17, UI.MUTED))
	var net := float(n.finance.get("net", 0.0))
	var money := UI.label("¥%s (%s)" % [UI.num(n.treasury), UI.signed(net)], 18, UI.BAD if n.treasury < 0 else UI.TEXT)
	money.tooltip_text = "国库余额（上周净收入）"
	_top_row.add_child(money)
	var stock := EconomySystem.nation_stock(s, n.id)
	_top_row.add_child(UI.label("人口 %s" % UI.num(EconomySystem.total_population(s, n.id)), 17))
	_top_row.add_child(UI.label("食品 %s" % UI.num(stock["food"]), 17, UI.res_color("food").lightened(0.3)))
	_top_row.add_child(UI.label("武器 %s" % UI.num(stock["arms"]), 17, UI.res_color("arms").lightened(0.35)))
	var rt := "未选科研" if n.research_target == "" else "%s %d%%" % [GameData.techs[n.research_target]["name"], int(TechnologySystem.progress_ratio(n, n.research_target) * 100)]
	_top_row.add_child(UI.label("科研：" + rt, 17, UI.INFO if n.research_target != "" else UI.WARN))
	var war_txt := "和平"
	var war_col := UI.GOOD
	for w in s.wars:
		if w["attacker"] == n.id or w["defender"] == n.id:
			war_txt = "战争中 · 分数 %s" % UI.signed(DiplomacySystem.score_for(w, n.id))
			war_col = UI.BAD
	_top_row.add_child(UI.label(war_txt, 17, war_col))
	if not s.proposals.is_empty():
		_top_row.add_child(UI.button("外交提议 %d" % s.proposals.size(), func(): _open_overlay("diplomacy"), 0, 40))
	_top_row.add_child(UI.spacer())
	_top_row.add_child(UI.button("≡ 菜单", func(): _open_overlay("menu"), 96, 42))


func _build_bottom() -> void:
	UI.clear(_bottom_row)
	var nav := [["world", "世界"], ["city", "城市"], ["economy", "经济"], ["military", "军队"], ["diplomacy", "外交"], ["tech", "科技"], ["log", "日志"]]
	for item in nav:
		var key: String = item[0]
		var b := UI.button(item[1], func(): _nav(key), 96, 52)
		b.name = "nav_" + key
		_bottom_row.add_child(b)
	_bottom_row.add_child(UI.spacer())
	var sp := UI.button("速度 1", func(): Session.cycle_speed(), 92, 52)
	sp.name = "speed"
	_bottom_row.add_child(sp)
	var auto := UI.button("▶ 自动", func(): Session.set_auto(not Session.auto_run), 110, 52)
	auto.name = "auto"
	_bottom_row.add_child(auto)
	var nxt := UI.button("下一周 ▶", func(): Session.advance_week(), 140, 52)
	nxt.name = "next"
	_bottom_row.add_child(nxt)


func _refresh_bottom_state() -> void:
	for c in _bottom_row.get_children():
		if not (c is Button):
			continue
		var b := c as Button
		var on := false
		if b.name.begins_with("nav_"):
			var key := String(b.name).substr(4)
			on = (key == view and overlay == "") or key == overlay
		elif b.name == "auto":
			b.text = "‖ 暂停" if Session.auto_run else "▶ 自动"
			on = Session.auto_run
		elif b.name == "speed":
			b.text = "速度 %d" % (Session.speed_idx + 1)
		elif b.name == "next":
			b.disabled = not Session.state.game_over.is_empty()
		if on:
			b.add_theme_stylebox_override("normal", UI._box(UI.ACCENT.darkened(0.45), UI.ACCENT, 8, 2))
		else:
			b.remove_theme_stylebox_override("normal")


func _build_modes() -> void:
	UI.clear(_modes)
	for m in [["political", "政治"], ["resource", "资源"], ["economy", "经济"], ["military", "军事"]]:
		var key: String = m[0]
		var b := UI.toggle(m[1], world.map_mode == key, func():
			world.map_mode = key
			_build_modes()
			world.queue_redraw(), 70)
		b.custom_minimum_size.y = 44
		_modes.add_child(b)
	_modes.add_child(UI.button("全图", func(): world.fit(), 44, 44))


func _nav(key: String) -> void:
	match key:
		"world":
			overlay = ""
			view = "world"
		"city":
			overlay = ""
			_enter_city(city_id)
			return
		_:
			_open_overlay(key if overlay != key else "")
			return
	refresh()


func _open_overlay(kind: String) -> void:
	overlay = kind
	_over.visible = kind != ""
	if kind == "":
		refresh()
		return
	recruit_province = ""
	refresh()


func _enter_city(cid: String) -> void:
	var s: GameState = Session.state
	var c: City = s.cities.get(cid)
	if c == null:
		return
	var p: Province = s.provinces[c.province_id]
	if p.owner != s.player_nation or p.controller != s.player_nation:
		show_toast("只能管理本国控制的城市", "error")
		return
	city_id = cid
	view = "city"
	overlay = ""
	_over.visible = false
	city_view.set_city(cid)
	refresh()


# ---------------------------------------------------------------- input from views

func _on_province_tapped(pid: String) -> void:
	var s: GameState = Session.state
	if selected_army != 0 and pid != "" and s.armies.has(selected_army):
		var a: Army = s.armies[selected_army]
		if a.nation == s.player_nation and pid != a.province:
			var r := Commands.move_army(s, s.player_nation, a.id, pid)
			if Session.apply(r):
				show_toast("%s 向%s进军（%d 段路程）" % [a.name, s.provinces[pid].name, r["path"].size()], "ok")
			return
	selected_province = pid
	selected_army = 0
	refresh()


func _on_army_tapped(aid: int) -> void:
	var s: GameState = Session.state
	var a: Army = s.armies.get(aid)
	if a == null:
		return
	if selected_army != 0 and selected_army != aid and s.armies.has(selected_army) and s.armies[selected_army].nation == s.player_nation and a.nation != s.player_nation:
		# tapping an enemy army while ours is selected = attack its province
		_on_province_tapped(a.province)
		return
	selected_army = aid if selected_army != aid else 0
	selected_province = a.province if selected_army == 0 else ""
	refresh()


func _on_building_tapped(bid: int) -> void:
	selected_building = bid
	refresh()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_back()
		get_viewport().set_input_as_handled()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		_back()


func _back() -> void:
	if overlay != "":
		_open_overlay("")
	elif view == "city" and city_view.mode != "select":
		city_view.cancel_mode()
	elif selected_army != 0 or selected_province != "":
		selected_army = 0
		selected_province = ""
		refresh()
	elif view == "city":
		_nav("world")
	else:
		_open_overlay("menu")


# ---------------------------------------------------------------- side panel

func _build_side() -> void:
	UI.clear(_side_body)
	var s: GameState = Session.state
	var head := UI.hbox()
	_side_body.add_child(head)
	if view == "city":
		var c: City = s.cities.get(city_id)
		if c == null:
			return
		if city_view.selected_building != 0 and c.buildings.has(city_view.selected_building):
			SidePanels.building(self, _side_body, s, c, c.buildings[city_view.selected_building])
		else:
			SidePanels.city_summary(self, _side_body, s, c)
		return
	if selected_army != 0 and s.armies.has(selected_army):
		SidePanels.army(self, _side_body, s, s.armies[selected_army])
	elif selected_province != "":
		SidePanels.province(self, _side_body, s, s.provinces[selected_province])


func clear_selection() -> void:
	selected_army = 0
	selected_province = ""
	city_view.selected_building = 0
	refresh()


func select_army(aid: int) -> void:
	overlay = ""
	_over.visible = false
	view = "world"
	selected_army = aid
	selected_province = ""
	var a: Army = Session.state.armies.get(aid)
	if a:
		world.center_on(Session.state.provinces[a.province].center)
	refresh()


func enter_city(cid: String) -> void:
	_enter_city(cid)


# ---------------------------------------------------------------- city toolbar

func _refresh_city_bar() -> void:
	UI.clear(_city_bar_body)
	var s: GameState = Session.state
	if s == null or view != "city":
		return
	var c: City = s.cities.get(city_id)
	if c == null:
		return
	var p: Province = s.provinces[c.province_id]
	var n: Nation = s.nations[s.player_nation]
	# row 1: status / actions
	var row := UI.hbox(8)
	_city_bar_body.add_child(row)
	match city_view.mode:
		"place":
			var d: Dictionary = GameData.buildings[city_view.place_type]
			var chk := city_view.ghost_check()
			var info := "%s  %s" % [d["name"], GameData.cost_text(d["cost"])]
			if city_view.ghost.x >= 0:
				if chk["ok"]:
					var site := CitySystem.preview_site_factor(c, city_view.place_type, city_view.ghost.x, city_view.ghost.y, city_view.place_rot)
					info += "  ·  可以建造" + ("（地块效率 %d%%）" % int(site * 100) if d.has("site") else "")
				else:
					info += "  ·  " + chk["reason"]
			else:
				info += "  ·  点击地图选择位置"
			var cc := EconomySystem.check_cost(n, [p], d["cost"])
			if not cc["ok"]:
				info += "  ·  缺少：" + "、".join(cc["missing"])
			row.add_child(UI.label(info, 16, UI.GOOD if chk["ok"] and cc["ok"] else UI.WARN, true))
			if d.get("rotatable", false):
				row.add_child(UI.button("旋转", city_view.rotate_ghost, 96))
			var ok_b := UI.button("✓ 确认建造", _confirm_build, 140)
			ok_b.disabled = not chk["ok"] or not cc["ok"]
			row.add_child(ok_b)
			row.add_child(UI.button("× 取消", city_view.cancel_mode, 90))
		"road":
			var cells := city_view.road_cells()
			var newc := 0
			for cell in cells:
				if CitySystem.can_place(c, "road", cell.x, cell.y, 0)["ok"]:
					newc += 1
			var tip := "点击起点" if city_view.road_start.x < 0 else ("点击终点（L 形路线）" if city_view.road_end.x < 0 else "将新建 %d 格道路，花费 ¥%d 石材%d" % [newc, newc * 2, newc])
			row.add_child(UI.label("铺设道路：" + tip, 16, UI.TEXT, true))
			var go := UI.button("✓ 铺设", _confirm_roads, 110)
			go.disabled = newc == 0 or city_view.road_end.x < 0
			row.add_child(go)
			row.add_child(UI.button("× 取消", city_view.cancel_mode, 90))
		_:
			row.add_child(UI.label("%s · 选择建筑后点击地块预览；点击已有建筑查看详情。" % c.name, 16, UI.MUTED, true))
			row.add_child(UI.toggle("连通显示", city_view.show_links, func():
				city_view.show_links = not city_view.show_links
				city_view.queue_redraw()
				_refresh_city_bar(), 110))
			var und := UI.button("撤销", func(): Session.apply(Commands.undo_build(s, s.player_nation, city_id), "已撤销并全额退款"), 96)
			und.disabled = c.undo_stack.is_empty()
			row.add_child(und)
	# row 2: building palette
	var pal := UI.hbox(6)
	var sc := ScrollContainer.new()
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.custom_minimum_size = Vector2(0, 74)
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(pal)
	_city_bar_body.add_child(sc)
	for bid in GameData.building_order:
		var d2: Dictionary = GameData.buildings[bid]
		var t := "%s %s\n%s" % [d2["glyph"], d2["name"], GameData.cost_text(d2["cost"])]
		var on: bool = city_view.place_type == bid
		var key: String = bid
		var b := UI.toggle(t, on, func():
			if city_view.place_type == key:
				city_view.cancel_mode()
			else:
				city_view.start_place(key)
			_refresh_city_bar(), 128)
		b.custom_minimum_size.y = 66
		b.add_theme_font_size_override("font_size", 14)
		b.tooltip_text = d2["desc"]
		var affordable: bool = EconomySystem.check_cost(n, [p], d2["cost"])["ok"]
		if not affordable:
			b.add_theme_color_override("font_color", UI.MUTED)
		pal.add_child(b)


func _confirm_build() -> void:
	var s: GameState = Session.state
	var g := city_view.ghost
	var t := city_view.place_type
	var r := Commands.build(s, s.player_nation, city_id, t, g.x, g.y, city_view.place_rot)
	if Session.apply(r):
		var d: Dictionary = GameData.buildings[t]
		show_toast("开始建造%s（%d 周）" % [d["name"], d["build_weeks"]] if d["build_weeks"] > 0 else "%s 已建成" % d["name"], "ok")
		city_view.ghost = Vector2i(-1, -1)
		city_view.queue_redraw()
		_refresh_city_bar()


func _confirm_roads() -> void:
	var s: GameState = Session.state
	var cells := []
	var c: City = s.cities[city_id]
	for cell in city_view.road_cells():
		if CitySystem.can_place(c, "road", cell.x, cell.y, 0)["ok"]:
			cells.append(cell)
	var r := Commands.build_roads(s, s.player_nation, city_id, cells)
	if r["ok"]:
		Session.apply(r, "铺设了 %d 格道路" % r["built"])
	else:
		Session.apply(r)
	city_view.road_start = Vector2i(-1, -1)
	city_view.road_end = Vector2i(-1, -1)
	_refresh_city_bar()


# ---------------------------------------------------------------- overlays

func _build_overlay() -> void:
	UI.clear(_over_body)
	_over.visible = true
	var head := UI.hbox()
	var titles := {"economy": "国家经济", "military": "军队", "diplomacy": "外交", "tech": "科技", "log": "日志与战报", "menu": "菜单"}
	head.add_child(UI.title(titles.get(overlay, "")))
	head.add_child(UI.spacer())
	head.add_child(UI.button("×", func(): _open_overlay(""), 52, 44))
	_over_body.add_child(head)
	var body := UI.vbox(8)
	var sc := UI.scroll(body)
	_over_body.add_child(sc)
	var s: GameState = Session.state
	match overlay:
		"economy":
			EconomyPanel.fill(self, body, s)
		"military":
			MilitaryPanel.fill(self, body, s)
		"diplomacy":
			DiplomacyPanel.fill(self, body, s)
		"tech":
			TechPanel.fill(self, body, s)
		"log":
			LogPanel.fill(self, body, s)
		"menu":
			_fill_menu(body)


func _fill_menu(body: VBoxContainer) -> void:
	for i in range(1, 4):
		var slot := "slot%d" % i
		var info := SaveSystem.slot_info(slot)
		var txt := "保存到存档 %d" % i + ("（覆盖：%s %s）" % [info["nation"], info["date"]] if not info.is_empty() else "")
		body.add_child(UI.button(txt, func():
			if Session.save_slot(slot)["ok"]:
				show_toast("已保存到存档 %d" % i, "ok")
				_build_overlay()))
	body.add_child(UI.sep())
	for slot in SaveSystem.SLOTS:
		var info2 := SaveSystem.slot_info(slot)
		if info2.is_empty():
			continue
		var nm: String = "自动存档" if slot == "autosave" else "存档 " + str(slot).substr(4)
		body.add_child(UI.button("读取 %s · %s %s" % [nm, info2["nation"], info2["date"]], func(): Session.load_slot(slot)))
	body.add_child(UI.sep())
	body.add_child(UI.label(HelpText.TEXT, 15, UI.TEXT, true))
	body.add_child(UI.sep())
	body.add_child(UI.button("保存并返回主菜单", func():
		Session.pause_and_save()
		exit_to_menu.emit()))


# ---------------------------------------------------------------- notifications

func show_toast(text: String, kind := "info") -> void:
	var col: Color = {"ok": UI.GOOD, "error": UI.BAD, "warn": UI.WARN, "info": UI.INFO}.get(kind, UI.INFO)
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UI.box(Color(UI.PANEL, 0.96), col, 8, 2))
	var l := UI.label(text, 17, UI.TEXT, true)
	l.custom_minimum_size = Vector2(480, 0)
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toasts.add_child(p)
	while _toasts.get_child_count() > 4:
		var old := _toasts.get_child(0)
		_toasts.remove_child(old)
		old.queue_free()
	var tw := create_tween()
	tw.tween_interval(3.2)
	tw.tween_property(p, "modulate:a", 0.0, 0.5)
	tw.tween_callback(p.queue_free)


func _on_week(events: Array) -> void:
	var shown := 0
	for e in events:
		if shown >= 3:
			break
		if e["type"] in ["war", "battle", "tech", "danger", "diplomacy", "victory", "build"]:
			var kind := "warn" if e["type"] in ["war", "battle", "danger"] else "info"
			show_toast(e["text"], kind)
			shown += 1


func _on_game_end(info: Dictionary) -> void:
	var s: GameState = Session.state
	UI.clear(_end)
	_end.visible = true
	var v := UI.vbox(10)
	_end.add_child(v)
	var won: bool = info.get("winner", "") == s.player_nation
	var types := {"military": "军事", "economic": "经济", "hegemony": "综合霸权", "collapse": "国家崩溃"}
	var t := UI.label("胜利！" if won else "失败", 44, UI.ACCENT_2 if won else UI.BAD)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	v.add_child(UI.label("%s结局 · %s" % [types.get(info.get("type", ""), ""), s.date_text(int(info.get("turn", s.turn)))], 18, UI.MUTED))
	v.add_child(UI.label(info.get("reason", ""), 20, UI.TEXT, true))
	var n: Nation = s.nations[s.player_nation]
	v.add_child(UI.label("国库 ¥%d · 人口 %d · 省份 %d · 科技 %d · 工业指数 %d" % [int(n.treasury), int(EconomySystem.total_population(s, n.id)),
		s.provinces_owned(n.id).size(), n.techs.size(), int(EconomySystem.industry_index(s, n.id))], 16, UI.MUTED, true))
	var row := UI.hbox(8)
	row.add_child(UI.button("查看世界", func(): _end.visible = false, 140))
	row.add_child(UI.spacer())
	row.add_child(UI.button("返回主菜单", func(): exit_to_menu.emit(), 160))
	v.add_child(row)
	refresh()
