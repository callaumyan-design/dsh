#!/bin/bash
# Imports the project (refreshes the class cache) and runs the headless test suite.
# Usage: tools/run_tests.sh [filter]
cd "$(dirname "$0")/.."
G=${GODOT:-godot}
[ -x /home/user/tools/Godot_v4.7.2-stable_linux.x86_64 ] && G=${GODOT:-/home/user/tools/Godot_v4.7.2-stable_linux.x86_64}
"$G" --headless --path . --import >/dev/null 2>&1
"$G" --headless --path . -s res://tests/run_tests.gd -- "$@" 2>&1 | grep -v "^$" | grep -v "^Godot Engine"
exit ${PIPESTATUS[0]}
