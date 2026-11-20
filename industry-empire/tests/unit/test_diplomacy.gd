extends "res://tests/test_case.gd"


func test_cannot_demand_unoccupied_land() -> void:
	var s := new_state()
	no_ai(s)
	s.set_relation("aster", "veld", 0.0)
	var w: Dictionary = DiplomacySystem.declare_war(s, "aster", "veld", "p8")["war"]
	w["battle_score"] = 50.0
	DiplomacySystem.update_war_scores(s)
	var r := DiplomacySystem.validate_terms(s, w, "aster", {"type": "demand", "provinces": ["p8"], "reparations": 0})
	check(not r["ok"], "unoccupied province cannot be demanded")
	MilitarySystem.occupy(s, s.provinces["p8"], "aster")
	DiplomacySystem.update_war_scores(s)
	r = DiplomacySystem.validate_terms(s, w, "aster", {"type": "demand", "provinces": ["p8"], "reparations": 0})
	check(r["ok"], "occupied province can be demanded: " + str(r))
	r = DiplomacySystem.validate_terms(s, w, "aster", {"type": "demand", "provinces": ["p7"], "reparations": 0})
	check(not r["ok"], "capital cannot be demanded")
	r = DiplomacySystem.validate_terms(s, w, "aster", {"type": "demand", "provinces": [], "reparations": 100000})
	check(not r["ok"], "reparations limited by war score")


func test_peace_cedes_and_truce_blocks_war() -> void:
	var s := new_state()
	no_ai(s)
	s.nations["veld"].is_ai = true
	s.set_relation("aster", "veld", 0.0)
	var w: Dictionary = DiplomacySystem.declare_war(s, "aster", "veld", "p8")["war"]
	MilitarySystem.occupy(s, s.provinces["p8"], "aster")
	w["battle_score"] = 40.0
	DiplomacySystem.update_war_scores(s)
	var r := Commands.propose_peace(s, "aster", "veld", {"type": "demand", "provinces": ["p8"], "reparations": 100})
	check(r["ok"] and r.get("accepted", false), "losing AI accepts justified demands: " + str(r))
	check_eq(s.provinces["p8"].owner, "aster", "province ceded")
	check(not s.at_war("aster", "veld"), "war over")
	check(s.has_treaty("truce", "aster", "veld"), "truce signed")
	check(not DiplomacySystem.can_declare_war(s, "aster", "veld", "p6")["ok"], "truce blocks new war")
	var rep := s.find_treaty("reparations", "veld", "aster")
	check(not rep.is_empty(), "reparations treaty created")


func test_ai_rejects_unjustified_peace() -> void:
	var s := new_state()
	no_ai(s)
	s.nations["veld"].is_ai = true
	s.set_relation("aster", "veld", 0.0)
	var w: Dictionary = DiplomacySystem.declare_war(s, "aster", "veld", "p8")["war"]
	w["battle_score"] = -30.0
	DiplomacySystem.update_war_scores(s)
	var r := Commands.propose_peace(s, "aster", "veld", {"type": "white"})
	check(r["ok"] and not r.get("accepted", true), "winning AI refuses white peace")
	check(s.at_war("aster", "veld"), "still at war")


func test_trade_agreement_effects() -> void:
	var s := new_state()
	no_ai(s)
	s.nations["veld"].is_ai = true
	var cap0: float = EconomySystem.market_capacity(s, "veld")
	var tax0: float = EconomySystem.tax_estimate(s, "veld")["city"]
	var r := Commands.propose_trade(s, "aster", "veld")
	check(r["ok"] and r.get("accepted", false), "landlocked AI accepts trade: " + str(r))
	check(EconomySystem.market_capacity(s, "veld") > cap0, "trade raises market capacity")
	check(EconomySystem.tax_estimate(s, "veld")["city"] > tax0, "trade raises tax income")
	check(not DiplomacySystem.can_declare_war(s, "aster", "veld", "p8")["ok"] or s.get_relation("aster", "veld") <= 30.0, "relation gate consistent")


func test_market_sells_only_existing_goods() -> void:
	var s := new_state()
	no_ai(s)
	set_stock(s, "p1", {"grain": 5.0})
	Commands.set_market_order(s, "aster", "grain", "sell", 50.0)
	var m0: float = s.nations["aster"].treasury
	EconomySystem.run_market(s)
	check_near(s.provinces["p1"].get_stock("grain"), 0.0, 0.0001, "sold only what existed")
	check_near(s.nations["aster"].treasury - m0, 5.0 * 1.5 * 0.8, 0.0001, "paid market price")


func test_peaceful_claim() -> void:
	var s := new_state()
	no_ai(s)
	var r := Commands.claim_province(s, "aster", "p5")
	check(r["ok"], "aster borders p5 via p2: " + str(r))
	var r2 := Commands.claim_province(s, "veld", "p5")
	check(not r2["ok"], "only one claimant at a time")
	run_weeks(s, int(GameData.bal("claims.weeks", 6)))
	check_eq(s.provinces["p5"].owner, "aster", "claim completed")
	check(s.armies_in("p5", "natives").is_empty(), "native garrison stands down")
