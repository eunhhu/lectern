using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LecternTray;

internal sealed class LectureDto
{
    public string id { get; set; } = "";
    public string share_token { get; set; } = "";
    public string title { get; set; } = "";
    public string course { get; set; } = "";
    public string date_label { get; set; } = "";
    public string excerpt { get; set; } = "";
    public string model_used { get; set; } = "";
    public string markdown { get; set; } = "";
    public override string ToString() => $"[{course}] {date_label} · {title}";
}

/// <summary>
/// Native Dark-Mode Windows Desktop Markdown Reader + System Tray Recorder (Alt+Shift+R)
/// </summary>
internal sealed class TrayForm : Form
{
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 9001;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_SHIFT = 0x0004;
    private const uint VK_R = 0x52;

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("winmm.dll", EntryPoint = "mciSendStringW", CharSet = CharSet.Unicode)]
    private static extern int mciSendString(string command, StringBuilder? buffer, int bufferSize, IntPtr hwndCallback);

    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _recordMenuItem;
    private readonly ListBox _lectureListBox;
    private readonly RichTextBox _markdownReader;
    private readonly TextBox _courseBox;
    private readonly TextBox _tokenBox;
    private readonly Button _recordButton;
    private readonly Label _statusLabel;

    private bool _isRecording;
    private string _currentWavPath = "";
    private readonly string _serverBase = Environment.GetEnvironmentVariable("LECTERN_URL") ?? "https://lectern.qucord.com";
    private readonly List<LectureDto> _lectures = new();
    private LectureDto? _selectedLecture;

    public TrayForm()
    {
        Text = "Lectern — Academic Audio Distillation (Alt+Shift+R)";
        Size = new Size(1060, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(11, 12, 14);
        ForeColor = Color.FromArgb(240, 242, 245);
        Font = new Font("Malgun Gothic", 10f);

        // Split layout: Left Sidebar + Right Native Markdown Reader (Elysium Dark Tokens)
        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            SplitterDistance = 320,
            BackColor = Color.FromArgb(20, 23, 29) // #14171D
        };
        Controls.Add(split);

        // Left Sidebar Controls
        var leftPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12), BackColor = Color.FromArgb(20, 23, 29) };
        split.Panel1.Controls.Add(leftPanel);

        _courseBox = new TextBox
        {
            Text = "정보보호개론",
            Dock = DockStyle.Top,
            BackColor = Color.FromArgb(28, 32, 40), // #1C2028
            ForeColor = Color.FromArgb(242, 244, 246), // #F2F4F6
            BorderStyle = BorderStyle.FixedSingle
        };

        _tokenBox = new TextBox
        {
            Text = Environment.GetEnvironmentVariable("LECTERN_TOKEN") ?? "",
            PlaceholderText = "내 계정 API 토큰 (lct_...)",
            Dock = DockStyle.Top,
            BackColor = Color.FromArgb(28, 32, 40),
            ForeColor = Color.FromArgb(242, 244, 246),
            BorderStyle = BorderStyle.FixedSingle
        };
        _tokenBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) await RefreshLecturesAsync();
        };

        _recordButton = new Button
        {
            Text = "즉시 강의 녹음 (Alt+Shift+R)",
            Dock = DockStyle.Top,
            Height = 38,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(69, 147, 252), // #4593FC (Elysium Action Primary)
            ForeColor = Color.White
        };
        _recordButton.Click += (_, _) => ToggleRecording();

        _statusLabel = new Label
        {
            Text = "준비됨 · 트레이 상주 중",
            Dock = DockStyle.Top,
            Height = 26,
            ForeColor = Color.FromArgb(158, 166, 178), // #9EA6B2
            TextAlign = ContentAlignment.MiddleLeft
        };

        _lectureListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(28, 32, 40), // #1C2028
            ForeColor = Color.FromArgb(242, 244, 246), // #F2F4F6
            BorderStyle = BorderStyle.None,
            IntegralHeight = false
        };
        _lectureListBox.SelectedIndexChanged += async (_, _) =>
        {
            if (_lectureListBox.SelectedItem is LectureDto dto)
            {
                await LoadLectureDetailAsync(dto.id);
            }
        };

        leftPanel.Controls.Add(_lectureListBox);
        leftPanel.Controls.Add(_statusLabel);
        leftPanel.Controls.Add(_recordButton);
        leftPanel.Controls.Add(_courseBox);
        leftPanel.Controls.Add(_tokenBox);

        // Right Panel: Action Toolbar + Native RichText Markdown Reader
        var rightPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16), BackColor = Color.FromArgb(11, 12, 14) };
        split.Panel2.Controls.Add(rightPanel);

        var topBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 40,
            FlowDirection = FlowDirection.RightToLeft,
            BackColor = Color.FromArgb(18, 20, 24)
        };

        var btnShare = CreateActionButton("🔗 공유 링크 복사", (_, _) =>
        {
            if (_selectedLecture == null) return;
            Clipboard.SetText($"{_serverBase}/s/{_selectedLecture.share_token}");
            _statusLabel.Text = "공유 링크 복사 완료!";
        });

        var btnSaveMd = CreateActionButton("⬇️ 마크다운 저장", (_, _) =>
        {
            if (_selectedLecture == null) return;
            using var sfd = new SaveFileDialog
            {
                FileName = $"{_selectedLecture.course}_{_selectedLecture.date_label}.md",
                Filter = "Markdown (*.md)|*.md"
            };
            if (sfd.ShowDialog() == DialogResult.OK)
            {
                File.WriteAllText(sfd.FileName, _selectedLecture.markdown, Encoding.UTF8);
            }
        });

        var btnWeb = CreateActionButton("🌐 웹 리더/PDF 인쇄", (_, _) =>
        {
            var url = _selectedLecture != null ? $"{_serverBase}/?lecture={_selectedLecture.id}" : _serverBase;
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        });

        topBar.Controls.Add(btnShare);
        topBar.Controls.Add(btnSaveMd);
        topBar.Controls.Add(btnWeb);

        _markdownReader = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            BackColor = Color.FromArgb(11, 13, 17), // #0B0D11 (Elysium Surface Canvas)
            ForeColor = Color.FromArgb(242, 244, 246), // #F2F4F6
            BorderStyle = BorderStyle.None,
            Font = new Font("Malgun Gothic", 11f),
            DetectUrls = true
        };

        rightPanel.Controls.Add(_markdownReader);
        rightPanel.Controls.Add(topBar);

        // System Tray Menu
        var menu = new ContextMenuStrip();
        _recordMenuItem = new ToolStripMenuItem("강의 녹음 시작 (Alt+Shift+R)", null, (_, _) => ToggleRecording());
        var openReaderItem = new ToolStripMenuItem("네이티브 리더 열기", null, (_, _) => ShowMainWindow());
        var exitItem = new ToolStripMenuItem("종료", null, (_, _) =>
        {
            if (_trayIcon != null) _trayIcon.Visible = false;
            Environment.Exit(0);
        });

        menu.Items.Add(_recordMenuItem);
        menu.Items.Add(openReaderItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exitItem);

        _trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Lectern — Academic Audio Distillation (Alt+Shift+R)",
            ContextMenuStrip = menu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => ShowMainWindow();

        _ = RefreshLecturesAsync();
    }

    private static Button CreateActionButton(string text, EventHandler onClick)
    {
        var btn = new Button
        {
            Text = text,
            AutoSize = true,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(30, 41, 59),
            ForeColor = Color.White,
            Margin = new Padding(4)
        };
        btn.Click += onClick;
        return btn;
    }

    private void ShowMainWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RegisterHotKey(Handle, HOTKEY_ID, MOD_ALT | MOD_SHIFT, VK_R);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
        {
            ToggleRecording();
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            _trayIcon.ShowBalloonTip(1500, "Lectern 트레이 상주 중", "Alt+Shift+R 단축키로 언제든 즉시 녹음할 수 있습니다.", ToolTipIcon.Info);
            return;
        }
        UnregisterHotKey(Handle, HOTKEY_ID);
        _trayIcon.Visible = false;
        base.OnFormClosing(e);
    }

    private async Task RefreshLecturesAsync(string? selectId = null)
    {
        try
        {
            using var client = new HttpClient();
            if (!string.IsNullOrWhiteSpace(_tokenBox.Text))
            {
                client.DefaultRequestHeaders.Add("X-Lectern-Token", _tokenBox.Text.Trim());
            }
            var json = await client.GetStringAsync($"{_serverBase}/api/lectures");
            using var doc = JsonDocument.Parse(json);
            var arr = doc.RootElement.GetProperty("lectures");

            _lectures.Clear();
            _lectureListBox.Items.Clear();
            foreach (var el in arr.EnumerateArray())
            {
                var dto = new LectureDto
                {
                    id = el.GetProperty("id").GetString() ?? "",
                    share_token = el.GetProperty("share_token").GetString() ?? "",
                    title = el.GetProperty("title").GetString() ?? "",
                    course = el.GetProperty("course").GetString() ?? "",
                    date_label = el.GetProperty("date_label").GetString() ?? "",
                    excerpt = el.GetProperty("excerpt").GetString() ?? "",
                    model_used = el.GetProperty("model_used").GetString() ?? ""
                };
                _lectures.Add(dto);
                _lectureListBox.Items.Add(dto);
            }

            if (_lectures.Count > 0)
            {
                var idx = selectId != null ? _lectures.FindIndex(x => x.id == selectId) : 0;
                _lectureListBox.SelectedIndex = Math.Max(0, idx);
            }
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"서버 연결 오류: {ex.Message}";
        }
    }

    private async Task LoadLectureDetailAsync(string id)
    {
        try
        {
            using var client = new HttpClient();
            if (!string.IsNullOrWhiteSpace(_tokenBox.Text))
            {
                client.DefaultRequestHeaders.Add("X-Lectern-Token", _tokenBox.Text.Trim());
            }
            var json = await client.GetStringAsync($"{_serverBase}/api/lectures/{id}");
            using var doc = JsonDocument.Parse(json);
            var lec = doc.RootElement.GetProperty("lecture");

            _selectedLecture = new LectureDto
            {
                id = lec.GetProperty("id").GetString() ?? "",
                share_token = lec.GetProperty("share_token").GetString() ?? "",
                title = lec.GetProperty("title").GetString() ?? "",
                course = lec.GetProperty("course").GetString() ?? "",
                date_label = lec.GetProperty("date_label").GetString() ?? "",
                markdown = lec.GetProperty("markdown").GetString() ?? ""
            };

            RenderMarkdownInRichTextBox(_selectedLecture.markdown);
            _statusLabel.Text = $"{_selectedLecture.course} · {_selectedLecture.date_label}";
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"노트 로드 실패: {ex.Message}";
        }
    }

    private void RenderMarkdownInRichTextBox(string markdown)
    {
        _markdownReader.Clear();
        foreach (var rawLine in markdown.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            if (line.StartsWith("# "))
            {
                _markdownReader.SelectionFont = new Font("Malgun Gothic", 17f, FontStyle.Bold);
                _markdownReader.SelectionColor = Color.White;
                _markdownReader.AppendText(line[2..] + "\n\n");
            }
            else if (line.StartsWith("## "))
            {
                _markdownReader.SelectionFont = new Font("Malgun Gothic", 13.5f, FontStyle.Bold);
                _markdownReader.SelectionColor = Color.FromArgb(147, 197, 253);
                _markdownReader.AppendText("\n" + line[3..] + "\n");
            }
            else if (line.StartsWith("### "))
            {
                _markdownReader.SelectionFont = new Font("Malgun Gothic", 11.5f, FontStyle.Bold);
                _markdownReader.SelectionColor = Color.FromArgb(191, 219, 254);
                _markdownReader.AppendText(line[4..] + "\n");
            }
            else if (line.Contains("[쉬는 시간 생략") || line.Contains("[수업 종료 후 녹음 절단"))
            {
                _markdownReader.SelectionFont = new Font("Malgun Gothic", 10.5f, FontStyle.Bold);
                _markdownReader.SelectionColor = Color.FromArgb(251, 191, 36);
                _markdownReader.AppendText("☕ " + line.Replace("`", "") + "\n");
            }
            else
            {
                _markdownReader.SelectionFont = new Font("Malgun Gothic", 10.5f, FontStyle.Regular);
                _markdownReader.SelectionColor = Color.FromArgb(226, 232, 240);
                _markdownReader.AppendText(line.Replace("**", "") + "\n");
            }
        }
        _markdownReader.SelectionStart = 0;
        _markdownReader.ScrollToCaret();
    }

    private void ToggleRecording()
    {
        if (!_isRecording)
        {
            var vaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "LecternRecordings");
            Directory.CreateDirectory(vaultDir);
            var safeCourse = string.Join("_", _courseBox.Text.Split(Path.GetInvalidFileNameChars()));
            _currentWavPath = Path.Combine(vaultDir, $"{safeCourse}_{DateTime.Now:yyyyMMdd_HHmmss}.wav");
            mciSendString("open new Type waveaudio Alias lecternrec", null, 0, IntPtr.Zero);
            mciSendString("set lecternrec time format ms bitspersample 16 channels 1 samplespersec 16000", null, 0, IntPtr.Zero);
            mciSendString("record lecternrec", null, 0, IntPtr.Zero);

            _isRecording = true;
            _recordButton.Text = "⏹ 녹음 종료 및 노트 증류 (Alt+Shift+R)";
            _recordButton.BackColor = Color.FromArgb(239, 68, 68);
            _recordMenuItem.Text = "⏹ 녹음 종료 및 노트 요약 업로드 (Alt+Shift+R)";
            _statusLabel.Text = $"🔴 {_courseBox.Text} 녹음 중...";
            _trayIcon.ShowBalloonTip(2000, "Lectern 녹음 시작", $"{_courseBox.Text} 강의 녹음 중... (Alt+Shift+R로 종료)", ToolTipIcon.Info);
        }
        else
        {
            mciSendString("stop lecternrec", null, 0, IntPtr.Zero);
            mciSendString($"save lecternrec \"{_currentWavPath}\"", null, 0, IntPtr.Zero);
            mciSendString("close lecternrec", null, 0, IntPtr.Zero);

            _isRecording = false;
            _recordButton.Text = "🔴 즉시 강의 녹음 (Alt+Shift+R)";
            _recordButton.BackColor = Color.FromArgb(94, 158, 255);
            _recordMenuItem.Text = "🔴 강의 녹음 시작 (Alt+Shift+R)";
            _statusLabel.Text = "⚡ Gemini Flash 증류 업로드 중...";

            var pathToUpload = _currentWavPath;
            var course = _courseBox.Text;
            _ = UploadAndRefreshAsync(pathToUpload, course);
        }
    }

    private async Task UploadAndRefreshAsync(string filePath, string course)
    {
        if (!File.Exists(filePath)) return;
        var idempotencyKey = $"win_{Path.GetFileName(filePath)}";
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                if (attempt > 1)
                {
                    _statusLabel.Text = $"업로드 자동 재시도 중 ({attempt}/3)...";
                    await Task.Delay(attempt * 2000);
                }
                using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
                if (!string.IsNullOrWhiteSpace(_tokenBox.Text))
                {
                    client.DefaultRequestHeaders.Add("X-Lectern-Token", _tokenBox.Text.Trim());
                }
                client.DefaultRequestHeaders.Add("X-Idempotency-Key", idempotencyKey);
                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(course), "course");
                form.Add(new StringContent("windows-native-tray"), "source");
                form.Add(new StringContent(idempotencyKey), "idempotency_key");

                var bytes = await File.ReadAllBytesAsync(filePath);
                var fileContent = new ByteArrayContent(bytes);
                fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
                form.Add(fileContent, "audio", Path.GetFileName(filePath));

                var res = await client.PostAsync($"{_serverBase}/api/ingest/shortcut?wait=false", form);
                res.EnsureSuccessStatusCode();
                var body = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var newId = doc.RootElement.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                await RefreshLecturesAsync(newId);
                ShowMainWindow();
                return;
            }
            catch (Exception ex)
            {
                _statusLabel.Text = $"업로드 지연 (원본 보존됨: Documents\\LecternRecordings): {ex.Message}";
            }
        }
    }

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayForm());
    }
}
