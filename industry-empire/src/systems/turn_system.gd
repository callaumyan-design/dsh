class_name TurnSystem
extends RefCounted
## Weekly simulation. The order below is fixed and documented in
## ARCHITECTURE.md; each phase runs exactly once per week.
##   1  AI decisions (same Commands API as the player)
##   2  construction progress & repairs
##   3  inter-province logistics (food, army supply, inputs, consolidation)
##   4  production (rural, then city buildings stage 0 → 1 → 2)
##   5  population: food consumption, growth, satisfaction, stability
##   6  market trade
##   7  finance: taxes and upkeep
##   8  research (funding paid here)
##   9  army supply consumption, attrition, morale, reinforcement
##  10  army movement
##  11  battles
##  12  sieges and occupation
##  13  war score, exhaustion, relations, treaties, claims
##  14  random events
##  15  close the books (finance report, ledgers, debt)
##  16  victory / defeat check
##  17  turn counter + 1


static func advance(state: GameState) -> Dictionary:
	if not state.game_over.is_empty():
		return {"ok": false, "reason": "游戏已结束"}
	var start_turn := state.turn
	AISystem.run(state)
	EconomySystem.advance_construction(state)
	LogisticsSystem.run(state)
	EconomySystem.run_production(state)
	EconomySystem.run_population(state)
	EconomySystem.run_market(state)
	EconomySystem.run_finance(state)
	TechnologySystem.run(state)
	MilitarySystem.run_supply(state)
	MilitarySystem.run_movement(state)
	CombatSystem.run(state)
	MilitarySystem.run_sieges(state)
	MilitarySystem.cleanup(state)
	DiplomacySystem.update_war_scores(state)
	DiplomacySystem.run(state)
	EventSystem.run(state)
	EconomySystem.finalize_week(state)
	VictorySystem.run(state)
	assert(state.turn == start_turn)
	state.turn += 1
	var problems := validate(state)
	for p in problems:
		push_error("State invariant violated: " + p)
	return {"ok": problems.is_empty(), "reason": "", "problems": problems}


## Invariant checks run after every week (cheap enough for production).
static func validate(state: GameState) -> PackedStringArray:
	var out := PackedStringArray()
	for pid in state.province_order:
		var p: Province = state.provinces[pid]
		for r in p.stock.keys():
			if float(p.stock[r]) < -0.0001:
				out.append("%s negative %s" % [pid, r])
		if not state.nations.has(p.owner) or not state.nations.has(p.controller):
			out.append("%s invalid owner/controller" % pid)
	for a: Army in state.armies.values():
		if not state.provinces.has(a.province):
			out.append("army %d in unknown province" % a.id)
		for r in a.supply.keys():
			if float(a.supply[r]) < -0.0001:
				out.append("army %d negative supply" % a.id)
		for u in a.units.keys():
			if float(a.units[u]) < -0.0001:
				out.append("army %d negative units" % a.id)
		if not a.path.is_empty() and not WorldMapSystem.are_adjacent(state, a.province, a.path[0]):
			out.append("army %d path not adjacent" % a.id)
	for c: City in state.cities.values():
		var seen := {}
		for b: Building in c.buildings.values():
			var r := b.rect()
			for y in range(r.position.y, r.end.y):
				for x in range(r.position.x, r.end.x):
					if not c.in_bounds(x, y):
						out.append("%s building %d out of bounds" % [c.id, b.id])
						continue
					var k := Vector2i(x, y)
					if seen.has(k):
						out.append("%s overlap at %d,%d" % [c.id, x, y])
					seen[k] = true
		if c.pop < 0.0:
			out.append("%s negative pop" % c.id)
	return out
