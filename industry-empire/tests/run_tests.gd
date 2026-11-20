extends SceneTree
## Headless test runner:
##   godot --headless --path . -s res://tests/run_tests.gd [-- filter]
## Exits with code 0 when every test passes, 1 otherwise.

const TEST_DIR := "res://tests/unit/"


func _init() -> void:
	var filter := ""
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		filter = args[0]
	GameData.load_all()
	if not GameData.errors.is_empty():
		print("DATA ERRORS: ", GameData.errors)
		quit(1)
		return
	var files := []
	var dir := DirAccess.open(TEST_DIR)
	for f in dir.get_files():
		if f.ends_with(".gd"):
			files.append(f)
	files.sort()
	var total := 0
	var failed := 0
	var checks := 0
	var t0 := Time.get_ticks_msec()
	for f in files:
		var script: GDScript = load(TEST_DIR + f)
		if script == null:
			print("FAIL could not load ", f)
			failed += 1
			continue
		for m in script.get_script_method_list():
			var name: String = m["name"]
			if not name.begins_with("test_"):
				continue
			if filter != "" and not (f + ":" + name).contains(filter):
				continue
			var inst = script.new()
			total += 1
			var t := Time.get_ticks_msec()
			inst.call(name)
			checks += inst.checks
			var ms := Time.get_ticks_msec() - t
			if inst.failures.is_empty():
				print("  PASS  %s :: %s  (%d checks, %d ms)" % [f, name, inst.checks, ms])
			else:
				failed += 1
				print("  FAIL  %s :: %s" % [f, name])
				for msg in inst.failures.slice(0, 12):
					print("        - ", msg)
	print("")
	print("%d tests, %d failed, %d checks, %.1f s" % [total, failed, checks, (Time.get_ticks_msec() - t0) / 1000.0])
	quit(0 if failed == 0 and total > 0 else 1)
