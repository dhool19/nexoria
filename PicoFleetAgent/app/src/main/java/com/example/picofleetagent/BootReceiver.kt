package com.example.picofleetagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.d("PicoFleet", "BootReceiver action=$action")

        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                try {
                    ContextCompat.startForegroundService(
                        context,
                        Intent(context, HeartbeatService::class.java)
                    )
                    Log.d("PicoFleet", "HeartbeatService started from boot")
                } catch (e: Exception) {
                    Log.e("PicoFleet", "Failed to start HeartbeatService from boot", e)
                }
            }
        }
    }
}