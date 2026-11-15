package com.qucord.lectern

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.random.Random

/** LecternUploadV2 against FakeV2Server (part size 1024). */
class LecternUploadV2Test {
    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server: FakeV2Server

    @Before
    fun start() {
        server = FakeV2Server(partSize = 1024)
    }

    @After
    fun stop() = server.close()

    private fun audio(bytes: Int): File = tmp.newFile().apply { writeBytes(Random(bytes).nextBytes(bytes)) }

    private fun upload(
        file: File,
        course: String = "",
        generation: Int = 0,
        onGeneration: (Int) -> Unit = {},
        onProgress: (Int, Int) -> Unit = { _, _ -> }
    ): UploadResult = LecternUploadV2.upload(
        server.base, "tok_test", file, course, "item-1", generation, "android-compose", "m4a", "audio/mp4",
        onGeneration, onProgress
    )

    private fun createBodies(): List<JSONObject> =
        server.requests.filter { it.method == "POST" && it.route == "/api/v2/uploads" }.map { JSONObject(it.bodyText) }

    @Test
    fun `partRange covers the file exactly`() {
        val ranges = (1..3).map { LecternUploadV2.partRange(2500, 1024, 1, it) }
        assertEquals(listOf(0L to 1024L, 1024L to 1024L, 2048L to 452L), ranges)
    }

    @Test
    fun `idempotency key keeps the id for generation 0`() {
        assertEquals("abc", LecternUploadV2.idempotencyKey("abc", 0))
        assertEquals("abc-g2", LecternUploadV2.idempotencyKey("abc", 2))
    }

    @Test
    fun `create body is byte-identical across calls`() {
        val a = LecternUploadV2.createBody("ws_1", "lectern_x.m4a", "audio/mp4", 2500, "fld_1")
        val b = LecternUploadV2.createBody("ws_1", "lectern_x.m4a", "audio/mp4", 2500, "fld_1")
        assertEquals(a, b)
        val parsed = JSONObject(a)
        assertEquals("fld_1", parsed.getJSONObject("recording").getString("folder_id"))
        assertEquals(2500L, parsed.getJSONArray("files").getJSONObject(0).getLong("bytes"))

        val noFolder = JSONObject(LecternUploadV2.createBody("ws_1", "lectern_x.m4a", "audio/mp4", 2500, null))
        assertFalse(noFolder.has("recording"))
        assertEquals("audio/mp4", noFolder.getJSONArray("files").getJSONObject(0).getString("mime"))
    }

    @Test
    fun `uploads three parts and completes`() {
        val file = audio(2500)

        val result = upload(file)

        assertEquals(UploadResult.Success("lec_1"), result)
        assertEquals(listOf("1", "2", "3"), server.puts().map { it.route.substringAfterLast('/') })
        assertArrayEquals(file.readBytes(), server.assembled(server.uploadIdFor("item-1")!!))
        assertTrue(server.requests.isNotEmpty())
        server.requests.forEach {
            assertEquals(it.path, "tok_test", it.headers["x-lectern-token"])
            assertEquals(it.path, "android-compose", it.headers["x-client"])
        }
        val create = server.requests.first { it.route == "/api/v2/uploads" }
        assertEquals("item-1", create.headers["idempotency-key"])
        assertEquals("lectern_item-1.m4a", JSONObject(create.bodyText).getJSONArray("files").getJSONObject(0).getString("filename"))
    }

    @Test
    fun `resumes after a dropped connection`() {
        val file = audio(2500)
        server.dropConnectionOnPart(2)

        val first = upload(file)
        val second = upload(file)

        assertTrue(first.toString(), first is UploadResult.NetworkError)
        assertEquals(UploadResult.Success("lec_1"), second)
        assertEquals(1, server.puts(part = 1).size)
        assertArrayEquals(file.readBytes(), server.assembled(server.uploadIdFor("item-1")!!))
    }

    @Test
    fun `retryable part failure is reported with its code`() {
        val file = audio(2500)
        server.failPartOnce(2, 503)

        val first = upload(file)

        assertTrue(first.toString(), first is UploadResult.Rejected && first.code == 503)
        assertTrue(LecternApi.isRetryable(503))
        assertEquals(UploadResult.Success("lec_1"), upload(file))
        assertEquals(1, server.puts(part = 1).size)
    }

