package com.qucord.lectern

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class PendingUpload(
    /** Also the X-Idempotency-Key, so every retry of this recording dedups on the server. */
    val id: String,
    val filePath: String,
    val course: String,
    val client: String,
    val createdAt: Long,
    /** Recordings made in the app keep their local original; tile recordings are deleted once uploaded. */
    val keepLocalCopy: Boolean,
    val status: String = STATUS_QUEUED,
    val lastError: String? = null
) {
    val file: File get() = File(filePath)

    companion object {
        const val STATUS_QUEUED = "queued"
        const val STATUS_UPLOADING = "uploading"
        /** Needs the user: a 4xx answer, missing login, or retries exhausted. */
        const val STATUS_FAILED = "failed"
    }
}

/**
 * Persistent list of recordings that have not been confirmed by the server yet.
 * An entry is written before the first upload attempt and removed only after a 2xx with a lecture id,
 * so a crash, a dead network or a rejected token never loses the recording.
 */
object PendingUploads {
    private const val PREFS = "lectern_uploads"
    private const val KEY_ITEMS = "items"

    private var prefs: SharedPreferences? = null
    private val _items = MutableStateFlow<List<PendingUpload>>(emptyList())
    private val _completed = MutableSharedFlow<String>(extraBufferCapacity = 8)

    /** Lecture ids of uploads the server just accepted. */
    val completed: SharedFlow<String> = _completed.asSharedFlow()

    private fun prefs(context: Context): SharedPreferences = synchronized(this) {
        prefs ?: context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).also {
            prefs = it
            _items.value = decode(it.getString(KEY_ITEMS, null))
        }
    }

    fun items(context: Context): StateFlow<List<PendingUpload>> {
        prefs(context)
        return _items.asStateFlow()
    }

    fun get(context: Context, id: String): PendingUpload? {
        prefs(context)
        return _items.value.firstOrNull { it.id == id }
    }

    fun add(context: Context, item: PendingUpload) = mutate(context) { list -> list.filterNot { it.id == item.id } + item }

    fun update(context: Context, id: String, transform: (PendingUpload) -> PendingUpload) =
        mutate(context) { list -> list.map { if (it.id == id) transform(it) else it } }

    fun remove(context: Context, id: String) = mutate(context) { list -> list.filterNot { it.id == id } }

    fun markCompleted(context: Context, item: PendingUpload, lectureId: String) {
        remove(context, item.id)
        if (!item.keepLocalCopy) item.file.delete()
        _completed.tryEmit(lectureId)
    }

    private fun mutate(context: Context, transform: (List<PendingUpload>) -> List<PendingUpload>) {
        val p = prefs(context)
        synchronized(this) {
            val next = transform(_items.value)
            // commit(): the entry is the only record that a recording still needs uploading.
            p.edit().putString(KEY_ITEMS, encode(next)).commit()
            _items.value = next
        }
    }

    private fun encode(items: List<PendingUpload>): String {
        val arr = JSONArray()
        items.forEach {
            arr.put(
                JSONObject()
                    .put("id", it.id)
                    .put("filePath", it.filePath)
                    .put("course", it.course)
                    .put("client", it.client)
                    .put("createdAt", it.createdAt)
                    .put("keepLocalCopy", it.keepLocalCopy)
                    .put("status", it.status)
                    .put("lastError", it.lastError ?: JSONObject.NULL)
            )
        }
        return arr.toString()
    }

    private fun decode(raw: String?): List<PendingUpload> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                PendingUpload(
                    id = o.getString("id"),
                    filePath = o.getString("filePath"),
                    course = o.optString("course", LecternSession.DEFAULT_COURSE),
                    client = o.optString("client", "android-compose"),
                    createdAt = o.optLong("createdAt"),
                    keepLocalCopy = o.optBoolean("keepLocalCopy", true),
                    status = o.optString("status", PendingUpload.STATUS_QUEUED),
                    lastError = if (o.isNull("lastError")) null else o.optString("lastError")
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
