package io.github.callaumyan.aipet.pet

import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/** 大脑能指挥身体做的事（由 [PetController] 实现） */
interface PetActor {
    /** 平时的表情 */
    fun face(face: Face)
    /** 临时换个表情，ms 后回到平时的表情 */
    fun flashFace(face: Face, ms: Long)
    /** 站在地上不走时的姿势（STAND / SIT / LIE / DANCE）；在空中、墙上、被拎着时由身体自己决定 */
    fun restPose(pose: Pose)
    fun effect(e: Effect)
    fun say(text: String)
    /** 看向某个方向（-1..1），(0,0) = 看着你 */
    fun lookAt(x: Float, y: Float)
    /** 走到地面上的某个位置（0 = 最左，1 = 最右） */
    fun walkTo(xFrac: Float, fast: Boolean = false)
    fun stopWalking()
    fun jump(vxDp: Float, vyDp: Float)
    /** 在墙上爬：-1 上，1 下，0 停 */
    fun climb(dir: Int)
    fun letGoOfWall()
    /** 走到墙边并粘上去 */
    fun goToWall(left: Boolean)
    /** 被推了一下（方向 -1/1） */
    fun bump(dir: Int)
    val surface: PetPhysics.Surface
    val xFrac: Float
    val gravityOn: Boolean
    /** 是否允许它自己找你说话（设置里的“偶尔主动说话”） */
    val chatterAllowed: Boolean
}

/** 需要长期记住的东西（由 Prefs 实现） */
interface PetMemory {
    var affection: Float
    val daysTogether: Int
    var lastDayAnnounced: Int
    fun today(key: String): Int
    fun bump(key: String): Int
    val petName: String
    val userCall: String
}

/**
 * 桌宠的“大脑”：心情、精力、无聊、烦躁、亲密度，决定它对每件事的反应，以及没人理它时自己干什么。
 * 不依赖安卓：时间、随机数都从外面传进来，方便测试。
 */
