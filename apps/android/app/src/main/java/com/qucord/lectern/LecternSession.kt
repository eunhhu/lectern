package com.qucord.lectern

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-wide login state and configuration shared by MainActivity, the Quick Settings tile,
 * the recording service and the upload worker.
 *
 * The server base comes only from BuildConfig (set at build time with -Plectern.serverUrl=...),
 * never from an intent extra, so other apps cannot redirect the token or the login password.
 * The token lives in app-private SharedPreferences, which are excluded from cloud backup and
 * device-to-device transfer (see AndroidManifest.xml and res/xml/data_extraction_rules.xml).
 */
object LecternSession {
    private const val PREFS = "lectern_prefs"
    private const val KEY_TOKEN = "auth_token"
    private const val KEY_LAST_COURSE = "last_course"
    private const val KEY_USE_V2_UPLOAD = "use_v2_upload"
    const val DEFAULT_COURSE = "대학교 전공 강의"

    val serverBase: String = BuildConfig.LECTERN_SERVER_URL.trimEnd('/')

    private val _token = MutableStateFlow("")
    private var prefs: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences = synchronized(this) {
        prefs ?: context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).also {
            prefs = it
            _token.value = it.getString(KEY_TOKEN, "") ?: ""
        }
    }

    fun tokenFlow(context: Context): StateFlow<String> {
        prefs(context)
        return _token.asStateFlow()
    }

    fun token(context: Context): String {
        prefs(context)
        return _token.value
    }

    fun saveToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_TOKEN, token).apply()
        _token.value = token
    }

    /** Called on logout and whenever the server answers 401 for the stored token. */
    fun clearToken(context: Context) {
        prefs(context).edit().remove(KEY_TOKEN).apply()
        _token.value = ""
    }

    fun lastCourse(context: Context): String =
        prefs(context).getString(KEY_LAST_COURSE, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_COURSE

    fun saveLastCourse(context: Context, course: String) {
        if (course.isNotBlank()) prefs(context).edit().putString(KEY_LAST_COURSE, course).apply()
    }

    /** Settings switch "새 업로드 방식": the v2 resumable upload (on) or v1 `/api/ingest/shortcut` (off). */
    fun useV2Upload(context: Context): Boolean = prefs(context).getBoolean(KEY_USE_V2_UPLOAD, true)

    fun setUseV2Upload(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_USE_V2_UPLOAD, value).apply()
    }
}
