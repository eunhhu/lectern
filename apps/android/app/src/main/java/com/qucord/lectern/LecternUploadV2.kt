package com.qucord.lectern

import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpRetryException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** The parts of an `UploadSession` the client needs (one audio file per upload). */
data class UploadSessionInfo(
    val id: String,
    /** open | completed | aborted | expired */
    val status: String,
    val partSize: Long,
    /** files[0].first_part */
    val firstPart: Int,
    /** files[0].part_count */
    val partCount: Int,
    val receivedParts: Set<Int>,
    val recordingId: String?
)

/**
 * The v2 resumable upload (`POST /uploads` → `PUT /uploads/{id}/parts/{n}` → `POST /uploads/{id}/complete`).
 * Keeps no state of its own: called again with the same item and generation, `createUpload` answers
 * with the same session and the parts it already has, so only the missing parts are sent.
 * Plain JVM (no `android.*`), blocking: call from a worker thread.
 */
object LecternUploadV2 {
    const val BASE = "/api/v2"
    private const val TOKEN_HEADER = "X-Lectern-Token"
    private const val IDEMPOTENCY_HEADER = "Idempotency-Key"
    private const val CONNECT_TIMEOUT_MS = 20_000
    private const val READ_TIMEOUT_MS = 120_000
    private const val BUFFER_BYTES = 64 * 1024
    private const val FOLDER_PAGE_LIMIT = 200
    private const val FOLDER_PAGES = 5

    /** Generation 0 keeps the item id (also the v1 key); a new generation is a new session. */
    fun idempotencyKey(itemId: String, generation: Int): String =
        if (generation == 0) itemId else "$itemId-g$generation"

    /** (offset, length) of [part] in a file of [fileBytes]. */
    fun partRange(fileBytes: Long, partSize: Long, firstPart: Int, part: Int): Pair<Long, Long> {
        val offset = (part - firstPart).toLong() * partSize
        return offset to minOf(partSize, fileBytes - offset)
    }

    /** The file's parts the server does not have yet, ascending. */
    fun missingParts(session: UploadSessionInfo): List<Int> =
        (session.firstPart until session.firstPart + session.partCount).filterNot { it in session.receivedParts }

    /**
     * The `CreateUploadRequest`, the same bytes on every call (the server compares the body sent
     * with a repeated `Idempotency-Key`): written by hand, not with JSONObject's key order.
     */
    fun createBody(workspaceId: String, filename: String, mime: String, bytes: Long, folderId: String?): String = buildString {
        append("{\"workspace_id\":").append(JSONObject.quote(workspaceId))
        if (folderId != null) append(",\"recording\":{\"folder_id\":").append(JSONObject.quote(folderId)).append('}')
        append(",\"files\":[{\"kind\":\"audio\",\"filename\":").append(JSONObject.quote(filename))
        append(",\"mime\":").append(JSONObject.quote(mime))
        append(",\"bytes\":").append(bytes).append("}]}")
    }

    /** GET /me → `personal_workspace_id` (uploads go to the personal workspace). */
    fun personalWorkspaceId(serverBase: String, token: String, client: String): String {
        val me = requestJson(serverBase, token, client, "GET", "/me")
        if (me.isNull("personal_workspace_id")) throw JSONException("no personal_workspace_id")
        return me.getString("personal_workspace_id").ifBlank { throw JSONException("no personal_workspace_id") }
    }

    /**
     * v1's course is a top-level folder name in v2: the folder with that name (trimmed, case
     * ignored), made when missing. Null for a blank course, or when the server refuses the name
     * (the recording then goes in without a folder rather than not at all).
     */
    fun folderIdForCourse(serverBase: String, token: String, client: String, workspaceId: String, course: String): String? {
        val name = course.trim()
        if (name.isEmpty()) return null
        findFolder(serverBase, token, client, workspaceId, name)?.let { return it }
        val body = "{\"workspace_id\":${JSONObject.quote(workspaceId)},\"name\":${JSONObject.quote(name)}}"
        return try {
            requestJson(serverBase, token, client, "POST", "/folders", body = body).getString("id")
        } catch (e: HttpStatusException) {
            when (e.code) {
                409 -> findFolder(serverBase, token, client, workspaceId, name) // made at the same time
                400, 422 -> null
                else -> throw e
            }
        }
    }

    /** POST /uploads with the key: a new session, or the existing one for the same key and body. */
    fun createUpload(serverBase: String, token: String, client: String, key: String, body: String): UploadSessionInfo =
        parseSession(requestJson(serverBase, token, client, "POST", "/uploads", body = body, key = key))

