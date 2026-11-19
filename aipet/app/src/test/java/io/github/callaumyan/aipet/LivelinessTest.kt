package io.github.callaumyan.aipet

import io.github.callaumyan.aipet.pet.Effect
import io.github.callaumyan.aipet.pet.Face
import io.github.callaumyan.aipet.pet.Lines
import io.github.callaumyan.aipet.pet.PetActor
import io.github.callaumyan.aipet.pet.PetBrain
import io.github.callaumyan.aipet.pet.PetGestures
import io.github.callaumyan.aipet.pet.PetMemory
import io.github.callaumyan.aipet.pet.PetPhysics
import io.github.callaumyan.aipet.pet.PetPhysics.Event
import io.github.callaumyan.aipet.pet.Pose
import io.github.callaumyan.aipet.pet.Zone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class PhysicsTest {
    private fun world(): PetPhysics = PetPhysics(dp = 3f).apply {
        minX = 0f; maxX = 1000f; minY = 0f; floorY = 2000f
        clingLeftX = -10f; clingRightX = 1010f
    }

    private fun run(p: PetPhysics, seconds: Float): List<Event> {
        val out = ArrayList<Event>()
        var t = 0f
        while (t < seconds) { out += p.step(0.016f); t += 0.016f }
        return out
    }

    @Test
    fun dropped_pet_falls_and_lands_on_the_floor() {
        val p = world()
        p.place(500f, 300f, PetPhysics.Surface.AIR)
        p.grab(); p.dragTo(500f, 300f); p.release(0f, 0f)
        assertEquals(PetPhysics.Surface.AIR, p.surface)
        val ev = run(p, 3f)
        assertEquals(PetPhysics.Surface.FLOOR, p.surface)
        assertEquals(2000f, p.y, 0.01f)
        assertTrue(ev.any { it is Event.Landed && !it.bounced })
    }

    @Test
    fun hard_throw_down_bounces_before_settling() {
        val p = world()
        p.place(500f, 1000f, PetPhysics.Surface.AIR)
        p.grab(); p.release(0f, 9000f)
        val landings = run(p, 4f).filterIsInstance<Event.Landed>()
        assertTrue(landings.first().bounced)
        assertTrue(landings.first().speedDp > 2000f)
        assertFalse(landings.last().bounced)
        assertTrue(p.isSettled)
    }

    @Test
    fun gentle_throw_at_a_wall_sticks_like_slime() {
        val p = world()
        p.place(500f, 800f, PetPhysics.Surface.AIR)
        p.grab(); p.release(-2400f, -300f) // 800 dp/s
        val ev = run(p, 2f)
        assertTrue(ev.any { it is Event.StuckToWall && it.left })
        assertEquals(PetPhysics.Surface.WALL_LEFT, p.surface)
        assertEquals(-10f, p.x, 0.01f)
    }

    @Test
    fun very_fast_throw_at_a_wall_bounces_off() {
        val p = world()
        p.place(500f, 800f, PetPhysics.Surface.AIR)
        p.grab(); p.release(9000f, -300f) // 3000 dp/s
        val ev = run(p, 0.3f)
        assertTrue(ev.any { it is Event.HitWall && !it.left && it.speedDp > 1400f })
        assertTrue(p.vx < 0f)
    }

    @Test
    fun climbing_the_wall_stops_at_the_top_and_down_returns_to_floor() {
        val p = world()
        p.place(0f, 1500f, PetPhysics.Surface.FLOOR)
        p.stickToWall(left = true)
        p.climbDir = -1; p.climbSpeed = 2000f
        run(p, 2f)
        assertEquals(0f, p.y, 0.01f)
        p.climbDir = 1
        run(p, 2f)
        assertEquals(PetPhysics.Surface.FLOOR, p.surface)
    }

    @Test
    fun walking_arrives_at_target() {
        val p = world()
        p.place(100f, 0f, PetPhysics.Surface.FLOOR)
        p.walkTo(400f, 100f) // 300 px/s
        val ev = run(p, 2f)
        assertTrue(ev.contains(Event.ArrivedAtTarget))
        assertEquals(400f, p.x, 0.01f)
    }

    @Test
    fun tilting_the_phone_slides_it_to_the_low_side() {
        val p = world()
        p.place(500f, 0f, PetPhysics.Surface.FLOOR)
        p.tiltAccel = 1500f
        run(p, 3f)
        assertEquals(1000f, p.x, 0.01f)
    }

    @Test
    fun without_gravity_it_glides_and_stops_where_it_is() {
        val p = world()
        p.gravityOn = false
        p.place(500f, 800f, PetPhysics.Surface.FLOAT)
        p.grab(); p.release(600f, 0f)
        val ev = run(p, 3f)
        assertTrue(ev.contains(Event.StoppedFloating))
        assertEquals(800f, p.y, 0.01f)
        assertTrue(p.x > 500f)
    }
}

