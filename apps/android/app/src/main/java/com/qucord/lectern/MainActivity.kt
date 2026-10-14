package com.qucord.lectern

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.media.PlaybackParams
import android.os.Build
import android.os.Bundle
import android.os.Environment
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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

data class LectureItem(
    val id: String,
    val shareToken: String,
    val title: String,
    val course: String,
    val dateLabel: String,
    val status: String,
    val excerpt: String,
    val modelUsed: String,
    val hasAudio: Boolean,
    val markdown: String = ""
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serverBase = intent?.getStringExtra("LECTERN_URL") ?: "https://lectern.qucord.com"
        val autoQuickRecord = intent?.action == "com.qucord.lectern.QUICK_RECORD"

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
                    serverBase = serverBase,
                    autoQuickRecord = autoQuickRecord
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LecternNativeComposeApp(serverBase: String, autoQuickRecord: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val prefs = remember { context.getSharedPreferences("lectern_prefs", Context.MODE_PRIVATE) }
    var authToken by remember { mutableStateOf(prefs.getString("auth_token", "") ?: "") }
    var loginEmail by remember { mutableStateOf("") }
    var loginPassword by remember { mutableStateOf("") }
    var loginError by remember { mutableStateOf<String?>(null) }

    var lectures by remember { mutableStateOf<List<LectureItem>>(emptyList()) }
    var courses by remember { mutableStateOf(listOf("정보보호개론", "자바프로그래밍", "영어읽기와토론", "대순사상과상생윤리")) }
    var selectedCourse by remember { mutableStateOf("ALL") }
    var searchQuery by remember { mutableStateOf("") }
    var activeLecture by remember { mutableStateOf<LectureItem?>(null) }
    var isLoading by remember { mutableStateOf(true) }

    // Recording state
    var showRecorderSheet by remember { mutableStateOf(autoQuickRecord) }
    var recordCourse by remember { mutableStateOf("정보보호개론") }
    var isRecording by remember { mutableStateOf(false) }
    var recSeconds by remember { mutableStateOf(0) }
    var recAmplitude by remember { mutableStateOf(0.1f) }
    var recorderRef by remember { mutableStateOf<MediaRecorder?>(null) }
    var recFileRef by remember { mutableStateOf<File?>(null) }

    // Native Audio Player state
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var isPlayingAudio by remember { mutableStateOf(false) }
    var playbackSpeed by remember { mutableStateOf(1.0f) }

    val micPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Toast.makeText(context, "마이크 권한이 필요합니다.", Toast.LENGTH_SHORT).show()
        }
    }

    suspend fun loadLectureList(selectId: String? = null) {
        if (authToken.isBlank()) {
            isLoading = false
            return
        }
        isLoading = true
        try {
            val result = withContext(Dispatchers.IO) {
                val conn = (URL("$serverBase/api/lectures").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("X-Lectern-Token", authToken)
                }
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                val arr = json.getJSONArray("lectures")
                val list = mutableListOf<LectureItem>()
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(
                        LectureItem(
                            id = o.optString("id"),
                            shareToken = o.optString("share_token"),
                            title = o.optString("title"),
                            course = o.optString("course"),
                            dateLabel = o.optString("date_label"),
                            status = o.optString("status"),
                            excerpt = o.optString("excerpt"),
                            modelUsed = o.optString("model_used"),
                            hasAudio = o.optBoolean("has_audio")
                        )
                    )
                }
                list
            }
            lectures = result
            val target = selectId ?: activeLecture?.id ?: result.firstOrNull()?.id
            if (target != null) {
                val detail = withContext(Dispatchers.IO) {
                    val conn = (URL("$serverBase/api/lectures/$target").openConnection() as HttpURLConnection).apply {
                        setRequestProperty("X-Lectern-Token", authToken)
                    }
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    val o = JSONObject(body).getJSONObject("lecture")
                    LectureItem(
                        id = o.optString("id"),
                        shareToken = o.optString("share_token"),
                        title = o.optString("title"),
                        course = o.optString("course"),
                        dateLabel = o.optString("date_label"),
                        status = o.optString("status"),
                        excerpt = o.optString("excerpt"),
                        modelUsed = o.optString("model_used"),
                        hasAudio = o.optBoolean("has_audio"),
                        markdown = o.optString("markdown")
                    )
                }
                activeLecture = detail
            }
        } catch (e: Exception) {
            Toast.makeText(context, "목록 로드 실패: ${e.message}", Toast.LENGTH_SHORT).show()
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
        loadLectureList()
    }

    LaunchedEffect(isRecording) {
        while (isRecording) {
            delay(250)
            val amp = recorderRef?.maxAmplitude ?: 0
            recAmplitude = (amp / 18000f).coerceIn(0.08f, 1.0f)
        }
    }

    LaunchedEffect(isRecording) {
        while (isRecording) {
            delay(1000)
            recSeconds += 1
        }
    }

    fun seekAudio(seconds: Int) {
        val lec = activeLecture ?: return
        if (!lec.hasAudio) {
            Toast.makeText(context, "원본 오디오가 없는 노트입니다.", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val mp = mediaPlayer ?: MediaPlayer().apply {
                setDataSource("$serverBase/api/lectures/${lec.id}/audio")
                prepare()
            }.also { mediaPlayer = it }

            mp.seekTo(seconds * 1000)
            mp.start()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                mp.playbackParams = PlaybackParams().setSpeed(playbackSpeed)
            }
            isPlayingAudio = true
            Toast.makeText(context, String.format("⏱ %02d:%02d 지점 재생", seconds / 60, seconds % 60), Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(context, "오디오 재생 오류: ${e.message}", Toast.LENGTH_SHORT).show()
        }
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
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = loginPassword,
                    onValueChange = { loginPassword = it },
                    label = { Text("비밀번호") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (loginError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(loginError!!, color = Color(0xFFF55864), fontSize = 12.sp)
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        scope.launch {
                            try {
                                val tok = withContext(Dispatchers.IO) {
                                    val conn = (URL("$serverBase/api/auth/login").openConnection() as HttpURLConnection).apply {
                                        requestMethod = "POST"
                                        doOutput = true
                                        setRequestProperty("Content-Type", "application/json")
                                    }
                                    val payload = JSONObject().put("email", loginEmail).put("password", loginPassword).toString()
                                    conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                                    val resp = conn.inputStream.bufferedReader().use { it.readText() }
                                    JSONObject(resp).getJSONObject("user").optString("apiToken")
                                }
                                if (tok.isNotBlank()) {
                                    prefs.edit().putString("auth_token", tok).apply()
                                    authToken = tok
                                    loadLectureList()
                                }
                            } catch (e: Exception) {
                                loginError = "로그인 실패: 아이디/비밀번호를 확인하세요."
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4593FC)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("내 워크스페이스 열기", color = Color.White, fontWeight = FontWeight.SemiBold)
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
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(item.course, color = Color(0xFF5E9EFF), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Text(item.dateLabel, color = Color(0xFF8E95A5), fontSize = 11.sp)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(item.title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }

            Divider(color = Color(0xFF1F2430))

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
                    Text("${lec.course} · ${lec.dateLabel}", color = Color(0xFF93C5FD), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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

    if (showRecorderSheet) {
        ModalBottomSheet(
            onDismissRequest = { if (!isRecording) showRecorderSheet = false },
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
                    value = recordCourse,
                    onValueChange = { recordCourse = it },
                    label = { Text("과목명") },
                    singleLine = true,
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
                            val vaultDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "LecternRecordings")
                            vaultDir.mkdirs()
                            val f = File(vaultDir, "${recordCourse.replace(" ", "_")}_${System.currentTimeMillis()}.m4a")
                            val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                MediaRecorder(context)
                            } else {
                                @Suppress("DEPRECATION")
                                MediaRecorder()
                            }
                            r.setAudioSource(MediaRecorder.AudioSource.MIC)
                            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                            r.setAudioSamplingRate(16000)
                            r.setAudioChannels(1)
                            r.setAudioEncodingBitRate(32000)
                            r.setOutputFile(f.absolutePath)
                            r.prepare()
                            r.start()
                            recorderRef = r
                            recFileRef = f
                            recSeconds = 0
                            isRecording = true
                        } else {
                            try {
                                recorderRef?.stop()
                            } catch (_: Exception) {}
                            recorderRef?.release()
                            recorderRef = null
                            isRecording = false
                            val f = recFileRef
                            showRecorderSheet = false
                            if (f != null && f.exists()) {
                                scope.launch {
                                    Toast.makeText(context, "로컬 원본 저장 완료 · 서버 증류 업로드 중...", Toast.LENGTH_SHORT).show()
                                    val newId = uploadAudioMultipart(serverBase, authToken, f, recordCourse)
                                    if (newId != null) {
                                        loadLectureList(newId)
                                    } else {
                                        Toast.makeText(context, "네트워크 장애: 원본이 LecternRecordings 폴더에 안전 보관되었습니다.", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isRecording) Color(0xFFEF4444) else Color(0xFF5E9EFF)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (isRecording) "⏹ 녹음 종료 및 즉시 요약" else "🔴 마이크 녹음 시작")
                }
                Spacer(Modifier.height(20.dp))
            }
        }
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

suspend fun uploadAudioMultipart(serverBase: String, authToken: String, file: File, course: String): String? = withContext(Dispatchers.IO) {
    val idempotencyKey = "and_${file.name}_${file.length()}"
    for (attempt in 1..3) {
        try {
            if (attempt > 1) kotlinx.coroutines.delay(attempt * 2000L)
            val boundary = "Boundary-${System.currentTimeMillis()}"
            val conn = (URL("$serverBase/api/ingest/shortcut?wait=false").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 20000
                readTimeout = 120000
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                setRequestProperty("X-Client", "android-compose")
                setRequestProperty("X-Lectern-Token", authToken)
                setRequestProperty("X-Idempotency-Key", idempotencyKey)
            }
            DataOutputStream(conn.outputStream).use { out ->
                out.writeBytes("--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"course\"\r\n\r\n")
                out.write(course.toByteArray(Charsets.UTF_8))
                out.writeBytes("\r\n--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"idempotency_key\"\r\n\r\n")
                out.write(idempotencyKey.toByteArray(Charsets.UTF_8))
                out.writeBytes("\r\n--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"audio\"; filename=\"${file.name}\"\r\n")
                out.writeBytes("Content-Type: audio/mp4\r\n\r\n")
                out.write(file.readBytes())
                out.writeBytes("\r\n--$boundary--\r\n")
            }
            val resp = conn.inputStream.bufferedReader().use { it.readText() }
            val id = JSONObject(resp).optString("id").takeIf { it.isNotEmpty() }
            if (id != null) return@withContext id
        } catch (_: Exception) {
        }
    }
    null
}
