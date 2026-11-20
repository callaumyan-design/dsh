extends Node
## Renders documentation screenshots of the real UI.
##   xvfb-run godot --path . --resolution 1600x720 res://tools/screenshots.tscn -- <out_dir> [prefix]

var out := "user://shots/"
var prefix := ""
var main: Control


func _ready() -> void:
	OS.low_processor_usage_mode = false
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	if args.size() > 1:
		prefix = args[1]
	DirAccess.make_dir_recursive_absolute(out)
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await _shot("01_menu")
	Session.new_game("aster", "normal", 2024)
	var s: GameState = Session.state
	s.nations["aster"].is_ai = true      # let the AI play a while for a lively world
	for i in range(30):
		TurnSystem.advance(s)
	s.nations["aster"].is_ai = false
	Session.state_changed.emit()
	await _frames(3)
	var gs: GameScreen = _gs()
	gs.world.fit()
	await _shot("02_world")
	gs._on_province_tapped("p7")
	await _shot("03_province")
	gs.world.map_mode = "resource"
	gs._build_modes()
	gs.clear_selection()
	await _shot("04_resource_map")
	gs.world.map_mode = "political"
	gs._build_modes()
	gs._nav("city")
	await _frames(2)
	var c: City = s.cities[gs.city_id]
	gs.city_view.start_place("steel_mill")
	var site := CitySystem.find_site(c, "steel_mill", 0)
	if not site.is_empty():
		gs.city_view.ghost = Vector2i(site["x"], site["y"])
	gs._refresh_city_bar()
	await _shot("05_city_place")
	gs.city_view.cancel_mode()
	var mill := 0
	for b in c.buildings.values():
		if b.type == "steel_mill":
			mill = b.id
	if mill != 0:
		gs.city_view.selected_building = mill
		gs.refresh()
	await _shot("06_city_building")
	for key in ["economy", "military", "diplomacy", "tech"]:
		gs._open_overlay(key)
		await _shot("07_" + key)
	gs._open_overlay("")
	gs._nav("world")
	# stage a war to show armies, sieges and paths
	s.set_relation("aster", "veld", 0)
	if not s.at_war("aster", "veld"):
		s.treaties = s.treaties.filter(func(t): return t["type"] != "truce")
		Commands.declare_war(s, "aster", "veld", "p8")
	s.nations["aster"].is_ai = true
	for i in range(6):
		TurnSystem.advance(s)
	s.nations["aster"].is_ai = false
	Session.state_changed.emit()
	await _frames(2)
	var mine := s.armies_of("aster")
	if not mine.is_empty():
		gs.select_army(mine[0].id)
	gs.world.fit()
	await _shot("08_war")
	gs._open_overlay("log")
	await _shot("09_log")
	get_tree().quit(0)


func _gs() -> GameScreen:
	for ch in main.get_children():
		if ch is GameScreen and not ch.is_queued_for_deletion():
			return ch
	return null


func _frames(n: int) -> void:
	for i in range(n):
		await get_tree().process_frame


func _shot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(out.path_join(prefix + name + ".png"))
	print("saved ", name)
