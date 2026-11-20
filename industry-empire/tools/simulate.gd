extends SceneTree
## AI-vs-AI balance simulation: godot --headless --path . -s res://tools/simulate.gd -- <seed> <weeks>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var seed_v := int(args[0]) if args.size() > 0 else 1
	var weeks := int(args[1]) if args.size() > 1 else 150
	var verbose := args.size() > 2
	GameData.load_all()
	var s := GameState.new_game("aster", seed_v)
	s.nations["aster"].is_ai = true
	var ev_idx := 0
	for w in range(weeks):
		TurnSystem.advance(s)
		while ev_idx < s.events.size():
			var e: Dictionary = s.events[ev_idx]
			ev_idx += 1
			if e["type"] in ["war", "diplomacy", "victory", "tech"] or (verbose and e["type"] in ["battle", "danger"]):
				print("  [%d] %s" % [e["turn"], e["text"]])
		if s.turn % 10 == 0 or not s.game_over.is_empty():
			for nid in ["aster", "veld"]:
				var n: Nation = s.nations[nid]
				var c := s.city_of(n.capital)
				var st := EconomySystem.nation_stock(s, nid)
				var bc := {}
				if c:
					for b in c.buildings.values():
						if b.type != "road":
							bc[b.type] = int(bc.get(b.type, 0)) + 1
				print("w%d %s ¥%d net%+.0f pop%d sat%d ind%.0f regs%.1f prov%d techs%d food%.0f arms%.0f steel%.0f coal%.0f iron%.0f | %s" % [
					s.turn, nid, n.treasury, float(n.finance.get("net", 0)), c.pop if c else 0, c.satisfaction if c else 0,
					EconomySystem.industry_index(s, nid), _regs(s, nid), s.provinces_owned(nid).size(), n.techs.size(),
					st["food"], st["arms"], st["steel"], st["coal"], st["iron"], str(bc)])
			if verbose:
				for nid in ["aster", "veld"]:
					print("   log ", nid, ": ", s.nations[nid].ai_memory.get("last_log", []))
		if not s.game_over.is_empty():
			print("GAME OVER: ", s.game_over)
			break
	quit(0)


func _regs(s: GameState, nid: String) -> float:
	var t := 0.0
	for a in s.armies_of(nid):
		t += a.total_strength()
	return t