class GesturesTest {
    private val log = ArrayList<String>()
    private val g = PetGestures(object : PetGestures.Callback {
        override fun onTap(localX: Float, localY: Float, count: Int) { log += "tap$count" }
        override fun onPickUp() { log += "pickup" }
        override fun onDrag(dxRaw: Float, dyRaw: Float) { log += "drag" }
        override fun onRelease(vx: Float, vy: Float, movedPx: Float) {
            log += if (movedPx < 20f) "release-in-place" else "release:${if (vx > 1000f) "fast" else "slow"}"
        }
        override fun onStroke(strokes: Int) { log += "stroke$strokes" }
        override fun onStrokeEnd(strokes: Int) { log += "strokeEnd$strokes" }
        override fun onFlick(vx: Float, vy: Float) { log += "flick" }
    }, slopPx = 10f)

    @Test
    fun quick_taps_count_up() {
        g.down(0, 50f, 50f, 50f, 50f); g.up(80, 50f, 50f)
        g.down(200, 52f, 50f, 52f, 50f); g.up(260, 52f, 50f)
        g.down(2000, 50f, 50f, 50f, 50f); g.up(2060, 50f, 50f)
        assertEquals(listOf("tap1", "tap2", "tap1"), log)
    }

    @Test
    fun hold_then_drag_then_throw() {
        g.down(0, 50f, 50f, 50f, 50f)
        g.tick(300)
        var t = 300L
        var x = 50f
        repeat(10) { t += 16; x += 40f; g.move(t, x, 50f) }
        g.up(t + 5, x + 10f, 50f)
        assertEquals("pickup", log.first())
        assertTrue(log.contains("drag"))
        assertEquals("release:fast", log.last())
    }

    @Test
    fun hold_and_release_without_moving_opens_menu() {
        g.down(0, 50f, 50f, 50f, 50f)
        g.tick(300)
        g.up(500, 51f, 50f)
        assertEquals(listOf("pickup", "release-in-place"), log)
    }

    @Test
    fun rubbing_back_and_forth_is_petting() {
        g.down(0, 50f, 50f, 50f, 50f)
        var t = 0L
        for (x in listOf(65f, 80f, 70f, 55f, 45f, 60f, 75f, 62f, 50f)) { t += 40; g.move(t, x, 50f) }
        g.up(t + 20, 50f, 50f)
        assertTrue(log.contains("stroke2"))
        assertTrue(log.last().startsWith("strokeEnd"))
        assertFalse(log.contains("pickup"))
    }

    @Test
    fun fast_swipe_is_a_flick() {
        g.down(0, 50f, 50f, 50f, 50f)
        g.move(16, 80f, 50f); g.move(32, 120f, 50f); g.move(48, 170f, 50f)
        g.up(56, 190f, 50f)
        assertEquals(listOf("flick"), log)
    }

