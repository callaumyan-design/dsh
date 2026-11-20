class_name SaveSystem
extends RefCounted
## Versioned local save files with atomic replacement:
## write <slot>.save.tmp → read back & verify → keep previous file as .bak → rename.
## Format: magic string, format version, metadata dictionary, state dictionary,
## all in Godot's binary Variant encoding (exact for floats and 64-bit ints, no
## objects allowed when reading), so a loaded game continues bit-for-bit.

const SAVE_DIR := "user://saves/"
const SLOTS := ["autosave", "slot1", "slot2", "slot3"]
const MAGIC := "INDUSTRY_EMPIRE_SAVE"


static func _path(slot: String) -> String:
	return SAVE_DIR + slot + ".save"


static func save(state: GameState, slot: String) -> Dictionary:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	var data := state.to_dict()
	var meta := {"save_version": GameState.SAVE_VERSION, "game_version": GameState.GAME_VERSION,
		"saved_at": Time.get_datetime_string_from_system(), "turn": state.turn, "date": state.date_text(),
		"nation": state.nations[state.player_nation].name, "over": not state.game_over.is_empty()}
	var path := _path(slot)
	var tmp := path + ".tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		return {"ok": false, "reason": "无法写入存档：%s" % error_string(FileAccess.get_open_error())}
	f.store_pascal_string(MAGIC)
	f.store_32(GameState.SAVE_VERSION)
	f.store_var(meta)
	f.store_var(data)
	f.flush()
	f.close()
	var check = _read(tmp)
	if check == null or int(check["data"].get("turn", -1)) != state.turn:
		DirAccess.remove_absolute(tmp)
		return {"ok": false, "reason": "存档校验失败"}
	if FileAccess.file_exists(path):
		var bak := path + ".bak"
		if FileAccess.file_exists(bak):
			DirAccess.remove_absolute(bak)
		DirAccess.rename_absolute(path, bak)
	var err := DirAccess.rename_absolute(tmp, path)
	if err != OK:
		return {"ok": false, "reason": "无法替换存档：%s" % error_string(err)}
	return {"ok": true, "reason": ""}


## Returns {"version", "meta", "data"} or null when missing/corrupt.
static func _read(path: String, meta_only := false) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null or f.get_length() < 8:
		return null
	if f.get_pascal_string() != MAGIC:
		return null
	var version := f.get_32()
	var meta = f.get_var(false)
	if typeof(meta) != TYPE_DICTIONARY:
		return null
	if meta_only:
		return {"version": version, "meta": meta, "data": {}}
	var data = f.get_var(false)
	if typeof(data) != TYPE_DICTIONARY or f.get_error() != OK:
		return null
	return {"version": version, "meta": meta, "data": data}


static func load_state(slot: String) -> Dictionary:
	var path := _path(slot)
	var r = _read(path)
	var used_backup := false
	if r == null:
		r = _read(path + ".bak")
		used_backup = r != null
	if r == null:
		return {"ok": false, "reason": "存档不存在或已损坏"}
	var d = migrate(r["data"])
	if d == null:
		return {"ok": false, "reason": "存档版本过新，无法读取"}
	var s := GameState.from_dict(d)
	return {"ok": true, "reason": "", "state": s, "used_backup": used_backup}


## Upgrades older save formats in place. Version 1 is current.
static func migrate(d: Dictionary) -> Variant:
	var v := int(d.get("save_version", 0))
	if v > GameState.SAVE_VERSION:
		return null
	# future: if v == 1: ...convert to 2...
	return d


static func has_save(slot: String) -> bool:
	return FileAccess.file_exists(_path(slot)) or FileAccess.file_exists(_path(slot) + ".bak")


static func slot_info(slot: String) -> Dictionary:
	var r = _read(_path(slot), true)
	if r == null:
		r = _read(_path(slot) + ".bak", true)
	if r == null:
		return {}
	var meta: Dictionary = r["meta"]
	return {"slot": slot, "saved_at": meta.get("saved_at", ""), "date": meta.get("date", ""),
		"nation": meta.get("nation", ""), "turn": int(meta.get("turn", 0)), "over": bool(meta.get("over", false))}


static func delete(slot: String) -> void:
	for suffix in ["", ".bak", ".tmp"]:
		if FileAccess.file_exists(_path(slot) + suffix):
			DirAccess.remove_absolute(_path(slot) + suffix)
