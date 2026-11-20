class_name Nation
extends RefCounted
## A country (player, AI or the native pseudo-nation).

var id := ""
var name := ""
var short_name := ""
var color := Color.WHITE
var capital := ""
var is_native := false
var is_ai := true
var personality := "industrialist"
var treasury := 0.0
var tax_policy := "normal"
var research_funding := 1
var research_target := ""
var research_bank := 0.0          # research points not yet assigned to a tech
var research_progress := {}       # tech id -> points
var techs: Array = []             # researched tech ids
var debt_weeks := 0
var war_exhaustion := 0.0
var eliminated := false
var market_orders := {}           # res -> {"mode": "sell"/"buy", "amount": float}
var finance := {"income": {}, "expense": {}, "net": 0.0}   # last completed week
var finance_pending := {"income": {}, "expense": {}}       # accumulating current week
var finance_history: Array = []   # recent weekly net values
var ledger := {}                  # cumulative resource ledger: reason -> {res: amount}
var week_ledger := {}             # resources ledger of the current week
var last_week_ledger := {}        # resources ledger of last completed week
var econ_victory_weeks := 0
var hegemony_weeks := 0
var capital_lost_weeks := 0
var ai_memory := {}
var history: Array = []           # [{turn, treasury, industry, pop, army}]


func is_active() -> bool:
	return not is_native and not eliminated


func to_dict() -> Dictionary:
	return {
		"id": id, "name": name, "short_name": short_name, "color": color.to_html(false),
		"capital": capital, "is_native": is_native, "is_ai": is_ai, "personality": personality,
		"treasury": treasury, "tax_policy": tax_policy, "research_funding": research_funding,
		"research_target": research_target, "research_bank": research_bank,
		"research_progress": research_progress.duplicate(true), "techs": techs.duplicate(),
		"debt_weeks": debt_weeks, "war_exhaustion": war_exhaustion, "eliminated": eliminated,
		"market_orders": market_orders.duplicate(true), "finance": finance.duplicate(true),
		"finance_pending": finance_pending.duplicate(true), "finance_history": finance_history.duplicate(),
		"ledger": ledger.duplicate(true), "week_ledger": week_ledger.duplicate(true),
		"last_week_ledger": last_week_ledger.duplicate(true),
		"econ_victory_weeks": econ_victory_weeks, "hegemony_weeks": hegemony_weeks,
		"capital_lost_weeks": capital_lost_weeks, "ai_memory": ai_memory.duplicate(true),
		"history": history.duplicate(true),
	}


static func from_dict(d: Dictionary) -> Nation:
	var n := Nation.new()
	n.id = d["id"]
	n.name = d["name"]
	n.short_name = d.get("short_name", n.name)
	n.color = Color.html(d["color"])
	n.capital = d["capital"]
	n.is_native = bool(d["is_native"])
	n.is_ai = bool(d["is_ai"])
	n.personality = d["personality"]
	n.treasury = float(d["treasury"])
	n.tax_policy = d["tax_policy"]
	n.research_funding = int(d["research_funding"])
	n.research_target = d["research_target"]
	n.research_bank = float(d["research_bank"])
	n.research_progress = Ser.float_dict(d["research_progress"])
	n.techs = Array(d["techs"])
	n.debt_weeks = int(d["debt_weeks"])
	n.war_exhaustion = float(d["war_exhaustion"])
	n.eliminated = bool(d["eliminated"])
	n.market_orders = {}
	for r in d["market_orders"].keys():
		n.market_orders[r] = {"mode": d["market_orders"][r]["mode"], "amount": float(d["market_orders"][r]["amount"])}
	n.finance = Ser.finance(d["finance"])
	n.finance_pending = Ser.finance(d["finance_pending"])
	n.finance_history = Ser.float_array(d["finance_history"])
	n.ledger = Ser.nested_float_dict(d["ledger"])
	n.week_ledger = Ser.nested_float_dict(d["week_ledger"])
	n.last_week_ledger = Ser.nested_float_dict(d["last_week_ledger"])
	n.econ_victory_weeks = int(d["econ_victory_weeks"])
	n.hegemony_weeks = int(d["hegemony_weeks"])
	n.capital_lost_weeks = int(d["capital_lost_weeks"])
	n.ai_memory = d["ai_memory"]
	n.history = d["history"]
	return n
