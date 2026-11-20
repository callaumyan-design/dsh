class_name EventSystem
extends RefCounted
## Seeded random events. They never create goods (only money, morale,
## satisfaction or damage) so material conservation is preserved.


static func run(state: GameState) -> void:
	var chance := GameData.balf("events.chance", 0.12)
	for nid in state.active_nations():
		if state.rng.randf() >= chance:
			continue
		var n: Nation = state.nations[nid]
		var c := state.city_of(n.capital)
		var roll := state.rng.randi_range(0, 4)
		var pid := n.capital
		match roll:
			0:
				var gift := 20.0 + state.rng.randf() * 30.0
				EconomySystem.earn(n, gift, "events")
				state.log_event("event", "外国商队来访，%s 获得 %d 金钱的关税。" % [n.short_name, int(gift)], [nid], pid)
			1:
				if c != null and c.province_id == n.capital and state.provinces[pid].controller == nid:
					c.satisfaction = min(100.0, c.satisfaction + 8.0)
					state.log_event("event", "%s 举办丰收节，居民满意度上升。" % c.name, [nid], pid)
			2:
				if c != null and state.provinces[pid].controller == nid:
					var loss := c.pop * 0.03
					c.pop = max(GameData.balf("population.min_pop", 20), c.pop - loss)
					state.log_event("event", "%s 爆发疫病，人口减少 %d。" % [c.name, int(loss)], [nid], pid)
			3:
				if c != null and state.provinces[pid].controller == nid:
					var cands := []
					for bid in c.sorted_ids():
						var b: Building = c.buildings[bid]
						if b.is_complete() and b.type != "road" and b.def()["stage"] >= 0:
							cands.append(b)
					if not cands.is_empty():
						var b2: Building = cands[state.rng.randi_range(0, cands.size() - 1)]
						b2.damage = min(0.9, b2.damage + 0.3)
						state.log_event("event", "%s 的%s发生火灾，受损 30%%（每周自动修复）。" % [c.name, b2.def()["name"]], [nid], pid)
			4:
				for a: Army in state.armies_of(nid):
					a.morale = min(MilitarySystem.max_morale(state, a), a.morale + 0.1)
				state.log_event("event", "%s 军中士气高涨。" % n.short_name, [nid], pid)
