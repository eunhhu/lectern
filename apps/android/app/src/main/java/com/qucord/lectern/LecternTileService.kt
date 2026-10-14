package com.qucord.lectern

import android.content.Intent
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import kotlinx.coroutines.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Android Quick Settings Tile:
 * Pull down the notification shade and tap once to start recording 16kHz HE-AAC audio.
 * Tap again to stop, automatically distill via Lectern, and open the Markdown Reader.
 */
class LecternTileService : TileService() {
    companion object {
        private var recorder: MediaRecorder? = null
        private var outputFile: File? = null
        private var isRecording = false
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartListening() {
        super.onStartListening()
        syncTileState()
    }

    override fun onClick() {
        super.onClick()
        if (!isRecording) {
            startQuickRecording()
        } else {
            stopAndUploadRecording()
        }
    }

    private fun startQuickRecording() {
        val out = File(cacheDir, "lectern_${System.currentTimeMillis()}.m4a")
        outputFile = out

        val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(applicationContext)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        rec.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(16000)
            setAudioChannels(1)
            setAudioEncodingBitRate(32000)
            setOutputFile(out.absolutePath)
            prepare()
            start()
        }

        recorder = rec
        isRecording = true
        syncTileState()
    }

    private fun stopAndUploadRecording() {
        try {
            recorder?.stop()
        } catch (_: Exception) {
        } finally {
            recorder?.release()
            recorder = null
            isRecording = false
        }

        qsTile?.apply {
            state = Tile.STATE_UNAVAILABLE
            label = "Lectern 증류 중..."
            updateTile()
        }

        val fileToUpload = outputFile ?: return
        scope.launch {
            val targetUrl = uploadToLecternServer(fileToUpload, "대학교 전공 강의")
            fileToUpload.delete()
            withContext(Dispatchers.Main) {
                syncTileState()
                val intent = Intent(this@LecternTileService, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("LECTERN_URL", targetUrl ?: "https://lectern.qucord.com")
                }
                startActivityAndCollapse(intent)
            }
        }
    }

    private fun syncTileState() {
        qsTile?.apply {
            state = if (isRecording) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = if (isRecording) "🔴 녹음 중 (탭하여 요약)" else "강의 녹음 (Lectern)"
            updateTile()
        }
    }

    private fun uploadToLecternServer(file: File, course: String): String? {
        return try {
            val boundary = "Boundary-${UUID.randomUUID()}"
            val conn = (URL("https://lectern.qucord.com/api/ingest/shortcut?wait=false").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                setRequestProperty("X-Client", "android-qstile")
            }

            conn.outputStream.use { out ->
                out.write("--$boundary\r\nContent-Disposition: form-data; name=\"course\"\r\n\r\n$course\r\n".toByteArray())
                out.write("--$boundary\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"${file.name}\"\r\nContent-Type: audio/mp4\r\n\r\n".toByteArray())
                file.inputStream().use { it.copyTo(out) }
                out.write("\r\n--$boundary--\r\n".toByteArray())
            }

            val body = conn.inputStream.bufferedReader().readText()
            val match = Regex("\"url\"\\s*:\\s*\"([^\"]+)\"").find(body)
            match?.groupValues?.get(1)
        } catch (e: Exception) {
            null
        }
    }
}