    @Test
    fun body_zones() {
        val s = 100f
        assertEquals(Zone.SPROUT, PetGestures.zoneOf(70f, 100f - 90f, 70f, 100f, s))
        assertEquals(Zone.HEAD, PetGestures.zoneOf(40f, 100f - 65f, 70f, 100f, s))
        assertEquals(Zone.FACE, PetGestures.zoneOf(70f, 100f - 40f, 70f, 100f, s))
        assertEquals(Zone.BELLY, PetGestures.zoneOf(70f, 100f - 10f, 70f, 100f, s))
    }
}

class BrainTest {
    private class FakeActor : PetActor {
        var lastFace = Face.NORMAL
        val faces = ArrayList<Face>()
        val effects = ArrayList<Effect>()
        val said = ArrayList<String>()
        var rest = Pose.STAND
        var walkedTo: Float? = null
        var jumps = 0
        override fun face(face: Face) { lastFace = face; faces += face }
        override fun flashFace(face: Face, ms: Long) { faces += face }
        override fun restPose(pose: Pose) { rest = pose }
        override fun effect(e: Effect) { effects += e }
        override fun say(text: String) { said += text }
        override fun lookAt(x: Float, y: Float) = Unit
        override fun walkTo(xFrac: Float, fast: Boolean) { walkedTo = xFrac }
        override fun stopWalking() = Unit
        override fun jump(vxDp: Float, vyDp: Float) { jumps++ }
        override fun climb(dir: Int) = Unit
        override fun letGoOfWall() = Unit
        override fun goToWall(left: Boolean) = Unit
        override fun bump(dir: Int) = Unit
        override var surface = PetPhysics.Surface.FLOOR
        override val xFrac = 0.8f
        override val gravityOn = true
        override val chatterAllowed = true
    }

    private class FakeMemory : PetMemory {
        override var affection = 30f
        override val daysTogether = 5
        override var lastDayAnnounced = 4
        val counts = HashMap<String, Int>()
        override fun today(key: String) = counts[key] ?: 0
        override fun bump(key: String): Int { val n = today(key) + 1; counts[key] = n; return n }
        override val petName = "团子"
        override val userCall = "主人"
    }

    private var now = 1_000_000L
    private var hour = 14
    private val actor = FakeActor()
    private val memory = FakeMemory()
    private val brain = PetBrain(actor, memory, Lines(Random(1)), { now }, { hour }, Random(7))

    private fun advance(ms: Long) {
        var left = ms
        while (left > 0) { val d = minOf(250L, left); now += d; left -= d; brain.tick() }
    }

    private fun saidOneOf(key: String): Boolean = actor.said.any { s -> Lines.table[key]!!.any { tmpl -> s == tmpl.replace("{u}", "主人").replace("{name}", "团子").replace("{days}", "5").replace("{throws}", memory.today("throw").toString()) } }

    @Test
    fun poking_too_much_makes_it_angry_and_walk_away() {
        repeat(8) { brain.onTap(Zone.FACE, it + 1); advance(150) }
        assertTrue(actor.faces.contains(Face.ANNOYED))
        assertEquals(Face.ANGRY, actor.faces.last { it == Face.ANGRY })
        assertTrue(actor.effects.contains(Effect.STEAM))
        assertTrue(brain.annoyance > 50f)
        advance(2000)
        assertEquals(0.1f, actor.walkedTo)
    }

    @Test
    fun different_spots_react_differently() {
        brain.onTap(Zone.SPROUT, 1); advance(2000)
        assertTrue(actor.faces.contains(Face.SURPRISED))
        brain.onTap(Zone.HEAD, 1); advance(2000)
        assertTrue(actor.faces.contains(Face.BLISS))
        brain.onTap(Zone.BELLY, 1)
        assertTrue(actor.jumps > 0)
    }

    @Test
    fun petting_calms_it_down_and_builds_affection() {
        repeat(6) { brain.onTap(Zone.FACE, it + 1); advance(100) }
        val angry = brain.annoyance
        val aff = memory.affection
        for (i in 1..5) { brain.onStroke(i); advance(200) }
        brain.onStrokeEnd(5)
        assertTrue(brain.annoyance < angry)
        assertTrue(memory.affection > aff)
        assertTrue(actor.faces.contains(Face.BLISS))
        assertTrue(actor.effects.contains(Effect.HEARTS))
        assertEquals(1, memory.today("pet"))
    }

