package com.smsrelay.secure

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.smsrelay.secure.core.Http
import com.smsrelay.secure.forward.Forwarder

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Http.userAgent = "SmsRelay/${BuildConfig.VERSION_NAME}"
        Notifier.createChannels(this)
    }
}

/** Restarts the background service after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                RelayService.sync(context)
                Forwarder.schedule(context)
            }
        }
    }
}
