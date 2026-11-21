package com.smsrelay.secure.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import com.smsrelay.secure.core.Bark
import com.smsrelay.secure.core.Filter
import com.smsrelay.secure.core.Ntfy
import com.smsrelay.secure.core.Pairing
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/**
 * All user settings. Ordinary values live in a private SharedPreferences file; every secret
 * is encrypted with [SecretStore] first.
 */
class Settings(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)

    // ---- General ----
    var forwardEnabled by bool("forward_enabled", true)
    var keepAlive by bool("keep_alive", true)
    var deviceLabel by string("device_label", Build.MODEL ?: "安卓手机")
    var filterMode by int("filter_mode", Filter.MODE_ALL)
    var includeKeywords by string("include_keywords", "")
    var excludeKeywords by string("exclude_keywords", "")

    // ---- Channel: end-to-end encrypted push to another phone running this app ----
    var e2eEnabled by bool("e2e_enabled", false)
    var e2eCode by secret("e2e_code")
    var e2eServer by string("e2e_server", Ntfy.DEFAULT_SERVER)
    var e2eToken by secret("e2e_token")
    /** Allow phones that know the pairing code to make this phone send SMS (off by default). */
    var remoteSmsEnabled by bool("remote_sms_enabled", false)
    var cmdSince by string("cmd_since", "")

    // ---- Channel: email ----
    var emailEnabled by bool("email_enabled", false)
    var emailPreset by int("email_preset", 0)
    var smtpHost by string("smtp_host", "smtp.qq.com")
    var smtpPort by int("smtp_port", 465)
    var smtpStartTls by bool("smtp_starttls", false)
    var smtpUser by string("smtp_user", "")
    var smtpPass by secret("smtp_pass")
    var emailTo by string("email_to", "")

    // ---- Channel: SMS to another number ----
    var smsEnabled by bool("sms_enabled", false)
    var smsTarget by string("sms_target", "")

    // ---- Channel: Bark (iPhone) ----
    var barkEnabled by bool("bark_enabled", false)
    var barkServer by string("bark_server", Bark.DEFAULT_SERVER)
    var barkDeviceKey by secret("bark_device_key")
    var barkEncrypt by bool("bark_encrypt", true)
    var barkKey by secret("bark_key")
    var barkIv by string("bark_iv", "")

    // ---- Channel: Telegram ----
    var tgEnabled by bool("tg_enabled", false)
    var tgToken by secret("tg_token")
    var tgChatId by string("tg_chat_id", "")

    // ---- Channel: webhook / group bots ----
    var whEnabled by bool("wh_enabled", false)
    var whType by int("wh_type", 0)
    var whUrl by secret("wh_url")
    var whSecret by secret("wh_secret")

    // ---- Receiver role ----
    var rxEnabled by bool("rx_enabled", false)
    var rxCode by secret("rx_code")
    var rxServer by string("rx_server", Ntfy.DEFAULT_SERVER)
    var rxToken by secret("rx_token")
    var rxSince by string("rx_since", "")

    fun enabledChannelIds(): List<String> = buildList {
        if (e2eEnabled) add(CH_E2E)
        if (emailEnabled) add(CH_EMAIL)
        if (smsEnabled) add(CH_SMS)
        if (barkEnabled) add(CH_BARK)
        if (tgEnabled) add(CH_TG)
        if (whEnabled) add(CH_WEBHOOK)
    }

    fun receiverConfigured(): Boolean = rxEnabled && Pairing.normalize(rxCode) != null

    fun remoteConfigured(): Boolean = remoteSmsEnabled && e2eEnabled && Pairing.normalize(e2eCode) != null

    fun needsService(): Boolean =
        receiverConfigured() || remoteConfigured() || (keepAlive && forwardEnabled && enabledChannelIds().isNotEmpty())

    // ---- Property delegates ----
    private fun bool(key: String, def: Boolean) = object : ReadWriteProperty<Any, Boolean> {
        override fun getValue(thisRef: Any, property: KProperty<*>) = prefs.getBoolean(key, def)
        override fun setValue(thisRef: Any, property: KProperty<*>, value: Boolean) =
            prefs.edit().putBoolean(key, value).apply()
    }

    private fun int(key: String, def: Int) = object : ReadWriteProperty<Any, Int> {
        override fun getValue(thisRef: Any, property: KProperty<*>) = prefs.getInt(key, def)
        override fun setValue(thisRef: Any, property: KProperty<*>, value: Int) =
            prefs.edit().putInt(key, value).apply()
    }

    private fun string(key: String, def: String) = object : ReadWriteProperty<Any, String> {
        override fun getValue(thisRef: Any, property: KProperty<*>) = prefs.getString(key, def) ?: def
        override fun setValue(thisRef: Any, property: KProperty<*>, value: String) =
            prefs.edit().putString(key, value).apply()
    }

    private fun secret(key: String) = object : ReadWriteProperty<Any, String> {
        override fun getValue(thisRef: Any, property: KProperty<*>): String {
            val stored = prefs.getString(key, null) ?: return ""
            return SecretStore.decrypt(stored) ?: ""
        }

        override fun setValue(thisRef: Any, property: KProperty<*>, value: String) {
            if (value.isEmpty()) {
                prefs.edit().remove(key).apply()
            } else {
                prefs.edit().putString(key, SecretStore.encrypt(value)).apply()
            }
        }
    }

    companion object {
        const val CH_E2E = "e2e"
        const val CH_EMAIL = "email"
        const val CH_SMS = "sms"
        const val CH_BARK = "bark"
        const val CH_TG = "tg"
        const val CH_WEBHOOK = "webhook"

        fun channelName(id: String): String = when (id) {
            CH_E2E -> "加密推送"
            CH_EMAIL -> "邮件"
            CH_SMS -> "短信"
            CH_BARK -> "Bark"
            CH_TG -> "Telegram"
            CH_WEBHOOK -> "群机器人"
            else -> id
        }
    }
}