    @Test
    fun coming_back_after_a_while_finds_it_asleep_then_it_greets_you() {
        brain.onScreenOff()
        brain.onScreenOn(awayMs = 45 * 60_000L)
        assertTrue(brain.asleep)
        assertEquals(Face.SLEEP, actor.lastFace)
        brain.onUnlock(awayMs = 45 * 60_000L)
        assertFalse(brain.asleep)
        advance(2000)
        assertTrue(saidOneOf("unlock_medium"))
        assertTrue(actor.faces.contains(Face.LOVE))
        advance(4000)
        assertTrue("first unlock of the day mentions days together", saidOneOf("days"))
    }

    @Test
    fun hard_landing_makes_it_dizzy_and_repeated_throws_make_it_sad() {
        repeat(3) {
            brain.onPickUp()
            actor.surface = PetPhysics.Surface.AIR // 真实情况：物理先把它扔到空中，再告诉大脑
            brain.onRelease(3000f)
            actor.surface = PetPhysics.Surface.FLOOR
            brain.onLanded(3000f, bounced = false)
            advance(5000)
        }
        assertTrue(actor.faces.contains(Face.DIZZY))
        assertTrue(saidOneOf("thrown_again"))
        assertEquals(3, memory.today("throw"))
    }

    @Test
    fun charging_feeds_it_and_low_battery_makes_it_weak() {
        brain.onBatteryLevel(14, false)
        assertEquals(Face.SAD, actor.lastFace)
        assertTrue(saidOneOf("battery_low"))
        advance(3000)
        brain.onCharging(true, 14)
        advance(1000)
        assertTrue(actor.faces.contains(Face.EAT))
        assertTrue(actor.effects.contains(Effect.BOLTS))
    }

    @Test
    fun music_makes_it_dance() {
        brain.onMusic(true)
        advance(1000)
        assertEquals(Pose.DANCE, actor.rest)
    }

    @Test
    fun feeding_a_snack() {
        brain.onFeedStart()
        brain.onFoodArrived()
        assertEquals(Face.EAT, actor.lastFace)
        advance(3000)
        assertTrue(actor.faces.contains(Face.LOVE))
        assertEquals(1, memory.today("feed"))
    }

    @Test
    fun left_alone_at_night_it_falls_asleep() {
        hour = 1
        advance(6 * 60_000L)
        assertTrue(brain.asleep)
        assertEquals(Pose.LIE, actor.rest)
    }

    @Test
    fun left_alone_during_the_day_it_does_things_on_its_own() {
        val before = actor.faces.size + actor.effects.size
        advance(3 * 60_000L)
        assertFalse(brain.asleep)
        assertTrue("it should do several ambient things", actor.faces.size + actor.effects.size > before + 3)
    }

    @Test
    fun its_own_hops_do_not_interrupt_what_it_is_saying() {
        brain.onShown()            // 出场：跳一下 + 400ms 后打招呼
        brain.onLanded(300f, bounced = false) // 自己跳完落地
        advance(600)
        assertTrue(saidOneOf("show"))
    }

    @Test
    fun tilting_into_the_wall_lets_the_physics_rest() {
        val p = PetPhysics(3f).apply { minX = 0f; maxX = 100f; floorY = 500f; minY = 0f }
        p.place(100f, 500f, PetPhysics.Surface.FLOOR)
        p.tiltAccel = 900f
        assertTrue(p.isSettled)
        p.tiltAccel = -900f
        assertFalse(p.isSettled)
    }

    @Test
    fun shaking_wakes_and_dizzies_it() {
        brain.fallAsleep(requested = true)
        advance(4000)
        assertTrue(brain.asleep)
        brain.onShake()
        assertFalse(brain.asleep)
        assertTrue(actor.faces.contains(Face.DIZZY))
    }
}
