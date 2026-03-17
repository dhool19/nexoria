package com.example.picofleetagent

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class InstallNowActivity : Activity() {

    companion object {
        private const val TAG = "PicoFleet"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val jobId = intent.getStringExtra("job_id") ?: ""
        val apkUrl = intent.getStringExtra("apk_url") ?: ""
        val expectedPkgFromIntent = intent.getStringExtra("expected_pkg") ?: ""
        val baseUrl = intent.getStringExtra("base_url") ?: ApiConfig.BASE_URL

        if (jobId.isBlank() || apkUrl.isBlank()) {
            Log.e(TAG, "InstallNowActivity missing jobId or apkUrl")
            finish()
            return
        }

        Thread {
            try {
                Log.d(TAG, "InstallNowActivity downloading APK, jobId=$jobId url=$apkUrl")

                val apkFile = downloadToCache(apkUrl)
                if (apkFile == null) {
                    Log.e(TAG, "APK download failed, jobId=$jobId")
                    runOnUiThread { finish() }
                    return@Thread
                }

                Log.d(TAG, "APK downloaded: ${apkFile.absolutePath}")

                // Save downloaded file path in JobStore
                try {
                    JobStore.updatePendingInstallFile(
                        ctx = this,
                        jobId = jobId,
                        apkPath = apkFile.absolutePath
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to update pending install file path", e)
                }

                // Resolve expected package if not already present
                var resolvedExpectedPkg = expectedPkgFromIntent
                if (resolvedExpectedPkg.isBlank()) {
                    resolvedExpectedPkg = getApkPackageName(apkFile)
                    if (resolvedExpectedPkg.isNotBlank()) {
                        try {
                            JobStore.updatePendingInstallExpectedPkg(
                                ctx = this,
                                jobId = jobId,
                                expectedPkg = resolvedExpectedPkg
                            )
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to update expected package in JobStore", e)
                        }
                    }
                }

                val installIntent = Intent(this, InstallerActivity::class.java).apply {
                    putExtra("apk_path", apkFile.absolutePath)
                    putExtra("job_id", jobId)
                    putExtra("expected_pkg", resolvedExpectedPkg)
                    putExtra("base_url", baseUrl)
                }

                runOnUiThread {
                    try {
                        startActivity(installIntent)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to start InstallerActivity", e)
                    } finally {
                        finish()
                    }
                }

            } catch (e: Exception) {
                Log.e(TAG, "InstallNowActivity failed", e)
                runOnUiThread { finish() }
            }
        }.start()
    }

    private fun downloadToCache(url: String): File? {
        val req = Request.Builder()
            .url(url)
            .get()
            .build()

        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                Log.e(TAG, "Download failed HTTP ${res.code} for url=$url")
                return null
            }

            val body = res.body ?: run {
                Log.e(TAG, "Download response body is null")
                return null
            }

            val file = File(cacheDir, "install-${System.currentTimeMillis()}.apk")
            FileOutputStream(file).use { out ->
                body.byteStream().copyTo(out)
            }

            return file
        }
    }

    private fun getApkPackageName(apkFile: File): String {
        return try {
            val pm = packageManager
            val pkgInfo = pm.getPackageArchiveInfo(apkFile.absolutePath, 0)
            pkgInfo?.packageName ?: ""
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read package name from APK", e)
            ""
        }
    }
}