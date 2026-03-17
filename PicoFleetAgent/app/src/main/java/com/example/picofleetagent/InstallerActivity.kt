package com.example.picofleetagent

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.FileProvider
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class InstallerActivity : Activity() {

    private var apkPath: String = ""
    private var jobId: String = ""
    private var expectedPkg: String = ""
    private var baseUrl: String = ""
    private var installIntentLaunched: Boolean = false
    private var tries = 0

    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    companion object {
        private const val TAG = "PicoFleet"
        private const val MAX_INSTALL_CHECK_RETRIES = 4
        private const val INSTALL_CHECK_DELAY_MS = 1200L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        apkPath = intent.getStringExtra("apk_path") ?: ""
        jobId = intent.getStringExtra("job_id") ?: ""
        expectedPkg = intent.getStringExtra("expected_pkg") ?: ""
        baseUrl = intent.getStringExtra("base_url") ?: ""

        if (apkPath.isBlank()) {
            Log.e(TAG, "InstallerActivity missing apk_path")
            finish()
            return
        }

        val apkFile = File(apkPath)
        if (!apkFile.exists()) {
            Log.e(TAG, "InstallerActivity apk file not found: $apkPath")
            finish()
            return
        }

        if (expectedPkg.isBlank()) {
            expectedPkg = getPkgFromApk(apkPath)
            Log.d(TAG, "Fallback expectedPkg from APK = '$expectedPkg'")
        }

        launchInstaller(apkFile)
    }

    override fun onResume() {
        super.onResume()

        if (!installIntentLaunched) return

        checkInstallStatus()
    }

    private fun launchInstaller(apkFile: File) {
        try {
            val uri = FileProvider.getUriForFile(
                this,
                "com.example.picofleetagent.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                addCategory(Intent.CATEGORY_DEFAULT)
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            installIntentLaunched = true
            startActivity(installIntent)
            Log.d(TAG, "Installer intent launched for path=$apkPath")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch installer intent", e)
            finish()
        }
    }

    private fun checkInstallStatus() {
        val pkgFromApk = if (apkPath.isNotBlank()) getPkgFromApk(apkPath) else ""

        val pkgToCheck = when {
            expectedPkg.isNotBlank() -> expectedPkg
            pkgFromApk.isNotBlank() -> pkgFromApk
            else -> ""
        }

        if (pkgToCheck.isBlank()) {
            Log.w(TAG, "Could not determine package name, removing pending install for jobId=$jobId")
            JobStore.removePendingInstall(this, jobId)

            if (jobId.isNotBlank() && baseUrl.isNotBlank()) {
                markJobComplete(jobId, baseUrl)
            }

            finish()
            return
        }

        val installed = isInstalled(pkgToCheck)
        Log.d(TAG, "Install check for pkg=$pkgToCheck installed=$installed try=$tries")

        if (installed) {
            Log.d(TAG, "Package installed successfully: $pkgToCheck")
            JobStore.removePendingInstall(this, jobId)

            if (jobId.isNotBlank() && baseUrl.isNotBlank()) {
                markJobComplete(jobId, baseUrl)
            }

            safeDeleteApk(apkPath)
            finish()
            return
        }

        if (tries < MAX_INSTALL_CHECK_RETRIES) {
            tries++
            mainHandler.postDelayed(
                { checkInstallStatus() },
                INSTALL_CHECK_DELAY_MS
            )
        } else {
            Log.w(TAG, "Install not confirmed after retries, leaving pending install as-is")
            finish()
        }
    }

    private fun isInstalled(pkg: String): Boolean {
        return try {
            packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun getPkgFromApk(apkPath: String): String {
        return try {
            val pm = packageManager
            val info = pm.getPackageArchiveInfo(
                apkPath,
                android.content.pm.PackageManager.GET_ACTIVITIES
            )

            val appInfo = info?.applicationInfo
            if (appInfo != null) {
                appInfo.sourceDir = apkPath
                appInfo.publicSourceDir = apkPath
            }

            info?.packageName.orEmpty()
        } catch (e: Exception) {
            Log.e(TAG, "getPkgFromApk failed", e)
            ""
        }
    }

    private fun safeDeleteApk(path: String) {
        if (path.isBlank()) return

        try {
            val file = File(path)
            if (file.exists()) {
                val deleted = file.delete()
                Log.d(TAG, "Deleted APK cache=$deleted path=$path")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete APK file: $path", e)
        }
    }

    private fun markJobComplete(jobId: String, baseUrl: String) {
        Thread {
            try {
                val url = "${baseUrl.trimEnd('/')}/api/jobs/$jobId/complete"
                val body = "{}".toRequestBody("application/json".toMediaType())
                val req = Request.Builder()
                    .url(url)
                    .post(body)
                    .build()

                client.newCall(req).execute().use { res ->
                    Log.d(TAG, "markJobComplete from InstallerActivity code=${res.code}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "markJobComplete failed in InstallerActivity", e)
            }
        }.start()
    }
}