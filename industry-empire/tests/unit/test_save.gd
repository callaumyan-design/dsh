extends "res://tests/test_case.gd"


func test_roundtrip_via_binary_encoding() -> void:
	var s := new_state(21)
	all_ai(s)
	run_weeks(s, 12)
	var bytes := var_to_bytes(s.to_dict())
	var s2 := GameState.from_dict(bytes_to_var(bytes))
	check_same_state(s2, s, "state identical after JSON round trip")


func test_save_load_file_and_continue_identically() -> void:
	var s := new_state(33)
	all_ai(s)
	run_weeks(s, 10)
	var r := SaveSystem.save(s, "test_slot")
	check(r["ok"], "save ok: " + str(r))
	var l := SaveSystem.load_state("test_slot")
	check(l["ok"], "load ok")
	var s2: GameState = l["state"]
	check_same_state(s2, s, "loaded world equals saved world")
	run_weeks(s, 15)
	run_weeks(s2, 15)
	check_same_state(s2, s, "loaded game continues exactly like the original (RNG state saved)")
	SaveSystem.delete("test_slot")


func test_corrupt_save_falls_back_to_backup() -> void:
	var s := new_state(4)
	SaveSystem.save(s, "test_corrupt")
	run_weeks(s, 1)
	SaveSystem.save(s, "test_corrupt")   # previous file becomes .bak
	var f := FileAccess.open("user://saves/test_corrupt.save", FileAccess.WRITE)
	f.store_string("garbage that is not a save")
	f.close()
	var l := SaveSystem.load_state("test_corrupt")
	check(l["ok"], "falls back to backup")
	check(l.get("used_backup", false), "reports that the backup was used")
	SaveSystem.delete("test_corrupt")


func test_newer_save_version_rejected() -> void:
	var s := new_state()
	var d := s.to_dict()
	d["save_version"] = 999
	check(SaveSystem.migrate(d) == null, "future save versions are refused")
