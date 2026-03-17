package com.example.picofleetagent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

val baseUrl = ApiConfig.BASE_URL

private const val TAG = "PicoFleet"
private const val HEARTBEAT_WORK_NAME = "heartbeat_loop"
private const val NOTIF_CHANNEL_ID = "telemetry"

data class HeartbeatResult(
    val nextDelaySeconds: Long,
    val shouldRetry: Boolean
)

class HeartbeatWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        setForegroundAsync(createForegroundInfo(applicationContext)).get()
        Log.d(TAG, "HeartbeatWorker started, baseUrl=$baseUrl")

        return try {
            val result = sendHeartbeatNow(applicationContext)
            Log.d(
                TAG,
                "HeartbeatWorker finished, nextDelay=${result.nextDelaySeconds}s retry=${result.shouldRetry}"
            )

            // NOTE:
            // Agar tum HeartbeatService ko primary loop bana rahi ho,
            // to neeche wali line hata dena.
            scheduleNextHeartbeat(applicationContext, result.nextDelaySeconds)

            if (result.shouldRetry) Result.retry() else Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "HeartbeatWorker failed hard", e)

            // NOTE:
            // Agar HeartbeatService primary loop hai, to ye bhi hata dena.
            scheduleNextHeartbeat(applicationContext, 60)

            Result.retry()
        }
    }

    companion object {

        private val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .build()

        fun sendHeartbeatNow(ctx: Context): HeartbeatResult {
            val url = "$baseUrl/heartbeat"
            val startedAt = System.currentTimeMillis()

            return try {
                Log.d(TAG, "Preparing heartbeat payload...")

                val snap = collectSnapshot(ctx)

                val installedApps = collectInstalledApps(ctx)
                Log.d(TAG, "Installed apps count = ${installedApps.length()}")

                val jsonObj = JSONObject()
                    .put("serial_number", snap.serialNumber)
                    .put("model", snap.model)
                    .put("brand", snap.brand)
                    .put("android_version", snap.androidVersion)
                    .put("pui_version", snap.puiVersion)
                    .put("software_version", snap.softwareVersion)
                    .put("storage_used_mb", snap.storageUsedMb)
                    .put("storage_total_mb", snap.storageTotalMb)
                    .put("volume_current", snap.volumeCurrent)
                    .put("volume_max", snap.volumeMax)
                    .put("brightness", snap.brightness)
                    .put("uptime_minutes", snap.uptimeMinutes)
                    .put("is_online", snap.isOnline)
                    .put("battery", snap.batteryPercent)
                    .put("charging", snap.charging)
                    .put("temperature_c", snap.batteryTempC)
                    .put("health", snap.batteryHealth)
                    .put("thermal_status", snap.thermalStatus)
                    .put("controller_l", snap.controllerLPercent)
                    .put("controller_r", snap.controllerRPercent)
                    .put("wifi_ssid", snap.wifiSsid)
                    .put("wifi_rssi", snap.wifiRssi)
                    .put("wifi_frequency_mhz", snap.wifiFrequencyMhz)
                    .put("wifi_link_mbps", snap.wifiLinkSpeedMbps)
                    .put("wifi_bssid", snap.wifiBssid)
                    .put("ip_address", snap.ipAddress)
                    .put("mac_address", snap.macAddress)
                    .put("installed_apps", installedApps)

                val json = jsonObj.toString()
                Log.d(TAG, "Posting heartbeat to $url, payloadBytes=${json.toByteArray().size}")

                val body = json.toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url(url)
                    .post(body)
                    .build()

                client.newCall(req).execute().use { res ->
                    val tookMs = System.currentTimeMillis() - startedAt
                    Log.d(TAG, "Heartbeat response code=${res.code} tookMs=$tookMs")

                    val respBody = res.body?.string()

                    if (respBody.isNullOrEmpty()) {
                        Log.d(TAG, "Heartbeat response body is empty")
                    } else {
                        val preview =
                            if (respBody.length > 300) respBody.substring(0, 300) + "..." else respBody
                        Log.d(TAG, "Heartbeat response preview=$preview")
                    }

                    if (res.isSuccessful) {
                        if (!respBody.isNullOrEmpty()) {
                            try {
                                val obj = JSONObject(respBody)
                                val jobs = obj.optJSONArray("jobs")
                                val jobsCount = jobs?.length() ?: 0
                                Log.d(TAG, "Parsed jobsCount=$jobsCount")

                                if (jobs != null && jobsCount > 0) {
                                    handleJobs(ctx, jobs)
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Failed parsing jobs JSON", e)
                            }
                        }

                        // FIX:
                        // Pehle jobs milne par 5 sec tha, ab stable delay rakha hai
                        HeartbeatResult(nextDelaySeconds = 30L, shouldRetry = false)
                    } else {
                        Log.w(TAG, "Heartbeat not successful, code=${res.code}, will retry")
                        HeartbeatResult(nextDelaySeconds = 60L, shouldRetry = true)
                    }
                }
            } catch (e: Exception) {
                when (e) {
                    is UnknownHostException -> Log.e(
                        TAG,
                        "Heartbeat failed, UnknownHost (DNS or wrong IP/host). url=$url",
                        e
                    )

                    is SocketTimeoutException -> Log.e(
                        TAG,
                        "Heartbeat failed, Timeout (network slow or blocked). url=$url",
                        e
                    )

                    is ConnectException -> Log.e(
                        TAG,
                        "Heartbeat failed, ConnectException (server down, firewall, wrong port). url=$url",
                        e
                    )

                    else -> Log.e(TAG, "sendHeartbeatNow failed, url=$url", e)
                }

                HeartbeatResult(nextDelaySeconds = 60L, shouldRetry = true)
            }
        }

        private fun handleJobs(ctx: Context, jobs: JSONArray) {
            Log.d(TAG, "handleJobs start, count=${jobs.length()}")

            for (i in 0 until jobs.length()) {
                val job = jobs.getJSONObject(i)
                val type = job.optString("type")
                val jobId = job.optString("job_id")

                Log.d(TAG, "Job[$i] type=$type jobId=$jobId")

                when (type) {
                    "install_apk" -> {
                        val apkUrl = job.optString("apk_download_url")
                        val label = job.optString("apk_label", "App")

                        Log.d(TAG, "install_apk jobId=$jobId label=$label apkUrl=$apkUrl")

                        if (apkUrl.isNotEmpty() && jobId.isNotEmpty()) {
                            try {
                                handleInstallJob(ctx, jobId, apkUrl, label)
                            } catch (e: Exception) {
                                Log.e(TAG, "Install job failed jobId=$jobId", e)
                            }
                        } else {
                            Log.w(
                                TAG,
                                "install_apk missing fields, jobId=$jobId apkUrlEmpty=${apkUrl.isEmpty()}"
                            )
                        }
                    }

                    else -> Log.d(TAG, "Unknown job type: $type")
                }
            }

            Log.d(TAG, "handleJobs end")
        }

        /**
         * FIXED FLOW:
         * - APK download heartbeat ke andar nahi hogi
         * - Sirf pending install metadata save hogi
         * - Actual download InstallNowActivity mein hogi
         */
        private fun handleInstallJob(ctx: Context, jobId: String, apkUrl: String, label: String) {
            Log.d(TAG, "handleInstallJob start jobId=$jobId url=$apkUrl label=$label")

            if (JobStore.hasPendingInstall(ctx, jobId)) {
                Log.d(TAG, "Job already pending, skipping save, jobId=$jobId")
                return
            }

            JobStore.addPendingInstall(
                ctx = ctx,
                jobId = jobId,
                label = label,
                apkUrl = apkUrl,
                apkPath = "",
                expectedPkg = "",
                baseUrl = baseUrl
            )

            Log.d(TAG, "Saved pending install metadata only, no download, jobId=$jobId")
        }

        fun scheduleNextHeartbeat(ctx: Context, delaySeconds: Long) {
            Log.d(TAG, "Scheduling next heartbeat in ${delaySeconds}s")

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val next = OneTimeWorkRequestBuilder<HeartbeatWorker>()
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(ctx)
                .enqueueUniqueWork(
                    HEARTBEAT_WORK_NAME,
                    ExistingWorkPolicy.KEEP,
                    next
                )
        }

        fun createForegroundInfo(ctx: Context): ForegroundInfo {
            ensureNotificationChannel(ctx)

            val notification = NotificationCompat.Builder(ctx, NOTIF_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Fleet telemetry")
                .setContentText("Collecting device status")
                .setOngoing(true)
                .build()

            return ForegroundInfo(1001, notification)
        }

        private fun ensureNotificationChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm =
                    ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val existing = nm.getNotificationChannel(NOTIF_CHANNEL_ID)
                if (existing == null) {
                    val ch = NotificationChannel(
                        NOTIF_CHANNEL_ID,
                        "Telemetry",
                        NotificationManager.IMPORTANCE_LOW
                    )
                    nm.createNotificationChannel(ch)
                }
            }
        }
    }
}