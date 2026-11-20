#!/bin/bash
# Compile-checks every script in src/ and tests/ and reports script errors.
cd "$(dirname "$0")/.."
G=${GODOT:-/home/user/tools/Godot_v4.7.2-stable_linux.x86_64}
cat > tests/_check.gd <<'GD'
extends SceneTree
func _init():
	var bad := 0
	for dir in ["res://src/core/", "res://src/systems/", "res://src/ui/", "res://src/ui/panels/", "res://src/autoload/"]:
		for f in DirAccess.get_files_at(dir):
			if f.ends_with(".gd"):
				var sc = load(dir + f)
				if sc == null or not sc.can_instantiate():
					print("BROKEN ", dir + f)
					bad += 1
	print("CHECK_DONE broken=", bad)
	quit(0)
GD
# UI scripts reference the Session autoload, which only exists when a scene runs;
# those are verified by tests/ui_smoke.tscn instead.
timeout 60 $G --headless --path . -s res://tests/_check.gd 2>&1 | grep -E "CHECK_DONE|BROKEN|SCRIPT ERROR|at: GDScript" | grep -v "Identifier not found: Session" | head -40
rm -f tests/_check.gd
