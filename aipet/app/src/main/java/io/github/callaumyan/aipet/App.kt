package io.github.callaumyan.aipet

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import io.github.callaumyan.aipet.chat.ChatEngine

class App : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var chat: ChatEngine
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        chat = ChatEngine(this, prefs)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PET, getString(R.string.channel_pet), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.channel_pet_desc)
                setShowBadge(false)
            }
        )
    }

    companion object {
        const val CHANNEL_PET = "pet"
        lateinit var instance: App
            private set
    }
}
