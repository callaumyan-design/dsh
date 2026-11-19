package io.github.callaumyan.aipet

import android.content.Context
import android.content.SharedPreferences
import io.github.callaumyan.aipet.ai.Providers
import io.github.callaumyan.aipet.chat.Persona

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

    companion object {
        const val MIN_SCALE = 60
        const val MAX_SCALE = 160
    }
}
