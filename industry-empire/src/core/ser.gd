class_name Ser
extends RefCounted
## Serialization helpers. JSON turns every number into a float, so loaders cast
## explicitly. 64-bit integers (RNG state) are stored as strings.

static func float_dict(d: Dictionary) -> Dictionary:
	var out := {}
	for k in d.keys():
		out[k] = float(d[k])
	return out


static func nested_float_dict(d: Dictionary) -> Dictionary:
	var out := {}
	for k in d.keys():
		out[k] = float_dict(d[k])
	return out


static func float_array(a: Array) -> Array:
	var out := []
	for v in a:
		out.append(float(v))
	return out


static func finance(d: Dictionary) -> Dictionary:
	var out := {"income": float_dict(d.get("income", {})), "expense": float_dict(d.get("expense", {}))}
	if d.has("net"):
		out["net"] = float(d["net"])
	return out


static func vec2(a: Array) -> Vector2:
	return Vector2(float(a[0]), float(a[1]))


static func canonical_json(v: Variant) -> String:
	return JSON.stringify(normalize_numbers(v), "", true, true)


## Converts every int to float recursively so that a value and its JSON
## round-trip produce identical canonical text.
static func normalize_numbers(v: Variant) -> Variant:
	match typeof(v):
		TYPE_INT:
			return float(v)
		TYPE_DICTIONARY:
			var out := {}
			for k in v.keys():
				out[str(k)] = normalize_numbers(v[k])
			return out
		TYPE_ARRAY:
			var arr := []
			for x in v:
				arr.append(normalize_numbers(x))
			return arr
	return v
