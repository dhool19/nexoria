package com.example.picofleetagent

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt
import java.net.NetworkInterface
import java.util.Collections

private const val INVALID_BSSID = "02:00:00:00:00:00"
private const val UNKNOWN_SSID = "<unknown ssid>"

data class DeviceSnapshot(
    val serialNumber: String,
    val model: String,
    val brand: String,
    val androidVersion: String,
    val puiVersion: String,
    val softwareVersion: String,
    val storageUsedMb: Long,
    val storageTotalMb: Long,
    val volumeCurrent: Int,
    val volumeMax: Int,
    val brightness: Int?,
    val uptimeMinutes: Long,
    val isOnline: Boolean,

    val batteryPercent: Int,
    val charging: Boolean,
    val batteryTempC: Double,
    val batteryHealth: String,

    val controllerLPercent: Int?,
    val controllerRPercent: Int?,

    val thermalStatus: Int,

    val wifiSsid: String?,
    val wifiRssi: Int?,
    val wifiFrequencyMhz: Int?,
    val wifiLinkSpeedMbps: Int?,
    val wifiBssid: String?,
    val ipAddress: String,
    val macAddress: String
)

data class WifiReading(
    val ssid: String?,
    val rssi: Int?,
    val freqMhz: Int?,
    val linkMbps: Int?,
    val downMbpsFallback: Int?,
    val bssid: String?
)

fun collectSnapshot(ctx: Context): DeviceSnapshot {
    val androidId =
        Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

    val model = Build.MODEL ?: "unknown"
    val brand = Build.BRAND ?: "unknown"
    val androidVersion = "Android " + Build.VERSION.RELEASE
    val puiVersion = Build.DISPLAY ?: "-"
    val softwareVersion = Build.ID ?: "-"

    val stat = StatFs(Environment.getDataDirectory().path)
    val totalBytes = stat.totalBytes
    val freeBytes = stat.availableBytes
    val usedBytes = totalBytes - freeBytes
    val usedMb = usedBytes / (1024 * 1024)
    val totalMb = totalBytes / (1024 * 1024)

    val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val volNow = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
    val volMax = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)

    val brightness = try {
        val v = Settings.System.getInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, -1)
        if (v >= 0) v else null
    } catch (_: Exception) {
        null
    }

    val uptimeMin = SystemClock.elapsedRealtime() / 60000L

    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

    val battIntent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val tempC = (battIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
    val healthCode = battIntent?.getIntExtra(
        BatteryManager.EXTRA_HEALTH,
        BatteryManager.BATTERY_HEALTH_UNKNOWN
    ) ?: BatteryManager.BATTERY_HEALTH_UNKNOWN

    val batteryHealth = when (healthCode) {
        BatteryManager.BATTERY_HEALTH_GOOD -> "good"
        BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
        BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
        BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
        BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
        BatteryManager.BATTERY_HEALTH_COLD -> "cold"
        else -> "unknown"
    }

    val status = battIntent?.getIntExtra(
        BatteryManager.EXTRA_STATUS,
        BatteryManager.BATTERY_STATUS_UNKNOWN
    ) ?: BatteryManager.BATTERY_STATUS_UNKNOWN

    val plugged = battIntent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL ||
            plugged == BatteryManager.BATTERY_PLUGGED_USB ||
            plugged == BatteryManager.BATTERY_PLUGGED_AC ||
            plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS

    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val thermalStatus = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        pm.currentThermalStatus
    } else {
        0
    }

    val wifiReading = readWifiStable(ctx)

    val ip = firstNonLoopbackIpv4()
    val mac = getMacAddressBestEffort()

    val linkToSend = wifiReading.linkMbps ?: wifiReading.downMbpsFallback

    return DeviceSnapshot(
        serialNumber = androidId,
        model = model,
        brand = brand,
        androidVersion = androidVersion,
        puiVersion = puiVersion,
        softwareVersion = softwareVersion,
        storageUsedMb = usedMb,
        storageTotalMb = totalMb,
        volumeCurrent = volNow,
        volumeMax = volMax,
        brightness = brightness,
        uptimeMinutes = uptimeMin,
        isOnline = true,
        batteryPercent = batteryPct,
        charging = charging,
        batteryTempC = (tempC * 10.0).roundToInt() / 10.0,
        batteryHealth = batteryHealth,
        controllerLPercent = null,
        controllerRPercent = null,
        thermalStatus = thermalStatus,
        wifiSsid = wifiReading.ssid,
        wifiRssi = wifiReading.rssi,
        wifiFrequencyMhz = wifiReading.freqMhz,
        wifiLinkSpeedMbps = linkToSend,
        wifiBssid = wifiReading.bssid,
        ipAddress = ip,
        macAddress = mac
    )
}

