using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LecternTray;

/// <summary>
/// Zero-overhead Windows System Tray Agent & Global Hotkey Recorder (Alt+Shift+R)
/// Uses native WinMM MCI for zero-dependency recording and opens the Lectern Markdown Reader.
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
    private bool _isRecording;
    private string _currentWavPath = "";
    private readonly string _serverBase = Environment.GetEnvironmentVariable("LECTERN_URL") ?? "https://lectern.qucord.com";
    private string _selectedCourse = "정보보호개론";

    public TrayForm()
    {
        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;

        var menu = new ContextMenuStrip();
        _recordMenuItem = new ToolStripMenuItem("🔴 강의 녹음 시작 (Alt+Shift+R)", null, (_, _) => ToggleRecording());
        var openReaderItem = new ToolStripMenuItem("📖 마크다운 리더 열기", null, (_, _) => OpenUrl(_serverBase));
        var exitItem = new ToolStripMenuItem("종료", null, (_, _) => Application.Exit());

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
        _trayIcon.DoubleClick += (_, _) => OpenUrl(_serverBase);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RegisterHotKey(Handle, HOTKEY_ID, MOD_ALT | MOD_SHIFT, VK_R);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Visible = false;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
        {
            ToggleRecording();
        }
        base.WndProc(ref m);
    }

    private void ToggleRecording()
    {
        if (!_isRecording)
        {
            _currentWavPath = Path.Combine(Path.GetTempPath(), $"lectern_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.wav");
            mciSendString("open new Type waveaudio Alias lecternrec", null, 0, IntPtr.Zero);
            mciSendString("set lecternrec time format ms bitspersample 16 channels 1 samplespersec 16000", null, 0, IntPtr.Zero);
            mciSendString("record lecternrec", null, 0, IntPtr.Zero);

            _isRecording = true;
            _recordMenuItem.Text = "⏹ 녹음 종료 및 노트 요약 업로드 (Alt+Shift+R)";
            _trayIcon.ShowBalloonTip(2000, "Lectern 녹음 시작", $"{_selectedCourse} 강의 녹음 중... (Alt+Shift+R로 종료)", ToolTipIcon.Info);
        }
        else
        {
            mciSendString("stop lecternrec", null, 0, IntPtr.Zero);
            mciSendString($"save lecternrec \"{_currentWavPath}\"", null, 0, IntPtr.Zero);
            mciSendString("close lecternrec", null, 0, IntPtr.Zero);

            _isRecording = false;
            _recordMenuItem.Text = "🔴 강의 녹음 시작 (Alt+Shift+R)";
            _trayIcon.ShowBalloonTip(2000, "Lectern 증류 중", "쉬는시간 필터링 및 마크다운 요약 중...", ToolTipIcon.Info);

            var pathToUpload = _currentWavPath;
            _ = Task.Run(() => UploadAndOpenReaderAsync(pathToUpload));
        }
    }

    private async Task UploadAndOpenReaderAsync(string filePath)
    {
        if (!File.Exists(filePath)) return;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(_selectedCourse), "course");
            form.Add(new StringContent("windows-tray"), "source");

            var bytes = await File.ReadAllBytesAsync(filePath);
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
            form.Add(fileContent, "audio", Path.GetFileName(filePath));

            var res = await client.PostAsync($"{_serverBase}/api/ingest/shortcut?wait=false", form);
            var body = await res.Content.ReadAsStringAsync();
            var m = Regex.Match(body, "\"url\"\\s*:\\s*\"([^\"]+)\"");
            OpenUrl(m.Success ? m.Groups[1].Value : _serverBase);
        }
        finally
        {
            try { File.Delete(filePath); } catch { }
        }
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        UnregisterHotKey(Handle, HOTKEY_ID);
        _trayIcon.Visible = false;
        base.OnFormClosing(e);
    }

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayForm());
    }
}
