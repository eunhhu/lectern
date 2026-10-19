package com.qucord.lectern

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.UUID
import kotlin.concurrent.thread

/** Runs LecternApi.uploadAudio against a local HTTP server and checks the multipart request the server parses. */
class LecternApiUploadTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server: ServerSocket
    private lateinit var base: String

    private class Captured(val headers: Map<String, String>, val body: ByteArray)

    @Volatile private var captured: Captured? = null
    @Volatile private var status = 200
    @Volatile private var response = """{"id":"lec_1","status":"queued"}"""

    /** One request per connection is enough for HttpURLConnection when the answer says Connection: close. */
    @Before
    fun startServer() {
        server = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
        base = "http://127.0.0.1:${server.localPort}"
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                socket.use { s ->
                    val input = s.getInputStream()
                    readLine(input) // request line
                    val headers = generateSequence { readLine(input).takeIf { it.isNotEmpty() } }
                        .associate { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
                    val body = ByteArray(headers.getValue("content-length").toInt())
                    var read = 0
                    while (read < body.size) read += input.read(body, read, body.size - read).also { check(it > 0) }
                    captured = Captured(headers, body)
                    val payload = response.toByteArray()
                    s.getOutputStream().apply {
                        write(("HTTP/1.1 $status X\r\nContent-Type: application/json\r\n" +
                            "Content-Length: ${payload.size}\r\nConnection: close\r\n\r\n").toByteArray())
                        write(payload)
                        flush()
                    }
                }
            }
        }
    }

    @After
    fun stopServer() = server.close()

    private fun readLine(input: InputStream): String {
        val line = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0 || b == '\n'.code) break
            if (b != '\r'.code) line.write(b)
        }
        return line.toString(Charsets.UTF_8.name())
    }

    @Test
    fun sendsExtensionMimeTypeClientAndCourse() {
        for ((ext, mime) in listOf("wav" to "audio/wav", "m4a" to "audio/mp4", "mp3" to "audio/mpeg")) {
            val audio = ByteArray(70_000) { (it * 31 + ext.length).toByte() }
            val file = tmp.newFile("shared.$ext").apply { writeBytes(audio) }
            val id = UUID.randomUUID().toString()

            val result = LecternApi.uploadAudio(base, "tok_test", file, "정보보호개론", id, "android-share", ext, mime)

            assertEquals(UploadResult.Success("lec_1"), result)
            val req = captured!!
            assertEquals("android-share", req.headers["x-client"])
            assertEquals("tok_test", req.headers["x-lectern-token"])
            assertEquals(id, req.headers["x-idempotency-key"])
            val parts = parseMultipart(req.headers.getValue("content-type"), req.body)
            assertEquals("정보보호개론", String(parts.getValue("course").second, Charsets.UTF_8))
            assertEquals(id, String(parts.getValue("idempotency_key").second, Charsets.UTF_8))
            val (audioHead, audioBody) = parts.getValue("audio")
            assertTrue(audioHead, audioHead.contains("filename=\"lectern_$id.$ext\""))
            assertTrue(audioHead, audioHead.contains("Content-Type: $mime"))
            assertArrayEquals(audio, audioBody)
        }
    }

    @Test
    fun serverErrorIsRejectedAndRetryable() {
        status = 503
        response = """{"error":"unavailable"}"""
        val file = tmp.newFile("a.m4a").apply { writeBytes(ByteArray(10) { 1 }) }

        val result = LecternApi.uploadAudio(base, "tok", file, "c", "id-1", "android-share", "m4a", "audio/mp4")

        assertEquals(UploadResult.Rejected(503, "unavailable"), result)
        assertTrue(LecternApi.isRetryable(503))
    }

    /** name → (part headers, part body) */
    private fun parseMultipart(contentType: String, body: ByteArray): Map<String, Pair<String, ByteArray>> {
        val boundary = ("--" + contentType.substringAfter("boundary=")).toByteArray()
        val out = mutableMapOf<String, Pair<String, ByteArray>>()
        var start = indexOf(body, boundary, 0)
        while (start >= 0) {
            val partStart = start + boundary.size + 2 // boundary line ends with CRLF, or "--" on the last one
            val next = indexOf(body, boundary, partStart)
            if (next < 0) break
            val part = body.copyOfRange(partStart, next - 2) // drop the CRLF before the next boundary
            val split = indexOf(part, "\r\n\r\n".toByteArray(), 0)
            val head = String(part, 0, split, Charsets.UTF_8)
            val name = Regex("name=\"([^\"]+)\"").find(head)!!.groupValues[1]
            out[name] = head to part.copyOfRange(split + 4, part.size)
            start = next
        }
        return out
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int): Int {
        outer@ for (i in from..haystack.size - needle.size) {
            for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }
}
