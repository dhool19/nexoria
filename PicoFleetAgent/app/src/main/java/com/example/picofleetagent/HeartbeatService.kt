package com.example.picofleetagent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class HeartbeatService : Service() {

    companion object {
        private const val TAG = "PicoFleet"
        private const val CHANNEL_ID = "telemetry"
        private const val NOTIFICATION_ID = 1001
        private const val FALLBACK_DELAY_MS = 60_000L
        private const val MIN_DELAY_SECONDS = 10L
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loopJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        Log.d(TAG, "HeartbeatService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loopJob?.isActive == true) {
            Log.d(TAG, "HeartbeatService loop already running")
            return START_STICKY
        }

        loopJob = serviceScope.launch {
            Log.d(TAG, "HeartbeatService loop started")

            while (isActive) {
                try {
                    val result = HeartbeatWorker.sendHeartbeatNow(applicationContext)

                    val nextDelaySeconds = if (result.nextDelaySeconds >= MIN_DELAY_SECONDS) {
                        result.nextDelaySeconds
                    } else {
                        30L
                    }

                    Log.d(TAG, "Service heartbeat ok, next=${nextDelaySeconds}s")
                    delay(nextDelaySeconds * 1000L)

                } catch (e: Exception) {
                    Log.e(TAG, "Service heartbeat failed", e)
                    delay(FALLBACK_DELAY_MS)
                }
            }

            Log.d(TAG, "HeartbeatService loop ended")
        }

        return START_STICKY
    }

    override fun onDestroy() {
        loopJob?.cancel()
        loopJob = null
        serviceScope.cancel()
        Log.d(TAG, "HeartbeatService destroyed")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val existing = nm.getNotificationChannel(CHANNEL_ID)

            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Telemetry",
                    NotificationManager.IMPORTANCE_LOW
                )
                nm.createNotificationChannel(channel)
            }
        }
    }

    private fun buildNotification() =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("NEXORIA")
            .setContentText("Management service running")
            .setOngoing(true)
            .build()
}