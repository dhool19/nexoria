package com.example.picofleetagent

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    // Location permissions (multiple)
    private val requestLocationPerms = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no-op */ }

    // Notification permission (single) for Android 13+
    private val requestNotifPerm = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* no-op */ }

    private fun ensureLocationPerms() {
        val needFine = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) != PackageManager.PERMISSION_GRANTED

        val needCoarse = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) != PackageManager.PERMISSION_GRANTED

        if (needFine || needCoarse) {
            requestLocationPerms.launch(
                arrayOf(
                    android.Manifest.permission.ACCESS_COARSE_LOCATION,
                    android.Manifest.permission.ACCESS_FINE_LOCATION
                )
            )
        }
    }

    private fun ensureNotifPerm() {
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

            if (!granted) {
                requestNotifPerm.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Wi-Fi SSID etc (Android 10+)
        ensureLocationPerms()

        // Notifications (Android 13+) for install notifications
        ensureNotifPerm()

        // Start Foreground Service (continuous monitoring)
        try {
            ContextCompat.startForegroundService(
                this,
                Intent(this, HeartbeatService::class.java)
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // UI (welcome)
        setContent {
            WelcomeScreen(
                onClose = {
                    // app ko band nahi karna, sirf background me bhejna
                    moveTaskToBack(true)
                }
            )
        }
    }
}