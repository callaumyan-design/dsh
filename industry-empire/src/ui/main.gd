extends Control
## Root: swaps between the main menu and the game screen.

var _screen: Control = null


func _ready() -> void:
	theme = UI.build_theme()
	var bg := ColorRect.new()
	bg.color = UI.BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	Session.session_started.connect(_show_game)
	_show_menu()


func _swap(c: Control) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen = c
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(c)


func _show_menu() -> void:
	var m := MainMenu.new()
	m.quit_to_desktop.connect(func(): get_tree().quit())
	_swap(m)


func _show_game() -> void:
	if _screen is GameScreen:
		(_screen as GameScreen).rebuild_all()
		return
	var g := GameScreen.new()
	g.exit_to_menu.connect(_show_menu)
	_swap(g)
