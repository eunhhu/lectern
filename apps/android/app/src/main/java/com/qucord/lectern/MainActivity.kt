package com.qucord.lectern

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.text.format.Formatter
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.core.os.BundleCompat
import androidx.work.ExistingWorkPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    /** Bumped for each QUICK_RECORD shortcut launch, including ones delivered to onNewIntent (singleTop). */
    private var quickRecordRequests by mutableIntStateOf(0)

    /** Shared audio waiting for the user to confirm its course. Nothing is copied until they do. */
    private val pendingShares = mutableStateListOf<SharedAudio>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The server base is fixed at build time; intent extras are ignored because this activity is exported.
        if (savedInstanceState == null && isQuickRecord(intent)) quickRecordRequests++
        if (savedInstanceState == null) handleShare(intent) else restorePendingShares(savedInstanceState)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = Color(0xFF0B0D11),
                    surface = Color(0xFF14171D),
                    primary = Color(0xFF4593FC),
                    onPrimary = Color.White
                )
            ) {
                LecternNativeComposeApp(
                    serverBase = LecternSession.serverBase,
                    quickRecordRequests = quickRecordRequests
                )
                // Outside LecternNativeComposeApp so it also shows over the login screen.
                pendingShares.firstOrNull()?.let { shared ->
                    key(shared.uri) {
                        SharedAudioDialog(
                            shared = shared,
                            onConfirm = { course ->
                                pendingShares.remove(shared)
                                SharedAudioImport.enqueue(this, shared, course)
                            },
                            onCancel = { pendingShares.remove(shared) }
                        )
                    }
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        // The sender's URI grant belongs to this activity record, so it outlives rotation and process death.
        outState.putParcelableArrayList(STATE_SHARE_URIS, ArrayList(pendingShares.map { it.uri }))
        outState.putStringArrayList(STATE_SHARE_TYPES, ArrayList(pendingShares.map { it.type.orEmpty() }))
    }

    private fun restorePendingShares(state: Bundle) {
        val uris = BundleCompat.getParcelableArrayList(state, STATE_SHARE_URIS, Uri::class.java) ?: return
        val types = state.getStringArrayList(STATE_SHARE_TYPES).orEmpty()
        uris.forEachIndexed { i, uri -> pendingShares += SharedAudio(uri, types.getOrNull(i)?.ifEmpty { null }) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isQuickRecord(intent)) quickRecordRequests++
        handleShare(intent)
    }

    private fun isQuickRecord(intent: Intent?): Boolean =
        intent?.action == ACTION_QUICK_RECORD && !launchedFromHistory(intent)

    /** Reopening from recents replays the launch intent; it must not record or import a second time. */
    private fun launchedFromHistory(intent: Intent): Boolean =
        (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0

    /** Share sheet target: audio shared from another app is confirmed in [SharedAudioDialog], then queued. */
    private fun handleShare(intent: Intent?) {
        if (intent == null || !SharedAudioImport.isAudioShare(intent) || launchedFromHistory(intent)) return
        val shared = SharedAudioImport.fromIntent(intent)
        if (shared == null) {
            Toast.makeText(this, "공유된 오디오 파일을 찾을 수 없습니다.", Toast.LENGTH_SHORT).show()
            return
        }
        if (pendingShares.none { it.uri == shared.uri }) pendingShares += shared
    }

    companion object {
        const val ACTION_QUICK_RECORD = "com.qucord.lectern.QUICK_RECORD"
        private const val STATE_SHARE_URIS = "pending_share_uris"
        private const val STATE_SHARE_TYPES = "pending_share_types"
    }
}

/** Lets the user pick the course for a shared file before it is copied and queued. */
@Composable
private fun SharedAudioDialog(shared: SharedAudio, onConfirm: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    var course by rememberSaveable { mutableStateOf(LecternSession.lastCourse(context)) }
    val authToken by LecternSession.tokenFlow(context).collectAsState()
    val fileLabel by produceState<String?>(null, shared.uri) {
        value = withContext(Dispatchers.IO) { SharedAudioImport.describe(context, shared.uri) }
    }
    AlertDialog(
        // Back cancels; a stray tap outside should not drop the share.
        onDismissRequest = onCancel,
        properties = DialogProperties(dismissOnClickOutside = false),
        title = { Text("공유된 오디오 업로드") },
        text = {
            Column {
                fileLabel?.let {
                    Text(it, color = Color(0xFF9EA6B2), fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(10.dp))
                }
                OutlinedTextField(
                    value = course,
                    onValueChange = { course = it },
                    label = { Text("과목명") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (authToken.isBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "로그인 전에는 업로드 대기열에 보관되며, 로그인한 뒤 재시도할 수 있습니다.",
                        color = Color(0xFFFBBF24),
                        fontSize = 12.sp
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(course.trim().ifBlank { LecternSession.DEFAULT_COURSE }) }) { Text("업로드") }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("취소") }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LecternNativeComposeApp(serverBase: String, quickRecordRequests: Int) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val authToken by LecternSession.tokenFlow(context).collectAsState()
    var loginEmail by rememberSaveable { mutableStateOf("") }
    var loginPassword by remember { mutableStateOf("") }
    var loginError by remember { mutableStateOf<String?>(null) }
    var isLoggingIn by remember { mutableStateOf(false) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    var lectures by remember { mutableStateOf<List<LectureItem>>(emptyList()) }
    var courses by remember { mutableStateOf(listOf("정보보호개론", "자바프로그래밍", "영어읽기와토론", "대순사상과상생윤리")) }
    var selectedCourse by remember { mutableStateOf("ALL") }
    var searchQuery by remember { mutableStateOf("") }
    var activeLecture by remember { mutableStateOf<LectureItem?>(null) }
    var isLoading by remember { mutableStateOf(true) }

    // Recording state lives in RecordingService so it survives rotation and screen lock.
    val recState by RecordingService.state.collectAsState()
    val isRecording = recState.isRecording
    var showRecorderSheet by rememberSaveable { mutableStateOf(false) }
    var recordCourse by rememberSaveable { mutableStateOf(LecternSession.lastCourse(context)) }
    var recSeconds by remember { mutableIntStateOf(0) }
    var recAmplitude by remember { mutableFloatStateOf(0.1f) }
    var startAfterPermission by remember { mutableStateOf(false) }
    var askedStartupPermissions by rememberSaveable { mutableStateOf(false) }

    val pendingUploads by PendingUploads.items(context).collectAsState()
    var showUploadsSheet by rememberSaveable { mutableStateOf(false) }
    var uploadToDelete by remember { mutableStateOf<PendingUpload?>(null) }

    // Native Audio Player state
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var playerReady by remember { mutableStateOf(false) }
    var isPlayingAudio by remember { mutableStateOf(false) }
    var pendingSeekMs by remember { mutableIntStateOf(0) }
    var playbackSpeed by remember { mutableStateOf(1.0f) }

    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && startAfterPermission) {
            RecordingService.start(context, recordCourse.ifBlank { LecternSession.DEFAULT_COURSE }, fromTile = false)
        } else if (!granted) {
            Toast.makeText(context, "마이크 권한이 필요합니다.", Toast.LENGTH_SHORT).show()
        }
        startAfterPermission = false
    }

    val startupPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if (result[Manifest.permission.RECORD_AUDIO] == false) {
            Toast.makeText(context, "마이크 권한이 필요합니다.", Toast.LENGTH_SHORT).show()
        }
    }

    fun startRecording() {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startAfterPermission = true
            micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        RecordingService.start(context, recordCourse.ifBlank { LecternSession.DEFAULT_COURSE }, fromTile = false)
    }

    fun onUnauthorized() {
        LecternSession.clearToken(context)
        loginError = "로그인이 만료되었습니다. 다시 로그인하세요."
    }

    suspend fun loadLectureList(selectId: String? = null) {
        val token = authToken
        if (token.isBlank()) {
            isLoading = false
            return
        }
        isLoading = true
        try {
            val result = withContext(Dispatchers.IO) { LecternApi.fetchLectures(serverBase, token) }
            lectures = result
            val target = selectId ?: activeLecture?.id ?: result.firstOrNull()?.id
            if (target != null) {
                activeLecture = withContext(Dispatchers.IO) { LecternApi.fetchLecture(serverBase, token, target) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpStatusException) {
            if (e.code == 401) {
                onUnauthorized()
            } else {
                Toast.makeText(context, "목록 로드 실패: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(context, "목록 로드 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        } finally {
            isLoading = false
        }
    }

    fun releasePlayer() {
        mediaPlayer?.release()
        mediaPlayer = null
        playerReady = false
        isPlayingAudio = false
    }

    LaunchedEffect(Unit) {
        if (!askedStartupPermissions) {
            askedStartupPermissions = true
            val wanted = buildList {
                add(Manifest.permission.RECORD_AUDIO)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
            }.filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (wanted.isNotEmpty()) startupPermLauncher.launch(wanted.toTypedArray())
        }
    }

    // Login, logout and a 401 anywhere (including the upload worker) all flow through the stored token.
    LaunchedEffect(authToken) {
        if (authToken.isBlank()) {
            releasePlayer()
            lectures = emptyList()
            activeLecture = null
            isLoading = false
        } else {
            loadLectureList()
        }
    }

    LaunchedEffect(Unit) {
        // A queued entry whose job was lost (e.g. process death between queueing and enqueueing) gets one back.
        PendingUploads.items(context).value
            .filter { it.status != PendingUpload.STATUS_FAILED }
            .forEach { UploadWorker.enqueue(context, it.id, ExistingWorkPolicy.KEEP) }
        PendingUploads.completed.collect { lectureId -> loadLectureList(lectureId) }
    }

    LaunchedEffect(quickRecordRequests) {
        if (quickRecordRequests > 0) showRecorderSheet = true
    }

    LaunchedEffect(isRecording) {
        // Recording started from the tile or before a rotation: bring the controls back.
        if (isRecording) showRecorderSheet = true
    }

    LaunchedEffect(recState) {
        if (!recState.isRecording) recSeconds = 0
        while (recState.isRecording) {
            recSeconds = ((SystemClock.elapsedRealtime() - recState.startedAtElapsed) / 1000).toInt()
            recAmplitude = (RecordingService.maxAmplitude() / 18000f).coerceIn(0.08f, 1.0f)
            delay(250)
        }
    }

    // A new lecture gets a new MediaPlayer; the old one is released (also on leaving the screen).
    DisposableEffect(activeLecture?.id) {
        onDispose { releasePlayer() }
    }

    fun seekAudio(seconds: Int) {
        val lec = activeLecture ?: return
        if (!lec.hasAudio) {
            Toast.makeText(context, "원본 오디오가 없는 노트입니다.", Toast.LENGTH_SHORT).show()
            return
        }
        val ms = seconds * 1000
        val existing = mediaPlayer
        if (existing != null) {
            if (playerReady) {
                existing.seekTo(ms)
                existing.start()
                isPlayingAudio = true
            } else {
                pendingSeekMs = ms // applied once prepareAsync finishes
            }
        } else {
            val mp = MediaPlayer()
            mediaPlayer = mp
            playerReady = false
            pendingSeekMs = ms
            try {
                mp.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                mp.setOnPreparedListener { p ->
                    if (mediaPlayer !== p) return@setOnPreparedListener
                    playerReady = true
                    p.seekTo(pendingSeekMs)
                    p.start()
                    p.playbackParams = PlaybackParams().setSpeed(playbackSpeed)
                    isPlayingAudio = true
                }
                mp.setOnCompletionListener { isPlayingAudio = false }
                mp.setOnErrorListener { p, what, extra ->
                    if (mediaPlayer === p) releasePlayer() else p.release()
                    Toast.makeText(context, "오디오 재생 오류 ($what/$extra)", Toast.LENGTH_SHORT).show()
                    true
                }
                // The audio route requires the account token, same as the JSON API.
                mp.setDataSource(
                    context,
                    Uri.parse(LecternApi.audioUrl(serverBase, lec.id)),
                    LecternApi.authHeaders(authToken)
                )
                mp.prepareAsync()
            } catch (e: Exception) {
                releasePlayer()
                Toast.makeText(context, "오디오 재생 오류: ${e.message}", Toast.LENGTH_SHORT).show()
                return
            }
        }
        Toast.makeText(context, String.format("⏱ %02d:%02d 지점 재생", seconds / 60, seconds % 60), Toast.LENGTH_SHORT).show()
    }

    fun retryUpload(item: PendingUpload) {
        PendingUploads.update(context, item.id) { it.copy(status = PendingUpload.STATUS_QUEUED, lastError = null) }
        UploadWorker.enqueue(context, item.id)
    }

    fun exportPdf(lec: LectureItem) {
        try {
            val pdf = PdfDocument()
            val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
            val page = pdf.startPage(pageInfo)
            val canvas = page.canvas
            val paint = Paint().apply {
                textSize = 11f
                isAntiAlias = true
            }
            var y = 40f
            for (line in lec.markdown.lines()) {
                if (y > 800f) break
                canvas.drawText(line.take(85), 32f, y, paint)
                y += 16f
            }
            pdf.finishPage(page)
            val outDir = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: context.cacheDir
            val outFile = File(outDir, "${lec.course}_${lec.dateLabel}.pdf")
            FileOutputStream(outFile).use { pdf.writeTo(it) }
            pdf.close()
            Toast.makeText(context, "📄 PDF 저장 완료: ${outFile.name}", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(context, "PDF 생성 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    val filtered = lectures.filter {
        (selectedCourse == "ALL" || it.course == selectedCourse) &&
            (searchQuery.isBlank() || it.title.contains(searchQuery, true) || it.excerpt.contains(searchQuery, true))
    }

    if (authToken.isBlank()) {
        Surface(color = Color(0xFF0B0D11), modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(28.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("Lectern", color = Color(0xFFF2F4F6), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("내 계정에 로그인하여 강의 녹음과 마크다운 노트를 불러오세요.", color = Color(0xFF9EA6B2), fontSize = 13.sp)
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = loginEmail,
                    onValueChange = { loginEmail = it },
                    label = { Text("아이디 또는 이메일") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = loginPassword,
                    onValueChange = { loginPassword = it },
                    label = { Text("비밀번호") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth()
                )
                if (loginError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(loginError!!, color = Color(0xFFF55864), fontSize = 12.sp)
                }
                if (pendingUploads.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "업로드 대기 중인 녹음 ${pendingUploads.size}건은 로그인 후 재시도할 수 있습니다.",
                        color = Color(0xFFFBBF24),
                        fontSize = 12.sp
                    )
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    enabled = !isLoggingIn,
                    onClick = {
                        scope.launch {
                            isLoggingIn = true
                            loginError = null
                            try {
                                val tok = withContext(Dispatchers.IO) {
                                    LecternApi.login(serverBase, loginEmail.trim(), loginPassword)
                                }
                                if (tok.isNotBlank()) {
                                    loginPassword = ""
                                    LecternSession.saveToken(context, tok)
                                } else {
                                    loginError = "로그인 실패: 서버 응답에 토큰이 없습니다."
                                }
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: HttpStatusException) {
                                loginError = if (e.code == 401) "로그인 실패: 아이디/비밀번호를 확인하세요." else "로그인 실패: ${e.message}"
                            } catch (e: Exception) {
                                loginError = "서버에 연결할 수 없습니다: ${e.message}"
                            } finally {
                                isLoggingIn = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4593FC)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (isLoggingIn) "로그인 중..." else "내 워크스페이스 열기", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        return
    }

    Scaffold(
        containerColor = Color(0xFF0B0D11),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Lectern", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color(0xFFF2F4F6))
                        Spacer(Modifier.width(8.dp))
                        Text("Elysium", fontSize = 11.sp, color = Color(0xFF6B7684))
                    }
                },
                actions = {
                    TextButton(onClick = { showLogoutConfirm = true }) {
                        Text("로그아웃", color = Color(0xFF9EA6B2), fontSize = 12.sp)
                    }
                    Button(
                        onClick = { showRecorderSheet = true },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4593FC))
                    ) {
                        Text("새 강의 녹음", color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF14171D))
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (pendingUploads.isNotEmpty()) {
                val failedCount = pendingUploads.count { it.status == PendingUpload.STATUS_FAILED }
                Surface(
                    color = if (failedCount > 0) Color(0x33F55864) else Color(0x335E9EFF),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .clickable { showUploadsSheet = true }
                ) {
                    Text(
                        text = if (failedCount > 0) {
                            "⚠️ 업로드 실패 ${failedCount}건 · 대기 ${pendingUploads.size - failedCount}건 — 탭하여 재시도"
                        } else {
                            "⬆️ 업로드 대기 ${pendingUploads.size}건 — 탭하여 상태 보기"
                        },
                        color = if (failedCount > 0) Color(0xFFFCA5A5) else Color(0xFF93C5FD),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                    )
                }
            }

            // Course Filter Chips & Search
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = { Text("강의 노트·키워드 검색...") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                (listOf("ALL") + courses).forEach { c ->
                    FilterChip(
                        selected = selectedCourse == c,
                        onClick = { selectedCourse = c },
                        label = { Text(if (c == "ALL") "전체" else c) }
                    )
                }
            }

            // Horizontal Lecture Selector
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                filtered.forEach { item ->
                    val isSel = activeLecture?.id == item.id
                    Surface(
                        color = if (isSel) Color(0xFF1E293B) else Color(0xFF161920),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .width(230.dp)
                            .clickable {
                                scope.launch { loadLectureList(item.id) }
                            }
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    item.course,
                                    color = Color(0xFF5E9EFF),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false).padding(end = 6.dp)
                                )
                                Text(item.dateLabel, color = Color(0xFF8E95A5), fontSize = 11.sp, maxLines = 1)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(item.title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }

            HorizontalDivider(color = Color(0xFF1F2430))

            // Active Lecture Native Markdown Reader
            val lec = activeLecture
            if (lec != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF121418))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "${lec.course} · ${lec.dateLabel}",
                        color = Color(0xFF93C5FD),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false).padding(end = 8.dp)
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val player = mediaPlayer
                        if (player != null && playerReady) {
                            OutlinedButton(
                                onClick = {
                                    if (isPlayingAudio) {
                                        player.pause()
                                        isPlayingAudio = false
                                    } else {
                                        player.start()
                                        isPlayingAudio = true
                                    }
                                },
                                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                            ) {
                                Text(if (isPlayingAudio) "⏸ 정지" else "▶ 재생", fontSize = 11.sp)
                            }
                        }
                        OutlinedButton(
                            onClick = { exportPdf(lec) },
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text("📄 PDF", fontSize = 11.sp)
                        }
                        OutlinedButton(
                            onClick = {
                                val link = "$serverBase/s/${lec.shareToken}"
                                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                cm.setPrimaryClip(ClipData.newPlainText("Lectern Share", link))
                                Toast.makeText(context, "🔗 공유 링크 복사 완료", Toast.LENGTH_SHORT).show()
                            },
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text("🔗 공유", fontSize = 11.sp)
                        }
                    }
                }

                NativeComposeMarkdownReader(
                    markdown = lec.markdown,
                    onSeekSeconds = { seekAudio(it) },
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(if (isLoading) "강의 노트 불러오는 중..." else "노트를 선택하거나 녹음을 시작하세요.", color = Color.Gray)
                }
            }
        }
    }

    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = { Text("로그아웃") },
            text = { Text("이 기기에서 로그아웃할까요? 업로드 대기 중인 녹음은 보관되며, 다시 로그인한 뒤 재시도할 수 있습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutConfirm = false
                    loginError = null
                    LecternSession.clearToken(context)
                }) { Text("로그아웃") }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutConfirm = false }) { Text("취소") }
            }
        )
    }

    if (showRecorderSheet) {
        val isRecordingNow by rememberUpdatedState(isRecording)
        val recorderSheetState = rememberModalBottomSheetState(
            skipPartiallyExpanded = true,
            // Keep the stop button reachable while recording; swiping it away would hide it for good.
            confirmValueChange = { it != SheetValue.Hidden || !isRecordingNow }
        )
        ModalBottomSheet(
            onDismissRequest = { if (!isRecording) showRecorderSheet = false },
            sheetState = recorderSheetState,
            containerColor = Color(0xFF161920)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("🎙 실시간 강의 녹음 및 증류", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = if (isRecording) recState.course else recordCourse,
                    onValueChange = { recordCourse = it },
                    label = { Text("과목명") },
                    singleLine = true,
                    enabled = !isRecording,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(14.dp))
                Text(
                    String.format("%02d:%02d", recSeconds / 60, recSeconds % 60),
                    fontSize = 36.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = if (isRecording) Color(0xFFEF4444) else Color.White
                )
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { if (isRecording) recAmplitude else 0f },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    color = Color(0xFFEF4444)
                )
                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = {
                        if (!isRecording) {
                            startRecording()
                        } else {
                            // The service saves the file, queues it in PendingUploads and starts UploadWorker.
                            RecordingService.stop(context)
                            showRecorderSheet = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isRecording) Color(0xFFEF4444) else Color(0xFF5E9EFF)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (isRecording) "⏹ 녹음 종료 및 즉시 요약" else "🔴 마이크 녹음 시작")
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "화면이 꺼져도 녹음이 계속되며, 알림에서 종료할 수 있습니다.",
                    color = Color(0xFF6B7684),
                    fontSize = 11.sp
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }

    if (showUploadsSheet) {
        ModalBottomSheet(
            onDismissRequest = { showUploadsSheet = false },
            containerColor = Color(0xFF161920)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("업로드 대기열", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    val failed = pendingUploads.filter { it.status == PendingUpload.STATUS_FAILED }
                    if (failed.size > 1) {
                        TextButton(onClick = { failed.forEach { retryUpload(it) } }) { Text("모두 재시도") }
                    }
                }
                Spacer(Modifier.height(8.dp))
                if (pendingUploads.isEmpty()) {
                    Text("대기 중인 업로드가 없습니다.", color = Color.Gray, fontSize = 13.sp)
                }
                val dateFmt = remember { SimpleDateFormat("M/d HH:mm", Locale.KOREA) }
                LazyColumn(
                    modifier = Modifier.heightIn(max = 420.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(pendingUploads, key = { it.id }) { item ->
                        Surface(color = Color(0xFF1C2029), shape = RoundedCornerShape(10.dp)) {
                            Column(Modifier.padding(12.dp)) {
                                val size = if (item.file.exists()) Formatter.formatShortFileSize(context, item.file.length()) else "파일 없음"
                                Text(item.course, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("${dateFmt.format(Date(item.createdAt))} · $size", color = Color(0xFF8E95A5), fontSize = 11.sp)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    when (item.status) {
                                        PendingUpload.STATUS_UPLOADING -> "업로드 중..."
                                        PendingUpload.STATUS_FAILED -> "실패 · ${item.lastError ?: "재시도 필요"}"
                                        else -> item.lastError?.let { "자동 재시도 대기 · $it" } ?: "업로드 대기 중"
                                    },
                                    color = if (item.status == PendingUpload.STATUS_FAILED) Color(0xFFFCA5A5) else Color(0xFF93C5FD),
                                    fontSize = 12.sp
                                )
                                Spacer(Modifier.height(6.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        onClick = { retryUpload(item) },
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                                    ) { Text("재시도", fontSize = 12.sp) }
                                    TextButton(onClick = { uploadToDelete = item }) {
                                        Text("삭제", color = Color(0xFFF55864), fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    uploadToDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { uploadToDelete = null },
            title = { Text("대기열에서 삭제") },
            text = {
                Text(
                    if (item.keepLocalCopy) {
                        "업로드를 취소합니다. 원본 파일은 LecternRecordings 폴더에 남습니다."
                    } else {
                        "업로드를 취소하고 이 녹음 파일을 삭제합니다. 되돌릴 수 없습니다."
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    UploadWorker.cancel(context, item.id)
                    PendingUploads.remove(context, item.id)
                    if (!item.keepLocalCopy) item.file.delete()
                    uploadToDelete = null
                }) { Text("삭제", color = Color(0xFFF55864)) }
            },
            dismissButton = {
                TextButton(onClick = { uploadToDelete = null }) { Text("취소") }
            }
        )
    }
}

@Composable
fun NativeComposeMarkdownReader(
    markdown: String,
    onSeekSeconds: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val lines = remember(markdown) { markdown.lines() }
    val tsRegex = remember { Regex("""\[(\d{1,2}):(\d{2})(?::(\d{2}))?""") }

    LazyColumn(
        modifier = modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(lines) { raw ->
            val trimmed = raw.trim()
            if (trimmed.isEmpty() || trimmed == "```") return@items

            val match = tsRegex.find(trimmed)
            val tsSec = if (match != null) {
                val m = match.groupValues[1].toIntOrNull() ?: 0
                val s = match.groupValues[2].toIntOrNull() ?: 0
                m * 60 + s
            } else null

            when {
                trimmed.contains("[쉬는 시간 생략") -> {
                    Surface(color = Color(0x33F59E0B), shape = RoundedCornerShape(8.dp)) {
                        Text(
                            text = "☕ " + trimmed.replace("`", ""),
                            color = Color(0xFFFBBF24),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
                trimmed.contains("[수업 종료 후 녹음 절단") -> {
                    Surface(color = Color(0x3310B981), shape = RoundedCornerShape(8.dp)) {
                        Text(
                            text = "✂️ " + trimmed.replace("`", ""),
                            color = Color(0xFF34D399),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
                trimmed.startsWith("# ") -> {
                    Text(
                        text = trimmed.removePrefix("# ").replace("**", ""),
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.padding(top = 6.dp)
                    )
                }
                trimmed.startsWith("## ") -> {
                    Text(
                        text = trimmed.removePrefix("## ").replace("**", ""),
                        color = Color(0xFF93C5FD),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                trimmed.startsWith("### ") -> {
                    Text(
                        text = trimmed.removePrefix("### ").replace("**", ""),
                        color = Color(0xFFBFDBFE),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                else -> {
                    Row(verticalAlignment = Alignment.Top) {
                        if (tsSec != null) {
                            Surface(
                                color = Color(0x285E9EFF),
                                shape = RoundedCornerShape(5.dp),
                                modifier = Modifier
                                    .padding(end = 6.dp, top = 2.dp)
                                    .clickable { onSeekSeconds(tsSec) }
                            ) {
                                Text(
                                    text = String.format("⏱ %02d:%02d", tsSec / 60, tsSec % 60),
                                    color = Color(0xFF60A5FA),
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                        Text(
                            text = trimmed.replace("**", ""),
                            color = Color(0xFFE5E7EB),
                            fontSize = 13.5.sp,
                            lineHeight = 20.sp
                        )
                    }
                }
            }
        }
    }
}
