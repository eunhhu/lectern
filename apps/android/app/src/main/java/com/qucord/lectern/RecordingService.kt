package com.qucord.lectern

import android.Manifest
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.service.quicksettings.TileService
import android.util.Log
import android.widget.Toast
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.UUID

data class RecordingState(
    val isRecording: Boolean = false,
    val course: String = "",
    /** SystemClock.elapsedRealtime() at start, so the timer survives rotation and process-wide observers. */
    val startedAtElapsed: Long = 0L
)

/**
 * Foreground service (type=microphone) that owns the MediaRecorder for both MainActivity and the
 * Quick Settings tile, so recording keeps going with the screen locked or the activity recreated.
 * On stop the file is added to [PendingUploads] and handed to [UploadWorker].
 */
class RecordingService : Service() {

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var current: PendingUpload? = null
    private var startedAtWallClock = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRecording(
                requestedCourse = intent.getStringExtra(EXTRA_COURSE)?.takeIf { it.isNotBlank() } ?: LecternSession.DEFAULT_COURSE,
                fromTile = intent.getBooleanExtra(EXTRA_FROM_TILE, false)
            )
            ACTION_STOP -> stopRecording()
            else -> if (recorder == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRecording(requestedCourse: String, fromTile: Boolean) {
        val alreadyRecording = recorder != null
        val course = if (alreadyRecording) _state.value.course else requestedCourse
        if (!alreadyRecording) startedAtWallClock = System.currentTimeMillis()
        // startForegroundService() obliges us to call startForeground() promptly, even if we bail out.
        val foregroundOk = try {
            ServiceCompat.startForeground(
                this,
                LecternNotifications.RECORDING_NOTIFICATION_ID,
                LecternNotifications.recording(this, course, startedAtWallClock),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            )
            true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed", e)
            false
        }
        if (alreadyRecording) return // a second start only re-posts the notification

        if (!foregroundOk || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "마이크 권한이 없어 녹음을 시작할 수 없습니다.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val id = UUID.randomUUID().toString()
        val dir = recordingsDir(this).apply { mkdirs() }
        val safeCourse = course.replace(Regex("[^\\w가-힣-]+"), "_").take(40)
        val file = File(dir, "${safeCourse}_${System.currentTimeMillis()}.m4a")

        val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioSamplingRate(16000)
            rec.setAudioChannels(1)
            rec.setAudioEncodingBitRate(32000)
            rec.setOutputFile(file.absolutePath)
            rec.setOnErrorListener { _, what, extra ->
                Log.e(TAG, "MediaRecorder error what=$what extra=$extra")
                stopRecording()
            }
            rec.prepare()
            rec.start()
        } catch (e: Exception) {
            Log.e(TAG, "MediaRecorder start failed", e)
            rec.release()
            file.delete()
            Toast.makeText(this, "녹음을 시작할 수 없습니다: ${e.message ?: "마이크 사용 중"}", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        recorder = rec
        outputFile = file
        current = PendingUpload(
            id = id,
            filePath = file.absolutePath,
            course = course,
            client = if (fromTile) "android-qstile" else "android-compose",
            createdAt = System.currentTimeMillis(),
            keepLocalCopy = !fromTile
        )
        activeRecorder = rec
        LecternSession.saveLastCourse(this, course)
        _state.value = RecordingState(isRecording = true, course = course, startedAtElapsed = SystemClock.elapsedRealtime())
        requestTileUpdate(this)
    }

    private fun stopRecording() {
        val rec = recorder ?: run {
            finish()
            return
        }
        var valid = true
        try {
            rec.stop()
        } catch (e: RuntimeException) {
            // stop() throws when no audio frames were written (e.g. stopped right after start).
            Log.w(TAG, "MediaRecorder stop failed", e)
            valid = false
        } finally {
            rec.release()
        }
        recorder = null
        activeRecorder = null

        val file = outputFile
        val item = current
        outputFile = null
        current = null
        if (valid && item != null && file != null && file.exists() && file.length() > 0) {
            PendingUploads.add(this, item)
            UploadWorker.enqueue(this, item.id)
            Toast.makeText(this, "녹음 저장 완료 · 서버 업로드를 시작합니다.", Toast.LENGTH_SHORT).show()
        } else {
            file?.delete()
            Toast.makeText(this, "녹음이 너무 짧아 저장되지 않았습니다.", Toast.LENGTH_SHORT).show()
        }
        finish()
    }

    private fun finish() {
        _state.value = RecordingState()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        requestTileUpdate(this)
    }

    override fun onDestroy() {
        // Normally already stopped; if the system tears us down mid-recording, still save what we have.
        if (recorder != null) stopRecording()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "LecternRecording"
        const val ACTION_START = "com.qucord.lectern.action.START_RECORDING"
        const val ACTION_STOP = "com.qucord.lectern.action.STOP_RECORDING"
        private const val EXTRA_COURSE = "course"
        private const val EXTRA_FROM_TILE = "from_tile"

        private val _state = MutableStateFlow(RecordingState())
        val state: StateFlow<RecordingState> = _state.asStateFlow()

        @Volatile
        private var activeRecorder: MediaRecorder? = null

        /** Current input level (0..32767) for the UI meter. */
        fun maxAmplitude(): Int = try {
            activeRecorder?.maxAmplitude ?: 0
        } catch (_: IllegalStateException) {
            0
        }

        fun recordingsDir(context: Context): File =
            File(context.getExternalFilesDir(null) ?: context.filesDir, "LecternRecordings")

        /**
         * Must be called while the app has a visible activity: a microphone FGS started from the
         * background does not get microphone access. Callers check RECORD_AUDIO first.
         */
        fun start(context: Context, course: String, fromTile: Boolean) {
            val intent = Intent(context, RecordingService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_COURSE, course)
                .putExtra(EXTRA_FROM_TILE, fromTile)
            ContextCompat.startForegroundService(context, intent)
        }

        /** Allowed from the background because the service is already in the foreground. */
        fun stop(context: Context) {
            context.startService(Intent(context, RecordingService::class.java).setAction(ACTION_STOP))
        }

        fun requestTileUpdate(context: Context) {
            try {
                TileService.requestListeningState(context, ComponentName(context, LecternTileService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "requestListeningState failed", e)
            }
        }
    }
}
