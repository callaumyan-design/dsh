package com.smsrelay.secure

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.smsrelay.secure.data.Settings
import com.smsrelay.secure.receive.RelayLoop

/**
 * Foreground service that
 *  - keeps the app process alive so incoming SMS are forwarded promptly (sending phone), and
 *  - holds the encrypted relay connection open (receiving phone).
 */
class RelayService : Service() {
    private var receiver: RelayLoop? = null
    private var commands: RelayLoop? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        goForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        val s = Settings(this)
        if (!s.needsService()) {
            stopReceiver()
            stopCommands()
            stopSelf()
            return START_NOT_STICKY
        }
        val restart = intent?.getBooleanExtra(EXTRA_RESTART_RX, false) == true
        if (s.receiverConfigured()) {
            if (restart) stopReceiver()
            if (receiver?.isRunning != true) receiver = RelayLoop.receiver(applicationContext).also { it.start() }
        } else {
            stopReceiver()
        }
        if (s.remoteConfigured()) {
            if (restart) stopCommands()
            if (commands?.isRunning != true) commands = RelayLoop.commands(applicationContext).also { it.start() }
        } else {
            stopCommands()
        }
        return START_STICKY
    }

    private fun goForeground() {
        val n = Notifier.serviceNotification(this, Settings(this))
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Notifier.ID_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(Notifier.ID_SERVICE, n)
        }
    }

    private fun stopReceiver() {
        receiver?.stop()
        receiver = null
    }

    private fun stopCommands() {
        commands?.stop()
        commands = null
    }

    override fun onDestroy() {
        stopReceiver()
        stopCommands()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_RESTART_RX = "restart_rx"

        /** Starts or stops the service to match the current settings. */
        fun sync(context: Context, restartReceiver: Boolean = false) {
            val s = Settings(context)
            val intent = Intent(context, RelayService::class.java).putExtra(EXTRA_RESTART_RX, restartReceiver)
            try {
                if (s.needsService()) {
                    context.startForegroundService(intent)
                } else {
                    context.stopService(intent)
                }
            } catch (_: RuntimeException) {
                // Starting a foreground service from the background can be refused by the system;
                // it will be started the next time the app is opened or the phone reboots.
            }
        }
    }
}