@Suppress("MissingPermission")
private fun readWifiStable(ctx: Context): WifiReading {
    val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    val locOn = try {
        Settings.Secure.getInt(
            ctx.contentResolver,
            Settings.Secure.LOCATION_MODE
        ) != Settings.Secure.LOCATION_MODE_OFF
    } catch (_: Exception) {
        false
    }

    val active = cm.activeNetwork
    val caps = active?.let { cm.getNetworkCapabilities(it) }
    val onWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true

    val info = wm.connectionInfo

    val rawSsid = info?.ssid?.trim('"')
    val rawBssid = info?.bssid
    val rawFreq = info?.frequency
    val rawLink = info?.linkSpeed
    val rawRssi = info?.rssi

    val isValidNow =
        locOn &&
                onWifi &&
                !rawBssid.isNullOrEmpty() &&
                rawBssid != INVALID_BSSID &&
                !rawSsid.isNullOrEmpty() &&
                rawSsid != UNKNOWN_SSID

    val prefs = ctx.getSharedPreferences("wifi_cache", Context.MODE_PRIVATE)

    var ssid: String? = prefs.getString("last_ssid", null)
    var bssid: String? = prefs.getString("last_bssid", null)
    var freq: Int? = prefs.getInt("last_freq", -1).takeIf { it != -1 }
    var link: Int? = prefs.getInt("last_link", -1).takeIf { it != -1 }
    var rssi: Int? = prefs.getInt("last_rssi", Int.MIN_VALUE).takeIf { it != Int.MIN_VALUE }

    if (isValidNow) {
        ssid = rawSsid
        bssid = rawBssid
        freq = rawFreq
        link = rawLink
        rssi = rawRssi

        prefs.edit()
            .putString("last_ssid", ssid)
            .putString("last_bssid", bssid)
            .putInt("last_freq", freq ?: -1)
            .putInt("last_link", link ?: -1)
            .putInt("last_rssi", rssi ?: Int.MIN_VALUE)
            .apply()
    }

    val downFallback = caps?.linkDownstreamBandwidthKbps?.let { it / 1000 }

    return WifiReading(
        ssid = ssid,
        rssi = rssi,
        freqMhz = freq,
        linkMbps = link,
        downMbpsFallback = downFallback,
        bssid = bssid
    )
}

private fun firstNonLoopbackIpv4(): String {
    val ifaces = NetworkInterface.getNetworkInterfaces() ?: return "unknown"
    for (iface in Collections.list(ifaces)) {
        for (addr in Collections.list(iface.inetAddresses)) {
            val host = addr.hostAddress ?: continue
            if (!addr.isLoopbackAddress && !host.contains(":")) return host
        }
    }
    return "unknown"
}

private fun getMacAddressBestEffort(): String {
    return try {
        val ni = NetworkInterface.getByName("wlan0")
        val mac = ni?.hardwareAddress ?: return "unknown"
        mac.joinToString(":") { b -> "%02X".format(b) }
    } catch (_: Exception) {
        "unknown"
    }
}

/**
 * Decide whether installed apps should be sent in this heartbeat.
 * Default: once every 6 hours only.
 */
fun shouldSendInstalledApps(ctx: Context): Boolean {
    val prefs = ctx.getSharedPreferences("agent_state", Context.MODE_PRIVATE)
    val last = prefs.getLong("last_apps_snapshot_ms", 0L)
    val now = System.currentTimeMillis()
    val everyMs = 6 * 60 * 60 * 1000L

    return if (now - last >= everyMs) {
        prefs.edit().putLong("last_apps_snapshot_ms", now).apply()
        true
    } else {
        false
    }
}

/**
 * Collect a lightweight list of installed user visible apps.
 * This should not be sent on every heartbeat.
 */
@Suppress("QueryPermissionsNeeded")
fun collectInstalledApps(ctx: Context): JSONArray {
    val pm = ctx.packageManager
    val apps = pm.getInstalledApplications(0)

    val appList = mutableListOf<JSONObject>()

    for (app in apps) {
        val isSystem = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        if (isSystem) continue

        val launchIntent = pm.getLaunchIntentForPackage(app.packageName)
        if (launchIntent == null) continue

        val label = try {
            pm.getApplicationLabel(app).toString()
        } catch (_: Exception) {
            app.packageName
        }

        val pkgInfo = try {
            pm.getPackageInfo(app.packageName, 0)
        } catch (_: Exception) {
            null
        }

        val versionName = pkgInfo?.versionName ?: ""
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkgInfo?.longVersionCode ?: 0L
        } else {
            @Suppress("DEPRECATION")
            (pkgInfo?.versionCode ?: 0).toLong()
        }

        val obj = JSONObject()
            .put("package_name", app.packageName)
            .put("label", label)
            .put("version_name", versionName)
            .put("version_code", versionCode)

        appList.add(obj)
    }

    val sorted = appList.sortedBy { it.optString("label").lowercase() }

    val arr = JSONArray()
    for (obj in sorted) {
        arr.put(obj)
    }

    return arr
}