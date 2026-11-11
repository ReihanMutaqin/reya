using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ReyaCompanion
{
    internal static class Program
    {
        private const string TARGET_URL = "https://reya-cyan.vercel.app/?floating=1";
        private const int WIN_WIDTH = 410;
        private const int WIN_HEIGHT = 670;

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const int SW_RESTORE = 9;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(
            IntPtr hWnd,
            IntPtr hWndInsertAfter,
            int X,
            int Y,
            int cx,
            int cy,
            uint uFlags
        );

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        private static IntPtr reyaHwnd = IntPtr.Zero;
        private static bool alwaysOnTop = true;
        private static Process browserProc = null;
        private static string profileDir = "";

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "REYA_Floating_Companion_v2"
            );
            Directory.CreateDirectory(profileDir);

            LaunchBrowserApp();

            using (NotifyIcon tray = new NotifyIcon())
            {
                tray.Icon = CreateReyaIcon();
                tray.Text = "REYA - Floating AI Companion (Always on Top)";
                tray.Visible = true;

                ContextMenuStrip menu = new ContextMenuStrip();

                ToolStripMenuItem pinItem = new ToolStripMenuItem("📌 Selalu di Atas (Always on Top)")
                {
                    Checked = true,
                    CheckOnClick = true
                };
                pinItem.Click += (s, e) =>
                {
                    alwaysOnTop = pinItem.Checked;
                    ApplyTopMost(true);
                };

                ToolStripMenuItem snapItem = new ToolStripMenuItem("🤖 Pindahkan ke Pojok Kanan Bawah");
                snapItem.Click += (s, e) => SnapToCorner();

                ToolStripMenuItem relaunchItem = new ToolStripMenuItem("🔄 Buka Ulang Jendela REYA");
                relaunchItem.Click += (s, e) =>
                {
                    reyaHwnd = IntPtr.Zero;
                    LaunchBrowserApp();
                };

                ToolStripMenuItem exitItem = new ToolStripMenuItem("❌ Tutup REYA Companion");
                exitItem.Click += (s, e) =>
                {
                    tray.Visible = false;
                    Application.Exit();
                };

                menu.Items.Add(pinItem);
                menu.Items.Add(snapItem);
                menu.Items.Add(relaunchItem);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(exitItem);

                tray.ContextMenuStrip = menu;
                tray.DoubleClick += (s, e) => SnapToCorner();

                tray.ShowBalloonTip(
                    2500,
                    "REYA Floating Companion Aktif! 🎤",
                    "REYA sekarang mengambang di atas semua aplikasi untuk menemanimu kerja & bernyanyi.",
                    ToolTipIcon.Info
                );

                System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer
                {
                    Interval = 400
                };
                bool initialSnapDone = false;
                int ticksAfterExit = 0;

                timer.Tick += (s, e) =>
                {
                    if (reyaHwnd == IntPtr.Zero || !IsWindow(reyaHwnd))
                    {
                        reyaHwnd = FindReyaWindow();
                        if (reyaHwnd != IntPtr.Zero && !initialSnapDone)
                        {
                            initialSnapDone = true;
                            SnapToCorner();
                        }
                    }

                    if (reyaHwnd != IntPtr.Zero && IsWindow(reyaHwnd))
                    {
                        ticksAfterExit = 0;
                        ApplyTopMost(false);
                    }
                    else if (initialSnapDone)
                    {
                        ticksAfterExit++;
                        if (ticksAfterExit > 6)
                        {
                            tray.Visible = false;
                            Application.Exit();
                        }
                    }
                };
                timer.Start();

                Application.Run();
            }
        }

        private static void LaunchBrowserApp()
        {
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            int posX = Math.Max(20, workArea.Right - WIN_WIDTH - 20);
            int posY = Math.Max(20, workArea.Bottom - WIN_HEIGHT - 20);

            string browserExe = FindChromiumBrowser();
            string args = string.Format(
                "--app=\"{0}\" --user-data-dir=\"{1}\" --window-size={2},{3} --window-position={4},{5} --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required",
                TARGET_URL,
                profileDir,
                WIN_WIDTH,
                WIN_HEIGHT,
                posX,
                posY
            );

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = browserExe,
                    Arguments = args,
                    UseShellExecute = true
                };
                browserProc = Process.Start(psi);
            }
            catch
            {
                Process.Start(TARGET_URL);
            }
        }

        private static string FindChromiumBrowser()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return "msedge.exe";
        }

        private static IntPtr FindReyaWindow()
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();
                if (title.IndexOf("REYA", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    found = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        private static void ApplyTopMost(bool activate)
        {
            if (reyaHwnd == IntPtr.Zero || !IsWindow(reyaHwnd)) return;
            IntPtr flag = alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST;
            uint swp = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | (activate ? 0 : SWP_NOACTIVATE);
            SetWindowPos(reyaHwnd, flag, 0, 0, 0, 0, swp);
        }

        private static void SnapToCorner()
        {
            if (reyaHwnd == IntPtr.Zero || !IsWindow(reyaHwnd))
            {
                reyaHwnd = FindReyaWindow();
            }
            if (reyaHwnd == IntPtr.Zero) return;

            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            int posX = Math.Max(20, workArea.Right - WIN_WIDTH - 20);
            int posY = Math.Max(20, workArea.Bottom - WIN_HEIGHT - 20);

            ShowWindow(reyaHwnd, SW_RESTORE);
            SetWindowPos(
                reyaHwnd,
                alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST,
                posX,
                posY,
                WIN_WIDTH,
                WIN_HEIGHT,
                SWP_SHOWWINDOW
            );
            SetForegroundWindow(reyaHwnd);
        }

        private static Icon CreateReyaIcon()
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.FromArgb(24, 24, 27));
                using (Brush green = new SolidBrush(Color.FromArgb(92, 232, 160)))
                {
                    g.FillEllipse(green, 5, 10, 8, 8);
                    g.FillEllipse(green, 19, 10, 8, 8);
                    g.FillRectangle(green, 10, 22, 12, 3);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }
    }
}

