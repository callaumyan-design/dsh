package io.github.callaumyan.aipet.pet

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sign

/**
 * 桌宠的“身体”：重力、被扔出去、弹跳、撞墙、粘在墙上、在地上走、手机倾斜时往下滑。
 * 坐标是桌宠悬浮窗左上角在屏幕上的位置（像素）。纯逻辑，方便在电脑上测试。
 */
class PetPhysics(private val dp: Float) {
    enum class Surface { FLOOR, AIR, WALL_LEFT, WALL_RIGHT, HELD, FLOAT }

    sealed class Event {
        /** 落地。speedDp：落地瞬间的速度（dp/秒）；bounced：是不是又弹起来了 */
        data class Landed(val speedDp: Float, val bounced: Boolean) : Event()
        data class HitWall(val left: Boolean, val speedDp: Float) : Event()
        data class StuckToWall(val left: Boolean) : Event()
        data class HitCeiling(val speedDp: Float) : Event()
        data object ArrivedAtTarget : Event()
        data object StoppedFloating : Event()
    }

    var x = 0f
    var y = 0f
    var vx = 0f
    var vy = 0f
    var surface = Surface.FLOOR
        private set

    /** 关掉重力 = 放哪儿就待哪儿（被扔出去会滑行一段然后停下） */
    var gravityOn = true

    // ---- 边界（由外部按屏幕和桌宠大小设置）----
    var minX = 0f
    var maxX = 0f
    var minY = 0f
    var floorY = 0f
    var clingLeftX = 0f
    var clingRightX = 0f

    /** 想走到的 x（null = 不走） */
    var walkTargetX: Float? = null
        private set
    var walkSpeed = 0f

    /** 在墙上爬：-1 往上，1 往下，0 不动 */
    var climbDir = 0
    var climbSpeed = 0f

    /** 手机倾斜带来的沿地面加速度（像素/秒²，正数往右） */
    var tiltAccel = 0f

    private val gravity get() = 3000f * dp
    private val bounceMin get() = 700f * dp
    private val stickMax get() = 1300f * dp

    val isOnWall get() = surface == Surface.WALL_LEFT || surface == Surface.WALL_RIGHT
    val isSettled: Boolean
        get() = when (surface) {
            Surface.FLOOR -> walkTargetX == null && abs(vx) < 1f &&
                (tiltAccel == 0f || (tiltAccel > 0f && x >= maxX) || (tiltAccel < 0f && x <= minX))
            Surface.WALL_LEFT, Surface.WALL_RIGHT -> climbDir == 0
            Surface.FLOAT -> true
            Surface.HELD -> true
            Surface.AIR -> false
        }

    fun place(px: Float, py: Float, s: Surface) {
        x = px; y = py; vx = 0f; vy = 0f
        surface = s
        walkTargetX = null
        climbDir = 0
        clamp()
    }

    fun grab() {
        surface = Surface.HELD
        vx = 0f; vy = 0f
        walkTargetX = null
        climbDir = 0
    }

    fun dragTo(px: Float, py: Float) {
        x = px; y = py
    }

    /** 松手：带着手指的速度飞出去（像素/秒） */
    fun release(vxPx: Float, vyPx: Float) {
        val max = 5000f * dp
        val sp = hypot(vxPx, vyPx)
        val k = if (sp > max) max / sp else 1f
        vx = vxPx * k
        vy = vyPx * k
        surface = if (gravityOn) Surface.AIR else Surface.FLOAT
        clamp()
    }

    /** 自己跳一下（dp/秒，vy 负数向上） */
    fun jump(vxDp: Float, vyDp: Float) {
        if (surface == Surface.HELD) return
        vx = vxDp * dp
        vy = vyDp * dp
        walkTargetX = null
        climbDir = 0
        surface = if (gravityOn) Surface.AIR else Surface.FLOAT
    }

    fun walkTo(targetX: Float, speedDp: Float) {
        if (surface != Surface.FLOOR && surface != Surface.FLOAT) return
        walkTargetX = targetX.coerceIn(minX, maxX)
        walkSpeed = speedDp * dp
    }

    fun stopWalking() {
        walkTargetX = null
    }

    /** 从墙上下来（松开，掉下去） */
    fun letGoOfWall() {
        if (!isOnWall) return
        val left = surface == Surface.WALL_LEFT
        x = if (left) minX else maxX
        vx = (if (left) 120f else -120f) * dp
        vy = 0f
        climbDir = 0
        surface = if (gravityOn) Surface.AIR else Surface.FLOAT
    }

    fun stickToWall(left: Boolean) {
        surface = if (left) Surface.WALL_LEFT else Surface.WALL_RIGHT
        x = if (left) clingLeftX else clingRightX
        vx = 0f; vy = 0f
        walkTargetX = null
    }

