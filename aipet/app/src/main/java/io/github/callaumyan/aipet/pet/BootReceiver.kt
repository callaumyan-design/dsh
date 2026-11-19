package io.github.callaumyan.aipet.pet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import io.github.callaumyan.aipet.App

/** 开机后（或 App 更新后）自动把桌宠叫出来——前提是用户之前开着它，并且打开了“开机自动出现”。 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = App.instance.prefs
        if (!prefs.petEnabled || !Overlay.canDraw(context)) return
        if (action == Intent.ACTION_BOOT_COMPLETED && !prefs.autoStart) return
        try {
            PetService.start(context)
        } catch (e: Exception) {
            Log.w("BootReceiver", "cannot start pet", e)
        }
    }
}
