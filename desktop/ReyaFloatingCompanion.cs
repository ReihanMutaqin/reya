using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace ReyaFloatingCompanion
{
    public class LyricSyllable
    {
        public string Text;
        public double BeginMs;
        public double EndMs;
    }

    public class LyricLine
    {
        public double TimeMs;
        public double EndMs;
        public string Text;
        public List<LyricSyllable> Syllables = new List<LyricSyllable>();
    }

    public class ReyaDesktopPetWindow : Window
    {
        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        private const string BaseApiUrl = "https://reya-cyan.vercel.app";
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(18) };

        // UI Elements
        private Border _cloudBubble;
        private TextBlock _cloudHeaderText;
        private TextBlock _cloudMainText;
        private Canvas _robotCanvas;
        private TranslateTransform _robotBobTransform;
        private RotateTransform _robotTiltTransform;
        private Canvas _eyesGroup;
        private TranslateTransform _eyesGazeTransform;
        private Border _leftEye;
        private Border _rightEye;
        private TranslateTransform _leftPupilTransform;
        private TranslateTransform _rightPupilTransform;
        private Border _leftCheek;
        private Border _rightCheek;
        private Canvas _catMouth;
        private StackPanel _talkMouth;
        private Border[] _mouthBars = new Border[5];
        private Ellipse _antennaBulb;
        private RotateTransform _antennaRotate;
        private RotateTransform _leftArmRotate;
        private RotateTransform _rightArmRotate;
        private RotateTransform _leftLegRotate;
        private RotateTransform _rightLegRotate;
        private TextBlock _floatingHearts;

        // Codex-style Bottom Pill & Popover
        private Border _actionPill;
        private Border[] _pillWaveBars = new Border[5];
        private Border _drawerPanel;
        private TextBox _promptInput;
        private TextBlock _statusMiniText;
        private StackPanel _playerMiniRow;
        private TextBlock _songTitleMini;
        private Slider _songProgressSlider;
        private TextBlock _songTimeMini;
        private Button _pauseResumeBtn;

        // Audio & Sync State
        private MediaPlayer _musicPlayer = new MediaPlayer();
        private MediaPlayer _ttsPlayer = new MediaPlayer();
        private List<LyricLine> _currentLyrics = new List<LyricLine>();
        private string _currentSongTitle = "";
        private bool _isSinging = false;
        private bool _isSpeaking = false;
        private bool _isThinking = false;
        private bool _mouthOpen = false;
        private bool _isBlinking = false;
        private bool _isDraggingSlider = false;
        private double _ReactionUntilTick = 0;
        private string _reactionKind = "";
        private double _speechClearTick = 0;
        private int _tickCount = 0;

        private DispatcherTimer _animTimer;
        private Forms.NotifyIcon _trayIcon;

        public ReyaDesktopPetWindow()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            if (!Http.DefaultRequestHeaders.Contains("User-Agent"))
            {
                Http.DefaultRequestHeaders.Add("User-Agent", "REYA-Desktop-Companion/2.0");
            }

            Title = "REYA Companion";
            Width = 340;
            Height = 470;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = true;

            var workArea = SystemParameters.WorkArea;
            Left = Math.Max(20, workArea.Right - Width - 30);
            Top = Math.Max(20, workArea.Bottom - Height - 20);

            BuildVisualTree();
            SetupTrayIcon();
            SetupMediaPlayers();

            _animTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            _animTimer.Tick += OnAnimationTick;
            _animTimer.Start();

            Loaded += (s, e) =>
            {
                SetCloudBubble("✦ REYA TEMAN KERJA", "Halo! Aku REYA siap nemenin kerja ♪", false);
            };

            SourceInitialized += (s, e) =>
            {
                var hwndSource = PresentationSource.FromVisual(this) as HwndSource;
                if (hwndSource != null)
                {
                    hwndSource.AddHook(WndProc);
                }
            };
        }

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            const int WM_NCHITTEST = 0x0084;
            const int HTTRANSPARENT = -1;
            const int HTCLIENT = 1;

            if (msg == WM_NCHITTEST)
            {
                int x = (short)(lParam.ToInt32() & 0xFFFF);
                int y = (short)((lParam.ToInt32() >> 16) & 0xFFFF);
                Point pt = PointFromScreen(new Point(x, y));

                bool overInteractive =
                    IsPointOverElement(_robotCanvas, pt) ||
                    IsPointOverElement(_actionPill, pt) ||
                    IsPointOverElement(_cloudBubble, pt) ||
                    (_drawerPanel.Visibility == Visibility.Visible && IsPointOverElement(_drawerPanel, pt));

                handled = true;
                return new IntPtr(overInteractive ? HTCLIENT : HTTRANSPARENT);
            }
            return IntPtr.Zero;
        }

        private bool IsPointOverElement(FrameworkElement el, Point windowPt)
        {
            if (el == null || el.Visibility != Visibility.Visible) return false;
            try
            {
                Point rel = TranslatePoint(windowPt, el);
                return rel.X >= -6 && rel.Y >= -6 && rel.X <= el.ActualWidth + 6 && rel.Y <= el.ActualHeight + 6;
            }
            catch
            {
                return false;
            }
        }

        private static SolidColorBrush HexBrush(string hex)
        {
            return (SolidColorBrush)new BrushConverter().ConvertFromString(hex);
        }

        private void BuildVisualTree()
        {
            var root = new Grid
            {
                Background = null, // Null background lets clicks outside the robot/pill pass through
                VerticalAlignment = VerticalAlignment.Top,
                HorizontalAlignment = HorizontalAlignment.Center,
                Width = 330
            };

            var mainStack = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 8, 0, 0)
            };

            // 1. FLOATING SPEECH & KARAOKE LYRIC CLOUD BUBBLE ABOVE HEAD
            _cloudBubble = new Border
            {
                Background = HexBrush("#F8F6F0"),
                BorderBrush = HexBrush("#2A302D"),
                BorderThickness = new Thickness(2.2),
                CornerRadius = new CornerRadius(18),
                Padding = new Thickness(14, 8, 14, 9),
                MaxWidth = 290,
                MinWidth = 150,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 6),
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 14,
                    ShadowDepth = 4,
                    Opacity = 0.35
                }
            };

            var cloudStack = new StackPanel { Orientation = Orientation.Vertical };
            _cloudHeaderText = new TextBlock
            {
                Text = "✦ REYA TEMAN KERJA",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#0E623D"),
                Margin = new Thickness(0, 0, 0, 2),
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            _cloudMainText = new TextBlock
            {
                Text = "Halo! Aku REYA siap nemenin kerja ♪",
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 12.5,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#161817"),
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                MaxHeight = 56
            };
            cloudStack.Children.Add(_cloudHeaderText);
            cloudStack.Children.Add(_cloudMainText);
            _cloudBubble.Child = cloudStack;
            mainStack.Children.Add(_cloudBubble);

            // 2. FULL-BODY CHIBI ROBOT MASCOT (Head + Antenna + Visor + Body + Arms + Sitting Legs)
            _robotCanvas = new Canvas
            {
                Width = 150,
                Height = 158,
                HorizontalAlignment = HorizontalAlignment.Center,
                Cursor = Cursors.SizeAll,
                Background = Brushes.Transparent,
                ToolTip = "Geser untuk memindahkan REYA · Klik 2x untuk mengelus!"
            };

            var robotTransformGroup = new TransformGroup();
            _robotBobTransform = new TranslateTransform(0, 0);
            _robotTiltTransform = new RotateTransform(0, 75, 85);
            robotTransformGroup.Children.Add(_robotBobTransform);
            robotTransformGroup.Children.Add(_robotTiltTransform);
            _robotCanvas.RenderTransform = robotTransformGroup;

            _robotCanvas.MouseLeftButtonDown += (s, e) =>
            {
                if (e.ClickCount >= 2)
                {
                    TriggerReaction("headpat", "♥ SENANG DIELUS", "Hehe nyaman banget dielus~ ♥");
                    Console.Beep(880, 70);
                }
                else
                {
                    try { DragMove(); } catch { }
                }
            };

            // Curved Top Antenna (Codex-style cute curved hook + glowing bulb)
            var antennaGroup = new Canvas { Width = 40, Height = 32 };
            Canvas.SetLeft(antennaGroup, 55);
            Canvas.SetTop(antennaGroup, 0);
            _antennaRotate = new RotateTransform(0, 20, 28);
            antennaGroup.RenderTransform = _antennaRotate;

            var antennaStem = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M 20,28 C 18,12 6,8 8,18"),
                Stroke = HexBrush("#252B28"),
                StrokeThickness = 5.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            _antennaBulb = new Ellipse
            {
                Width = 11,
                Height = 11,
                Fill = HexBrush("#5CE8A0"),
                Stroke = HexBrush("#161A18"),
                StrokeThickness = 1.8,
                Effect = new DropShadowEffect { Color = Color.FromRgb(92, 232, 160), BlurRadius = 10, ShadowDepth = 0 }
            };
            Canvas.SetLeft(_antennaBulb, 3);
            Canvas.SetTop(_antennaBulb, 13);
            antennaGroup.Children.Add(antennaStem);
            antennaGroup.Children.Add(_antennaBulb);
            _robotCanvas.Children.Add(antennaGroup);

            // Cute Cat-Robot Ears
            var leftEar = CreateEar(-14);
            Canvas.SetLeft(leftEar, 28);
            Canvas.SetTop(leftEar, 18);
            _robotCanvas.Children.Add(leftEar);

            var rightEar = CreateEar(14);
            Canvas.SetLeft(rightEar, 98);
            Canvas.SetTop(rightEar, 18);
            _robotCanvas.Children.Add(rightEar);

            // Chibi Robot Torso & Sitting Legs (under CRT Head)
            var leftArm = new Border
            {
                Width = 18,
                Height = 11,
                CornerRadius = new CornerRadius(6),
                Background = HexBrush("#232927"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2)
            };
            _leftArmRotate = new RotateTransform(-15, 16, 5);
            leftArm.RenderTransform = _leftArmRotate;
            Canvas.SetLeft(leftArm, 24);
            Canvas.SetTop(leftArm, 108);
            _robotCanvas.Children.Add(leftArm);

            var rightArm = new Border
            {
                Width = 18,
                Height = 11,
                CornerRadius = new CornerRadius(6),
                Background = HexBrush("#232927"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2)
            };
            _rightArmRotate = new RotateTransform(15, 2, 5);
            rightArm.RenderTransform = _rightArmRotate;
            Canvas.SetLeft(rightArm, 108);
            Canvas.SetTop(rightArm, 108);
            _robotCanvas.Children.Add(rightArm);

            var torso = new Border
            {
                Width = 68,
                Height = 36,
                CornerRadius = new CornerRadius(14),
                Background = HexBrush("#1F2523"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.5),
                Child = new TextBlock
                {
                    Text = "♥",
                    FontSize = 12,
                    FontWeight = FontWeights.Bold,
                    Foreground = HexBrush("#5CE8A0"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
            Canvas.SetLeft(torso, 41);
            Canvas.SetTop(torso, 102);
            _robotCanvas.Children.Add(torso);

            // Sitting Feet
            var leftFoot = new Border
            {
                Width = 20,
                Height = 16,
                CornerRadius = new CornerRadius(8),
                Background = HexBrush("#181C1B"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2)
            };
            _leftLegRotate = new RotateTransform(0, 10, 2);
            leftFoot.RenderTransform = _leftLegRotate;
            Canvas.SetLeft(leftFoot, 45);
            Canvas.SetTop(leftFoot, 132);
            _robotCanvas.Children.Add(leftFoot);

            var rightFoot = new Border
            {
                Width = 20,
                Height = 16,
                CornerRadius = new CornerRadius(8),
                Background = HexBrush("#181C1B"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2)
            };
            _rightLegRotate = new RotateTransform(0, 10, 2);
            rightFoot.RenderTransform = _rightLegRotate;
            Canvas.SetLeft(rightFoot, 85);
            Canvas.SetTop(rightFoot, 132);
            _robotCanvas.Children.Add(rightFoot);

            // Side Earphone Pods
            var leftPod = new Border
            {
                Width = 8,
                Height = 28,
                CornerRadius = new CornerRadius(4, 0, 0, 4),
                Background = HexBrush("#2C3531"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2, 2, 0, 2)
            };
            Canvas.SetLeft(leftPod, 17);
            Canvas.SetTop(leftPod, 52);
            _robotCanvas.Children.Add(leftPod);

            var rightPod = new Border
            {
                Width = 8,
                Height = 28,
                CornerRadius = new CornerRadius(0, 4, 4, 0),
                Background = HexBrush("#2C3531"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(0, 2, 2, 2)
            };
            Canvas.SetLeft(rightPod, 125);
            Canvas.SetTop(rightPod, 52);
            _robotCanvas.Children.Add(rightPod);

            // CRT TV Head Housing
            var crtHousing = new Border
            {
                Width = 104,
                Height = 84,
                CornerRadius = new CornerRadius(22),
                Background = HexBrush("#232A27"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(3),
                Padding = new Thickness(7),
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 16,
                    ShadowDepth = 5,
                    Opacity = 0.45
                }
            };
            Canvas.SetLeft(crtHousing, 23);
            Canvas.SetTop(crtHousing, 24);

            var crtScreen = new Border
            {
                CornerRadius = new CornerRadius(15),
                Background = HexBrush("#131A17"),
                BorderBrush = HexBrush("#36423D"),
                BorderThickness = new Thickness(1.5),
                ClipToBounds = true
            };

            var screenCanvas = new Canvas { Width = 86, Height = 64 };

            // Glare highlight
            var glare = new Border
            {
                Width = 32,
                Height = 5,
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255))
            };
            Canvas.SetLeft(glare, 10);
            Canvas.SetTop(glare, 5);
            screenCanvas.Children.Add(glare);

            // Floating Hearts / Notes inside Visor
            _floatingHearts = new TextBlock
            {
                Text = "♪",
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#E8F47A"),
                Visibility = Visibility.Collapsed
            };
            Canvas.SetLeft(_floatingHearts, 68);
            Canvas.SetTop(_floatingHearts, 4);
            screenCanvas.Children.Add(_floatingHearts);

            // Eyes Group
            _eyesGroup = new Canvas { Width = 86, Height = 40 };
            _eyesGazeTransform = new TranslateTransform(0, 0);
            _eyesGroup.RenderTransform = _eyesGazeTransform;

            _leftPupilTransform = new TranslateTransform(0, 0);
            _rightPupilTransform = new TranslateTransform(0, 0);
            _leftEye = CreateEye(_leftPupilTransform);
            _rightEye = CreateEye(_rightPupilTransform);
            Canvas.SetLeft(_leftEye, 15);
            Canvas.SetTop(_leftEye, 14);
            Canvas.SetLeft(_rightEye, 51);
            Canvas.SetTop(_rightEye, 14);
            _eyesGroup.Children.Add(_leftEye);
            _eyesGroup.Children.Add(_rightEye);

            // Blush Cheeks
            _leftCheek = new Border
            {
                Width = 11,
                Height = 6,
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(Color.FromArgb(190, 255, 120, 150))
            };
            Canvas.SetLeft(_leftCheek, 8);
            Canvas.SetTop(_leftCheek, 38);
            _eyesGroup.Children.Add(_leftCheek);

            _rightCheek = new Border
            {
                Width = 11,
                Height = 6,
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(Color.FromArgb(190, 255, 120, 150))
            };
            Canvas.SetLeft(_rightCheek, 67);
            Canvas.SetTop(_rightCheek, 38);
            _eyesGroup.Children.Add(_rightCheek);

            screenCanvas.Children.Add(_eyesGroup);

            // Cute Cat Mouth (ω)
            _catMouth = new Canvas { Width = 24, Height = 12 };
            var catPath = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M 2,3 Q 6,10 11,4 Q 16,10 20,3"),
                Stroke = HexBrush("#5CE8A0"),
                StrokeThickness = 2.2,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            _catMouth.Children.Add(catPath);
            Canvas.SetLeft(_catMouth, 32);
            Canvas.SetTop(_catMouth, 43);
            screenCanvas.Children.Add(_catMouth);

            // Singing / Speaking Equalizer Mouth
            _talkMouth = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Height = 14,
                VerticalAlignment = VerticalAlignment.Center,
                Visibility = Visibility.Collapsed
            };
            for (int i = 0; i < 5; i++)
            {
                var bar = new Border
                {
                    Width = 3.2,
                    Height = 6,
                    CornerRadius = new CornerRadius(1.5),
                    Background = HexBrush(i % 2 == 0 ? "#E8F47A" : "#5CE8A0"),
                    Margin = new Thickness(1.2, 0, 1.2, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                _mouthBars[i] = bar;
                _talkMouth.Children.Add(bar);
            }
            Canvas.SetLeft(_talkMouth, 29);
            Canvas.SetTop(_talkMouth, 42);
            screenCanvas.Children.Add(_talkMouth);

            crtScreen.Child = screenCanvas;
            crtHousing.Child = crtScreen;
            _robotCanvas.Children.Add(crtHousing);

            mainStack.Children.Add(_robotCanvas);

            // 3. CODEX-STYLE DARK FLOATING CAPSULE PILL ([ 📝 | 🎙️ ])
            _actionPill = new Border
            {
                Background = HexBrush("#181A1C"),
                BorderBrush = HexBrush("#383E42"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(22),
                Padding = new Thickness(10, 6, 10, 6),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, -2, 0, 0),
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 14,
                    ShadowDepth = 4,
                    Opacity = 0.45
                }
            };

            var pillRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

            // Left Pill Button: Compose / Song Search Icon (📝)
            var composeBtn = CreatePillButton("📝", "Ketik pesan atau cari lagu full (Komang, Wildflower, dll)");
            composeBtn.Click += (s, e) =>
            {
                _drawerPanel.Visibility = _drawerPanel.Visibility == Visibility.Visible
                    ? Visibility.Collapsed
                    : Visibility.Visible;
                if (_drawerPanel.Visibility == Visibility.Visible)
                {
                    _promptInput.Focus();
                }
            };
            pillRow.Children.Add(composeBtn);

            // Pill Divider
            var divider = new Border
            {
                Width = 1.2,
                Height = 20,
                Background = HexBrush("#383E42"),
                Margin = new Thickness(8, 0, 8, 0)
            };
            pillRow.Children.Add(divider);

            // Right Pill Button: Audio Waveform Icon (klik = putar/jeda atau bicara)
            var waveStack = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Height = 20
            };
            double[] defaultHeights = { 7, 13, 18, 13, 7 };
            for (int i = 0; i < 5; i++)
            {
                var wBar = new Border
                {
                    Width = 2.6,
                    Height = defaultHeights[i],
                    CornerRadius = new CornerRadius(1.3),
                    Background = Brushes.White,
                    Margin = new Thickness(1.4, 0, 1.4, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                _pillWaveBars[i] = wBar;
                waveStack.Children.Add(wBar);
            }

            var waveBtn = new Button
            {
                Content = waveStack,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(8, 4, 8, 4),
                Cursor = Cursors.Hand,
                ToolTip = "Klik untuk sapa suara / Jeda-Lanjut musik (Klik kanan untuk Stop lagu)"
            };
            waveBtn.Click += async (s, e) =>
            {
                if (_isSinging)
                {
                    TogglePauseSong();
                }
                else
                {
                    await SpeakAndShowAsync("Halo! Aku REYA siap menemanimu kerja. Klik ikon tulis di kiri kalau mau minta lagu atau ngobrol ya!");
                }
            };
            waveBtn.MouseRightButtonUp += (s, e) =>
            {
                StopSong();
            };
            pillRow.Children.Add(waveBtn);

            _actionPill.Child = pillRow;
            mainStack.Children.Add(_actionPill);

            // 4. COMPACT POPOVER DRAWER (Toggled by 📝 button)
            _drawerPanel = new Border
            {
                Background = HexBrush("#181A1C"),
                BorderBrush = HexBrush("#383E42"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(12, 10, 12, 10),
                Width = 310,
                Margin = new Thickness(0, 8, 0, 0),
                Visibility = Visibility.Collapsed,
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 16,
                    ShadowDepth = 5,
                    Opacity = 0.5
                }
            };

            var drawerStack = new StackPanel { Orientation = Orientation.Vertical };

            // Input Row
            var inputGrid = new Grid();
            inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _promptInput = new TextBox
            {
                Background = HexBrush("#25292C"),
                Foreground = Brushes.White,
                CaretBrush = HexBrush("#5CE8A0"),
                BorderBrush = HexBrush("#454C50"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 6, 8, 6),
                FontSize = 12,
                Text = ""
            };
            _promptInput.KeyDown += async (s, e) =>
            {
                if (e.Key == Key.Enter)
                {
                    await HandleUserPromptAsync(_promptInput.Text);
                }
            };
            Grid.SetColumn(_promptInput, 0);
            inputGrid.Children.Add(_promptInput);

            var sendBtn = new Button
            {
                Content = "🎤 Kirim",
                Background = HexBrush("#B83312"),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(10, 6, 10, 6),
                Margin = new Thickness(6, 0, 0, 0),
                FontWeight = FontWeights.Bold,
                FontSize = 11.5,
                Cursor = Cursors.Hand
            };
            sendBtn.Click += async (s, e) =>
            {
                await HandleUserPromptAsync(_promptInput.Text);
            };
            Grid.SetColumn(sendBtn, 1);
            inputGrid.Children.Add(sendBtn);
            drawerStack.Children.Add(inputGrid);

            // Quick Song Chips
            var chipsWrap = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            string[] quickSongs = { "Komang", "Wildflower", "Laskar Pelangi", "Hotel California", "Bohemian Rhapsody", "Sial" };
            foreach (var songName in quickSongs)
            {
                var chip = new Button
                {
                    Content = "♪ " + songName,
                    Background = HexBrush("#262B2E"),
                    Foreground = HexBrush("#E8F47A"),
                    BorderBrush = HexBrush("#3E464A"),
                    BorderThickness = new Thickness(1),
                    Padding = new Thickness(7, 3, 7, 3),
                    Margin = new Thickness(0, 0, 5, 5),
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Cursor = Cursors.Hand
                };
                string captured = songName;
                chip.Click += async (s, e) =>
                {
                    await PlayBitChordSongAsync(captured);
                };
                chipsWrap.Children.Add(chip);
            }
            drawerStack.Children.Add(chipsWrap);

            // Mini Full-Song Progress Player Row
            _playerMiniRow = new StackPanel
            {
                Orientation = Orientation.Vertical,
                Margin = new Thickness(0, 6, 0, 0),
                Visibility = Visibility.Collapsed
            };
            _songTitleMini = new TextBlock
            {
                Text = "",
                Foreground = HexBrush("#5CE8A0"),
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            _playerMiniRow.Children.Add(_songTitleMini);

            var progGrid = new Grid { Margin = new Thickness(0, 4, 0, 0) };
            progGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            progGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            progGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _songProgressSlider = new Slider
            {
                Minimum = 0,
                Maximum = 210,
                Value = 0,
                VerticalAlignment = VerticalAlignment.Center
            };
            _songProgressSlider.PreviewMouseLeftButtonDown += (s, e) => _isDraggingSlider = true;
            _songProgressSlider.PreviewMouseLeftButtonUp += (s, e) =>
            {
                _isDraggingSlider = false;
                if (_musicPlayer.NaturalDuration.HasTimeSpan)
                {
                    _musicPlayer.Position = TimeSpan.FromSeconds(_songProgressSlider.Value);
                }
            };
            Grid.SetColumn(_songProgressSlider, 0);
            progGrid.Children.Add(_songProgressSlider);

            _songTimeMini = new TextBlock
            {
                Text = "0:00 / 0:00",
                Foreground = HexBrush("#A9B0AC"),
                FontFamily = new FontFamily("Consolas"),
                FontSize = 10,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 6, 0)
            };
            Grid.SetColumn(_songTimeMini, 1);
            progGrid.Children.Add(_songTimeMini);

            _pauseResumeBtn = new Button
            {
                Content = "⏸",
                Background = HexBrush("#262B2E"),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(6, 2, 6, 2),
                Margin = new Thickness(0, 0, 4, 0),
                FontSize = 10,
                Cursor = Cursors.Hand
            };
            _pauseResumeBtn.Click += (s, e) => TogglePauseSong();
            Grid.SetColumn(_pauseResumeBtn, 2);
            progGrid.Children.Add(_pauseResumeBtn);

            var stopMiniBtn = new Button
            {
                Content = "⏹",
                Background = HexBrush("#B83312"),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(6, 2, 6, 2),
                FontSize = 10,
                Cursor = Cursors.Hand
            };
            stopMiniBtn.Click += (s, e) => StopSong();
            Grid.SetColumn(stopMiniBtn, 3);
            progGrid.Children.Add(stopMiniBtn);

            _playerMiniRow.Children.Add(progGrid);
            drawerStack.Children.Add(_playerMiniRow);

            _statusMiniText = new TextBlock
            {
                Text = "Ketik judul lagu untuk karaoke full atau ketik pesan untuk ngobrol.",
                Foreground = HexBrush("#9AA29E"),
                FontSize = 10,
                Margin = new Thickness(0, 4, 0, 0),
                TextWrapping = TextWrapping.Wrap
            };
            drawerStack.Children.Add(_statusMiniText);

            _drawerPanel.Child = drawerStack;
            mainStack.Children.Add(_drawerPanel);

            root.Children.Add(mainStack);
            Content = root;
        }

        private Border CreateEar(double angle)
        {
            var ear = new Border
            {
                Width = 24,
                Height = 20,
                CornerRadius = new CornerRadius(12, 12, 3, 3),
                Background = HexBrush("#232A27"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.5),
                RenderTransform = new RotateTransform(angle, 12, 18),
                Child = new Border
                {
                    Width = 12,
                    Height = 9,
                    CornerRadius = new CornerRadius(7, 7, 2, 2),
                    Background = HexBrush("#E8F47A"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Bottom,
                    Margin = new Thickness(0, 0, 0, 2)
                }
            };
            return ear;
        }

        private Border CreateEye(TranslateTransform pupilTransform)
        {
            var pupil = new Canvas
            {
                Width = 9,
                Height = 10,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RenderTransform = pupilTransform
            };
            var pupilCircle = new Ellipse
            {
                Width = 9,
                Height = 10,
                Fill = HexBrush("#141816")
            };
            var glint = new Ellipse
            {
                Width = 3.5,
                Height = 3.5,
                Fill = Brushes.White
            };
            Canvas.SetLeft(glint, 4.5);
            Canvas.SetTop(glint, 1.5);
            pupil.Children.Add(pupilCircle);
            pupil.Children.Add(glint);

            return new Border
            {
                Width = 20,
                Height = 23,
                CornerRadius = new CornerRadius(9),
                Background = HexBrush("#E8F47A"),
                Child = pupil,
                Effect = new DropShadowEffect
                {
                    Color = Color.FromRgb(232, 244, 122),
                    BlurRadius = 8,
                    ShadowDepth = 0,
                    Opacity = 0.55
                }
            };
        }

        private Button CreatePillButton(string iconText, string tooltip)
        {
            return new Button
            {
                Content = new TextBlock
                {
                    Text = iconText,
                    FontSize = 14,
                    Foreground = Brushes.White,
                    VerticalAlignment = VerticalAlignment.Center
                },
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(8, 2, 8, 2),
                Cursor = Cursors.Hand,
                ToolTip = tooltip
            };
        }

        private void SetupMediaPlayers()
        {
            _musicPlayer.Volume = 0.92;
            _musicPlayer.MediaOpened += (s, e) =>
            {
                if (_musicPlayer.NaturalDuration.HasTimeSpan)
                {
                    _songProgressSlider.Maximum = Math.Max(1, _musicPlayer.NaturalDuration.TimeSpan.TotalSeconds);
                }
            };
            _musicPlayer.MediaEnded += (s, e) =>
            {
                _isSinging = false;
                _mouthOpen = false;
                _playerMiniRow.Visibility = Visibility.Collapsed;
                SetCloudBubble("✦ LAGU SELESAI", "Yey! Lagu " + _currentSongTitle + " selesai dinyanyikan sampai tuntas ♪", false);
            };

            _ttsPlayer.Volume = 1.0;
            _ttsPlayer.MediaEnded += (s, e) =>
            {
                _isSpeaking = false;
                _mouthOpen = false;
                _speechClearTick = _tickCount + 70; // Keep bubble text for ~3.5s
            };
        }

        private void SetupTrayIcon()
        {
            _trayIcon = new Forms.NotifyIcon
            {
                Text = "REYA - Teman Kerja AI (Always on Top)",
                Icon = System.Drawing.SystemIcons.Application,
                Visible = true
            };

            var menu = new Forms.ContextMenuStrip();
            var topItem = new Forms.ToolStripMenuItem("📌 Selalu Paling Atas (Always on Top)")
            {
                Checked = true,
                CheckOnClick = true
            };
            topItem.CheckedChanged += (s, e) =>
            {
                Topmost = topItem.Checked;
            };

            var inputItem = new Forms.ToolStripMenuItem("📝 Buka Kotak Obrolan & Lagu");
            inputItem.Click += (s, e) =>
            {
                Show();
                Activate();
                _drawerPanel.Visibility = Visibility.Visible;
                _promptInput.Focus();
            };

            var cornerItem = new Forms.ToolStripMenuItem("🤖 Pindahkan ke Pojok Kanan Bawah");
            cornerItem.Click += (s, e) =>
            {
                var wa = SystemParameters.WorkArea;
                Left = Math.Max(20, wa.Right - Width - 30);
                Top = Math.Max(20, wa.Bottom - Height - 20);
            };

            var exitItem = new Forms.ToolStripMenuItem("❌ Tutup REYA");
            exitItem.Click += (s, e) =>
            {
                _trayIcon.Visible = false;
                Application.Current.Shutdown();
            };

            menu.Items.Add(topItem);
            menu.Items.Add(inputItem);
            menu.Items.Add(cornerItem);
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add(exitItem);
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.DoubleClick += (s, e) =>
            {
                Show();
                Activate();
            };
        }

        private void SetCloudBubble(string header, string text, bool darkSingMode)
        {
            _cloudHeaderText.Text = header;
            _cloudMainText.Text = text;
            if (darkSingMode)
            {
                _cloudBubble.Background = HexBrush("#18221E");
                _cloudBubble.BorderBrush = HexBrush("#5CE8A0");
                _cloudHeaderText.Foreground = HexBrush("#5CE8A0");
                _cloudMainText.Foreground = HexBrush("#E8F47A");
            }
            else
            {
                _cloudBubble.Background = HexBrush("#F8F6F0");
                _cloudBubble.BorderBrush = HexBrush("#2A302D");
                _cloudHeaderText.Foreground = HexBrush("#0E623D");
                _cloudMainText.Foreground = HexBrush("#161817");
            }
        }

        private void TriggerReaction(string kind, string header, string bubbleText)
        {
            _reactionKind = kind;
            _ReactionUntilTick = _tickCount + 55;
            SetCloudBubble(header, bubbleText, false);
        }

        private void OnAnimationTick(object sender, EventArgs e)
        {
            _tickCount++;

            // 1. Global Cursor Eye-Tracking (follows mouse anywhere on Windows screen)
            POINT pt;
            if (GetCursorPos(out pt))
            {
                try
                {
                    Point screenCenter = _robotCanvas.PointToScreen(new Point(75, 62));
                    double dx = pt.X - screenCenter.X;
                    double dy = pt.Y - screenCenter.Y;
                    double dist = Math.Sqrt(dx * dx + dy * dy);
                    double factor = Math.Tanh(dist / 180.0);
                    double angle = Math.Atan2(dy, dx);

                    _eyesGazeTransform.X = Math.Cos(angle) * factor * 6.5;
                    _eyesGazeTransform.Y = Math.Sin(angle) * factor * 4.5;
                    _leftPupilTransform.X = Math.Cos(angle) * factor * 3.5;
                    _leftPupilTransform.Y = Math.Sin(angle) * factor * 3.0;
                    _rightPupilTransform.X = _leftPupilTransform.X;
                    _rightPupilTransform.Y = _leftPupilTransform.Y;
                }
                catch { }
            }

            // 2. Natural Eye Blinking every ~3.4s
            int blinkMod = _tickCount % 68;
            _isBlinking = (blinkMod == 0 || blinkMod == 1);
            bool isHappyReaction = _tickCount < _ReactionUntilTick;
            _leftEye.Height = _isBlinking ? 3 : (isHappyReaction ? 9 : 23);
            _rightEye.Height = _isBlinking ? 3 : (isHappyReaction ? 9 : 23);

            // 3. Cute Breathing / Dancing Motion
            double t = _tickCount * 0.12;
            if (_isSinging)
            {
                _robotBobTransform.Y = Math.Sin(t * 2.2) * 4.5;
                _robotTiltTransform.Angle = Math.Sin(t * 1.1) * 4.0;
                _leftArmRotate.Angle = -25 + Math.Sin(t * 2.2) * 18;
                _rightArmRotate.Angle = 25 - Math.Sin(t * 2.2) * 18;
                _leftLegRotate.Angle = Math.Sin(t * 2.2) * 12;
                _rightLegRotate.Angle = -Math.Sin(t * 2.2) * 12;
                _floatingHearts.Visibility = Visibility.Visible;
                _floatingHearts.Text = (_tickCount / 10) % 2 == 0 ? "♪" : "♫";
            }
            else
            {
                _robotBobTransform.Y = Math.Sin(t) * 2.5;
                _robotTiltTransform.Angle = isHappyReaction ? Math.Sin(t * 3) * 5.0 : 0;
                _leftArmRotate.Angle = -15 + Math.Sin(t) * 5;
                _rightArmRotate.Angle = 15 - Math.Sin(t) * 5;
                _leftLegRotate.Angle = Math.Sin(t * 0.8) * 4;
                _rightLegRotate.Angle = -Math.Sin(t * 0.8) * 4;
                _floatingHearts.Visibility = isHappyReaction ? Visibility.Visible : Visibility.Collapsed;
                if (isHappyReaction) _floatingHearts.Text = "♥";
            }
            _antennaRotate.Angle = Math.Sin(t * 0.9) * 7.0;

            // 4. Sync Karaoke Lyrics & Mouth directly to _musicPlayer.Position (100% Full Song!)
            if (_isSinging && _musicPlayer.Source != null)
            {
                double currentSec = _musicPlayer.Position.TotalSeconds;
                double totalSec = _musicPlayer.NaturalDuration.HasTimeSpan
                    ? _musicPlayer.NaturalDuration.TimeSpan.TotalSeconds
                    : _songProgressSlider.Maximum;

                if (!_isDraggingSlider)
                {
                    _songProgressSlider.Value = Math.Min(currentSec, _songProgressSlider.Maximum);
                }
                _songTimeMini.Text = FormatSec(currentSec) + " / " + FormatSec(totalSec);

                double currentMs = currentSec * 1000.0;
                if (_currentLyrics.Count > 0)
                {
                    int activeIdx = -1;
                    for (int i = 0; i < _currentLyrics.Count; i++)
                    {
                        if (_currentLyrics[i].TimeMs <= currentMs + 140)
                            activeIdx = i;
                        else
                            break;
                    }

                    if (activeIdx >= 0)
                    {
                        var line = _currentLyrics[activeIdx];
                        double nextTime = (activeIdx + 1 < _currentLyrics.Count)
                            ? _currentLyrics[activeIdx + 1].TimeMs
                            : line.TimeMs + 5500;
                        double endMs = line.EndMs > line.TimeMs ? line.EndMs : Math.Min(nextTime - 80, line.TimeMs + 5500);

                        if (currentMs <= endMs + 1800)
                        {
                            SetCloudBubble("🎤 " + _currentSongTitle, line.Text, true);
                        }
                        else if (activeIdx == _currentLyrics.Count - 1)
                        {
                            SetCloudBubble("🎵 " + _currentSongTitle, "Instrumental Outro ♪", true);
                        }

                        if (currentMs >= line.TimeMs && currentMs <= endMs)
                        {
                            if (line.Syllables.Count > 0)
                            {
                                bool inSyl = false;
                                foreach (var s in line.Syllables)
                                {
                                    if (currentMs >= s.BeginMs && currentMs <= s.EndMs)
                                    {
                                        inSyl = true;
                                        break;
                                    }
                                }
                                _mouthOpen = inSyl || ((_tickCount / 3) % 2 == 0);
                            }
                            else
                            {
                                _mouthOpen = (_tickCount / 3) % 2 == 0;
                            }
                        }
                        else
                        {
                            _mouthOpen = false;
                        }
                    }
                    else
                    {
                        SetCloudBubble("🎵 " + _currentSongTitle, "Intro Musik · Siap Bernyanyi ♪", true);
                        _mouthOpen = false;
                    }
                }
                else
                {
                    _mouthOpen = (_tickCount / 3) % 2 == 0;
                }
            }
            else if (_isSpeaking)
            {
                _mouthOpen = (_tickCount / 2) % 2 == 0;
            }
            else
            {
                _mouthOpen = false;
                if (_speechClearTick > 0 && _tickCount >= _speechClearTick && !_isThinking)
                {
                    _speechClearTick = 0;
                    string[] idleLines = {
                        "Semangat kerjanya ya! Aku temenin di sini ♥",
                        "Jangan lupa senyum ya! ;3",
                        "Klik 📝 di bawah buat putar lagu full ♪",
                        "Lagi fokus kerja ya? Aku jagain di pojok layar ♥"
                    };
                    SetCloudBubble("✦ REYA TEMAN KERJA", idleLines[(_tickCount / 100) % idleLines.Length], false);
                }
            }

            // 5. Mouth & Pill Waveform Animation
            bool showActiveMouth = _isSpeaking || (_isSinging && _mouthOpen);
            _catMouth.Visibility = showActiveMouth ? Visibility.Collapsed : Visibility.Visible;
            _talkMouth.Visibility = showActiveMouth ? Visibility.Visible : Visibility.Collapsed;

            double[] baseWave = { 6, 12, 17, 12, 6 };
            for (int i = 0; i < 5; i++)
            {
                if (showActiveMouth)
                {
                    double h = 4 + Math.Abs(Math.Sin((_tickCount * 0.45) + i * 1.1)) * 10;
                    _mouthBars[i].Height = h;
                }
                if (_isSinging || _isSpeaking)
                {
                    double wh = 5 + Math.Abs(Math.Sin((_tickCount * 0.4) + i * 0.9)) * 14;
                    _pillWaveBars[i].Height = wh;
                    _pillWaveBars[i].Background = HexBrush("#5CE8A0");
                }
                else
                {
                    _pillWaveBars[i].Height = baseWave[i];
                    _pillWaveBars[i].Background = Brushes.White;
                }
            }
        }

        private static string FormatSec(double sec)
        {
            if (double.IsNaN(sec) || double.IsInfinity(sec) || sec < 0) return "0:00";
            int total = (int)Math.Floor(sec);
            int m = total / 60;
            int s = total % 60;
            return m + ":" + (s < 10 ? "0" : "") + s;
        }

        private async Task HandleUserPromptAsync(string rawText)
        {
            string text = (rawText ?? "").Trim();
            if (string.IsNullOrEmpty(text) || _isThinking) return;
            _promptInput.Text = "";

            string norm = text.ToLowerInvariant();
            bool wantsSong =
                norm.Contains("nyanyi") ||
                norm.Contains("karaoke") ||
                norm.Contains("lagu") ||
                norm.Contains("putar") ||
                norm.Contains("mainkan") ||
                norm.Contains("komang") ||
                norm.Contains("wildflower") ||
                norm.Contains("laskar") ||
                norm.Contains("bohemian") ||
                norm.Contains("hotel california") ||
                norm.Contains("sial");

            if (wantsSong)
            {
                string cleaned = Regex.Replace(
                    text,
                    @"\b(tolong|coba|bisa|ga|ngga|dong|ya|yuk|reya|nyanyi|nyanyikan|menyanyi|karaoke|putar|putarkan|mainkan|lagu)\b",
                    " ",
                    RegexOptions.IgnoreCase
                ).Trim();
                if (string.IsNullOrEmpty(cleaned)) cleaned = text;
                await PlayBitChordSongAsync(cleaned);
                return;
            }

            _isThinking = true;
            _statusMiniText.Text = "REYA sedang berpikir...";
            SetCloudBubble("💭 BERPIKIR...", "Hmm, bentar ya...", false);

            string reply = "";
            try
            {
                string payload = "{\"messages\":[{\"role\":\"user\",\"content\":\"" + EscapeJson(text) + "\"}]}";
                var res = await Http.PostAsync(
                    BaseApiUrl + "/api/chat",
                    new StringContent(payload, Encoding.UTF8, "application/json")
                );
                string body = await res.Content.ReadAsStringAsync();
                reply = ExtractJsonString(body, "message");
            }
            catch
            {
                reply = "";
            }
            finally
            {
                _isThinking = false;
            }

            if (string.IsNullOrEmpty(reply))
            {
                reply = "Aku selalu siap nemenin kamu kerja! Kalau mau sambil dengerin lagu, ketik aja judul lagunya ya ♪";
            }
            _statusMiniText.Text = "REYA: " + reply;
            await SpeakAndShowAsync(reply);
        }

        private async Task SpeakAndShowAsync(string text)
        {
            SetCloudBubble("🗣️ SUARA REYA", text, true);
            _isSpeaking = true;

            try
            {
                string payload = "{\"text\":\"" + EscapeJson(text) + "\",\"engine\":\"voicebox\",\"speaker\":\"F2\"}";
                var res = await Http.PostAsync(
                    BaseApiUrl + "/api/tts",
                    new StringContent(payload, Encoding.UTF8, "application/json")
                );
                if (res.IsSuccessStatusCode)
                {
                    byte[] audioBytes = await res.Content.ReadAsByteArrayAsync();
                    if (audioBytes != null && audioBytes.Length > 200)
                    {
                        string tempFile = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "reya_tts_" + Guid.NewGuid().ToString("N") + ".mp3");
                        File.WriteAllBytes(tempFile, audioBytes);
                        _ttsPlayer.Open(new Uri(tempFile, UriKind.Absolute));
                        _ttsPlayer.Play();
                        return;
                    }
                }
            }
            catch { }

            // Fallback timer if TTS audio fails
            _isSpeaking = false;
            _speechClearTick = _tickCount + 80;
        }

        private async Task PlayBitChordSongAsync(string query)
        {
            StopSong();
            _statusMiniText.Text = "Mencari full lagu \"" + query + "\" di BitChord...";
            SetCloudBubble("🔍 MENCARI LAGU...", "Mencari full lagu \"" + query + "\" ♪", true);

            try
            {
                string url = BaseApiUrl + "/api/enchor?q=" + Uri.EscapeDataString(query);
                string json = await Http.GetStringAsync(url);

                // Extract selected section
                int selIdx = json.IndexOf("\"selected\":", StringComparison.Ordinal);
                string selBlock = selIdx >= 0 ? json.Substring(selIdx) : json;

                string name = ExtractJsonString(selBlock, "name");
                string artist = ExtractJsonString(selBlock, "artist");
                string audioUrl = ExtractJsonString(selBlock, "audioUrl");

                if (string.IsNullOrEmpty(name)) name = query;
                _currentSongTitle = string.IsNullOrEmpty(artist) ? name : (name + " · " + artist);
                _currentLyrics = ParseLyricsFromJson(selBlock);

                if (string.IsNullOrEmpty(audioUrl))
                {
                    _statusMiniText.Text = "Audio tidak ditemukan untuk " + query;
                    SetCloudBubble("✦ INFO LAGU", "Lagu belum tersedia, coba judul lain ya!", false);
                    return;
                }

                if (audioUrl.StartsWith("/"))
                {
                    audioUrl = BaseApiUrl + audioUrl;
                }

                _songTitleMini.Text = "🎤 " + _currentSongTitle;
                _playerMiniRow.Visibility = Visibility.Visible;
                _pauseResumeBtn.Content = "⏸";
                _statusMiniText.Text = "Memutar full lagu: " + _currentSongTitle;

                _isSinging = true;
                SetCloudBubble("🎤 " + _currentSongTitle, _currentLyrics.Count > 0 ? _currentLyrics[0].Text : "♪ Memutar lagu penuh... ♫", true);

                _musicPlayer.Open(new Uri(audioUrl, UriKind.Absolute));
                _musicPlayer.Play();
            }
            catch (Exception ex)
            {
                _statusMiniText.Text = "Gagal memuat lagu: " + ex.Message;
                SetCloudBubble("✦ KONEKSI SIBUK", "Coba klik lagu lagi ya ♪", false);
            }
        }

        private void TogglePauseSong()
        {
            if (!_isSinging || _musicPlayer.Source == null) return;
            if (_pauseResumeBtn.Content.ToString() == "⏸")
            {
                _musicPlayer.Pause();
                _pauseResumeBtn.Content = "▶";
                _mouthOpen = false;
            }
            else
            {
                _musicPlayer.Play();
                _pauseResumeBtn.Content = "⏸";
            }
        }

        private void StopSong()
        {
            _musicPlayer.Stop();
            _musicPlayer.Close();
            _isSinging = false;
            _mouthOpen = false;
            _playerMiniRow.Visibility = Visibility.Collapsed;
            SetCloudBubble("✦ REYA TEMAN KERJA", "Semangat kerjanya ya! Aku temenin di sini ♥", false);
        }

        private static string EscapeJson(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }

        private static string ExtractJsonString(string json, string key)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
            if (!m.Success) return "";
            return Regex.Unescape(m.Groups[1].Value);
        }

        private static List<LyricLine> ParseLyricsFromJson(string json)
        {
            var list = new List<LyricLine>();
            int lyrIdx = json.IndexOf("\"lyrics\":", StringComparison.Ordinal);
            if (lyrIdx < 0) return list;

            string sub = json.Substring(lyrIdx);
            var matches = Regex.Matches(
                sub,
                "\\{\\s*\"timeMs\"\\s*:\\s*([0-9.]+)(?:\\s*,\\s*\"endMs\"\\s*:\\s*([0-9.]+))?\\s*,\\s*\"text\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""
            );

            foreach (Match m in matches)
            {
                double tMs;
                double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out tMs);
                double eMs = 0;
                if (m.Groups[2].Success)
                {
                    double.TryParse(m.Groups[2].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out eMs);
                }
                string txt = Regex.Unescape(m.Groups[3].Value);
                if (!string.IsNullOrWhiteSpace(txt))
                {
                    list.Add(new LyricLine
                    {
                        TimeMs = tMs,
                        EndMs = eMs > tMs ? eMs : tMs + 3400,
                        Text = txt
                    });
                }
            }
            return list;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            var app = new Application();
            app.Run(new ReyaDesktopPetWindow());
        }
    }
}
