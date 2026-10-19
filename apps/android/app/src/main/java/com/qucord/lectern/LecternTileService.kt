package com.qucord.lectern

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Android Quick Settings Tile:
 * Pull down the notification shade and tap once to start recording 16kHz AAC audio.
 * Tap again to stop; the recording is queued in [PendingUploads] and uploaded by [UploadWorker].
 *
 * Recording itself runs in [RecordingService]. Starting it goes through [QuickRecordActivity]
 * because a microphone foreground service only gets mic access when started from a visible activity.
 */
class LecternTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        syncTileState()
    }

    override fun onClick() {
        super.onClick()
        if (RecordingService.state.value.isRecording) {
            RecordingService.stop(this)
            qsTile?.apply {
                state = Tile.STATE_INACTIVE
                label = "저장 중..."
                updateTile()
            }
            return
        }

        val needsApp = checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
            LecternSession.token(this).isBlank()
        val target = if (needsApp) {
            // Ask for the mic permission or a login in the full app instead of recording into a dead end.
            Intent(this, MainActivity::class.java)
        } else {
            Intent(this, QuickRecordActivity::class.java)
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        if (isLocked) unlockAndRun { launch(target) } else launch(target)
    }

    private fun launch(intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pi = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            startActivityAndCollapse(pi)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun syncTileState() {
        val recording = RecordingService.state.value.isRecording
        qsTile?.apply {
            state = if (recording) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = if (recording) "🔴 녹음 중 (탭하여 종료)" else "강의 녹음 (Lectern)"
            updateTile()
        }
    }
}
