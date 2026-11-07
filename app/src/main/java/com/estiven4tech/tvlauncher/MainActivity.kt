package com.estiven4tech.tvlauncher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {

    companion object {
        private const val TAG = "TvLauncher"
        private const val LOCAL_ORIGIN = "https://appassets.androidplatform.net"
        const val LOCAL_URL = "$LOCAL_ORIGIN/assets/web/index.html"
        private const val RETRY_REMOTE_MS = 60_000L
    }

    private lateinit var container: FrameLayout
    private var webView: WebView? = null
    private lateinit var assetLoader: WebViewAssetLoader
    private val handler = Handler(Looper.getMainLooper())

    /** Origem da página carregada no momento (lida pela ponte JS em outra thread). */
    @Volatile private var currentOrigin: String = ""
    private var usingFallback = false

    private val remoteUrl: String get() = BuildConfig.START_URL.trim()

    private val allowedOrigins: Set<String> by lazy {
        val set = mutableSetOf(LOCAL_ORIGIN)
        originOf(remoteUrl)?.let { set += it }
        BuildConfig.ALLOWED_ORIGINS.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .forEach { o -> originOf(o)?.let { set += it } }
        set
    }

    private val retryRemote = object : Runnable {
        override fun run() {
            if (usingFallback && remoteUrl.isNotEmpty() && isOnline()) {
                Log.i(TAG, "Rede voltou, recarregando interface remota")
                loadStart()
            } else if (usingFallback && remoteUrl.isNotEmpty()) {
                handler.postDelayed(this, RETRY_REMOTE_MS)
            }
        }
    }

    // ---------------------------------------------------------------- ciclo de vida

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        lockLandscapeIfFullscreen()
        useCutoutArea()
        autoEnableHomeOnTv()

        container = FrameLayout(this)
        setContentView(container)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        createWebView()
        loadStart()
        enterImmersive()
        startKioskIfDeviceOwner()
    }

    override fun onResume() {
        super.onResume()
        enterImmersive()
        js("window.onAndroidResume && window.onAndroidResume()")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    // Botão Home -> HomeActivity -> novo intent aqui: volta pro menu.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        js("window.onAndroidHome && window.onAndroidHome()")
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    // Celular em tela cheia: trava em paisagem. Em janela (DeX/multi-janela) deixa livre,
    // senão a Samsung trata o app como "não redimensionável" e mostra o aviso de proporção.
    private fun lockLandscapeIfFullscreen() {
        requestedOrientation =
            if (isInMultiWindowMode) ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        lockLandscapeIfFullscreen()
    }

    // Ocupa a tela inteira, inclusive ao lado do furo da câmera (celular deitado).
    private fun useCutoutArea() {
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    // ---------------------------------------------------------------- papel de tela inicial
    // A HomeActivity (categoria HOME = autostart no boot) vem DESLIGADA no manifest, porque
    // o Samsung DeX se recusa a abrir apps que têm tela inicial ativa. Em box/TV (leanback)
    // ou com kiosk (Device Owner) ela liga sozinha; no celular liga pelo painel técnico.
    private fun homeComponent() = ComponentName(this, HomeActivity::class.java)

    fun isHomeEnabled(): Boolean =
        packageManager.getComponentEnabledSetting(homeComponent()) ==
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    fun setHomeEnabled(on: Boolean) {
        packageManager.setComponentEnabledSetting(
            homeComponent(),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        )
    }

    private fun autoEnableHomeOnTv() {
        val isTv = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        if ((isTv || isDeviceOwner()) && !isHomeEnabled()) {
            try { setHomeEnabled(true) } catch (e: Exception) { Log.w(TAG, "Não ativou HOME", e) }
        }
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val wv = WebView(this)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
        }
        wv.setBackgroundColor(0xFF000000.toInt())
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        wv.addJavascriptInterface(JsBridge(this) { currentOrigin in allowedOrigins }, "Android")
        wv.webChromeClient = WebChromeClient()
        wv.webViewClient = Client()

        container.removeAllViews()
        container.addView(wv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        wv.requestFocus()
        webView = wv
    }

    fun loadStart() {
        handler.removeCallbacks(retryRemote)
        if (remoteUrl.isNotEmpty() && isOnline()) {
            usingFallback = false
            webView?.loadUrl(remoteUrl)
        } else {
            loadFallback()
        }
    }

    private fun loadFallback() {
        usingFallback = true
        webView?.loadUrl(LOCAL_URL)
        if (remoteUrl.isNotEmpty()) handler.postDelayed(retryRemote, RETRY_REMOTE_MS)
    }

    private inner class Client : WebViewClient() {

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(request.url)

        // Só navega em origens autorizadas: a ponte JS nunca fica exposta a site de terceiro.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val origin = originOf(request.url.toString())
            if (origin != null && origin in allowedOrigins) return false
            Log.w(TAG, "Navegação bloqueada: ${request.url}")
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            currentOrigin = originOf(url) ?: ""
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && !usingFallback) {
                Log.w(TAG, "Falha na interface remota (${error.description}), usando versão local")
                loadFallback()
            }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && !usingFallback && response.statusCode >= 500) {
                loadFallback()
            }
        }

        // Renderer do WebView morreu (comum em box com pouca RAM): recria em vez de travar.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "Renderer do WebView caiu (crash=${detail.didCrash()}), recriando")
            container.removeView(view)
            view.destroy()
            if (webView === view) webView = null
            createWebView()
            loadStart()
            return true
        }
    }

    // ---------------------------------------------------------------- controle remoto

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Voltar nunca fecha o launcher: repassa pro JS decidir (fechar modal, voltar tela etc).
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                js("window.onAndroidBack && window.onAndroidBack()")
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // ---------------------------------------------------------------- kiosk

    private fun dpm() = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun adminComponent() = ComponentName(this, AdminReceiver::class.java)
    fun isDeviceOwner(): Boolean = dpm().isDeviceOwnerApp(packageName)

    private fun startKioskIfDeviceOwner() {
        if (!isDeviceOwner()) return
        try {
            dpm().setLockTaskPackages(adminComponent(), arrayOf(packageName))
            startLockTask()
            Log.i(TAG, "Modo kiosk (lock task) ativo")
        } catch (e: Exception) {
            Log.e(TAG, "Não foi possível iniciar lock task", e)
        }
    }

    /** Em lock task só abrem apps na whitelist: adiciona o pacote antes de abrir. */
    fun allowInKiosk(pkg: String) {
        if (!isDeviceOwner()) return
        val current = dpm().getLockTaskPackages(adminComponent()).toMutableSet()
        if (current.add(pkg)) dpm().setLockTaskPackages(adminComponent(), current.toTypedArray())
    }

    /** Fecha o app (some da lista de recentes). Com Autostart ligado o Android reabre, pois somos a tela Início. */
    fun closeApp() {
        try { stopLockTask() } catch (_: Exception) {}
        finishAndRemoveTask()
    }

    /** Sai do kiosk e remove o Device Owner (acesso do técnico). */
    fun exitKiosk() {
        if (!isDeviceOwner()) return
        try { stopLockTask() } catch (_: Exception) {}
        @Suppress("DEPRECATION")
        dpm().clearDeviceOwnerApp(packageName)
        Log.i(TAG, "Kiosk desativado")
    }

    // ---------------------------------------------------------------- util

    private fun enterImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun js(code: String) {
        runOnUiThread { webView?.evaluateJavascript(code, null) }
    }

    private fun originOf(url: String): String? {
        if (url.isBlank()) return null
        val u = Uri.parse(url)
        val scheme = u.scheme ?: return null
        val host = u.host ?: return null
        val port = if (u.port != -1) ":${u.port}" else ""
        return "$scheme://$host$port"
    }
}
