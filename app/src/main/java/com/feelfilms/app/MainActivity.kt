package com.feelfilms.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.feelfilms.app.BuildConfig
import com.yandex.mobile.ads.banner.BannerAdEventListener
import com.yandex.mobile.ads.banner.BannerAdSize
import com.yandex.mobile.ads.banner.BannerAdView
import com.yandex.mobile.ads.common.AdError
import com.yandex.mobile.ads.common.AdRequest
import com.yandex.mobile.ads.common.AdRequestConfiguration
import com.yandex.mobile.ads.common.AdRequestError
import com.yandex.mobile.ads.common.ImpressionData
import com.yandex.mobile.ads.common.MobileAds
import com.yandex.mobile.ads.interstitial.InterstitialAd
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader
import kotlin.concurrent.thread
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var adBannerPlaceholder: FrameLayout
    private lateinit var assetLoader: WebViewAssetLoader
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var bannerAdView: BannerAdView? = null
    private var interstitialAdLoader: InterstitialAdLoader? = null
    private var interstitialAd: InterstitialAd? = null
    private var movieOpenCount = 0
    private var movieSwipeCount = 0
    private var lastInterstitialShownAt = 0L
    private var appStartAt = 0L
    private var remoteConfig: JSONObject? = null
    private val backendBaseUrl = "http://185.73.126.11:8000"
    private fun getCurrentVersionCode(): Long {
        return runCatching {
            packageManager.getPackageInfo(packageName, 0).longVersionCode
        }.getOrDefault(1L)
    }

    private fun getAppAssetsUrl(): String {
        return "https://appassets.androidplatform.net/assets/index.html?v=${getCurrentVersionCode()}"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setContentView(R.layout.activity_main)
        configureWindowBackground()
        enableFullscreenMode()
        applySystemWindowInsets()

        webView = findViewById(R.id.webView)
        adBannerPlaceholder = findViewById(R.id.adBannerPlaceholder)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        configureAdMobScaffold()
        configureWebView(webView)

        // Force fresh UI assets after each app update to avoid stale CSS/JS from WebView cache.
        webView.clearCache(true)
        if (savedInstanceState == null) {
            webView.loadUrl(getAppAssetsUrl())
        } else {
            webView.restoreState(savedInstanceState)
            val currentVersionToken = "v=${getCurrentVersionCode()}"
            if (!webView.url.orEmpty().contains(currentVersionToken)) {
                webView.loadUrl(getAppAssetsUrl())
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreenView != null) {
                    (webView.webChromeClient as? WebChromeClient)?.onHideCustomView()
                    return
                }
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })
    }

    private fun configureAdMobScaffold() {
        hideBannerSlot()
        appStartAt = System.currentTimeMillis()
        loadRemoteConfigAsync()
        MobileAds.initialize(this) {
            Log.d(TAG, "Yandex Mobile Ads SDK initialized")
            if (getConfigBool("banner_enabled", true)) {
                loadYandexBanner()
            } else {
                Log.d(TAG, "Banner disabled via remote config")
            }
            if (getConfigBool("interstitial_enabled", true)) {
                setupInterstitial()
            } else {
                Log.d(TAG, "Interstitial disabled via remote config")
            }
        }
    }

    private fun loadRemoteConfigAsync() {
        val prefs = getSharedPreferences("feelfilms_prefs", MODE_PRIVATE)
        prefs.getString("remote_config_cached", null)?.let {
            runCatching { remoteConfig = JSONObject(it) }
        }
        thread(isDaemon = true) {
            try {
                val url = URL("$backendBaseUrl/api/config")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 5000
                    readTimeout = 5000
                }
                if (conn.responseCode in 200..299) {
                    val body = conn.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
                    val parsed = JSONObject(body)
                    runOnUiThread {
                        remoteConfig = parsed
                        prefs.edit().putString("remote_config_cached", body).apply()
                        Log.d(TAG, "Remote config loaded: $body")
                    }
                }
            } catch (error: Exception) {
                Log.w(TAG, "Remote config fetch failed: ${error.message}")
            }
        }
    }

    private fun getConfigInt(key: String, defaultValue: Int): Int {
        return remoteConfig?.optInt(key, defaultValue) ?: defaultValue
    }

    private fun getConfigBool(key: String, defaultValue: Boolean): Boolean {
        return remoteConfig?.optBoolean(key, defaultValue) ?: defaultValue
    }

    private fun setupInterstitial() {
        interstitialAdLoader = InterstitialAdLoader(this).apply {
            setAdLoadListener(object : InterstitialAdLoadListener {
                override fun onAdLoaded(ad: InterstitialAd) {
                    Log.d(TAG, "Interstitial loaded")
                    ad.setAdEventListener(interstitialEventListener)
                    interstitialAd = ad
                }

                override fun onAdFailedToLoad(error: AdRequestError) {
                    Log.w(TAG, "Interstitial failed to load: code=${error.code} description=${error.description}")
                }
            })
        }
        loadInterstitial()
    }

    private fun loadInterstitial() {
        val adUnitId = getString(R.string.yandex_interstitial_ad_unit_id)
        val configuration = AdRequestConfiguration.Builder(adUnitId).build()
        interstitialAdLoader?.loadAd(configuration)
    }

    private val interstitialEventListener = object : InterstitialAdEventListener {
        override fun onAdShown() {
            Log.d(TAG, "Interstitial shown")
        }

        override fun onAdDismissed() {
            Log.d(TAG, "Interstitial dismissed, preloading next")
            interstitialAd?.setAdEventListener(null)
            interstitialAd = null
            loadInterstitial()
        }

        override fun onAdImpression(data: ImpressionData?) {}
        override fun onAdClicked() {}

        override fun onAdFailedToShow(error: AdError) {
            Log.w(TAG, "Interstitial failed to show: ${error.description}")
            interstitialAd?.setAdEventListener(null)
            interstitialAd = null
            loadInterstitial()
        }
    }

    private fun tryShowInterstitial(): Boolean {
        val now = System.currentTimeMillis()
        val gracePeriodMs = getConfigInt("interstitial_grace_period_seconds", 60) * 1000L
        val minIntervalMs = getConfigInt("interstitial_min_interval_seconds", 180) * 1000L
        if (now - appStartAt < gracePeriodMs) {
            Log.d(TAG, "Interstitial skipped: grace period")
            return false
        }
        if (now - lastInterstitialShownAt < minIntervalMs) {
            Log.d(TAG, "Interstitial skipped: min interval")
            return false
        }
        val ad = interstitialAd
        if (ad == null) {
            Log.d(TAG, "Interstitial skipped: not loaded yet")
            return false
        }
        ad.show(this)
        lastInterstitialShownAt = now
        return true
    }

    private fun loadYandexBanner() {
        val adUnitId = getString(R.string.yandex_banner_ad_unit_id)
        val screenWidthDp = getScreenWidthDp()

        val banner = BannerAdView(this).apply {
            setAdUnitId(adUnitId)
            setAdSize(BannerAdSize.inlineSize(this@MainActivity, screenWidthDp, BANNER_MAX_HEIGHT_DP))
            setBannerAdEventListener(object : BannerAdEventListener {
                override fun onAdLoaded() {
                    Log.d(TAG, "Yandex banner loaded")
                    showBannerSlot()
                }

                override fun onAdFailedToLoad(error: AdRequestError) {
                    Log.w(TAG, "Yandex banner failed: code=${error.code} description=${error.description}")
                    hideBannerSlot()
                }

                override fun onAdClicked() {}
                override fun onLeftApplication() {}
                override fun onReturnedToApplication() {}
                override fun onImpression(data: ImpressionData?) {}
            })
        }

        bannerAdView = banner
        adBannerPlaceholder.removeAllViews()
        adBannerPlaceholder.addView(
            banner,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )
        )
        banner.loadAd(AdRequest.Builder().build())
    }

    private fun getScreenWidthDp(): Int {
        val metrics = resources.displayMetrics
        return (metrics.widthPixels.toFloat() / metrics.density).toInt()
    }

    private fun applySystemWindowInsets() {
        val content = findViewById<View>(android.R.id.content)
        val root = (content as? ViewGroup)?.getChildAt(0) ?: return
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            // Let WebView occupy full window to avoid top seam above overlays.
            view.setPadding(0, 0, 0, 0)
            insets
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun enableFullscreenMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        hideSystemBars()
    }

    private fun configureWindowBackground() {
        // Match native background with web app base color to avoid black top flashes/bands.
        val appBg = Color.parseColor("#0D0F14")
        window.decorView.setBackgroundColor(appBg)
        window.statusBarColor = appBg
        window.navigationBarColor = appBg
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun showBannerSlot() {
        adBannerPlaceholder.visibility = View.VISIBLE
    }

    private fun hideBannerSlot() {
        adBannerPlaceholder.visibility = View.GONE
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun onMovieDescriptionOpened() {
            Log.d(TAG, "Movie description opened")
            runOnUiThread {
                movieOpenCount++
                val defaultThreshold = resources.getInteger(R.integer.interstitial_every_n_opens)
                val threshold = getConfigInt("interstitial_every_n_opens", defaultThreshold)
                if (movieOpenCount >= threshold) {
                    if (tryShowInterstitial()) {
                        movieOpenCount = 0
                        movieSwipeCount = 0
                    }
                }
            }
        }

        @JavascriptInterface
        fun onMovieSwiped() {
            Log.d(TAG, "Movie swiped")
            runOnUiThread {
                movieSwipeCount++
                val defaultThreshold = resources.getInteger(R.integer.interstitial_every_n_swipes)
                val threshold = getConfigInt("interstitial_every_n_swipes", defaultThreshold)
                if (movieSwipeCount >= threshold) {
                    if (tryShowInterstitial()) {
                        movieOpenCount = 0
                        movieSwipeCount = 0
                    }
                }
            }
        }

        @JavascriptInterface
        fun openExternalUrl(rawUrl: String?) {
            val safeUrl = rawUrl?.trim().orEmpty()
            if (safeUrl.isBlank()) return
            val uri = runCatching { Uri.parse(safeUrl) }.getOrNull() ?: return
            val scheme = uri.scheme?.lowercase().orEmpty()
            if (scheme != "http" && scheme != "https") return

            runOnUiThread {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
                runCatching { startActivity(intent) }
                    .onFailure { error -> Log.e(TAG, "Failed to open external URL", error) }
            }
        }

        @JavascriptInterface
        fun composeEmail(email: String?, subject: String?, body: String?) {
            val normalizedEmail = email?.trim().orEmpty()
            if (normalizedEmail.isBlank()) return

            runOnUiThread {
                val intent = Intent(Intent.ACTION_SENDTO).apply {
                    data = Uri.parse("mailto:$normalizedEmail")
                    putExtra(Intent.EXTRA_SUBJECT, subject.orEmpty())
                    putExtra(Intent.EXTRA_TEXT, body.orEmpty())
                }
                try {
                    startActivity(intent)
                } catch (_: ActivityNotFoundException) {
                    Log.e(TAG, "No email client found")
                }
            }
        }

        @JavascriptInterface
        fun getAppVersion(): String {
            return runCatching {
                packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
            }.getOrElse { "1.0.0" }
        }
    }

    private fun configureWebView(view: WebView) {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, true)
        }
        view.addJavascriptInterface(AndroidBridge(), "AndroidAds")

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean {
                // Kinopoisk trailer widget triggers window.open() to a Yandex CDN URL when
                // its inner Play is tapped. Instead of letting Android open an external browser,
                // route that popup back through our own iframe so playback stays in-app.
                val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                val hiddenWebView = WebView(this@MainActivity)
                hiddenWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        v: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val popupUrl = request?.url?.toString().orEmpty()
                        if (popupUrl.isNotBlank()) {
                            val js = "var f=document.getElementById('trailer-frame');" +
                                "if(f){var i=f.querySelector('iframe');if(i){i.src=" +
                                org.json.JSONObject.quote(popupUrl) + ";}}"
                            view?.evaluateJavascript(js, null)
                        }
                        hiddenWebView.destroy()
                        return true
                    }
                }
                transport.webView = hiddenWebView
                resultMsg.sendToTarget()
                return true
            }

            override fun onShowCustomView(customView: View, callback: CustomViewCallback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenView = customView
                fullscreenCallback = callback
                val decor = window.decorView as FrameLayout
                decor.addView(
                    customView,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
                webView.visibility = View.GONE
                hideSystemBars()
            }

            override fun onHideCustomView() {
                val view = fullscreenView ?: return
                val decor = window.decorView as FrameLayout
                decor.removeView(view)
                fullscreenView = null
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
                webView.visibility = View.VISIBLE
                hideSystemBars()
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                if (isApiProxyRequest(request.url)) {
                    return proxyBackendRequest(request.url, request.method)
                }
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                // Do not hijack iframe/subframe navigations (e.g. YouTube trailer embed).
                if (request.isForMainFrame != true) return false
                val host = uri.host ?: return false
                if (host == "appassets.androidplatform.net") return false
                val scheme = uri.scheme?.lowercase().orEmpty()
                if (scheme != "http" && scheme != "https" && scheme != "mailto") return false

                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
                runCatching { startActivity(intent) }
                    .onFailure { error -> Log.e(TAG, "Failed to open external intent", error) }
                return true
            }
        }
    }

    private fun isApiProxyRequest(uri: Uri): Boolean {
        val host = uri.host ?: return false
        val path = uri.path ?: return false
        return host == "appassets.androidplatform.net" && path.startsWith("/api-proxy/")
    }

    private fun buildTargetUrl(uri: Uri): String {
        val encodedPath = uri.encodedPath ?: "/"
        val backendPath = encodedPath.removePrefix("/api-proxy").ifBlank { "/" }
        val query = uri.encodedQuery?.let { "?$it" } ?: ""
        return "$backendBaseUrl$backendPath$query"
    }

    private fun parseMimeType(contentType: String?): String {
        if (contentType.isNullOrBlank()) return "application/json"
        return contentType.substringBefore(";").trim().ifBlank { "application/json" }
    }

    private fun parseEncoding(contentType: String?): String {
        if (contentType.isNullOrBlank()) return "utf-8"
        val charsetToken = contentType
            .split(";")
            .map { it.trim() }
            .firstOrNull { it.startsWith("charset=", ignoreCase = true) }
        return charsetToken?.substringAfter("=")?.trim()?.ifBlank { "utf-8" } ?: "utf-8"
    }

    private fun escapeJsonValue(raw: String): String {
        return raw
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", " ")
            .replace("\r", " ")
    }

    private fun proxyBackendRequest(uri: Uri, method: String): WebResourceResponse {
        return try {
            val targetUrl = buildTargetUrl(uri)
            val connection = (URL(targetUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = method.ifBlank { "GET" }
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "FeelFilms-Android-WebView")
            }

            val statusCode = connection.responseCode
            val stream = if (statusCode in 200..399) {
                connection.inputStream
            } else {
                connection.errorStream ?: ByteArrayInputStream(
                    "{\"detail\":\"Backend error\"}".toByteArray(StandardCharsets.UTF_8)
                )
            }

            val headers = linkedMapOf<String, String>()
            connection.headerFields.forEach { (name, values) ->
                if (name != null && !values.isNullOrEmpty()) {
                    headers[name] = values.joinToString(",")
                }
            }
            headers["Cache-Control"] = "no-store"

            WebResourceResponse(
                parseMimeType(connection.contentType),
                parseEncoding(connection.contentType),
                stream
            ).apply {
                setStatusCodeAndReasonPhrase(
                    statusCode,
                    connection.responseMessage ?: "OK"
                )
                responseHeaders = headers
            }
        } catch (error: Exception) {
            val safeMessage = escapeJsonValue(error.message ?: "Unknown error")
            val payload = "{\"detail\":\"Proxy request failed: $safeMessage\"}"
            WebResourceResponse(
                "application/json",
                "utf-8",
                ByteArrayInputStream(payload.toByteArray(StandardCharsets.UTF_8))
            ).apply {
                setStatusCodeAndReasonPhrase(502, "Bad Gateway")
                responseHeaders = mapOf("Cache-Control" to "no-store")
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onDestroy() {
        bannerAdView?.destroy()
        bannerAdView = null
        interstitialAd?.setAdEventListener(null)
        interstitialAd = null
        interstitialAdLoader?.setAdLoadListener(null)
        interstitialAdLoader = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "FeelFilmsApp"
        private const val BANNER_MAX_HEIGHT_DP = 50
    }
}
