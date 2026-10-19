package com.qucord.lectern

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.core.content.IntentCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale
import java.util.UUID

/** An audio stream another app shared with MainActivity (ACTION_SEND with an audio type). [type] is the sender's MIME type. */
data class SharedAudio(val uri: Uri, val type: String?)

/**
 * Copies shared audio into [RecordingService.recordingsDir] and queues it in [PendingUploads] like a recording.
 * The copy runs in a process-wide scope so rotating or leaving MainActivity while a long lecture file is
 * still copying neither cancels it nor loses the share.
 */
object SharedAudioImport {
    private const val TAG = "LecternShare"
    private const val CLIENT = "android-share"
    /** The server refuses request bodies over 250 MB and the web uploader advertises 200 MB. */
    private const val MAX_BYTES = 200L * 1024 * 1024

    private data class AudioFormat(val extension: String, val mimeType: String)

    private val M4A = AudioFormat(PendingUpload.DEFAULT_EXTENSION, PendingUpload.DEFAULT_MIME_TYPE)
    private val MP3 = AudioFormat("mp3", "audio/mpeg")
    private val WAV = AudioFormat("wav", "audio/wav")
    private val WEBM = AudioFormat("webm", "audio/webm")
    private val OGG = AudioFormat("ogg", "audio/ogg")
    private val AAC = AudioFormat("aac", "audio/aac")
    private val FLAC = AudioFormat("flac", "audio/flac")

    /**
     * The sender's MIME type ends up in the multipart Content-Type line, so only these canonical values are
     * ever sent. Anything else uploads as m4a, the same as an app recording.
     */
    private val FORMATS = mapOf(
        "audio/mp4" to M4A, "audio/m4a" to M4A, "audio/x-m4a" to M4A, "audio/mp4a-latm" to M4A,
        "audio/mpeg" to MP3, "audio/mp3" to MP3, "audio/mpeg3" to MP3, "audio/x-mpeg" to MP3, "audio/x-mp3" to MP3,
        "audio/wav" to WAV, "audio/wave" to WAV, "audio/x-wav" to WAV, "audio/vnd.wave" to WAV,
        "audio/webm" to WEBM,
        "audio/ogg" to OGG, "application/ogg" to OGG, "audio/opus" to OGG,
        "audio/aac" to AAC, "audio/x-aac" to AAC,
        "audio/flac" to FLAC, "audio/x-flac" to FLAC
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private class TooLargeException : IOException()

    fun isAudioShare(intent: Intent): Boolean =
        intent.action == Intent.ACTION_SEND && intent.type?.lowercase(Locale.ROOT)?.startsWith("audio/") == true

    /**
     * The shared content:// stream, or null if the sender attached none. Other schemes are refused: a file://
     * URI could name this app's own private files (e.g. the prefs holding the API token).
     */
    fun fromIntent(intent: Intent): SharedAudio? {
        val uri = try {
            // Typed getParcelableExtra on the API levels where it is reliable; some senders only fill ClipData.
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri
        } catch (e: RuntimeException) {
            // Extras another app sent can fail to unparcel.
            Log.w(TAG, "unreadable share extras", e)
            null
        }
        if (uri?.scheme != ContentResolver.SCHEME_CONTENT) return null
        return SharedAudio(uri, intent.type)
    }

    /** Copies [shared] on Dispatchers.IO and queues the upload; the outcome is reported with a Toast. */
    fun enqueue(context: Context, shared: SharedAudio, course: String) {
        val app = context.applicationContext
        scope.launch {
            val message = try {
                copyAndQueue(app, shared, course)
            } catch (e: Exception) {
                Log.e(TAG, "shared audio import failed", e)
                "공유된 오디오를 가져오지 못했습니다: ${e.message ?: e.javaClass.simpleName}"
            }
            withContext(Dispatchers.Main) { Toast.makeText(app, message, Toast.LENGTH_LONG).show() }
        }
    }

    /** Returns the message to show the user. */
    private fun copyAndQueue(context: Context, shared: SharedAudio, course: String): String {
        val format = formatOf(context, shared)
        val id = UUID.randomUUID().toString()
        // The sender's display name is never used: it could contain path separators.
        val dir = RecordingService.recordingsDir(context).apply { mkdirs() }
        val file = File(dir, "shared_${System.currentTimeMillis()}_${id.take(8)}.${format.extension}")

        val size = try {
            val input = context.contentResolver.openInputStream(shared.uri)
                ?: throw FileNotFoundException("no stream for ${shared.uri}")
            input.use { src -> file.outputStream().use { dst -> copyAtMost(src, dst, MAX_BYTES) } }
        } catch (e: Exception) {
            file.delete()
            Log.w(TAG, "copy of shared audio failed", e)
            return when (e) {
                is SecurityException -> "공유한 앱이 파일 접근 권한을 주지 않았습니다. 다시 공유해 주세요."
                is TooLargeException -> "200MB를 넘는 오디오는 업로드할 수 없습니다."
                else -> "공유된 오디오 파일을 읽을 수 없습니다."
            }
        }
        if (size == 0L) {
            file.delete()
            return "빈 오디오 파일이라 업로드하지 않았습니다."
        }

        PendingUploads.add(
            context,
            PendingUpload(
                id = id,
                filePath = file.absolutePath,
                course = course,
                client = CLIENT,
                createdAt = System.currentTimeMillis(),
                keepLocalCopy = true,
                extension = format.extension,
                mimeType = format.mimeType
            )
        )
        // Queued even when logged out: the worker marks it failed and the upload banner offers a retry after login.
        UploadWorker.enqueue(context, id)
        LecternSession.saveLastCourse(context, course)
        return if (LecternSession.token(context).isBlank()) {
            "업로드 대기열에 추가했습니다. 로그인한 뒤 재시도하세요."
        } else {
            "$course · 공유된 오디오 업로드를 시작합니다."
        }
    }

    /** The provider usually knows the real type; senders often send only the audio wildcard. */
    private fun formatOf(context: Context, shared: SharedAudio): AudioFormat {
        val providerType = try {
            context.contentResolver.getType(shared.uri)
        } catch (_: Exception) {
            null
        }
        return listOfNotNull(providerType, shared.type)
            .firstNotNullOfOrNull { FORMATS[it.substringBefore(';').trim().lowercase(Locale.ROOT)] }
            ?: M4A
    }

    /** InputStream.copyTo that gives up once more than [limit] bytes arrive, so a huge share cannot fill the disk. */
    private fun copyAtMost(src: InputStream, dst: OutputStream, limit: Long): Long {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = src.read(buffer)
            if (n < 0) return total
            total += n
            if (total > limit) throw TooLargeException()
            dst.write(buffer, 0, n)
        }
    }
}
