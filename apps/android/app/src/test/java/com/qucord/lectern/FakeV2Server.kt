package com.qucord.lectern

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * A local stand-in for the v2 upload API (`apps/server/src/api/v2/uploads.ts`): one request per
 * connection, answered with `Connection: close`, like LecternApiUploadTest's server. JSON shapes
 * follow the server's `uploadSessionDto` and `completeResponse`.
 */
class FakeV2Server(private val partSize: Long = 1024) : Closeable {
    class Recorded(val method: String, val path: String, val headers: Map<String, String>, val body: ByteArray) {
        val bodyText: String get() = String(body, Charsets.UTF_8)
        /** The path without its query. */
        val route: String get() = path.substringBefore('?')
    }

    private class Session(val id: String, val key: String?, val body: String, val spec: JSONObject, val partCount: Int) {
        var status = "open"
        val parts = mutableMapOf<Int, ByteArray>()
        var recordingId: String? = null
    }

    private class Folder(val id: String, val name: String, val parentId: String? = null)

    private class Override(val method: String, val route: String, val status: Int, val body: String)

    private val socket = ServerSocket(0, 16, InetAddress.getLoopbackAddress())
    val base = "http://127.0.0.1:${socket.localPort}"

    private val lock = Any()
    private val recorded = mutableListOf<Recorded>()
    private val sessions = mutableListOf<Session>()
    private val folders = mutableListOf<Folder>()
    private val overrides = mutableListOf<Override>()
    private val failOnce = mutableMapOf<Int, Int>()
    private val dropOnce = mutableSetOf<Int>()
    private val completeOnce = mutableSetOf<Int>()
    private var nextFolder = 1

    val requests: List<Recorded> get() = synchronized(lock) { recorded.toList() }