class PetBrain(
    private val actor: PetActor,
    private val memory: PetMemory,
    private val lines: Lines,
    private val clock: () -> Long,
    private val hourOfDay: () -> Int,
    private val rng: Random = Random.Default,
) {
    // ---- 内在状态（0..100）----
    var mood = 70f; private set
    var energy = 80f; private set
    var boredom = 10f; private set
    var annoyance = 0f; private set
    val affection get() = memory.affection

    var asleep = false; private set
    var charging = false; private set
    var batteryLevel = 100; private set
    var musicOn = false; private set
    private var screenOn = true
    private var held = false
    private var heldSince = 0L
    private var heldComplained = false
    private var airborne = false

    private var lastInteraction = clock()
    private var lastTick = clock()
    private var nextAmbientAt = clock() + 2_000
    private var nextChatterAt = clock() + 4 * MIN
    private var lastHour = hourOfDay()
    private var lastFeed = 0L
    private val pokes = ArrayDeque<Long>()
    private val throws = ArrayDeque<Long>()
    private val feeds = ArrayDeque<Long>()
    private var strokeSaidLine = false

    private val night get() = hourOfDay().let { it >= 23 || it < 6 }
    private fun vars() = mapOf(
        "name" to memory.petName, "u" to memory.userCall, "days" to memory.daysTogether.toString(),
        "pets" to memory.today("pet").toString(), "feeds" to memory.today("feed").toString(),
        "throws" to memory.today("throw").toString(),
    )

    private fun line(key: String): String = lines.pick(key, vars())
    private fun say(key: String) {
        val l = line(key)
        if (l.isNotEmpty()) actor.say(l)
    }

    /** 有一定概率说一句（避免每个动作都冒字） */
    private fun maybeSay(key: String, p: Float) {
        if (rng.nextFloat() < p) say(key)
    }

    // ============ 小剧本：一串按时间执行的动作 ============

    private inner class Script(val name: String, val priority: Int) {
        val steps = ArrayList<Pair<Long, () -> Unit>>()
        var start = 0L
        var length = 0L
        var idx = 0
        fun at(ms: Long, f: () -> Unit) { steps += ms to f }
        fun lasts(ms: Long) { length = ms }
    }

    private var script: Script? = null
    val currentScript: String? get() = script?.name

    private fun run(name: String, priority: Int, build: Script.() -> Unit): Boolean {
        val cur = script
        if (cur != null && cur.priority > priority) return false
        val s = Script(name, priority).apply(build)
        s.steps.sortBy { it.first }
        s.start = clock()
        script = s
        advance()
        return true
    }

    private fun advance() {
        val s = script ?: return
        val t = clock() - s.start
        while (s.idx < s.steps.size && s.steps[s.idx].first <= t) {
            val f = s.steps[s.idx].second
            s.idx++
            f()
            if (script !== s) return
        }
        if (s.idx >= s.steps.size && t >= s.length) {
            script = null
            settle()
            nextAmbientAt = clock() + rng.nextLong(1_500, 5_000)
        }
    }

    /** 剧本结束后回到“平时”的样子 */
    private fun settle() {
        if (asleep) {
            actor.restPose(Pose.LIE); actor.face(Face.SLEEP); return
        }
        actor.restPose(Pose.STAND)
        actor.face(baseFace())
        actor.lookAt(0f, 0f)
    }

    private fun baseFace(): Face = when {
        annoyance > 55 -> Face.ANNOYED
        batteryLevel <= 15 && !charging -> Face.SAD
        energy < 25 -> Face.SLEEPY
        mood < 30 -> Face.SAD
        else -> Face.NORMAL
    }

    private fun interacted() {
        lastInteraction = clock()
        boredom = max(0f, boredom - 25f)
    }

    private fun addAffection(d: Float) {
        memory.affection = (memory.affection + d).coerceIn(0f, 100f)
    }

    // ============ 时间流逝 ============

    /** 屏幕亮着的时候大约每 250ms 调一次 */
    fun tick() {
        val now = clock()
        val dtMin = ((now - lastTick).coerceIn(0, 60_000)) / 60_000f
        lastTick = now
        drift(dtMin)
        advance()

        if (held) {
            if (!heldComplained && now - heldSince > 5_000) {
                heldComplained = true
                actor.face(Face.WORRIED)
                say("held_long")
            }
            return
        }
        if (airborne || script != null) return

        val h = hourOfDay()
        if (h != lastHour) {
            lastHour = h
            onNewHour(h)
            if (script != null) return
        }
        if (asleep) {
            if (energy >= 98 && !night) wakeUp(grumpy = false)
            return
        }
        if (now >= nextAmbientAt) chooseAmbient()
    }

    private fun drift(dtMin: Float) {
        if (dtMin <= 0f) return
        when {
            asleep -> energy += 1.2f * dtMin
            charging -> energy += 0.4f * dtMin
            else -> energy -= (if (night) 0.35f else 0.15f) * dtMin
        }
        if (batteryLevel <= 15 && !charging) energy = min(energy, 30f)
        energy = energy.coerceIn(0f, 100f)
        if (screenOn && !asleep) boredom = min(100f, boredom + 1.2f * dtMin)
        annoyance = max(0f, annoyance - 8f * dtMin)
        val target = (45f + affection * 0.3f - boredom * 0.25f - annoyance * 0.3f + (energy - 50f) * 0.1f).coerceIn(5f, 95f)
        mood += (target - mood) * min(1f, 0.08f * dtMin)
    }

    private fun onNewHour(h: Int) {
        if (!actor.chatterAllowed || asleep || !screenOn) return
        when (h) {
            23 -> run("bedtime", P_REACT) {
                at(0) { actor.flashFace(Face.SLEEPY, 2500); say("bedtime") }
                lasts(2500)
            }
            12, 18 -> run("meal", P_REACT) {
                at(0) { actor.flashFace(Face.HAPPY, 2000); say("meal") }
                lasts(2000)
            }
        }
    }

    // ============ 自己找事做 ============

    private fun chatterOk(): Boolean = actor.chatterAllowed && clock() >= nextChatterAt

    private fun chattered() {
        nextChatterAt = clock() + rng.nextLong(6 * MIN, 14 * MIN)
    }

    private fun chooseAmbient() {
        val surf = actor.surface
        if (surf == PetPhysics.Surface.WALL_LEFT || surf == PetPhysics.Surface.WALL_RIGHT) {
            wallActivity(); return
        }
        val idleFor = clock() - lastInteraction
        if (energy < 15 || (night && idleFor > 3 * MIN) || (energy < 35 && idleFor > 8 * MIN)) {
            fallAsleep(requested = false); return
        }
        if (batteryLevel <= 5 && !charging) { weak(); return }
        if (musicOn) { dance(); return }
        if (charging && batteryLevel < 100 && rng.nextFloat() < 0.5f) { eatElectricity(); return }

        val g = actor.gravityOn
        val options = listOf(
            3f to ::lookAround,
            (if (g) 3f else 0.5f) to ::wander,
            2f to ::sitDown,
            (if (energy < 40) 3f else 0.8f) to ::stretch,
            (if (mood > 65) 1.5f else 0.3f) to ::hum,
            (if (boredom > 40) 2f else 0.6f) to ::play,
            (if (g) 0.9f else 0f) to ::goClimb,
            1f to ::daydream,
            (if (boredom > 65) 5f else 0f) to ::seekAttention,
            (if (annoyance > 40) 4f else 0f) to ::sulk,
        )
        val total = options.sumOf { it.first.toDouble() }.toFloat()
        var r = rng.nextFloat() * total
        for ((w, f) in options) {
            r -= w
            if (r <= 0f) { f(); return }
        }
        lookAround()
    }

    private fun lookAround() = run("look", P_AMBIENT) {
        at(0) { actor.lookAt(-0.9f, -0.2f) }
        at(900) { actor.lookAt(0.9f, -0.3f) }
        at(1900) { actor.lookAt(0f, 0f) }
        if (chatterOk() && rng.nextFloat() < 0.5f) at(2000) { say(timeKey()); chattered() }
        lasts(2600)
    }

    private fun timeKey(): String = when (hourOfDay()) {
        in 6..10 -> "idle_morning"
        in 11..13 -> "idle_noon"
        in 14..17 -> "idle_afternoon"
        in 18..22 -> "idle_evening"
        else -> "idle_night"
    }

    private fun wander() = run("wander", P_AMBIENT) {
        // 多在屏幕两侧活动，少挡住中间的内容
        val x = actor.xFrac
        val target = if (x < 0.5f) rng.nextFloat() * 0.35f else 0.65f + rng.nextFloat() * 0.35f
        at(0) { actor.walkTo(target) }
        lasts(rng.nextLong(3_000, 6_000))
    }

    private fun sitDown() = run("sit", P_AMBIENT) {
        at(0) { actor.restPose(Pose.SIT) }
        at(1500) { actor.lookAt(rng.nextFloat() * 2 - 1, 0.3f) }
        if (energy < 50) at(3000) { actor.face(Face.SLEEPY) }
        lasts(rng.nextLong(5_000, 9_000))
    }

    private fun stretch() = run("stretch", P_AMBIENT) {
        at(0) { actor.restPose(Pose.STAND); actor.flashFace(Face.SLEEPY, 1800) }
        at(300) { actor.jump(0f, -220f) }
        if (chatterOk() && energy < 40) at(600) { say("yawn"); chattered() }
        lasts(2200)
    }

    private fun hum() = run("hum", P_AMBIENT) {
        at(0) { actor.flashFace(Face.HAPPY, 2500); actor.effect(Effect.NOTES) }
        at(1200) { actor.effect(Effect.NOTES) }
        if (chatterOk() && rng.nextFloat() < 0.4f) at(200) { say("hum"); chattered() }
        lasts(2600)
    }

    private fun play() = run("play", P_AMBIENT) {
        at(0) { actor.flashFace(Face.HAPPY, 2600); actor.jump(0f, -420f) }
        at(800) { actor.jump(if (rng.nextBoolean()) 160f else -160f, -360f) }
        at(1700) { actor.jump(0f, -280f); actor.effect(Effect.SPARKLES) }
        lasts(2800)
    }

    private fun goClimb() = run("climb", P_AMBIENT) {
        val left = actor.xFrac < 0.5f
        at(0) { actor.goToWall(left) }
        lasts(5_000)
    }

    private fun wallActivity() = run("wall", P_AMBIENT) {
        val r = rng.nextFloat()
        when {
            r < 0.4f -> {
                at(0) { actor.climb(-1) }
                if (chatterOk() && rng.nextFloat() < 0.3f) at(300) { say("climb"); chattered() }
                at(rng.nextLong(1_200, 2_600)) { actor.climb(0) }
                lasts(3_000)
            }
            r < 0.7f -> {
                at(0) { actor.lookAt(if (actor.surface == PetPhysics.Surface.WALL_LEFT) 1f else -1f, 0.2f) }
                at(1500) { actor.lookAt(0f, 0f) }
                lasts(3_000)
            }
            else -> {
                at(0) { actor.flashFace(Face.HAPPY, 1200); maybeSay("drop", 0.4f) }
                at(400) { actor.letGoOfWall() }
                lasts(1_500)
            }
        }
    }

    private fun daydream() = run("daydream", P_AMBIENT) {
        at(0) { actor.face(Face.THINK) }
        at(1800) {
            if (chatterOk() && rng.nextFloat() < 0.35f) { say("daydream"); chattered() }
            actor.effect(if (rng.nextBoolean()) Effect.SPARKLES else Effect.HEARTS)
        }
        at(2600) { actor.face(baseFace()) }
        lasts(3_000)
    }

    private fun seekAttention() = run("attention", P_AMBIENT) {
        at(0) { actor.walkTo(0.5f, fast = true) }
        at(1800) { actor.lookAt(0f, 0f); actor.jump(0f, -380f); actor.effect(Effect.EXCLAIM) }
        at(2200) {
            val lonely = clock() - lastInteraction > 40 * MIN
            say(if (lonely) "lonely" else "bored")
        }
        at(3000) { actor.jump(0f, -300f) }
        at(6500) { actor.walkTo(if (rng.nextBoolean()) 0.1f else 0.9f) }
        lasts(9_000)
        boredom = max(0f, boredom - 30f)
    }

    private fun sulk() = run("sulk", P_AMBIENT) {
        at(0) { actor.face(Face.ANNOYED); actor.restPose(Pose.SIT); actor.lookAt(if (rng.nextBoolean()) 1f else -1f, 0.4f) }
        lasts(6_000)
    }

    private fun dance() = run("dance", P_AMBIENT) {
        at(0) { actor.restPose(Pose.DANCE); actor.face(Face.HAPPY); actor.effect(Effect.NOTES) }
        at(2000) { actor.effect(Effect.NOTES) }
        at(4000) { actor.effect(Effect.NOTES) }
        at(6000) { actor.effect(Effect.NOTES) }
        lasts(8_000)
    }

    private fun eatElectricity() = run("eat_power", P_AMBIENT) {
        at(0) { actor.restPose(Pose.SIT); actor.face(Face.EAT) }
        for (i in 0..5) at(i * 900L) { actor.effect(Effect.BOLTS) }
        at(5500) { actor.face(Face.BLISS) }
        lasts(7_000)
    }

    private fun weak() = run("weak", P_AMBIENT) {
        at(0) { actor.restPose(Pose.LIE); actor.face(Face.SAD) }
        if (chatterOk()) at(500) { say("battery_critical"); chattered() }
        lasts(10_000)
    }

    fun fallAsleep(requested: Boolean) {
        val p = if (requested) P_REACT else P_AMBIENT
        run("fall_asleep", p) {
            at(0) {
                actor.stopWalking()
                actor.face(Face.SLEEPY)
                if (requested) say(if (energy > 70 && !night) "sleep_not_sleepy" else "sleep_ok")
                else if (chatterOk()) { say("yawn"); chattered() }
            }
            at(1500) { actor.restPose(Pose.SIT) }
            at(3000) {
                asleep = true
                actor.restPose(Pose.LIE)
                actor.face(Face.SLEEP)
            }
            lasts(3200)
        }
    }

    private fun wakeUp(grumpy: Boolean) {
        asleep = false
        run("wake", P_REACT) {
            at(0) { actor.restPose(Pose.SIT); actor.face(if (grumpy) Face.SLEEPY else Face.SURPRISED) }
            at(700) {
                actor.restPose(Pose.STAND)
                actor.flashFace(if (grumpy) Face.ANNOYED else Face.HAPPY, 1500)
                say(if (grumpy) "wake_grumpy" else "wake")
                if (!grumpy) actor.jump(0f, -260f)
            }
            lasts(2000)
        }
    }

    // ============ 你对它做的事 ============

    fun onShown() {
        interacted()
        run("show", P_REACT) {
            at(0) { actor.flashFace(Face.HAPPY, 1500); actor.effect(Effect.SPARKLES); actor.jump(0f, -320f) }
            at(400) { say("show") }
            lasts(1800)
        }
    }

    fun onTap(zone: Zone, count: Int) {
        interacted()
        if (asleep) {
            wakeUp(grumpy = energy < 40)
            return
        }
        val now = clock()
        pokes.addLast(now)
        while (pokes.isNotEmpty() && now - pokes.first() > 4_000) pokes.removeFirst()
        val n = pokes.size
        memory.bump("poke")
        when {
            n >= 7 || annoyance > 75 -> {
                annoyance = min(100f, annoyance + 20f)
                mood -= 6f
                addAffection(-0.2f)
                run("angry", P_REACT) {
                    at(0) { actor.face(Face.ANGRY); actor.effect(Effect.STEAM); say("poke_angry") }
                    at(1600) {
                        // 转身走开
                        val away = if (actor.xFrac < 0.5f) 0.9f else 0.1f
                        actor.walkTo(away, fast = true)
                    }
                    at(4200) { actor.face(Face.ANNOYED) }
                    lasts(5_000)
                }
            }
            n >= 4 -> {
                annoyance = min(100f, annoyance + 10f)
                run("annoyed", P_REACT) {
                    at(0) { actor.flashFace(Face.ANNOYED, 1600); actor.effect(Effect.SWEAT); say("poke_annoyed") }
                    lasts(1200)
                }
            }
            else -> {
                mood += 2f
                addAffection(0.05f)
                run("tap", P_REACT) {
                    when (zone) {
                        Zone.SPROUT -> {
                            at(0) { actor.flashFace(Face.SURPRISED, 900); actor.effect(Effect.EXCLAIM); maybeSay("tap_sprout", 0.7f) }
                        }
                        Zone.HEAD -> {
                            at(0) { actor.flashFace(Face.BLISS, 1200); maybeSay("tap_head", 0.45f) }
                            at(300) { if (rng.nextFloat() < 0.5f) actor.effect(Effect.HEARTS) }
                        }
                        Zone.FACE -> {
                            at(0) { actor.flashFace(if (rng.nextBoolean()) Face.SHY else Face.PAIN, 1000); maybeSay("tap_face", 0.45f) }
                        }
                        Zone.BELLY -> {
                            at(0) { actor.flashFace(Face.HAPPY, 1200); actor.jump(0f, -200f); maybeSay("tap_belly", 0.55f) }
                        }
                    }
                    lasts(1200)
                }
            }
        }
    }

    fun onMenuOpened() {
        interacted()
        if (asleep) { wakeUp(grumpy = energy < 40); return }
        run("menu", P_REACT) {
            at(0) { actor.flashFace(Face.HAPPY, 1500); actor.lookAt(0f, 0f); say("menu") }
            lasts(1500)
        }
    }

    fun onStroke(strokes: Int) {
        interacted()
        if (asleep && strokes >= 2) {
            // 睡着时被摸：不醒，开心地在梦里笑
            actor.effect(Effect.HEARTS)
            return
        }
        if (strokes == 1) strokeSaidLine = false
        if (strokes >= 2) {
            run("petting", P_REACT) {
                at(0) {
                    actor.face(Face.BLISS)
                    if (strokes % 2 == 0) actor.effect(Effect.HEARTS)
                    if (!strokeSaidLine && strokes >= 3) {
                        strokeSaidLine = true
                        say(if (annoyance > 40) "petting_calm" else "petting")
                    }
                }
                lasts(1500)
            }
        }
    }

    fun onStrokeEnd(strokes: Int) {
        if (strokes < 2) return
        val n = memory.bump("pet")
        mood = min(100f, mood + 4f + strokes)
        annoyance = max(0f, annoyance - 15f * strokes)
        addAffection(0.4f)
        if (asleep) return
        run("petted", P_REACT) {
            at(0) { actor.flashFace(Face.LOVE, 1500); actor.effect(Effect.HEARTS) }
            if (n % 10 == 0) at(500) { say("pet_count") }
            lasts(1500)
        }
    }

    fun onFlick(dir: Int) {
        interacted()
        if (asleep) { wakeUp(grumpy = true); return }
        run("flick", P_REACT) {
            at(0) { actor.flashFace(Face.SURPRISED, 900); actor.bump(dir); maybeSay("flick", 0.5f) }
            lasts(1000)
        }
    }

    fun onPickUp() {
        interacted()
        asleep = false
        held = true
        heldSince = clock()
        heldComplained = false
        script = null
        actor.stopWalking()
        actor.face(if (annoyance > 50) Face.ANNOYED else Face.SURPRISED)
        actor.effect(Effect.EXCLAIM)
        maybeSay("pickup", 0.4f)
    }

    /** 拎着它甩来甩去（速度很快）会晕 */
    fun onShakenWhileHeld() {
        if (!held) return
        actor.face(Face.DIZZY)
    }

    fun onRelease(speedDp: Float) {
        held = false
        airborne = actor.surface == PetPhysics.Surface.AIR || actor.surface == PetPhysics.Surface.FLOAT
        if (speedDp > 900f) {
            val now = clock()
            throws.addLast(now)
            while (throws.isNotEmpty() && now - throws.first() > 3 * MIN) throws.removeFirst()
            memory.bump("throw")
            annoyance = min(100f, annoyance + 8f)
            actor.face(Face.SURPRISED)
            maybeSay("thrown", 0.5f)
        } else if (!actor.gravityOn) {
            airborne = false
            settle()
        }
    }

    fun onLanded(speedDp: Float, bounced: Boolean) {
        // 自己蹦一下落地不算事，不打断正在做的事
        if (!airborne) return
        if (bounced) {
            actor.face(Face.PAIN)
            return
        }
        airborne = false
        val repeated = throws.size >= 3
        when {
            speedDp > 2600f -> {
                annoyance = min(100f, annoyance + 15f)
                mood -= 8f
                addAffection(-0.5f)
                run("land_dizzy", P_REACT) {
                    at(0) { actor.face(Face.DIZZY); say(if (repeated) "thrown_again" else "land_dizzy") }
                    at(3200) { actor.face(if (repeated) Face.SAD else Face.ANNOYED) }
                    lasts(4500)
                }
            }
            speedDp > 1300f -> run("land_hard", P_REACT) {
                at(0) { actor.face(Face.PAIN); say(if (repeated) "thrown_again" else "land_hard") }
                at(1500) { actor.face(baseFace()) }
                lasts(1800)
            }
            else -> run("land", P_REACT) {
                at(0) { actor.flashFace(Face.HAPPY, 1000); maybeSay("land_soft", 0.25f) }
                lasts(1000)
            }
        }
    }

    fun onHitWall(speedDp: Float) {
        if (speedDp > 1400f) {
            annoyance = min(100f, annoyance + 6f)
            actor.face(Face.DIZZY)
            maybeSay("hit_wall", 0.6f)
        } else {
            actor.flashFace(Face.PAIN, 600)
        }
    }

    fun onStuckToWall() {
        airborne = false
        run("stuck", P_REACT) {
            at(0) { actor.flashFace(Face.SURPRISED, 700) }
            at(700) { actor.flashFace(Face.HAPPY, 1200); maybeSay("stuck_wall", 0.5f) }
            lasts(2200)
        }
    }

    fun onStoppedFloating() {
        airborne = false
        settle()
    }

    fun onFeedStart(): Boolean {
        interacted()
        if (asleep) wakeUp(grumpy = false)
        run("feed_wait", P_REACT) {
            at(0) { actor.face(Face.SURPRISED); actor.lookAt(0f, -1f); actor.effect(Effect.EXCLAIM); maybeSay("feed_see", 0.7f) }
            lasts(6_000)
        }
        return true
    }

    fun onFoodArrived() {
        val now = clock()
        feeds.addLast(now)
        while (feeds.isNotEmpty() && now - feeds.first() > 10 * MIN) feeds.removeFirst()
        memory.bump("feed")
        val full = feeds.size > 5
        energy = min(100f, energy + 8f)
        mood = min(100f, mood + if (full) 2f else 8f)
        addAffection(if (full) 0.05f else 0.3f)
        lastFeed = now
        run("eat", P_REACT) {
            at(0) { actor.lookAt(0f, 0f); actor.restPose(Pose.SIT); actor.face(Face.EAT); actor.effect(Effect.CRUMBS) }
            at(900) { actor.effect(Effect.CRUMBS) }
            at(1800) { actor.effect(Effect.CRUMBS) }
            at(2600) {
                actor.restPose(Pose.STAND)
                if (full) { actor.face(Face.WORRIED); say("feed_full") }
                else { actor.flashFace(Face.LOVE, 1800); actor.effect(Effect.HEARTS); say("feed_eat") }
            }
            lasts(3600)
        }
    }

    fun onSleepRequested() {
        interacted()
        if (asleep) return
        fallAsleep(requested = true)
    }

    // ============ 手机发生的事 ============

    fun onShake() {
        interacted()
        val wasAsleep = asleep
        asleep = false
        annoyance = min(100f, annoyance + 5f)
        run("shake", P_PHYSICAL) {
            at(0) {
                actor.face(Face.DIZZY)
                if (actor.surface == PetPhysics.Surface.WALL_LEFT || actor.surface == PetPhysics.Surface.WALL_RIGHT) actor.letGoOfWall()
                else actor.jump((rng.nextFloat() - 0.5f) * 300f, -350f)
                say(if (wasAsleep) "wake_grumpy" else "shake")
            }
            at(2800) { actor.face(baseFace()) }
            lasts(3000)
        }
    }

    private var lastTiltLine = 0L
    fun onTiltSliding() {
        if (asleep || held) return
        actor.flashFace(Face.WORRIED, 1200)
        if (clock() - lastTiltLine > 20_000) {
            lastTiltLine = clock()
            say("tilt")
        }
    }

    fun onScreenOff() {
        screenOn = false
        script = null
        onPlaced()
    }

    /** 被直接放到某处（显示出来、锁屏时落地）：不再处于被拎着/飞行中 */
    fun onPlaced() {
        held = false
        airborne = false
    }

    /** 亮屏（可能还在锁屏界面）。离开久了的话，你看到的会是它在睡觉 */
    fun onScreenOn(awayMs: Long) {
        screenOn = true
        lastTick = clock()
        if (awayMs > 20 * MIN) {
            energy = min(100f, energy + awayMs / MIN.toFloat() * 0.3f)
            boredom = min(100f, boredom + 20f)
        }
        if (awayMs > 10 * MIN && !held) {
            asleep = true
            settle()
        }
    }

    /** 解锁进入手机：打招呼，离开得越久越激动 */
    fun onUnlock(awayMs: Long) {
        interacted()
        val h = hourOfDay()
        val wasAsleep = asleep
        asleep = false
        val firstToday = memory.lastDayAnnounced != memory.daysTogether
        val key = when {
            awayMs < 2 * MIN -> null
            h in 0..4 -> "unlock_night"
            awayMs > 3 * 60 * MIN && h in 5..10 -> "unlock_morning"
            awayMs > 3 * 60 * MIN -> "unlock_long"
            awayMs > 30 * MIN -> "unlock_medium"
            else -> "unlock_short"
        }
        if (key == null && !wasAsleep) return
        run("greet", P_REACT) {
            if (wasAsleep) {
                at(0) { actor.restPose(Pose.SIT); actor.face(Face.SLEEPY) }
                at(900) { actor.face(Face.SURPRISED); actor.effect(Effect.EXCLAIM) }
            }
            val t0 = if (wasAsleep) 1400L else 0L
            at(t0) {
                actor.restPose(Pose.STAND)
                actor.lookAt(0f, 0f)
                actor.face(if (key == "unlock_long" || key == "unlock_medium") Face.LOVE else Face.HAPPY)
                actor.jump(0f, if (key == "unlock_long") -480f else -320f)
                if (key != null) say(key)
                if (key == "unlock_long" || key == "unlock_medium") actor.effect(Effect.HEARTS)
            }
            if (firstToday && memory.daysTogether > 1) at(t0 + 3200) {
                memory.lastDayAnnounced = memory.daysTogether
                say("days")
                actor.effect(Effect.SPARKLES)
            }
            at(t0 + 2600) { actor.face(baseFace()) }
            lasts(t0 + if (firstToday) 5200 else 3000)
        }
        if (firstToday && memory.daysTogether <= 1) memory.lastDayAnnounced = memory.daysTogether
        if (key == "unlock_long") addAffection(0.3f)
    }

    fun onCharging(on: Boolean, level: Int) {
        val was = charging
        charging = on
        batteryLevel = level
        if (on == was) return
        if (asleep) return
        run(if (on) "charge_on" else "charge_off", P_REACT) {
            if (on) {
                at(0) { actor.face(Face.SURPRISED); actor.lookAt(0f, 1f); actor.effect(Effect.EXCLAIM) }
                at(600) { actor.face(Face.EAT); actor.effect(Effect.BOLTS); say("charge_on") }
                at(1500) { actor.effect(Effect.BOLTS) }
                at(2400) { actor.face(baseFace()) }
                lasts(2600)
            } else {
                at(0) {
                    if (level < 80) { actor.face(Face.SAD); say("charge_off_hungry") }
                    else { actor.face(Face.BLISS); say("charge_off_full") }
                }
                at(2200) { actor.face(baseFace()) }
                lasts(2400)
            }
        }
    }

    private var saidLow = false
    private var saidCritical = false
    private var saidFull = false

    fun onBatteryLevel(level: Int, isCharging: Boolean) {
        batteryLevel = level
        charging = isCharging
        if (level > 20) saidLow = false
        if (level > 8) saidCritical = false
        if (level < 95) saidFull = false
        if (asleep) return
        when {
            isCharging && level >= 100 && !saidFull -> {
                saidFull = true
                run("full", P_REACT) {
                    at(0) { actor.restPose(Pose.SIT); actor.face(Face.BLISS); say("battery_full") }
                    lasts(2500)
                }
            }
            !isCharging && level <= 5 && !saidCritical -> {
                saidCritical = true
                weak()
            }
            !isCharging && level <= 15 && !saidLow -> {
                saidLow = true
                run("low", P_REACT) {
                    at(0) { actor.face(Face.SAD); say("battery_low") }
                    lasts(2500)
                }
            }
        }
    }

    fun onMusic(on: Boolean) {
        if (on == musicOn) return
        musicOn = on
        if (asleep) return
        if (on) {
            run("music_on", P_REACT) {
                at(0) { actor.face(Face.SURPRISED); actor.effect(Effect.NOTES) }
                at(600) { actor.restPose(Pose.DANCE); actor.face(Face.HAPPY); if (rng.nextFloat() < 0.6f) say("music_on") }
                lasts(3000)
            }
        } else {
            run("music_off", P_REACT) {
                at(0) { actor.restPose(Pose.STAND); actor.face(Face.NORMAL); maybeSay("music_off", 0.4f) }
                lasts(1500)
            }
        }
    }

    fun onHeadset(on: Boolean) {
        if (!on || asleep) return
        run("headset", P_REACT) {
            at(0) { actor.flashFace(Face.SURPRISED, 1200); maybeSay("headset", 0.7f) }
            lasts(1500)
        }
    }

    fun onChatThinking() {
        interacted()
        asleep = false
        actor.face(Face.THINK)
    }

    fun onChatDone(ok: Boolean) {
        actor.face(if (ok) Face.NORMAL else Face.SAD)
        if (ok) actor.flashFace(Face.HAPPY, 1500)
    }

    /** 服务重启后恢复上次的心情和精力 */
    fun restore(savedMood: Float, savedEnergy: Float) {
        mood = savedMood.coerceIn(0f, 100f)
        energy = savedEnergy.coerceIn(0f, 100f)
    }

    /** 给设置页显示的状态 */
    fun snapshot() = PetStatus(mood, energy, boredom, annoyance, affection, asleep)

    companion object {
        const val MIN = 60_000L
        const val P_AMBIENT = 1
        const val P_REACT = 5
        const val P_PHYSICAL = 8
    }
}

data class PetStatus(
    val mood: Float, val energy: Float, val boredom: Float, val annoyance: Float, val affection: Float, val asleep: Boolean,
)
