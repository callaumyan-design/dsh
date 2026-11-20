class_name MapCanvas
extends Control
## Base for the world map and city map: pan (drag), zoom (pinch / wheel /
## trackpad) and tap detection that ignores drags. Screen = world*zoom + offset.

signal tapped(world_pos: Vector2)
signal view_changed

var zoom := 1.0
var offset := Vector2.ZERO
var min_zoom := 0.3
var max_zoom := 4.0
var content_size := Vector2(1000, 1000)
var _touches := {}
var _pressed := false
var _dragging := false
var _press_pos := Vector2.ZERO
var _pinch_dist := 0.0
var _pinch_zoom := 1.0
var _fitted := false

const TAP_SLOP := 14.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	resized.connect(_on_resized)


func _on_resized() -> void:
	if not _fitted and size.x > 10.0:
		fit()
		_fitted = true
	else:
		clamp_view()
	queue_redraw()


func fit() -> void:
	if size.x <= 0.0:
		return
	zoom = clampf(min(size.x / content_size.x, size.y / content_size.y) * 0.96, min_zoom, max_zoom)
	min_zoom = min(min_zoom, zoom * 0.8)
	offset = (size - content_size * zoom) * 0.5
	queue_redraw()
	view_changed.emit()


func screen_to_world(p: Vector2) -> Vector2:
	return (p - offset) / zoom


func world_to_screen(p: Vector2) -> Vector2:
	return p * zoom + offset


func zoom_at(screen_pos: Vector2, factor: float) -> void:
	var before := screen_to_world(screen_pos)
	zoom = clampf(zoom * factor, min_zoom, max_zoom)
	offset = screen_pos - before * zoom
	clamp_view()
	queue_redraw()
	view_changed.emit()


func clamp_view() -> void:
	var cs := content_size * zoom
	var margin := size * 0.5
	offset.x = clampf(offset.x, size.x - cs.x - margin.x, margin.x)
	offset.y = clampf(offset.y, size.y - cs.y - margin.y, margin.y)


func center_on(world: Vector2) -> void:
	offset = size * 0.5 - world * zoom
	clamp_view()
	queue_redraw()


func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
			if _touches.size() == 2:
				var pts := _touches.values()
				_pinch_dist = (pts[0] as Vector2).distance_to(pts[1])
				_pinch_zoom = zoom
				_dragging = true
		else:
			_touches.erase(event.index)
	elif event is InputEventScreenDrag:
		_touches[event.index] = event.position
		if _touches.size() >= 2 and _pinch_dist > 1.0:
			var pts2 := _touches.values()
			var a: Vector2 = pts2[0]
			var b: Vector2 = pts2[1]
			var mid := (a + b) * 0.5
			var target := _pinch_zoom * a.distance_to(b) / _pinch_dist
			zoom_at(mid, target / zoom)
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			zoom_at(mb.position, 1.12)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			zoom_at(mb.position, 1.0 / 1.12)
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_pressed = true
				_dragging = false
				_press_pos = mb.position
			else:
				if _pressed and not _dragging and _touches.size() < 2:
					tapped.emit(screen_to_world(mb.position))
				_pressed = false
				_dragging = false
		accept_event()
	elif event is InputEventMouseMotion and _pressed:
		var mm := event as InputEventMouseMotion
		if not _dragging and mm.position.distance_to(_press_pos) > TAP_SLOP:
			_dragging = true
		if _dragging and _touches.size() < 2:
			offset += mm.relative
			clamp_view()
			queue_redraw()
			view_changed.emit()
		accept_event()
	elif event is InputEventMagnifyGesture:
		zoom_at(event.position, event.factor)
	elif event is InputEventPanGesture:
		offset -= event.delta * 24.0
		clamp_view()
		queue_redraw()
