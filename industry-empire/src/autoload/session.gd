extends Node
## Global game session: owns the current GameState, runs the week clock,
## autosaves and pauses itself when the app goes to the background.

signal state_changed
signal week_advanced(new_events: Array)
signal toast(text: String, kind: String)
signal game_ended(info: Dictionary)
signal session_started

const SPEEDS := [2.0, 1.0, 0.45]   # seconds per week for speed 1/2/3

var state: GameState = null
var auto_run := false
var speed_idx := 0
var _busy := false
var _timer := 0.0
var _seen_events := 0


func _ready() -> void:
	GameData.ensure_loaded()
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().set_auto_accept_quit(false)


func has_game() -> bool:
	return state != null


func player() -> Nation:
	return state.nations[state.player_nation] if state else null


func new_game(nation_id: String, difficulty: String, seed_v := -1) -> void:
	if seed_v < 0:
		seed_v = int(Time.get_unix_time_from_system()) % 1000000 + randi() % 1000
	state = GameState.new_game(nation_id, seed_v, difficulty)
	_seen_events = state.events.size()
	auto_run = false
	save_slot("autosave")
	session_started.emit()
	state_changed.emit()


func load_slot(slot: String) -> bool:
	var r := SaveSystem.load_state(slot)
	if not r["ok"]:
		toast.emit(r["reason"], "error")
		return false
	state = r["state"]
	_seen_events = state.events.size()
	auto_run = false
	if r.get("used_backup", false):
		toast.emit("主存档损坏，已从备份恢复", "warn")
	session_started.emit()
	state_changed.emit()
	return true


func save_slot(slot: String) -> Dictionary:
	if state == null:
		return {"ok": false, "reason": "没有进行中的游戏"}
	var r := SaveSystem.save(state, slot)
	if not r["ok"]:
		toast.emit(r["reason"], "error")
	return r


## Wraps a Commands result: shows the reason on failure, refreshes UI on success.
func apply(result: Dictionary, ok_text := "") -> bool:
	if not result.get("ok", false):
		toast.emit(result.get("reason", "操作失败"), "error")
		return false
	if ok_text != "":
		toast.emit(ok_text, "ok")
	elif result.get("reason", "") != "":
		toast.emit(result["reason"], "info")
	state_changed.emit()
	return true


func advance_week() -> void:
	if state == null or _busy or not state.game_over.is_empty():
		return
	_busy = true
	TurnSystem.advance(state)
	save_slot("autosave")
	var fresh := []
	for i in range(_seen_events, state.events.size()):
		var e: Dictionary = state.events[i]
		if e["nations"].is_empty() or e["nations"].has(state.player_nation) or e["type"] in ["war", "victory"]:
			fresh.append(e)
	_seen_events = state.events.size()
	_busy = false
	week_advanced.emit(fresh)
	state_changed.emit()
	if not state.game_over.is_empty():
		auto_run = false
		game_ended.emit(state.game_over)


func set_auto(on: bool) -> void:
	auto_run = on and state != null and state.game_over.is_empty()
	_timer = 0.0
	state_changed.emit()


func cycle_speed() -> void:
	speed_idx = (speed_idx + 1) % SPEEDS.size()
	state_changed.emit()


func _process(delta: float) -> void:
	if not auto_run or state == null or _busy:
		return
	_timer += delta
	if _timer >= SPEEDS[speed_idx]:
		_timer = 0.0
		advance_week()


func pause_and_save() -> void:
	auto_run = false
	if state != null:
		save_slot("autosave")


func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_PAUSED, NOTIFICATION_APPLICATION_FOCUS_OUT:
			# never let game time run in the background
			if auto_run or state != null:
				pause_and_save()
				state_changed.emit()
		NOTIFICATION_WM_CLOSE_REQUEST:
			pause_and_save()
			get_tree().quit()
