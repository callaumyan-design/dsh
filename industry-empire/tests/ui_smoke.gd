extends Node
## UI smoke test (run as a scene so autoloads exist):
##   godot --headless --path . res://tests/ui_smoke.tscn
## Drives the real UI: menu → new game → every screen → build → recruit →
## move → weeks → save/load → back to menu. Exits 0 on success.

var main: Control
var errors := 0


func _ready() -> void:
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await _frames(3)
	_check(main.get_child_count() >= 2, "menu shown")
	Session.new_game("aster", "normal", 77)
	await _frames(3)
	var gs: GameScreen = _find_game_screen()
	_check(gs != null, "game screen shown after new game")
	if gs == null:
		_finish()
		return
	gs.size = Vector2(1600, 720)
	# world map selection & side panel
	gs._on_province_tapped("p1")
	await _frames(2)
	_check(gs._side.visible, "province side panel visible")
	# every management overlay
	for key in ["economy", "military", "diplomacy", "tech", "log", "menu"]:
		gs._open_overlay(key)
		await _frames(1)
		_check(gs._over.visible and gs._over_body.get_child_count() > 1, "overlay %s built" % key)
	gs._open_overlay("")
	# map modes
	for m in ["resource", "economy", "military", "political"]:
		gs.world.map_mode = m
		gs.world.queue_redraw()
		await _frames(1)
	# city view, placement preview and building
	gs._nav("city")
	await _frames(2)
	_check(gs.view == "city" and gs.city_view.visible, "city view shown")
	var c: City = Session.state.cities[gs.city_id]
	var before := c.buildings.size()
	gs.city_view.start_place("farm")
	var site := CitySystem.find_site(c, "farm", 0)
	gs.city_view.ghost = Vector2i(site["x"], site["y"])
	gs._refresh_city_bar()
	gs._confirm_build()
	await _frames(1)
	_check(c.buildings.size() == before + 1, "farm placed through UI")
	gs.city_view.cancel_mode()
	gs.city_view.start_place("road")
	gs.city_view.road_start = Vector2i(20, 12)
	gs.city_view.road_end = Vector2i(20, 16)
	gs._refresh_city_bar()
	gs._confirm_roads()
	await _frames(1)
	var b: Building = c.building_at(11, 9)
	gs._on_building_tapped(b.id)
	gs.city_view.selected_building = b.id
	gs.refresh()
	await _frames(1)
	# recruit + move
	gs._nav("world")
	Session.apply(Commands.recruit(Session.state, "aster", "p1", "militia", 1))
	var army: Army = Session.state.armies_in("p1", "aster")[0]
	gs.select_army(army.id)
	gs._on_province_tapped("p4")
	await _frames(1)
	_check(not army.path.is_empty(), "army ordered to move via map tap")
	# time
	for i in range(6):
		Session.advance_week()
		await _frames(1)
	_check(Session.state.turn == 6, "six weeks advanced")
	Session.set_auto(true)
	await _frames(2)
	Session._notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	_check(not Session.auto_run, "auto-run stops when the app is paused")
	var t := Session.state.turn
	await _frames(5)
	_check(Session.state.turn == t, "no weeks pass while paused")
	# save / load
	_check(Session.save_slot("slot3")["ok"], "manual save")
	var fp := Session.state.fingerprint()
	_check(Session.load_slot("slot3"), "manual load")
	await _frames(2)
	_check(Session.state.fingerprint() == fp, "loaded state identical")
	gs = _find_game_screen()
	gs._on_game_end({"winner": "aster", "loser": "veld", "type": "economic", "reason": "测试", "turn": 6})
	await _frames(1)
	_check(gs._end.visible, "end screen shown")
	gs.exit_to_menu.emit()
	await _frames(2)
	_check(_find_game_screen() == null, "back to main menu")
	SaveSystem.delete("slot3")
	_finish()


func _find_game_screen() -> GameScreen:
	for ch in main.get_children():
		if ch is GameScreen and not ch.is_queued_for_deletion():
			return ch
	return null


func _frames(n: int) -> void:
	for i in range(n):
		await get_tree().process_frame


func _check(cond: bool, msg: String) -> void:
	print(("  ok   " if cond else "  FAIL ") + msg)
	if not cond:
		errors += 1


func _finish() -> void:
	print("UI smoke: %d failures" % errors)
	get_tree().quit(0 if errors == 0 else 1)
