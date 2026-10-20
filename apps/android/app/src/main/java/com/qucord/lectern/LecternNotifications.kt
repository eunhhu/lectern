package com.qucord.lectern

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object LecternNotifications {
    private const val CHANNEL_RECORDING = "lectern_recording"
    private const val CHANNEL_UPLOADS = "lectern_uploads"
    const val RECORDING_NOTIFICATION_ID = 1001

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_RECORDING, "강의 녹음", NotificationManager.IMPORTANCE_LOW).apply {
                description = "녹음이 진행 중일 때 표시됩니다."
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_UPLOADS, "업로드 결과", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "녹음 업로드 성공·실패 알림"
            }
        )
    }

    fun recording(context: Context, course: String, startedAtWallClock: Long): Notification {
        ensureChannels(context)
        val stopIntent = PendingIntent.getService(
            context,
            1,
            Intent(context, RecordingService::class.java).setAction(RecordingService.ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(context, CHANNEL_RECORDING)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("🔴 강의 녹음 중")
            .setContentText(course)
            .setWhen(startedAtWallClock)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openAppIntent(context))
            .addAction(android.R.drawable.ic_media_pause, "녹음 종료 및 업로드", stopIntent)
            .build()
    }

    fun notifyUpload(context: Context, uploadId: String, success: Boolean, text: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        ensureChannels(context)
        val n = NotificationCompat.Builder(context, CHANNEL_UPLOADS)
            .setSmallIcon(if (success) android.R.drawable.stat_sys_upload_done else android.R.drawable.stat_notify_error)
            .setContentTitle(if (success) "Lectern 업로드 완료" else "Lectern 업로드 실패 · 앱에서 재시도")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build()
        NotificationManagerCompat.from(context).notify(uploadId.hashCode(), n)
    }

    private fun openAppIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}