    /** GET /uploads/{id}: which parts arrived. */
    fun getUpload(serverBase: String, token: String, client: String, uploadId: String): UploadSessionInfo =
        parseSession(requestJson(serverBase, token, client, "GET", "/uploads/${enc(uploadId)}"))

    /** PUT one part: that byte range of [file] only, streamed (never the whole file in memory). */
    fun putPart(serverBase: String, token: String, client: String, uploadId: String, part: Int, file: File, offset: Long, length: Long) {
        val conn = open(serverBase, "/uploads/${enc(uploadId)}/parts/$part", token, client, "PUT")
        try {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/octet-stream")
            conn.setFixedLengthStreamingMode(length)
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(offset)
                conn.outputStream.use { out ->
                    val buffer = ByteArray(BUFFER_BYTES)
                    var left = length
                    while (left > 0) {
                        val n = raf.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                        if (n < 0) throw IOException("녹음 파일이 예상보다 짧습니다.")
                        out.write(buffer, 0, n)
                        left -= n
                    }
                }
            }
            conn.readBodyOrThrow()
        } finally {
            conn.disconnect()
        }
    }

    /** POST /uploads/{id}/complete → the recording id (also the v1 lecture id). */
    fun complete(serverBase: String, token: String, client: String, uploadId: String, key: String): String {
        val response = requestJson(serverBase, token, client, "POST", "/uploads/${enc(uploadId)}/complete", body = "", key = key)
        return response.getJSONObject("recording").getString("id").ifBlank { throw JSONException("no recording id") }
    }

    /**
     * Uploads [file] for the pending item [itemId] in session generation [generation]. A dead
     * session (expired, aborted) or a changed body (a folder appeared since) moves to the next
     * generation once ([onGeneration]); [onProgress] gets (parts the server has, all parts) after
     * each part. Same result rules as [LecternApi.uploadAudio].
     */
    fun upload(
        serverBase: String, token: String, file: File, course: String, itemId: String, generation: Int,
        client: String, extension: String, mimeType: String,
        onGeneration: (Int) -> Unit = {},
        onProgress: (uploaded: Int, total: Int) -> Unit = { _, _ -> }
    ): UploadResult = try {
        val workspaceId = personalWorkspaceId(serverBase, token, client)
        val folderId = folderIdForCourse(serverBase, token, client, workspaceId, course)
        val body = createBody(workspaceId, "lectern_$itemId.$extension", mimeType, file.length(), folderId)

        var key = idempotencyKey(itemId, generation)
        var session = createOrNull(serverBase, token, client, key, body)
        if (session == null || session.isDead) {
            val next = generation + 1
            onGeneration(next)
            key = idempotencyKey(itemId, next)
            session = createOrNull(serverBase, token, client, key, body)
            if (session == null || session.isDead) throw HttpStatusException(409, "업로드 세션을 새로 만들 수 없습니다.")
        }

        if (session.status != STATUS_COMPLETED) {
            try {
                sendMissing(serverBase, token, client, session, file, onProgress)
            } catch (e: HttpStatusException) {
                // 409 on a part: the session is no longer open. Another run of this item (a stopped
                // worker keeps uploading on its thread) may have completed it: then this one has too.
                if (e.code != 409 || getUpload(serverBase, token, client, session.id).status != STATUS_COMPLETED) throw e
            }
        }
        val recordingId = try {
            complete(serverBase, token, client, session.id, key)
        } catch (e: HttpStatusException) {
            if (e.code != 409 || e.apiCode != "upload_incomplete") throw e
            // A part the server lost or never stored: send what it lacks, then complete once more.
            sendMissing(serverBase, token, client, getUpload(serverBase, token, client, session.id), file, onProgress)
            complete(serverBase, token, client, session.id, key)
        }
        UploadResult.Success(recordingId)
    } catch (e: HttpStatusException) {
        UploadResult.Rejected(e.code, e.message ?: "HTTP ${e.code}")
    } catch (e: HttpRetryException) {
        // A streaming request answered with an auth challenge (e.g. a token revoked mid-upload).
        UploadResult.Rejected(e.responseCode(), e.message ?: "HTTP ${e.responseCode()}")
    } catch (e: IOException) {
        UploadResult.NetworkError(e.message ?: e.javaClass.simpleName)
    } catch (e: JSONException) {
        // e.g. a captive portal answering 200 with HTML; worth retrying later.
        UploadResult.NetworkError("서버 응답을 해석할 수 없습니다.")
    }

    private const val STATUS_COMPLETED = "completed"
    private val UploadSessionInfo.isDead get() = status == "expired" || status == "aborted"

    /** Null when the key was used with another body (409 `idempotency_conflict`). */
    private fun createOrNull(serverBase: String, token: String, client: String, key: String, body: String): UploadSessionInfo? = try {
        createUpload(serverBase, token, client, key, body)
    } catch (e: HttpStatusException) {
        if (e.code == 409 && e.apiCode == "idempotency_conflict") null else throw e
    }

    private fun sendMissing(
        serverBase: String, token: String, client: String, session: UploadSessionInfo, file: File,
        onProgress: (Int, Int) -> Unit
    ) {
        val missing = missingParts(session)
        var done = session.partCount - missing.size
        val bytes = file.length()
        for (part in missing) {
            val (offset, length) = partRange(bytes, session.partSize, session.firstPart, part)
            putPart(serverBase, token, client, session.id, part, file, offset, length)
            done += 1
            onProgress(done, session.partCount)
        }
    }

    private fun findFolder(serverBase: String, token: String, client: String, workspaceId: String, name: String): String? {
        var cursor: String? = null
        repeat(FOLDER_PAGES) {
            val query = "workspace_id=${enc(workspaceId)}&limit=$FOLDER_PAGE_LIMIT" + (cursor?.let { "&cursor=${enc(it)}" } ?: "")
            val page = requestJson(serverBase, token, client, "GET", "/folders?$query")
            val items = page.getJSONArray("items")
            for (i in 0 until items.length()) {
                val folder = items.getJSONObject(i)
                // isNull, not optString: Android's optString gives "null" for a JSON null.
                if (folder.isNull("parent_id") && folder.optString("name").trim().equals(name, ignoreCase = true)) {
                    return folder.getString("id")
                }
            }
            cursor = if (page.isNull("next_cursor")) null else page.getString("next_cursor")
            if (cursor.isNullOrBlank()) return null
        }
        return null
    }

    private fun parseSession(json: JSONObject): UploadSessionInfo {
        val file = json.getJSONArray("files").getJSONObject(0)
        val received = json.optJSONArray("received_parts")
        return UploadSessionInfo(
            id = json.getString("id"),
            status = json.getString("status"),
            partSize = json.getLong("part_size"),
            firstPart = file.getInt("first_part"),
            partCount = file.getInt("part_count"),
            receivedParts = if (received == null) emptySet() else (0 until received.length()).map { received.getInt(it) }.toSet(),
            recordingId = if (json.isNull("recording_id")) null else json.getString("recording_id")
        )
    }

    /** One JSON request; [body] null sends none, "" sends an empty one (POST without a body). */
    private fun requestJson(
        serverBase: String, token: String, client: String, method: String, path: String,
        body: String? = null, key: String? = null
    ): JSONObject {
        val conn = open(serverBase, path, token, client, method)
        try {
            key?.let { conn.setRequestProperty(IDEMPOTENCY_HEADER, it) }
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                if (bytes.isNotEmpty()) conn.setRequestProperty("Content-Type", "application/json")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            return JSONObject(conn.readBodyOrThrow())
        } finally {
            conn.disconnect()
        }
    }

    private fun open(serverBase: String, path: String, token: String, client: String, method: String): HttpURLConnection =
        (URL("$serverBase$BASE$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty(TOKEN_HEADER, token)
            setRequestProperty("X-Client", client)
            setRequestProperty("Accept", "application/json")
        }

    private fun HttpURLConnection.readBodyOrThrow(): String {
        val code = responseCode
        if (code in 200..299) return inputStream.bufferedReader().use { it.readText() }
        val raw = try {
            errorStream?.bufferedReader()?.use { it.readText() }
        } catch (_: IOException) {
            null
        }
        // v2 errors are `{"error":{"code","message"}}` (v1's `error` was a string).
        val error = raw?.let {
            try {
                JSONObject(it).optJSONObject("error")
            } catch (_: JSONException) {
                null
            }
        }
        val message = error?.takeUnless { it.isNull("message") }?.optString("message")?.takeIf { it.isNotBlank() } ?: "HTTP $code"
        val apiCode = error?.takeUnless { it.isNull("code") }?.optString("code")?.takeIf { it.isNotBlank() }
        throw HttpStatusException(code, message, apiCode)
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
