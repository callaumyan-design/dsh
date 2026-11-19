package io.github.callaumyan.aipet

import android.content.Context
import android.content.SharedPreferences
import io.github.callaumyan.aipet.ai.Providers
import io.github.callaumyan.aipet.chat.Persona
import io.github.callaumyan.aipet.pet.PetMemory
import java.time.LocalDate

/** 所有设置都只存在手机本地（App 私有存储），不会上传到任何地方。 */
class Prefs(context: Context) {
    val sp: SharedPreferences = context.getSharedPreferences("pet", Context.MODE_PRIVATE)

    var petName: String
        get() = sp.getString("pet_name", null)?.takeIf { it.isNotBlank() } ?: "团子"
        set(v) = sp.edit().putString("pet_name", v.trim()).apply()

    var personaId: String
        get() = sp.getString("persona_id", Persona.presets.first().id)!!
        set(v) = sp.edit().putString("persona_id", v).apply()

    var personaText: String
        get() = sp.getString("persona_text", null) ?: Persona.presets.first().text
        set(v) = sp.edit().putString("persona_text", v).apply()

    var aboutMe: String
        get() = sp.getString("about_me", "")!!
        set(v) = sp.edit().putString("about_me", v).apply()

    var colorIndex: Int
        get() = sp.getInt("color", 0)
        set(v) = sp.edit().putInt("color", v).apply()

    /** 桌宠大小，百分比 */
    var scalePercent: Int
        get() = sp.getInt("scale", 100)
        set(v) = sp.edit().putInt("scale", v.coerceIn(MIN_SCALE, MAX_SCALE)).apply()

    /** 它怎么称呼你 */
    var userCall: String
        get() = sp.getString("user_call", null)?.takeIf { it.isNotBlank() } ?: "主人"
        set(v) = sp.edit().putString("user_call", v.trim()).apply()

    /** 重力：关掉后放哪儿就待哪儿 */
    var gravity: Boolean
        get() = sp.getBoolean("gravity", true)
        set(v) = sp.edit().putBoolean("gravity", v).apply()

    /** 感应摇晃和倾斜 */
    var senseMotion: Boolean
        get() = sp.getBoolean("sense_motion", true)
        set(v) = sp.edit().putBoolean("sense_motion", v).apply()

    /** 手机放音乐时跟着跳舞 */
    var senseMusic: Boolean
        get() = sp.getBoolean("sense_music", true)
        set(v) = sp.edit().putBoolean("sense_music", v).apply()

    /** 上次在哪：0 地上 1 左墙 2 右墙 3 空中（关掉重力时） */
    var petSurface: Int
        get() = sp.getInt("pet_surface", 0)
        set(v) = sp.edit().putInt("pet_surface", v).apply()

    var savedMood: Float
        get() = sp.getFloat("mood", 70f)
        set(v) = sp.edit().putFloat("mood", v).apply()

    var savedEnergy: Float
        get() = sp.getFloat("energy", 80f)
        set(v) = sp.edit().putFloat("energy", v).apply()

    var wander: Boolean
        get() = sp.getBoolean("wander", true)
        set(v) = sp.edit().putBoolean("wander", v).apply()

    var proactive: Boolean
        get() = sp.getBoolean("proactive", true)
        set(v) = sp.edit().putBoolean("proactive", v).apply()

    var proactiveAi: Boolean
        get() = sp.getBoolean("proactive_ai", false)
        set(v) = sp.edit().putBoolean("proactive_ai", v).apply()

    var tts: Boolean
        get() = sp.getBoolean("tts", false)
        set(v) = sp.edit().putBoolean("tts", v).apply()

    var autoStart: Boolean
        get() = sp.getBoolean("auto_start", true)
        set(v) = sp.edit().putBoolean("auto_start", v).apply()

    /** 用户上次是不是让桌宠出来了（用于开机/更新后自动恢复） */
    var petEnabled: Boolean
        get() = sp.getBoolean("pet_enabled", false)
        set(v) = sp.edit().putBoolean("pet_enabled", v).apply()

    var petX: Int
        get() = sp.getInt("pet_x", -1)
        set(v) = sp.edit().putInt("pet_x", v).apply()

    var petY: Int
        get() = sp.getInt("pet_y", -1)
        set(v) = sp.edit().putInt("pet_y", v).apply()

    // ---- AI 服务 ----

    var providerId: String
        get() = sp.getString("provider", Providers.all.first().id)!!
        set(v) = sp.edit().putString("provider", v).apply()

    val provider get() = Providers.byId(providerId)

    /** 每个服务商的钥匙/模型/地址分开存，切换服务商不会丢。 */
    fun apiKey(id: String = providerId): String = sp.getString("key_$id", "")!!.trim()
    fun setApiKey(id: String, v: String) = sp.edit().putString("key_$id", v.trim()).apply()

    fun model(id: String = providerId): String =
        sp.getString("model_$id", null)?.trim()?.takeIf { it.isNotEmpty() } ?: Providers.byId(id).defaultModel
    fun setModel(id: String, v: String) = sp.edit().putString("model_$id", v.trim()).apply()

    fun baseUrl(id: String = providerId): String =
        sp.getString("base_$id", null)?.trim()?.takeIf { it.isNotEmpty() } ?: Providers.byId(id).defaultBaseUrl
    fun setBaseUrl(id: String, v: String) = sp.edit().putString("base_$id", v.trim()).apply()

    // ---- 它记得的事 ----

    private fun epochDay() = LocalDate.now().toEpochDay()

    val firstMetDay: Long
        get() {
            val d = sp.getLong("first_met", -1L)
            if (d >= 0) return d
            val today = epochDay()
            sp.edit().putLong("first_met", today).apply()
            return today
        }

    val daysTogether: Int get() = (epochDay() - firstMetDay + 1).toInt().coerceAtLeast(1)

    fun todayCount(key: String): Int =
        if (sp.getLong("day_$key", -1L) == epochDay()) sp.getInt("cnt_$key", 0) else 0

    fun bumpToday(key: String): Int {
        val n = todayCount(key) + 1
        sp.edit().putLong("day_$key", epochDay()).putInt("cnt_$key", n).putInt("total_$key", totalCount(key) + 1).apply()
        return n
    }

    fun totalCount(key: String): Int = sp.getInt("total_$key", 0)

    val memory: PetMemory = object : PetMemory {
        override var affection: Float
            get() = sp.getFloat("affection", 30f)
            set(v) = sp.edit().putFloat("affection", v).apply()
        override val daysTogether: Int get() = this@Prefs.daysTogether
        override var lastDayAnnounced: Int
            get() = sp.getInt("last_day_announced", 0)
            set(v) = sp.edit().putInt("last_day_announced", v).apply()
        override fun today(key: String) = todayCount(key)
        override fun bump(key: String) = bumpToday(key)
        override val petName: String get() = this@Prefs.petName
        override val userCall: String get() = this@Prefs.userCall
    }

    companion object {
        const val MIN_SCALE = 60
        const val MAX_SCALE = 160
    }
}
