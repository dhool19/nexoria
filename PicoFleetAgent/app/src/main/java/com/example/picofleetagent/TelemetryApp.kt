package com.example.picofleetagent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class TelemetryApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "telemetry",
                "Fleet Telemetry",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background telemetry collection"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }
}
