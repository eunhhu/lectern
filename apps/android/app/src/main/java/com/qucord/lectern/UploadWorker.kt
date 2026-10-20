package com.qucord.lectern

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Uploads one [PendingUpload]. WorkManager persists the job, waits for a network and backs off
 * between network/5xx failures; 4xx answers stop retrying and leave the entry for the retry UI.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val id = inputData.getString(KEY_ID) ?: return@withContext Result.failure()
        val item = PendingUploads.get(ctx, id) ?: return@withContext Result.success()

        if (!item.file.exists() || item.file.length() == 0L) {
            PendingUploads.update(ctx, id) {
                it.copy(status = PendingUpload.STATUS_FAILED, lastError = "녹음 파일을 찾을 수 없습니다.")
            }
            return@withContext Result.failure()
        }

        val token = LecternSession.token(ctx)
        if (token.isBlank()) {
            fail(item, "로그인이 필요합니다. 로그인 후 다시 시도하세요.")
            return@withContext Result.failure()
        }

        PendingUploads.update(ctx, id) { it.copy(status = PendingUpload.STATUS_UPLOADING) }
        when (val result = LecternApi.uploadAudio(
            LecternSession.serverBase, token, item.file, item.course, item.id, item.client, item.extension, item.mimeType
        )) {
            is UploadResult.Success -> {
                PendingUploads.markCompleted(ctx, item, result.lectureId)
                LecternNotifications.notifyUpload(ctx, item.id, success = true, "${item.course} 업로드 완료 · 노트 생성 중")
                Result.success()
            }
            is UploadResult.Rejected -> {
                if (result.code == 401) {
                    LecternSession.clearToken(ctx)
                    fail(item, "로그인이 만료되었습니다. 다시 로그인한 뒤 재시도하세요.")
                    Result.failure()
                } else if (LecternApi.isRetryable(result.code)) {
                    retryOrFail(item, "서버 오류 (${result.code}): ${result.message}")
                } else {
                    fail(item, "업로드 거부 (${result.code}): ${result.message}")
                    Result.failure()
                }
            }
            is UploadResult.NetworkError -> retryOrFail(item, "네트워크 오류: ${result.message}")
        }
    }

    private fun retryOrFail(item: PendingUpload, message: String): Result {
        if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
            fail(item, message)
            return Result.failure()
        }
        PendingUploads.update(applicationContext, item.id) {
            it.copy(status = PendingUpload.STATUS_QUEUED, lastError = message)
        }
        return Result.retry()
    }

    private fun fail(item: PendingUpload, message: String) {
        PendingUploads.update(applicationContext, item.id) {
            it.copy(status = PendingUpload.STATUS_FAILED, lastError = message)
        }
        LecternNotifications.notifyUpload(applicationContext, item.id, success = false, "${item.course}: $message")
    }

    companion object {
        private const val KEY_ID = "pending_upload_id"
        private const val MAX_ATTEMPTS = 8

        /** REPLACE restarts the job (retry button); KEEP only fills in a job that went missing. */
        fun enqueue(context: Context, id: String, policy: ExistingWorkPolicy = ExistingWorkPolicy.REPLACE) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_ID to id))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(workName(id), policy, request)
        }

        fun cancel(context: Context, id: String) {
            WorkManager.getInstance(context).cancelUniqueWork(workName(id))
        }

        private fun workName(id: String) = "lectern-upload-$id"
        private const val TAG = "lectern-upload"
    }
}
