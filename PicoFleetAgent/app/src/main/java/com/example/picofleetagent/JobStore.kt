package com.example.picofleetagent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object JobStore {
    private const val PREFS = "jobs_store"
    private const val KEY_PENDING_INSTALLS = "pending_installs"

    fun hasPendingInstall(ctx: Context, jobId: String): Boolean {
        val arr = getPendingInstalls(ctx)
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("job_id") == jobId) return true
        }
        return false
    }

    fun addPendingInstall(
        ctx: Context,
        jobId: String,
        label: String,
        apkUrl: String,
        apkPath: String,
        expectedPkg: String,
        baseUrl: String
    ) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY_PENDING_INSTALLS, "[]"))

        // avoid duplicates
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("job_id") == jobId) return
        }

        val obj = JSONObject()
            .put("job_id", jobId)
            .put("label", label)
            .put("apk_url", apkUrl)
            .put("apk_path", apkPath)
            .put("expected_pkg", expectedPkg)
            .put("base_url", baseUrl)

        arr.put(obj)
        prefs.edit().putString(KEY_PENDING_INSTALLS, arr.toString()).apply()
    }

    fun getPendingInstalls(ctx: Context): JSONArray {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return JSONArray(prefs.getString(KEY_PENDING_INSTALLS, "[]"))
    }

    fun removePendingInstall(ctx: Context, jobId: String) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY_PENDING_INSTALLS, "[]"))
        val out = JSONArray()

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("job_id") != jobId) {
                out.put(o)
            }
        }

        prefs.edit().putString(KEY_PENDING_INSTALLS, out.toString()).apply()
    }

    // NEW: update APK file path after download
    fun updatePendingInstallFile(ctx: Context, jobId: String, apkPath: String) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY_PENDING_INSTALLS, "[]"))

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("job_id") == jobId) {
                o.put("apk_path", apkPath)
                break
            }
        }

        prefs.edit().putString(KEY_PENDING_INSTALLS, arr.toString()).apply()
    }

    // NEW: update expected package name after reading APK
    fun updatePendingInstallExpectedPkg(ctx: Context, jobId: String, expectedPkg: String) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY_PENDING_INSTALLS, "[]"))

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("job_id") == jobId) {
                o.put("expected_pkg", expectedPkg)
                break
            }
        }

        prefs.edit().putString(KEY_PENDING_INSTALLS, arr.toString()).apply()
    }
}