    init {
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                try {
                    client.use { handle(it) }
                } catch (_: Exception) {
                    // A dropped connection (on purpose, or the client gave up).
                }
            }
        }
    }

    override fun close() = socket.close()

    // ---- set up ---------------------------------------------------------------------------

    fun addFolder(id: String, name: String, parentId: String? = null) = synchronized(lock) { folders += Folder(id, name, parentId) }

    fun clearFolders() = synchronized(lock) { folders.clear() }

    /** Answers every [method] request to [route] with this status and body. */
    fun respond(method: String, route: String, status: Int, body: String) = synchronized(lock) {
        overrides += Override(method, route, status, body)
    }

    /** The next PUT of part [part] reads its body, then answers [status]. */
    fun failPartOnce(part: Int, status: Int) = synchronized(lock) { failOnce[part] = status }

    /** The next PUT of part [part] is cut off: the server reads part of the body and closes. */
    fun dropConnectionOnPart(part: Int) = synchronized(lock) { dropOnce += part }

    fun expire(uploadId: String) = synchronized(lock) { session(uploadId)!!.status = "expired" }

    /** When part [part] arrives, another client has just completed the session (the PUT gets 409). */
    fun completeByAnotherRunOnPart(part: Int) = synchronized(lock) { completeOnce += part }

    // ---- look ----------------------------------------------------------------------------

    fun uploadIdFor(key: String): String? = synchronized(lock) { sessions.firstOrNull { it.key == key }?.id }

    fun assembled(uploadId: String): ByteArray = synchronized(lock) {
        val s = session(uploadId)!!
        val out = ByteArrayOutputStream()
        for (part in 1..s.partCount) out.write(s.parts.getValue(part))
        out.toByteArray()
    }

    fun puts(part: Int? = null): List<Recorded> = requests.filter {
        it.method == "PUT" && (part == null || it.route.endsWith("/parts/$part"))
    }

    // ---- serve ---------------------------------------------------------------------------

    private fun handle(client: Socket) {
        val input = client.getInputStream()
        val requestLine = readLine(input)
        if (requestLine.isBlank()) return
        val method = requestLine.substringBefore(' ')
        val path = requestLine.substringAfter(' ').substringBefore(' ')
        val headers = generateSequence { readLine(input).takeIf { it.isNotEmpty() } }
            .associate { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
        val length = headers["content-length"]?.toInt() ?: 0
        val route = path.substringBefore('?')

        if (method == "PUT" && route.contains("/parts/")) {
            val part = route.substringAfterLast('/').toInt()
            val drop = synchronized(lock) { dropOnce.remove(part) }
            if (drop) {
                val partial = readBody(input, length / 2)
                synchronized(lock) { recorded += Recorded(method, path, headers, partial) }
                client.setSoLinger(true, 0) // reset, not a clean close
                return
            }
        }
        val body = readBody(input, length)
        val request = Recorded(method, path, headers, body)
        synchronized(lock) { recorded += request }
        val (status, payload) = synchronized(lock) { answer(request) }
        write(client.getOutputStream(), status, payload)
    }

    private fun answer(r: Recorded): Pair<Int, String> {
        overrides.firstOrNull { it.method == r.method && it.route == r.route }?.let { return it.status to it.body }
        if (r.headers["x-lectern-token"].isNullOrBlank()) return error(401, "unauthorized", "로그인이 필요합니다.")
        val route = r.route.removePrefix(LecternUploadV2.BASE)
        val segments = route.trim('/').split('/')
        return when {
            r.method == "GET" && route == "/me" ->
                200 to """{"id":"usr_1","email":"user@example.com","name":"사용자","personal_workspace_id":"ws_1"}"""
            r.method == "GET" && route == "/folders" -> 200 to folderPage()
            r.method == "POST" && route == "/folders" -> createFolder(JSONObject(r.bodyText))
            r.method == "POST" && route == "/uploads" -> createUpload(r)
            r.method == "GET" && segments.size == 2 && segments[0] == "uploads" ->
                session(segments[1])?.let { 200 to sessionJson(it).toString() } ?: error(404, "not_found", "업로드를 찾을 수 없습니다.")
            r.method == "PUT" && segments.size == 4 && segments[2] == "parts" -> putPart(segments[1], segments[3].toInt(), r.body)
            r.method == "POST" && segments.size == 3 && segments[2] == "complete" -> complete(segments[1])
            else -> error(404, "not_found", "없는 경로입니다.")
        }
    }

    private fun folderPage(): String {
        val items = JSONArray()
        folders.forEach {
            items.put(
                JSONObject().put("id", it.id).put("workspace_id", "ws_1").put("name", it.name)
                    .put("parent_id", it.parentId ?: JSONObject.NULL).put("sort_key", "a")
            )
        }
        return JSONObject().put("items", items).put("next_cursor", JSONObject.NULL).toString()
    }

    private fun createFolder(body: JSONObject): Pair<Int, String> {
        val name = body.getString("name")
        if (folders.any { it.parentId == null && it.name.trim().equals(name.trim(), ignoreCase = true) }) {
            return error(409, "conflict", "같은 이름의 폴더가 있습니다.")
        }
        val folder = Folder("fld_new${nextFolder++}", name)
        folders += folder
        return 201 to JSONObject().put("id", folder.id).put("workspace_id", "ws_1").put("name", folder.name)
            .put("parent_id", JSONObject.NULL).put("sort_key", "a").toString()
    }

    private fun createUpload(r: Recorded): Pair<Int, String> {
        val key = r.headers["idempotency-key"]
        if (key != null) {
            sessions.firstOrNull { it.key == key }?.let { existing ->
                if (existing.body != r.bodyText) return error(409, "idempotency_conflict", "같은 Idempotency-Key로 다른 업로드를 만들 수 없습니다.")
                return 201 to sessionJson(existing).toString()
            }
        }
        val spec = JSONObject(r.bodyText)
        val bytes = spec.getJSONArray("files").getJSONObject(0).getLong("bytes")
        val partCount = maxOf(1L, (bytes + partSize - 1) / partSize).toInt()
        val session = Session("upl_${sessions.size + 1}", key, r.bodyText, spec, partCount)
        sessions += session
        return 201 to sessionJson(session).toString()
    }

    private fun putPart(uploadId: String, part: Int, body: ByteArray): Pair<Int, String> {
        val s = session(uploadId) ?: return error(404, "not_found", "업로드를 찾을 수 없습니다.")
        failOnce.remove(part)?.let { return error(it, "unavailable", "잠시 후 다시 시도하세요.") }
        if (completeOnce.remove(part)) {
            s.status = "completed"
            s.recordingId = "lec_1"
        }
        if (s.status != "open") return error(409, "conflict", "이미 끝났거나 취소된 업로드입니다.")
        if (part < 1 || part > s.partCount) return error(400, "bad_request", "업로드 계획에 없는 파트 번호입니다.")
        val bytes = s.spec.getJSONArray("files").getJSONObject(0).getLong("bytes")
        val expected = minOf(partSize, bytes - (part - 1) * partSize)
        if (body.size.toLong() != expected) return error(400, "bad_request", "파트 ${part}는 ${expected}바이트여야 합니다.")
        s.parts[part] = body
        return 200 to JSONObject().put("part", part).put("bytes", body.size).put("sha256", "0".repeat(64)).toString()
    }

    private fun complete(uploadId: String): Pair<Int, String> {
        val s = session(uploadId) ?: return error(404, "not_found", "업로드를 찾을 수 없습니다.")
        if (s.status == "open") {
            val missing = (1..s.partCount).filterNot { it in s.parts }
            if (missing.isNotEmpty()) return error(409, "upload_incomplete", "아직 받지 못한 파트가 있습니다.")
            s.status = "completed"
            s.recordingId = "lec_1"
        } else if (s.status != "completed") {
            return error(409, "conflict", "이미 끝났거나 취소된 업로드입니다.")
        }
        val recording = JSONObject().put("id", s.recordingId).put("workspace_id", "ws_1").put("status", "queued")
        return 200 to JSONObject().put("upload", sessionJson(s)).put("recording", recording)
            .put("job", JSONObject.NULL).put("deduplicated", false).toString()
    }

    private fun sessionJson(s: Session): JSONObject {
        val spec = s.spec.getJSONArray("files").getJSONObject(0)
        val file = JSONObject().put("kind", spec.getString("kind")).put("filename", spec.getString("filename"))
            .put("mime", spec.getString("mime")).put("bytes", spec.getLong("bytes"))
            .put("index", 0).put("first_part", 1).put("part_count", s.partCount)
        return JSONObject()
            .put("id", s.id)
            .put("workspace_id", s.spec.getString("workspace_id"))
            .put("recording_id", s.recordingId ?: JSONObject.NULL)
            .put("status", s.status)
            .put("recorded_at", JSONObject.NULL)
            .put("part_size", partSize)
            .put("files", JSONArray().put(file))
            .put("received_parts", JSONArray(s.parts.keys.sorted()))
            .put("created_at", "2026-11-15T00:00:00.000Z")
            .put("expires_at", "2026-11-16T00:00:00.000Z")
    }

    private fun session(id: String): Session? = sessions.firstOrNull { it.id == id }

    private fun error(status: Int, code: String, message: String): Pair<Int, String> =
        status to JSONObject().put("error", JSONObject().put("code", code).put("message", message)).toString()

    private fun write(out: OutputStream, status: Int, payload: String) {
        val bytes = payload.toByteArray(Charsets.UTF_8)
        out.write(
            ("HTTP/1.1 $status X\r\nContent-Type: application/json\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray()
        )
        out.write(bytes)
        out.flush()
    }

    private fun readBody(input: InputStream, length: Int): ByteArray {
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        return if (read == length) body else body.copyOf(read)
    }

    private fun readLine(input: InputStream): String {
        val line = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0 || b == '\n'.code) break
            if (b != '\r'.code) line.write(b)
        }
        return line.toString(Charsets.UTF_8.name())
    }

    companion object {
        /** The JSON a test expects in a 401 body. */
        fun errorBody(code: String, message: String): String =
            JSONObject().put("error", JSONObject().put("code", code).put("message", message)).toString()
    }
}
