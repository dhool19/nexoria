package com.example.picofleetagent

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import java.util.concurrent.TimeUnit

class UpdatesActivity : Activity() {

    private lateinit var listView: ListView
    private lateinit var adapter: ArrayAdapter<String>
    private val labels = mutableListOf<String>()
    private var arr: JSONArray = JSONArray()

    private val greenBg = 0xFF00C853.toInt()

    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .writeTimeout(6, TimeUnit.SECONDS)
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Root layout
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(greenBg)
            setPadding(dp(16), dp(18), dp(16), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        // Header
        val title = TextView(this).apply {
            text = "Updates"
            textSize = 22f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, dp(6))
        }

        val subtitle = TextView(this).apply {
            text = "Tap an item to install"
            textSize = 14f
            setTextColor(0xE6FFFFFF.toInt())
            setPadding(0, 0, 0, dp(12))
        }

        // List
        listView = ListView(this).apply {
            dividerHeight = 0
            cacheColorHint = greenBg
            setBackgroundColor(0x00000000) // transparent
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, labels) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(0xFFFFFFFF.toInt())
                v.textSize = 16f
                v.setPadding(dp(14), dp(14), dp(14), dp(14))
                v.setBackgroundColor(0x22000000) // light transparent black
                return v
            }
        }
        listView.adapter = adapter

        listView.setOnItemClickListener { _, _, position, _ ->
            // If we are showing the placeholder line, do nothing
            if (arr.length() == 0) return@setOnItemClickListener
            if (position < 0 || position >= arr.length()) return@setOnItemClickListener

            val obj = arr.getJSONObject(position)

            val jobId = obj.optString("job_id", "")
            val apkPath = obj.optString("apk_path", "")
            val expectedPkg = obj.optString("expected_pkg", "")
            val baseUrl = obj.optString("base_url", ApiConfig.BASE_URL)

            val intent = if (apkPath.isNotBlank()) {
                Intent(this, InstallerActivity::class.java).apply {
                    putExtra("apk_path", apkPath)
                    putExtra("job_id", jobId)
                    putExtra("expected_pkg", expectedPkg)
                    putExtra("base_url", baseUrl)
                }
            } else {
                Intent(this, InstallNowActivity::class.java).apply {
                    putExtra("job_id", jobId)
                    putExtra("apk_url", obj.optString("apk_url", ""))
                    putExtra("expected_pkg", expectedPkg)
                    putExtra("base_url", baseUrl)
                }
            }

            startActivity(intent)
        }

        // Bottom buttons row
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val btnRefresh = Button(this).apply {
            text = "Refresh"
            layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f).apply {
                marginEnd = dp(10)
            }
            setOnClickListener { refresh() }
        }

        val btnBack = Button(this).apply {
            text = "Back to Homepage"
            layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f)
            setOnClickListener { finish() }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(listView)
        btnRow.addView(btnRefresh)
        btnRow.addView(btnBack)
        root.addView(btnRow)

        setContentView(root)
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        // 1) Load pending installs
        arr = JobStore.getPendingInstalls(this)

        // 2) Auto-clean already installed apps (this is the key fix)
        if (arr.length() > 0) {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)

                val jobId = o.optString("job_id", "")
                val expectedPkg = o.optString("expected_pkg", "")
                val baseUrl = o.optString("base_url", ApiConfig.BASE_URL)
                val apkPath = o.optString("apk_path", "")

                if (expectedPkg.isNotBlank() && isInstalled(expectedPkg)) {
                    Log.d("PicoFleet", "Auto-clean installed pkg=$expectedPkg jobId=$jobId")
                    // remove from local pending list
                    JobStore.removePendingInstall(this, jobId)
                    // notify backend (best effort)
                    if (jobId.isNotBlank() && baseUrl.isNotBlank()) {
                        markJobCompleteAsync(jobId, baseUrl)
                    }
                    // delete downloaded apk if present (best effort)
                    if (apkPath.isNotBlank()) {
                        safeDeleteFile(apkPath)
                    }
                }
            }
        }

        // 3) Reload after cleanup
        arr = JobStore.getPendingInstalls(this)

        // 4) Render list
        labels.clear()
        if (arr.length() == 0) {
            labels.add("No updates available")
        } else {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val label = o.optString("label", "App")
                labels.add("Install now: $label")
            }
        }

        adapter.notifyDataSetChanged()
        Log.d("PicoFleet", "UpdatesActivity pending=${arr.length()}")
    }

    private fun isInstalled(pkg: String): Boolean {
        return try {
            packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun markJobCompleteAsync(jobId: String, baseUrl: String) {
        Thread {
            try {
                val url = "${baseUrl.trimEnd('/')}/api/jobs/$jobId/complete"
                val body = "{}".toRequestBody("application/json".toMediaType())
                val req = Request.Builder().url(url).post(body).build()
                http.newCall(req).execute().use { res ->
                    Log.d("PicoFleet", "markJobComplete code=${res.code} jobId=$jobId")
                }
            } catch (e: Exception) {
                Log.e("PicoFleet", "markJobComplete failed jobId=$jobId", e)
            }
        }.start()
    }

    private fun safeDeleteFile(path: String) {
        try {
            val f = java.io.File(path)
            if (f.exists()) {
                val ok = f.delete()
                Log.d("PicoFleet", "Deleted apk file=$path ok=$ok")
            }
        } catch (e: Exception) {
            Log.e("PicoFleet", "Failed to delete file=$path", e)
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}