    @Test
    fun `unauthorized part is rejected with 401`() {
        val file = audio(2500)
        server.failPartOnce(1, 401)

        val result = upload(file)

        assertTrue(result.toString(), result is UploadResult.Rejected && result.code == 401)
    }

    @Test
    fun `another run completing the session is a success`() {
        server.completeByAnotherRunOnPart(2)

        val result = upload(audio(2500))

        assertEquals(UploadResult.Success("lec_1"), result)
        assertTrue(server.requests.any { it.method == "GET" && it.route.startsWith("/api/v2/uploads/") })
    }

    @Test
    fun `completed session is not re-uploaded`() {
        val file = audio(2500)
        assertEquals(UploadResult.Success("lec_1"), upload(file))
        val putsBefore = server.puts().size

        val again = upload(file)

        assertEquals(UploadResult.Success("lec_1"), again)
        assertEquals(putsBefore, server.puts().size)
    }

    @Test
    fun `expired session starts a new generation`() {
        val file = audio(2500)
        server.dropConnectionOnPart(2)
        assertTrue(upload(file) is UploadResult.NetworkError)
        server.expire(server.uploadIdFor("item-1")!!)
        val generations = mutableListOf<Int>()

        val result = upload(file, onGeneration = { generations += it })

        assertEquals(UploadResult.Success("lec_1"), result)
        assertEquals(listOf(1), generations)
        val fresh = server.uploadIdFor("item-1-g1")
        assertNotNull(fresh)
        assertArrayEquals(file.readBytes(), server.assembled(fresh!!))
    }

    @Test
    fun `idempotency conflict starts a new generation`() {
        val file = audio(2500)
        server.dropConnectionOnPart(2)
        assertTrue(upload(file, course = "운영체제") is UploadResult.NetworkError)
        // The folder the first call made is gone and another of the same name is there: the
        // body (folder_id) differs under the same key.
        server.clearFolders()
        server.addFolder("fld_other", "운영체제")
        val generations = mutableListOf<Int>()

        val result = upload(file, course = "운영체제", onGeneration = { generations += it })

        assertEquals(UploadResult.Success("lec_1"), result)
        assertEquals(listOf(1), generations)
        assertEquals("fld_other", createBodies().last().getJSONObject("recording").getString("folder_id"))
    }

    @Test
    fun `course maps to an existing folder`() {
        server.addFolder("fld_os", "운영체제")
        server.addFolder("fld_child", "운영체제", parentId = "fld_os")

        assertEquals(UploadResult.Success("lec_1"), upload(audio(10), course = " 운영체제 "))

        assertEquals("fld_os", createBodies().single().getJSONObject("recording").getString("folder_id"))
        assertTrue(server.requests.none { it.method == "POST" && it.route == "/api/v2/folders" })
    }

    @Test
    fun `course creates a folder when missing`() {
        assertEquals(UploadResult.Success("lec_1"), upload(audio(10), course = "자료구조"))

        val posts = server.requests.filter { it.method == "POST" && it.route == "/api/v2/folders" }
        assertEquals(1, posts.size)
        assertEquals("자료구조", JSONObject(posts.single().bodyText).getString("name"))
        assertEquals("fld_new1", createBodies().single().getJSONObject("recording").getString("folder_id"))
    }

    @Test
    fun `blank course sends no folder`() {
        assertEquals(UploadResult.Success("lec_1"), upload(audio(10), course = ""))

        assertTrue(server.requests.none { it.route == "/api/v2/folders" })
        assertFalse(createBodies().single().has("recording"))
    }

    @Test
    fun `v2 error message comes from error message`() {
        server.respond("POST", "/api/v2/uploads", 403, FakeV2Server.errorBody("quota_exceeded", "한도 초과"))

        assertEquals(UploadResult.Rejected(403, "한도 초과"), upload(audio(10)))
    }

    @Test
    fun `progress reports every part`() {
        val progress = mutableListOf<Pair<Int, Int>>()

        upload(audio(2500), onProgress = { done, total -> progress += done to total })

        assertEquals(listOf(1 to 3, 2 to 3, 3 to 3), progress)
    }

    @Test
    fun `unauthorized is rejected with 401`() {
        server.respond("GET", "/api/v2/me", 401, FakeV2Server.errorBody("unauthorized", "로그인이 필요합니다."))

        val result = upload(audio(10))

        assertEquals(UploadResult.Rejected(401, "로그인이 필요합니다."), result)
    }
}