    /** 屏幕大小变了（比如转屏）后，把桌宠挪回屏幕里 */
    fun clamp() {
        when (surface) {
            Surface.FLOOR -> { y = floorY; x = x.coerceIn(minX, maxX) }
            Surface.WALL_LEFT -> { x = clingLeftX; y = y.coerceIn(minY, floorY) }
            Surface.WALL_RIGHT -> { x = clingRightX; y = y.coerceIn(minY, floorY) }
            else -> { x = x.coerceIn(minX, maxX); y = y.coerceIn(minY, floorY) }
        }
    }

    fun step(dtRaw: Float): List<Event> {
        val dt = dtRaw.coerceIn(0f, 0.05f)
        val events = ArrayList<Event>(2)
        when (surface) {
            Surface.HELD -> Unit
            Surface.AIR -> stepAir(dt, events)
            Surface.FLOAT -> stepFloat(dt, events)
            Surface.FLOOR -> stepFloor(dt, events)
            Surface.WALL_LEFT, Surface.WALL_RIGHT -> stepWall(dt, events)
        }
        return events
    }

    private fun stepAir(dt: Float, events: MutableList<Event>) {
        vy += gravity * dt
        vx *= exp(-0.4f * dt)
        x += vx * dt
        y += vy * dt
        if (y < minY) {
            y = minY
            events += Event.HitCeiling(abs(vy) / dp)
            vy = abs(vy) * 0.3f
        }
        if (x <= minX || x >= maxX) {
            val left = x <= minX
            val speed = abs(vx)
            if (speed < stickMax && speed > 150f * dp && y < floorY - 40f * dp) {
                // 不太快地撞到墙：像史莱姆一样粘住
                stickToWall(left)
                y = y.coerceIn(minY, floorY)
                events += Event.StuckToWall(left)
                return
            }
            x = if (left) minX else maxX
            if (speed > 150f * dp) events += Event.HitWall(left, speed / dp)
            vx = -vx * 0.45f
        }
        if (y >= floorY) {
            y = floorY
            val speed = vy
            if (speed > bounceMin) {
                vy = -speed * 0.3f
                vx *= 0.75f
                events += Event.Landed(speed / dp, bounced = true)
            } else {
                vy = 0f
                surface = Surface.FLOOR
                events += Event.Landed(max(0f, speed) / dp, bounced = false)
            }
        }
    }

    private fun stepFloat(dt: Float, events: MutableList<Event>) {
        val target = walkTargetX
        if (target != null) {
            moveToward(target, dt, events)
            return
        }
        if (vx == 0f && vy == 0f) return
        val f = exp(-3.5f * dt)
        vx *= f; vy *= f
        x += vx * dt
        y += vy * dt
        if (x < minX || x > maxX) {
            if (abs(vx) > 150f * dp) events += Event.HitWall(x < minX, abs(vx) / dp)
            x = x.coerceIn(minX, maxX); vx = -vx * 0.5f
        }
        if (y < minY || y > floorY) {
            y = y.coerceIn(minY, floorY); vy = -vy * 0.5f
        }
        if (hypot(vx, vy) < 25f * dp) {
            vx = 0f; vy = 0f
            events += Event.StoppedFloating
        }
    }

    private fun stepFloor(dt: Float, events: MutableList<Event>) {
        y = floorY
        val target = walkTargetX
        if (target != null && tiltAccel == 0f) {
            moveToward(target, dt, events)
            return
        }
        vx += tiltAccel * dt
        vx *= exp(-(if (tiltAccel != 0f) 1.2f else 7f) * dt)
        if (abs(vx) < 2f && tiltAccel == 0f) vx = 0f
        x += vx * dt
        if (x < minX || x > maxX) {
            val left = x < minX
            x = x.coerceIn(minX, maxX)
            if (abs(vx) > 250f * dp) events += Event.HitWall(left, abs(vx) / dp)
            vx = 0f
        }
    }

    private fun moveToward(target: Float, dt: Float, events: MutableList<Event>) {
        val d = target - x
        val step = walkSpeed * dt
        if (abs(d) <= step) {
            x = target
            vx = 0f
            walkTargetX = null
            events += Event.ArrivedAtTarget
        } else {
            vx = sign(d) * walkSpeed
            x += vx * dt
        }
    }

    private fun stepWall(dt: Float, events: MutableList<Event>) {
        if (climbDir == 0) return
        y += climbDir * climbSpeed * dt
        if (y <= minY) {
            y = minY
            climbDir = 0
            events += Event.ArrivedAtTarget
        } else if (y >= floorY) {
            // 爬到底就回到地面
            y = floorY
            climbDir = 0
            x = if (surface == Surface.WALL_LEFT) minX else maxX
            surface = Surface.FLOOR
            events += Event.ArrivedAtTarget
        }
    }
}
