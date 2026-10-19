package com.qucord.lectern

import android.net.Uri
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpRetryException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

data class LectureItem(
    val id: String,
    val shareToken: String,
    val title: String,
    val course: String,
    val dateLabel: String,
    val status: String,
    val excerpt: String,
    val modelUsed: String,
    val hasAudio: Boolean,
    val markdown: String = ""
)

/** Non-2xx answer from the Lectern server; [message] is the server's `error` string when present. */
class HttpStatusException(val code: Int, message: String) : IOException(message)

sealed class UploadResult {
    data class Success(val lectureId: String) : UploadResult()
    data class Rejected(val code: Int, val message: String) : UploadResult()
    data class NetworkError(val message: String) : UploadResult()
}

/**
 * Blocking HTTP calls against apps/server (call from Dispatchers.IO or a worker thread).
 * Every authenticated request sends the account API token in X-Lectern-Token.
 */
object LecternApi {
    private const val TOKEN_HEADER = "X-Lectern-Token"

    fun authHeaders(token: String): Map<String, String> = mapOf(TOKEN_HEADER to token)

    fun audioUrl(serverBase: String, lectureId: String): String =
        "$serverBase/api/lectures/${Uri.encode(lectureId)}/audio"

    /** 4xx answers (bad token, viewer role, quota, bad file) are final; only timeouts, rate limits and 5xx are retried. */
    fun isRetryable(code: Int): Boolean = code == 408 || code == 429 || code >= 500

    /** POST /api/auth/login → the account's long-lived API token (`user.apiToken`). */
    fun login(serverBase: String, email: String, password: String): String {
        val conn = (URL("$serverBase/api/auth/login").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            val payload = JSONObject().put("email", email).put("password", password).toString()
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            return JSONObject(conn.readBodyOrThrow()).getJSONObject("user").optString("apiToken")
        } finally {
            conn.disconnect()
        }
    }

    /** GET /api/lectures */
    fun fetchLectures(serverBase: String, token: String): List<LectureItem> {
        val arr = getJson("$serverBase/api/lectures", token).getJSONArray("lectures")
        return (0 until arr.length()).map { parseLecture(arr.getJSONObject(it)) }
    }

    /** GET /api/lectures/:id (includes markdown) */
    fun fetchLecture(serverBase: String, token: String, id: String): LectureItem {
        val o = getJson("$serverBase/api/lectures/${Uri.encode(id)}", token).getJSONObject("lecture")
        return parseLecture(o).copy(markdown = o.optString("markdown"))
    }

    /**
     * POST /api/ingest/shortcut?wait=false as multipart (course, idempotency_key, audio).
     * The same [idempotencyKey] is sent on every retry so the server deduplicates an upload whose
     * first response was lost and answers with the existing lecture id.
     * The server keeps the filename's [extension] and the part's [mimeType], so both must describe the real file.
     */
    fun uploadAudio(
        serverBase: String,
        token: String,
        file: File,
        course: String,
        idempotencyKey: String,
        client: String,
        extension: String,
        mimeType: String
    ): UploadResult {
        val boundary = "LecternBoundary-${UUID.randomUUID()}"
        val head = buildString {
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"course\"\r\n\r\n")
            append(course).append("\r\n")
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"idempotency_key\"\r\n\r\n")
            append(idempotencyKey).append("\r\n")
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"audio\"; filename=\"lectern_$idempotencyKey.$extension\"\r\n")
            append("Content-Type: $mimeType\r\n\r\n")
        }.toByteArray(Charsets.UTF_8)
        val tail = "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)

        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$serverBase/api/ingest/shortcut?wait=false").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 20_000
                readTimeout = 120_000
                // Stream the file instead of buffering a multi-hour recording in memory.
                setFixedLengthStreamingMode(head.size + file.length() + tail.size)
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                setRequestProperty("X-Client", client)
                setRequestProperty(TOKEN_HEADER, token)
                setRequestProperty("X-Idempotency-Key", idempotencyKey)
            }
            conn.outputStream.use { out ->
                out.write(head)
                file.inputStream().use { it.copyTo(out, 64 * 1024) }
                out.write(tail)
            }
            val code = conn.responseCode
            if (code in 200..299) {
                val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                val id = json.optString("id").ifBlank { json.optJSONObject("lecture")?.optString("id").orEmpty() }
                if (id.isNotBlank()) UploadResult.Success(id)
                else UploadResult.NetworkError("서버 응답에 강의 ID가 없습니다.")
            } else {
                UploadResult.Rejected(code, errorMessage(conn, code))
            }
        } catch (e: HttpRetryException) {
            // Thrown instead of a normal response when the server challenges auth in streaming mode.
            UploadResult.Rejected(e.responseCode(), e.message ?: "HTTP ${e.responseCode()}")
        } catch (e: IOException) {
            UploadResult.NetworkError(e.message ?: e.javaClass.simpleName)
        } catch (e: JSONException) {
            // e.g. a captive portal answering 200 with HTML; worth retrying later.
            UploadResult.NetworkError("서버 응답을 해석할 수 없습니다.")
        } finally {
            conn?.disconnect()
        }
    }

    private fun getJson(url: String, token: String): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 15_000
            setRequestProperty(TOKEN_HEADER, token)
        }
        try {
            return JSONObject(conn.readBodyOrThrow())
        } finally {
            conn.disconnect()
        }
    }

    private fun HttpURLConnection.readBodyOrThrow(): String {
        val code = responseCode
        if (code in 200..299) return inputStream.bufferedReader().use { it.readText() }
        throw HttpStatusException(code, errorMessage(this, code))
    }

    private fun errorMessage(conn: HttpURLConnection, code: Int): String {
        val raw = try {
            conn.errorStream?.bufferedReader()?.use { it.readText() }
        } catch (_: IOException) {
            null
        }
        val parsed = raw?.let {
            try {
                JSONObject(it).optString("error")
            } catch (_: JSONException) {
                null
            }
        }
        return parsed?.takeIf { it.isNotBlank() } ?: "HTTP $code"
    }

    private fun parseLecture(o: JSONObject) = LectureItem(
        id = o.optString("id"),
        shareToken = o.optString("share_token"),
        title = o.optString("title"),
        course = o.optString("course"),
        dateLabel = o.optString("date_label"),
        status = o.optString("status"),
        excerpt = o.optString("excerpt"),
        modelUsed = o.optString("model_used"),
        hasAudio = o.optBoolean("has_audio")
    )
}
