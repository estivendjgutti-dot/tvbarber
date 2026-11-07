package com.estiven4tech.tvlauncher

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Exposto no JS como `window.Android`.
 * Toda chamada é recusada se a página atual não for de uma origem autorizada.
 */
class JsBridge(
    private val activity: MainActivity,
    private val isTrusted: () -> Boolean,
) {
    private val pm: PackageManager get() = activity.packageManager

    /** Lista apps instaláveis/abríveis: [{label, package}] */
    @JavascriptInterface
    fun listApps(): String {
        if (!isTrusted()) return "[]"
        val seen = mutableMapOf<String, String>()
        for (category in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(category)
            for (ri in pm.queryIntentActivities(intent, 0)) {
                val pkg = ri.activityInfo.packageName
                if (pkg == activity.packageName || seen.containsKey(pkg)) continue
                seen[pkg] = ri.loadLabel(pm).toString()
            }
        }
        val arr = JSONArray()
        seen.entries.sortedBy { it.value.lowercase() }.forEach { (pkg, label) ->
            arr.put(JSONObject().put("label", label).put("package", pkg))
        }
        return arr.toString()
    }

    /** Banner (TV) ou ícone do app como data URL PNG. "" se não existir. */
    @JavascriptInterface
    fun getAppImage(pkg: String): String {
        if (!isTrusted()) return ""
        return try {
            val info = pm.getApplicationInfo(pkg, 0)
            val drawable = pm.getApplicationBanner(info) ?: pm.getApplicationIcon(info)
            "data:image/png;base64," + toPngBase64(drawable)
        } catch (e: Exception) {
            ""
        }
    }

    @JavascriptInterface
    fun isInstalled(pkg: String): Boolean {
        if (!isTrusted()) return false
        return launchIntentFor(pkg) != null
    }

    @JavascriptInterface
    fun launchApp(pkg: String): Boolean {
        if (!isTrusted()) return false
        val intent = launchIntentFor(pkg) ?: return false
        activity.runOnUiThread {
            activity.allowInKiosk(pkg)
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return true
    }

    @JavascriptInterface
    fun openSettings() {
        if (!isTrusted()) return
        val intent = Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pkg = intent.resolveActivity(pm)?.packageName ?: return
        activity.runOnUiThread {
            activity.allowInKiosk(pkg)
            activity.startActivity(intent)
        }
    }

    /** Recarrega a interface (tenta a remota de novo se houver rede). */
    @JavascriptInterface
    fun reload() {
        if (!isTrusted()) return
        activity.runOnUiThread { activity.loadStart() }
    }

    /** Desliga o kiosk (lock task + Device Owner). Proteja com PIN/combinação na UI. */
    @JavascriptInterface
    fun exitKiosk() {
        if (!isTrusted()) return
        activity.runOnUiThread { activity.exitKiosk() }
    }

    @JavascriptInterface
    fun deviceInfo(): String {
        if (!isTrusted()) return "{}"
        val pInfo = pm.getPackageInfo(activity.packageName, 0)
        return JSONObject()
            .put("model", Build.MODEL)
            .put("manufacturer", Build.MANUFACTURER)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("appVersion", pInfo.versionName)
            .put("isTv", pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK))
            .put("kiosk", activity.isDeviceOwner())
            .put("online", activity.isOnline())
            .toString()
    }

    // ---------------------------------------------------------------- util

    private fun launchIntentFor(pkg: String): Intent? =
        pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)

    private fun toPngBase64(d: Drawable): String {
        val bmp = if (d is BitmapDrawable && d.bitmap != null) {
            d.bitmap
        } else {
            val w = if (d.intrinsicWidth > 0) d.intrinsicWidth else 192
            val h = if (d.intrinsicHeight > 0) d.intrinsicHeight else 192
            Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
                val c = Canvas(it)
                d.setBounds(0, 0, c.width, c.height)
                d.draw(c)
            }
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
