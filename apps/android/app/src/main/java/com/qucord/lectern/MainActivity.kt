package com.qucord.lectern

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Jetpack Compose Main Activity:
 * Opens directly into the Lectern Markdown Reader and supports instant Quick Action recording.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initialUrl = intent?.getStringExtra("LECTERN_URL") ?: "https://lectern.qucord.com"
        val autoQuickRecord = intent?.action == "com.qucord.lectern.QUICK_RECORD"

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                LecternComposeScreen(
                    targetUrl = initialUrl,
                    autoQuickRecord = autoQuickRecord
                )
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LecternComposeScreen(targetUrl: String, autoQuickRecord: Boolean) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0C0E))
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            if (autoQuickRecord) {
                                view?.evaluateJavascript("if(window.openRecorderModal) openRecorderModal();", null)
                            }
                        }
                    }
                    webChromeClient = WebChromeClient()
                    loadUrl(targetUrl)
                }
            }
        )
    }
}
