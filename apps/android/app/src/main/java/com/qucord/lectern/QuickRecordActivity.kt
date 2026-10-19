package com.qucord.lectern

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast

/**
 * Invisible, non-exported trampoline launched by [LecternTileService]. Starting the microphone
 * foreground service from here (while an activity of ours is visible) is what grants it
 * while-in-use microphone access; starting it straight from the tile could record silence.
 */
class QuickRecordActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
            LecternSession.token(this).isBlank()
        ) {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else if (!RecordingService.state.value.isRecording) {
            RecordingService.start(this, LecternSession.lastCourse(this), fromTile = true)
            Toast.makeText(this, "🔴 강의 녹음 시작", Toast.LENGTH_SHORT).show()
        }
        finish()
    }
}
