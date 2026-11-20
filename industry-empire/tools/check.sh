#!/bin/bash
# Compile-checks the project: loads every class and reports script errors.
cd "$(dirname "$0")/.."
G=${GODOT:-/home/user/tools/Godot_v4.7.2-stable_linux.x86_64}
printf 'extends SceneTree\nfunc _init():\n\tprint("CHECK_OK ", GameState, AISystem, TurnSystem, SaveSystem)\n\tquit(0)\n' > /tmp/claude-0/check_t.gd
cp /tmp/claude-0/check_t.gd tests/_check.gd
timeout 30 $G --headless --path . -s res://tests/_check.gd 2>&1 | grep -E "CHECK_OK|SCRIPT ERROR|at: |ERROR" | grep -v "Failed to load script\|gdscript_resource_format" | head -40
rm -f tests/_check.gd
