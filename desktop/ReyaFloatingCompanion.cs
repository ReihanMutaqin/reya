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
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };

        // Window & Layout sizing for cute compact Desktop Pet (Micro Scale)
        private double _petScale = 0.44;
        private double _baseWindowHeight = 145;
        private double _baseWindowWidth = 230;
        private ScaleTransform _robotLayoutScale;

        // UI Elements
        private StackPanel _mainStack;
        private Border _cloudBubble;
        private TextBlock _cloudHeaderText;
        private TextBlock _cloudMainText;
        private Canvas _robotCanvas;
        private TranslateTransform _robotBobTransform;
        private RotateTransform _robotTiltTransform;
        private ScaleTransform _robotScaleTransform;
        private Canvas _eyesGroup;
        private TranslateTransform _eyesGazeTransform;
        private Border _leftEye;
        private Border _rightEye;
        private Canvas _leftPupil;
        private Canvas _rightPupil;
        private TranslateTransform _leftPupilTransform;
        private TranslateTransform _rightPupilTransform;
        private TextBlock _leftSpecialEye;
        private TextBlock _rightSpecialEye;
        private Border _leftCheek;
        private Border _rightCheek;
        private Canvas _catMouth;
        private Border _happyOpenMouth;
        private StackPanel _talkMouth;
        private Border[] _mouthBars = new Border[5];
        private Ellipse _antennaBulb;
        private RotateTransform _antennaRotate;
        private RotateTransform _leftEarRotate;
        private RotateTransform _rightEarRotate;
        private RotateTransform _leftArmRotate;
        private RotateTransform _rightArmRotate;
        private RotateTransform _leftLegRotate;
        private RotateTransform _rightLegRotate;
        private TextBlock _torsoBadgeText;
        private TextBlock _floatingHearts;
        private TextBlock _propSticker;

        // Codex-style Bottom Pill & Popover (Hidden by default, shown on click!)
        private Border _actionPill;
        private Button _walkToggleBtn;
        private Border[] _pillWaveBars = new Border[5];
        private Border _drawerPanel;
        private TextBox _promptInput;
        private TextBlock _statusMiniText;
        private StackPanel _playerMiniRow;
        private TextBlock _songTitleMini;
        private Slider _songProgressSlider;
        private TextBlock _songTimeMini;
        private Button _pauseResumeBtn;
        private int _pillAutoCloseTick = 0;

        // Audio & Sync State
        private MediaPlayer _musicPlayer = new MediaPlayer();
        private MediaPlayer _ttsPlayer = new MediaPlayer();
        private List<LyricLine> _currentLyrics = new List<LyricLine>();
        private string _currentSongTitle = "";
        private double _estimatedDurationSec = 210;
        private bool _isSinging = false;
        private bool _isAudioPaused = false;
        private bool _isSpeaking = false;
        private bool _isThinking = false;
        private bool _mouthOpen = false;
        private bool _isBlinking = false;
        private bool _isDraggingSlider = false;
        private double _reactionUntilTick = 0;
        private string _reactionKind = "";
        private double _speechClearTick = 0;
        private int _tickCount = 0;
        private int _moodIndex = 0;

        // Taskbar Walking Pet State Machine
        private bool _petWalkEnabled = true;
        private bool _isWalking = true;
        private int _walkDirection = -1; // -1 = walk left (towards Start button), 1 = walk right (towards Clock)
        private double _walkSpeed = 1.25;
        private int _walkPhaseTicks = 0;
        private int _walkDurationTicks = 110;
        private int _idleDurationTicks = 75;
        private double _walkStepCycle = 0;

        // Drag / Shake detection
        private bool _isDraggingWindow = false;
        private Point _dragStartMouseScreen;
        private Point _dragStartWindowPos;
        private double _lastDragScreenX = 0;
        private double _shakeEnergy = 0;

        private DispatcherTimer _animTimer;
        private Forms.NotifyIcon _trayIcon;

        public ReyaDesktopPetWindow()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            if (!Http.DefaultRequestHeaders.Contains("User-Agent"))
            {
                Http.DefaultRequestHeaders.Add("User-Agent", "REYA-Desktop-Companion/4.0");
            }

            Title = "REYA Companion";
            Width = _baseWindowWidth;
            Height = _baseWindowHeight;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;

            // Snap feet directly on top of the taskbar
            SnapToTaskbarBottom();

            BuildVisualTree();
            SetupContextMenu();
            SetupTrayIcon();
            SetupMediaPlayers();

            _animTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            _animTimer.Tick += OnAnimationTick;
            _animTimer.Start();

            Loaded += (s, e) =>
            {
                TriggerReaction("wave", "✦ HALO!", "Aku REYA! Klik badanku untuk buka tombol kontrol ya ♪", false);
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

        private void SnapToTaskbarBottom()
        {
            var workArea = SystemParameters.WorkArea;
            if (double.IsNaN(Left) || Left < 10)
            {
                Left = Math.Max(20, workArea.Right - Width - 35);
            }
            Top = Math.Max(10, workArea.Bottom - Height);
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
                    IsPointOverElement(_cloudBubble, pt) ||
                    (_actionPill.Visibility == Visibility.Visible && IsPointOverElement(_actionPill, pt)) ||
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
                Background = null,
                VerticalAlignment = VerticalAlignment.Bottom,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            _mainStack = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 0, 0)
            };

            // 1. FLOATING SPEECH & KARAOKE LYRIC CLOUD BUBBLE ABOVE HEAD
            _cloudBubble = new Border
            {
                Background = HexBrush("#F8F6F0"),
                BorderBrush = HexBrush("#2A302D"),
                BorderThickness = new Thickness(1.8),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(7, 3, 7, 4),
                MaxWidth = 165,
                MinWidth = 100,
                Opacity = 0.75, // 75% opacity requested by user
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 3),
                Cursor = Cursors.Hand,
                ToolTip = "Klik bubble untuk ganti sapaan lucu REYA!",
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 8,
                    ShadowDepth = 2,
                    Opacity = 0.25
                }
            };
            _cloudBubble.MouseLeftButtonDown += (s, e) =>
            {
                CycleRandomFunInteraction();
            };

            var cloudStack = new StackPanel { Orientation = Orientation.Vertical };
            _cloudHeaderText = new TextBlock
            {
                Text = "✦ REYA",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 7.5,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#0E623D"),
                Margin = new Thickness(0, 0, 0, 1),
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            _cloudMainText = new TextBlock
            {
                Text = "Halo! Aku REYA siap nemenin kerja ♪",
                FontFamily = new FontFamily("Segoe UI Semibold"),
                FontSize = 9.8,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#161817"),
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                MaxHeight = 36
            };
            cloudStack.Children.Add(_cloudHeaderText);
            cloudStack.Children.Add(_cloudMainText);
            _cloudBubble.Child = cloudStack;
            _mainStack.Children.Add(_cloudBubble);

            // 2. FULL-BODY CHIBI ROBOT MASCOT (Interactive Head, Ears, Face, Torso, Arms, Feet)
            _robotCanvas = new Canvas
            {
                Width = 160,
                Height = 164,
                HorizontalAlignment = HorizontalAlignment.Center,
                Cursor = Cursors.Hand,
                Background = Brushes.Transparent,
                ToolTip = "REYA Pet: Klik = Buka/Tutup Tombol | Geser = Pindah | Klik Kanan = Menu"
            };

            // LayoutTransform scales the entire robot down to cute micro pet size (~70x72px)!
            _robotLayoutScale = new ScaleTransform(_petScale, _petScale);
            _robotCanvas.LayoutTransform = _robotLayoutScale;

            _robotCanvas.RenderTransformOrigin = new Point(0.5, 0.5);
            var robotTransformGroup = new TransformGroup();
            _robotScaleTransform = new ScaleTransform(1, 1);
            _robotBobTransform = new TranslateTransform(0, 0);
            _robotTiltTransform = new RotateTransform(0);
            robotTransformGroup.Children.Add(_robotScaleTransform);
            robotTransformGroup.Children.Add(_robotBobTransform);
            robotTransformGroup.Children.Add(_robotTiltTransform);
            _robotCanvas.RenderTransform = robotTransformGroup;

            // Custom drag + click zone handling + shake detection!
            _robotCanvas.MouseLeftButtonDown += OnRobotMouseDown;
            _robotCanvas.MouseMove += OnRobotMouseMove;
            _robotCanvas.MouseLeftButtonUp += OnRobotMouseUp;
            _robotCanvas.MouseWheel += (s, e) =>
            {
                _moodIndex = (_moodIndex + 1) % 4;
                if (_moodIndex == 0)
                    TriggerReaction("love", "♥ MANJA", "Ehehe seneng banget ditemenin kamu kerja~ ♥", true);
                else if (_moodIndex == 1)
                    TriggerReaction("star", "🔥 SEMANGAT", "Gas terus kerjanya! Kamu pasti bisa! 🔥", true);
                else if (_moodIndex == 2)
                    TriggerReaction("boba", "🧋 BOBA", "Slurp~ minum boba dulu biar adem ♪", true);
                else
                    TriggerReaction("sleepy", "💤 NGANTUK", "Huaah~ istirahat mata sebentar ya... Zzz", false);
            };

            // Curved Top Antenna
            var antennaGroup = new Canvas { Width = 40, Height = 32 };
            Canvas.SetLeft(antennaGroup, 60);
            Canvas.SetTop(antennaGroup, 0);
            _antennaRotate = new RotateTransform(0, 20, 28);
            antennaGroup.RenderTransform = _antennaRotate;

            var antennaStem = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M 20,28 C 18,10 5,6 8,18"),
                Stroke = HexBrush("#252B28"),
                StrokeThickness = 5.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            _antennaBulb = new Ellipse
            {
                Width = 12,
                Height = 12,
                Fill = HexBrush("#5CE8A0"),
                Stroke = HexBrush("#161A18"),
                StrokeThickness = 1.8,
                Effect = new DropShadowEffect { Color = Color.FromRgb(92, 232, 160), BlurRadius = 8, ShadowDepth = 0 }
            };
            Canvas.SetLeft(_antennaBulb, 2);
            Canvas.SetTop(_antennaBulb, 12);
            antennaGroup.Children.Add(antennaStem);
            antennaGroup.Children.Add(_antennaBulb);
            _robotCanvas.Children.Add(antennaGroup);

            // Cute Cat-Robot Ears
            _leftEarRotate = new RotateTransform(-14, 12, 18);
            var leftEar = CreateEar(_leftEarRotate);
            Canvas.SetLeft(leftEar, 31);
            Canvas.SetTop(leftEar, 18);
            _robotCanvas.Children.Add(leftEar);

            _rightEarRotate = new RotateTransform(14, 12, 18);
            var rightEar = CreateEar(_rightEarRotate);
            Canvas.SetLeft(rightEar, 105);
            Canvas.SetTop(rightEar, 18);
            _robotCanvas.Children.Add(rightEar);

            // Chibi Robot Arms
            var leftArm = new Border
            {
                Width = 20,
                Height = 12,
                CornerRadius = new CornerRadius(6),
                Background = HexBrush("#232927"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.2)
            };
            _leftArmRotate = new RotateTransform(-15, 18, 6);
            leftArm.RenderTransform = _leftArmRotate;
            Canvas.SetLeft(leftArm, 26);
            Canvas.SetTop(leftArm, 110);
            _robotCanvas.Children.Add(leftArm);

            var rightArm = new Border
            {
                Width = 20,
                Height = 12,
                CornerRadius = new CornerRadius(6),
                Background = HexBrush("#232927"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.2)
            };
            _rightArmRotate = new RotateTransform(15, 2, 6);
            rightArm.RenderTransform = _rightArmRotate;
            Canvas.SetLeft(rightArm, 114);
            Canvas.SetTop(rightArm, 110);
            _robotCanvas.Children.Add(rightArm);

            // Chibi Torso
            _torsoBadgeText = new TextBlock
            {
                Text = "♥",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#5CE8A0"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RenderTransformOrigin = new Point(0.5, 0.5)
            };
            var torso = new Border
            {
                Width = 72,
                Height = 38,
                CornerRadius = new CornerRadius(15),
                Background = HexBrush("#1F2523"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.6),
                Child = _torsoBadgeText
            };
            Canvas.SetLeft(torso, 44);
            Canvas.SetTop(torso, 104);
            _robotCanvas.Children.Add(torso);

            // Sitting / Walking Feet (These touch the taskbar directly!)
            var leftFoot = new Border
            {
                Width = 22,
                Height = 16,
                CornerRadius = new CornerRadius(8),
                Background = HexBrush("#181C1B"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.2)
            };
            _leftLegRotate = new RotateTransform(0, 11, 2);
            leftFoot.RenderTransform = _leftLegRotate;
            Canvas.SetLeft(leftFoot, 48);
            Canvas.SetTop(leftFoot, 136);
            _robotCanvas.Children.Add(leftFoot);

            var rightFoot = new Border
            {
                Width = 22,
                Height = 16,
                CornerRadius = new CornerRadius(8),
                Background = HexBrush("#181C1B"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.2)
            };
            _rightLegRotate = new RotateTransform(0, 11, 2);
            rightFoot.RenderTransform = _rightLegRotate;
            Canvas.SetLeft(rightFoot, 90);
            Canvas.SetTop(rightFoot, 136);
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
            Canvas.SetLeft(leftPod, 20);
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
            Canvas.SetLeft(rightPod, 132);
            Canvas.SetTop(rightPod, 52);
            _robotCanvas.Children.Add(rightPod);

            // CRT TV Head Housing
            var crtHousing = new Border
            {
                Width = 108,
                Height = 86,
                CornerRadius = new CornerRadius(22),
                Background = HexBrush("#232A27"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(3.2),
                Padding = new Thickness(7),
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 12,
                    ShadowDepth = 3,
                    Opacity = 0.45
                }
            };
            Canvas.SetLeft(crtHousing, 26);
            Canvas.SetTop(crtHousing, 24);

            var crtScreen = new Border
            {
                CornerRadius = new CornerRadius(15),
                Background = HexBrush("#131A17"),
                BorderBrush = HexBrush("#36423D"),
                BorderThickness = new Thickness(1.5),
                ClipToBounds = true
            };

            var screenCanvas = new Canvas { Width = 88, Height = 66 };

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

            // Floating Hearts / Notes / Sparkles inside Visor
            _floatingHearts = new TextBlock
            {
                Text = "♥",
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = HexBrush("#FF8BA7"),
                Visibility = Visibility.Collapsed
            };
            Canvas.SetLeft(_floatingHearts, 68);
            Canvas.SetTop(_floatingHearts, 3);
            screenCanvas.Children.Add(_floatingHearts);

            // Eyes Group
            _eyesGroup = new Canvas { Width = 88, Height = 42 };
            _eyesGazeTransform = new TranslateTransform(0, 0);
            _eyesGroup.RenderTransform = _eyesGazeTransform;

            _leftPupilTransform = new TranslateTransform(0, 0);
            _rightPupilTransform = new TranslateTransform(0, 0);
            _leftEye = CreateEye(_leftPupilTransform, out _leftPupil);
            _rightEye = CreateEye(_rightPupilTransform, out _rightPupil);
            Canvas.SetLeft(_leftEye, 15);
            Canvas.SetTop(_leftEye, 14);
            Canvas.SetLeft(_rightEye, 53);
            Canvas.SetTop(_rightEye, 14);
            _eyesGroup.Children.Add(_leftEye);
            _eyesGroup.Children.Add(_rightEye);

            // Special expressive eyes overlay (^ ^, > <, ★ ★, ♥ ♥, @ @)
            _leftSpecialEye = new TextBlock
            {
                Text = "^",
                FontSize = 19,
                FontWeight = FontWeights.ExtraBold,
                Foreground = HexBrush("#E8F47A"),
                Visibility = Visibility.Collapsed
            };
            Canvas.SetLeft(_leftSpecialEye, 18);
            Canvas.SetTop(_leftSpecialEye, 11);
            _eyesGroup.Children.Add(_leftSpecialEye);

            _rightSpecialEye = new TextBlock
            {
                Text = "^",
                FontSize = 19,
                FontWeight = FontWeights.ExtraBold,
                Foreground = HexBrush("#E8F47A"),
                Visibility = Visibility.Collapsed
            };
            Canvas.SetLeft(_rightSpecialEye, 56);
            Canvas.SetTop(_rightSpecialEye, 11);
            _eyesGroup.Children.Add(_rightSpecialEye);

            // Blush Cheeks
            _leftCheek = new Border
            {
                Width = 12,
                Height = 6.5,
                CornerRadius = new CornerRadius(3.2),
                Background = new SolidColorBrush(Color.FromArgb(200, 255, 115, 150))
            };
            Canvas.SetLeft(_leftCheek, 7);
            Canvas.SetTop(_leftCheek, 38);
            _eyesGroup.Children.Add(_leftCheek);

            _rightCheek = new Border
            {
                Width = 12,
                Height = 6.5,
                CornerRadius = new CornerRadius(3.2),
                Background = new SolidColorBrush(Color.FromArgb(200, 255, 115, 150))
            };
            Canvas.SetLeft(_rightCheek, 69);
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
            Canvas.SetLeft(_catMouth, 33);
            Canvas.SetTop(_catMouth, 44);
            screenCanvas.Children.Add(_catMouth);

            // Happy Laughing Open Mouth (:D)
            _happyOpenMouth = new Border
            {
                Width = 16,
                Height = 10,
                CornerRadius = new CornerRadius(2, 2, 9, 9),
                Background = HexBrush("#FF7B9C"),
                BorderBrush = HexBrush("#E8F47A"),
                BorderThickness = new Thickness(1.5),
                Visibility = Visibility.Collapsed
            };
            Canvas.SetLeft(_happyOpenMouth, 36);
            Canvas.SetTop(_happyOpenMouth, 44);
            screenCanvas.Children.Add(_happyOpenMouth);

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
            Canvas.SetLeft(_talkMouth, 30);
            Canvas.SetTop(_talkMouth, 43);
            screenCanvas.Children.Add(_talkMouth);

            crtScreen.Child = screenCanvas;
            crtHousing.Child = crtScreen;
            _robotCanvas.Children.Add(crtHousing);

            // Cute Prop Sticker next to hand
            _propSticker = new TextBlock
            {
                Text = "🧋",
                FontSize = 18,
                Visibility = Visibility.Collapsed,
                RenderTransformOrigin = new Point(0.5, 0.5)
            };
            Canvas.SetLeft(_propSticker, 124);
            Canvas.SetTop(_propSticker, 92);
            _robotCanvas.Children.Add(_propSticker);

            _mainStack.Children.Add(_robotCanvas);

            // 3. CODEX-STYLE DARK FLOATING CAPSULE PILL
            // *** HIDDEN BY DEFAULT (User: "bawah nya hide aja, kalau di klik bot nya baru muncul") ***
            _actionPill = new Border
            {
                Background = HexBrush("#181A1C"),
                BorderBrush = HexBrush("#383E42"),
                BorderThickness = new Thickness(1.4),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(5, 2, 5, 2),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 3, 0, 0),
                Visibility = Visibility.Collapsed, // HIDDEN BY DEFAULT!
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 10,
                    ShadowDepth = 3,
                    Opacity = 0.5
                }
            };

            var pillRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

            var patBtn = CreatePillButton("♥", "Elus kepala REYA (Senang & Manja)");
            patBtn.Click += (s, e) =>
            {
                TriggerReaction("headpat", "♥ NYAMAN DIELUS~", "Hehe makasih udah elus kepalaku! Semangat kerjanya ya~ ♥", true);
            };
            pillRow.Children.Add(patBtn);

            var tickleBtn = CreatePillButton("★", "Kilik perut REYA (Geli & Ketawa)");
            tickleBtn.Click += (s, e) =>
            {
                TriggerReaction("tickle", "😆 HAHAHA GELI!", "Hahaha jangan dikilik perutku, geli tau! >w<", true);
            };
            pillRow.Children.Add(tickleBtn);

            var bobaBtn = CreatePillButton("🧋", "Kasih Boba & Camilan ke REYA (Tambah Energi)");
            bobaBtn.Click += (s, e) =>
            {
                TriggerReaction("boba", "🧋 NYAM NYAM SEGER!", "Waaah makasih bobanya! Energi REYA langsung penuh 100%! ⚡", true);
            };
            pillRow.Children.Add(bobaBtn);

            // 🐾 TASKBAR PET WALK TOGGLE BUTTON
            _walkToggleBtn = CreatePillButton("🐾", "Mode Jalan Pet di Atas Taskbar: Aktif (Klik untuk Diam / Jalan)");
            _walkToggleBtn.Foreground = HexBrush("#5CE8A0");
            _walkToggleBtn.Click += (s, e) =>
            {
                _petWalkEnabled = !_petWalkEnabled;
                if (_petWalkEnabled)
                {
                    _isWalking = true;
                    _walkPhaseTicks = 0;
                    _walkToggleBtn.Foreground = HexBrush("#5CE8A0");
                    _walkToggleBtn.ToolTip = "Mode Jalan Pet di Atas Taskbar: Aktif (Klik untuk Diam)";
                    TriggerReaction("dance", "🐾 JALAN SANTAI", "Yey! Aku jalan-jalan lagi di atas taskbarmu ya ♪", false);
                }
                else
                {
                    _isWalking = false;
                    _walkToggleBtn.Foreground = HexBrush("#8E9692");
                    _walkToggleBtn.ToolTip = "Mode Jalan Pet di Atas Taskbar: Diam (Klik untuk Jalan)";
                    TriggerReaction("sleepy", "📌 DIAM DI TEMPAT", "Siap! Aku duduk manis di sini jagain kamu kerja ♥", false);
                }
            };
            pillRow.Children.Add(_walkToggleBtn);

            pillRow.Children.Add(CreatePillDivider());

            // Compose / Song Search Icon (📝)
            var composeBtn = CreatePillButton("📝", "Ketik obrolan atau cari lagu full (Komang, Wildflower, dll)");
            composeBtn.Click += (s, e) => ToggleDrawer();
            pillRow.Children.Add(composeBtn);

            pillRow.Children.Add(CreatePillDivider());

            // Right Pill Button: Audio Waveform Icon
            var waveStack = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Height = 16
            };
            double[] defaultHeights = { 4, 8, 12, 8, 4 };
            for (int i = 0; i < 5; i++)
            {
                var wBar = new Border
                {
                    Width = 2.0,
                    Height = defaultHeights[i],
                    CornerRadius = new CornerRadius(1.0),
                    Background = Brushes.White,
                    Margin = new Thickness(0.9, 0, 0.9, 0),
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
                Padding = new Thickness(4, 2, 4, 2),
                Cursor = Cursors.Hand,
                ToolTip = "Klik untuk sapaan suara / Jeda-Lanjut lagu (Klik kanan untuk Stop lagu)"
            };
            waveBtn.Click += async (s, e) =>
            {
                if (_isSinging)
                {
                    TogglePauseSong();
                }
                else
                {
                    string[] voiceLines = {
                        "Halo! Semangat terus kerjanya ya, aku nemenin kamu di atas taskbar!",
                        "Jangan lupa minum air putih dan istirahatkan mata sejenak ya!",
                        "Kalau mau dengerin lagu, klik ikon tulis lalu ketik lagu kesukaanmu!",
                        "Hehe seneng banget nemenin kamu kerja hari ini!"
                    };
                    string picked = voiceLines[_tickCount % voiceLines.Length];
                    TriggerReaction("love", "🗣️ SUARA REYA", picked, false);
                    await SpeakAndShowAsync(picked);
                }
            };
            waveBtn.MouseRightButtonUp += (s, e) =>
            {
                StopSong();
            };
            pillRow.Children.Add(waveBtn);

            // Mini Close button for the pill
            var closePillBtn = CreatePillButton("✕", "Tutup tombol kontrol (bisa dibuka lagi kapan saja dengan klik REYA)");
            closePillBtn.Foreground = HexBrush("#7E8682");
            closePillBtn.Click += (s, e) =>
            {
                TogglePillVisibility(false);
            };
            pillRow.Children.Add(closePillBtn);

            _actionPill.Child = pillRow;
            _mainStack.Children.Add(_actionPill);

            // 4. COMPACT POPOVER DRAWER (Toggled by 📝 button, expands smoothly upwards)
            _drawerPanel = new Border
            {
                Background = HexBrush("#181A1C"),
                BorderBrush = HexBrush("#383E42"),
                BorderThickness = new Thickness(1.4),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(8, 6, 8, 6),
                Width = 210,
                Margin = new Thickness(0, 5, 0, 0),
                Visibility = Visibility.Collapsed,
                Effect = new DropShadowEffect
                {
                    Color = Colors.Black,
                    BlurRadius = 12,
                    ShadowDepth = 4,
                    Opacity = 0.55
                }
            };

            var drawerStack = new StackPanel { Orientation = Orientation.Vertical };

            // Input Row
            var inputGrid = new Grid();
            inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _promptInput = new TextBox
            {
                Background = HexBrush("#25292C"),
                Foreground = Brushes.White,
                CaretBrush = HexBrush("#5CE8A0"),
                BorderBrush = HexBrush("#454C50"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(5, 3, 5, 3),
                FontSize = 10.5,
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

            var singBtn = new Button
            {
                Content = "🎵",
                Background = HexBrush("#26332D"),
                Foreground = HexBrush("#5CE8A0"),
                BorderBrush = HexBrush("#5CE8A0"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(5, 3, 5, 3),
                Margin = new Thickness(3, 0, 0, 0),
                FontWeight = FontWeights.Bold,
                FontSize = 10,
                Cursor = Cursors.Hand,
                ToolTip = "Cari & Nyanyikan Lagu Full"
            };
            singBtn.Click += async (s, e) =>
            {
                string q = (_promptInput.Text ?? "").Trim();
                if (string.IsNullOrEmpty(q)) q = "Komang";
                _promptInput.Text = "";
                await PlayBitChordSongAsync(q);
            };
            Grid.SetColumn(singBtn, 1);
            inputGrid.Children.Add(singBtn);

            var sendBtn = new Button
            {
                Content = "💬",
                Background = HexBrush("#B83312"),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(5, 3, 5, 3),
                Margin = new Thickness(3, 0, 0, 0),
                FontWeight = FontWeights.Bold,
                FontSize = 10,
                Cursor = Cursors.Hand,
                ToolTip = "Kirim pesan obrolan"
            };
            sendBtn.Click += async (s, e) =>
            {
                await HandleUserPromptAsync(_promptInput.Text);
            };
            Grid.SetColumn(sendBtn, 2);
            inputGrid.Children.Add(sendBtn);
            drawerStack.Children.Add(inputGrid);

            // Quick Song Chips
            var chipsWrap = new WrapPanel { Margin = new Thickness(0, 5, 0, 0) };
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
                    Padding = new Thickness(4, 2, 4, 2),
                    Margin = new Thickness(0, 0, 3, 3),
                    FontSize = 9.0,
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
                Margin = new Thickness(0, 3, 0, 0),
                Visibility = Visibility.Collapsed
            };
            _songTitleMini = new TextBlock
            {
                Text = "",
                Foreground = HexBrush("#5CE8A0"),
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            _playerMiniRow.Children.Add(_songTitleMini);

            var progGrid = new Grid { Margin = new Thickness(0, 2, 0, 0) };
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
                try
                {
                    _musicPlayer.Position = TimeSpan.FromSeconds(_songProgressSlider.Value);
                }
                catch { }
            };
            Grid.SetColumn(_songProgressSlider, 0);
            progGrid.Children.Add(_songProgressSlider);

            _songTimeMini = new TextBlock
            {
                Text = "0:00 / 0:00",
                Foreground = HexBrush("#A9B0AC"),
                FontFamily = new FontFamily("Consolas"),
                FontSize = 8.5,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(3, 0, 3, 0)
            };
            Grid.SetColumn(_songTimeMini, 1);
            progGrid.Children.Add(_songTimeMini);

            _pauseResumeBtn = new Button
            {
                Content = "⏸",
                Background = HexBrush("#262B2E"),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 2, 0),
                FontSize = 8.5,
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
                Padding = new Thickness(4, 1, 4, 1),
                FontSize = 8.5,
                Cursor = Cursors.Hand
            };
            stopMiniBtn.Click += (s, e) => StopSong();
            Grid.SetColumn(stopMiniBtn, 3);
            progGrid.Children.Add(stopMiniBtn);

            _playerMiniRow.Children.Add(progGrid);
            drawerStack.Children.Add(_playerMiniRow);

            _statusMiniText = new TextBlock
            {
                Text = "Klik lagu di atas untuk karaoke full sampai beres ♪",
                Foreground = HexBrush("#9AA29E"),
                FontSize = 8.5,
                Margin = new Thickness(0, 2, 0, 0),
                TextWrapping = TextWrapping.Wrap
            };
            drawerStack.Children.Add(_statusMiniText);

            _drawerPanel.Child = drawerStack;
            _mainStack.Children.Add(_drawerPanel);

            root.Children.Add(_mainStack);
            Content = root;
        }

        // Toggle bottom pill bar on clicking the bot
        private void TogglePillVisibility(bool? forceShow = null)
        {
            var wa = SystemParameters.WorkArea;
            bool shouldShow = forceShow.HasValue ? forceShow.Value : (_actionPill.Visibility != Visibility.Visible);

            if (shouldShow)
            {
                _actionPill.Visibility = Visibility.Visible;
                Height = _baseWindowHeight + 36;
                Top = Math.Max(10, wa.Bottom - Height);
                _pillAutoCloseTick = _tickCount + 360; // Auto-close in ~18s if untouched
            }
            else
            {
                _actionPill.Visibility = Visibility.Collapsed;
                _drawerPanel.Visibility = Visibility.Collapsed;
                Height = _baseWindowHeight;
                Top = Math.Max(10, wa.Bottom - Height);
                _pillAutoCloseTick = 0;
            }
        }

        private void ToggleDrawer()
        {
            var wa = SystemParameters.WorkArea;
            if (_drawerPanel.Visibility == Visibility.Visible)
            {
                _drawerPanel.Visibility = Visibility.Collapsed;
                Height = _baseWindowHeight + (_actionPill.Visibility == Visibility.Visible ? 36 : 0);
                Top = Math.Max(10, wa.Bottom - Height);
            }
            else
            {
                _drawerPanel.Visibility = Visibility.Visible;
                _actionPill.Visibility = Visibility.Visible;
                Height = _baseWindowHeight + 36 + 180;
                Top = Math.Max(10, wa.Bottom - Height);
                _promptInput.Focus();
                _pillAutoCloseTick = 0; // Don't auto-close while typing
            }
        }

        private void SetupContextMenu()
        {
            var cm = new ContextMenu();

            var walkItem = new MenuItem { Header = "🐾 Jalan-Jalan di Atas Taskbar", IsChecked = _petWalkEnabled };
            walkItem.Click += (s, e) =>
            {
                _petWalkEnabled = !_petWalkEnabled;
                walkItem.IsChecked = _petWalkEnabled;
                _walkToggleBtn.Foreground = HexBrush(_petWalkEnabled ? "#5CE8A0" : "#8E9692");
            };
            cm.Items.Add(walkItem);

            var pillItem = new MenuItem { Header = "🎛️ Tampilkan Tombol Kontrol Bawah" };
            pillItem.Click += (s, e) => TogglePillVisibility();
            cm.Items.Add(pillItem);

            cm.Items.Add(new Separator());

            var patItem = new MenuItem { Header = "♥ Elus Kepala REYA" };
            patItem.Click += (s, e) => TriggerReaction("headpat", "♥ NYAMAN DIELUS~", "Hehe makasih udah elus kepalaku! ♥", true);
            cm.Items.Add(patItem);

            var tickleItem = new MenuItem { Header = "★ Kilik Perut REYA" };
            tickleItem.Click += (s, e) => TriggerReaction("tickle", "😆 GELI BANGET!", "Hahaha jangan dikilik perutku! >w<", true);
            cm.Items.Add(tickleItem);

            var bobaItem = new MenuItem { Header = "🧋 Kasih Boba Segar" };
            bobaItem.Click += (s, e) => TriggerReaction("boba", "🧋 NYAM BOBA!", "Slurp~ makasih bobanya seger banget! ⚡", true);
            cm.Items.Add(bobaItem);

            cm.Items.Add(new Separator());

            var snapItem = new MenuItem { Header = "📌 Pindahkan ke Atas Taskbar" };
            snapItem.Click += (s, e) => SnapToTaskbarBottom();
            cm.Items.Add(snapItem);

            var exitItem = new MenuItem { Header = "❌ Tutup REYA" };
            exitItem.Click += (s, e) =>
            {
                if (_trayIcon != null) _trayIcon.Visible = false;
                Application.Current.Shutdown();
            };
            cm.Items.Add(exitItem);

            _robotCanvas.ContextMenu = cm;
        }

        private void OnRobotMouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Right) return;

            POINT pt;
            GetCursorPos(out pt);
            _dragStartMouseScreen = new Point(pt.X, pt.Y);
            _dragStartWindowPos = new Point(Left, Top);
            _lastDragScreenX = pt.X;
            _isDraggingWindow = true;
            _isWalking = false;
            _robotCanvas.CaptureMouse();
        }

        private void OnRobotMouseMove(object sender, MouseEventArgs e)
        {
            if (!_isDraggingWindow) return;
            POINT pt;
            if (!GetCursorPos(out pt)) return;

            double dx = pt.X - _dragStartMouseScreen.X;
            double dy = pt.Y - _dragStartMouseScreen.Y;

            if (Math.Abs(dx) > 3 || Math.Abs(dy) > 3)
            {
                Left = _dragStartWindowPos.X + dx;
                Top = _dragStartWindowPos.Y + dy;

                _leftArmRotate.Angle = -42;
                _rightArmRotate.Angle = 42;
                _leftLegRotate.Angle = 16;
                _rightLegRotate.Angle = -16;

                double vx = Math.Abs(pt.X - _lastDragScreenX);
                _lastDragScreenX = pt.X;
                if (vx > 28)
                {
                    _shakeEnergy += vx;
                    if (_shakeEnergy > 220)
                    {
                        _shakeEnergy = 0;
                        TriggerReaction("dizzy", "🌀 PUSING~", "Waaah duniaku muter~ @ _ @", true);
                    }
                }
            }
        }

        private void OnRobotMouseUp(object sender, MouseButtonEventArgs e)
        {
            if (!_isDraggingWindow) return;
            _isDraggingWindow = false;
            _robotCanvas.ReleaseMouseCapture();

            POINT pt;
            GetCursorPos(out pt);
            double moved = Math.Sqrt(Math.Pow(pt.X - _dragStartMouseScreen.X, 2) + Math.Pow(pt.Y - _dragStartMouseScreen.Y, 2));

            // Snap back on top of the taskbar if dropped within 120px
            var wa = SystemParameters.WorkArea;
            if (Math.Abs(Top - (wa.Bottom - Height)) < 120)
            {
                Top = Math.Max(10, wa.Bottom - Height);
            }

            // User clicked REYA: Toggle the bottom pill bar on click! ("kalau di klik bot nya baru muncul")
            if (moved < 7)
            {
                TogglePillVisibility();

                Point local = e.GetPosition(_robotCanvas);
                if (local.Y < 48)
                {
                    TriggerReaction("headpat", "♥ NYAMAN DIELUS~", "Purrr~ nyaman banget dielus kepalaku! ♥", true);
                }
                else if (local.Y < 104)
                {
                    TriggerReaction("wink", "😜 BOOP HIDUNG!", "Ehehe hidungku di-boop! Jangan lupa senyum ya ;3", true);
                }
                else if (local.Y < 138)
                {
                    TriggerReaction("tickle", "😆 GELI BANGET!", "Hahaha jangan dikilik perutku! >w<", true);
                }
                else
                {
                    TriggerReaction("dance", "🕺 GOYANG KAKI~", "Tap tap tap~ ayo kita jalan di atas taskbar! ♪", true);
                }
            }
        }

        private void CycleRandomFunInteraction()
        {
            int pick = (_tickCount / 7) % 5;
            if (pick == 0)
                TriggerReaction("headpat", "♥ SAYANG KAMU!", "Aku seneng banget nemenin kamu kerja di atas taskbar ini ♥", true);
            else if (pick == 1)
                TriggerReaction("boba", "🧋 WAKTUNYA BOBA!", "Nyam nyam~ minum yang seger dulu biar makin fokus! ⚡", true);
            else if (pick == 2)
                TriggerReaction("tickle", "😆 HEHE GELI!", "Jangan lupa istirahatkan jari dan bahumu sebentar ya! ★", true);
            else if (pick == 3)
                TriggerReaction("dance", "🕺 JOGET SANTAI!", "Goyang kanan kiri~ kerjaan berat jadi terasa ringan ♪", true);
            else
                TriggerReaction("wink", "✨ KAMU HEBAT!", "Kerjaanmu hari ini keren banget, teruskan ya! ;3", true);
        }

        private static Border CreatePillDivider()
        {
            return new Border
            {
                Width = 1.0,
                Height = 14,
                Background = HexBrush("#383E42"),
                Margin = new Thickness(2.5, 0, 2.5, 0)
            };
        }

        private Border CreateEar(RotateTransform rotate)
        {
            var ear = new Border
            {
                Width = 24,
                Height = 20,
                CornerRadius = new CornerRadius(12, 12, 3, 3),
                Background = HexBrush("#232A27"),
                BorderBrush = HexBrush("#0F1211"),
                BorderThickness = new Thickness(2.5),
                RenderTransform = rotate,
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

        private Border CreateEye(TranslateTransform pupilTransform, out Canvas pupilCanvas)
        {
            pupilCanvas = new Canvas
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
            pupilCanvas.Children.Add(pupilCircle);
            pupilCanvas.Children.Add(glint);

            return new Border
            {
                Width = 20,
                Height = 23,
                CornerRadius = new CornerRadius(9),
                Background = HexBrush("#E8F47A"),
                Child = pupilCanvas,
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
                    FontSize = 10.5,
                    Foreground = Brushes.White,
                    VerticalAlignment = VerticalAlignment.Center
                },
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(4, 1.5, 4, 1.5),
                Cursor = Cursors.Hand,
                ToolTip = tooltip
            };
        }

        private void SetupMediaPlayers()
        {
            _musicPlayer.Volume = 0.95;
            _musicPlayer.MediaOpened += (s, e) =>
            {
                if (_musicPlayer.NaturalDuration.HasTimeSpan)
                {
                    double dur = _musicPlayer.NaturalDuration.TimeSpan.TotalSeconds;
                    if (dur > 5)
                    {
                        _estimatedDurationSec = dur;
                        _songProgressSlider.Maximum = dur;
                    }
                }
            };
            _musicPlayer.MediaEnded += (s, e) =>
            {
                _isSinging = false;
                _isAudioPaused = false;
                _mouthOpen = false;
                _playerMiniRow.Visibility = Visibility.Collapsed;
                TriggerReaction("love", "✦ SELESAI", "Lagu " + _currentSongTitle + " selesai sampai beres ♪", true);
            };

            _ttsPlayer.Volume = 1.0;
            _ttsPlayer.MediaEnded += (s, e) =>
            {
                _isSpeaking = false;
                _mouthOpen = false;
                _speechClearTick = _tickCount + 75;
            };
        }

        private void SetupTrayIcon()
        {
            _trayIcon = new Forms.NotifyIcon
            {
                Text = "REYA - Pet Mungil Taskbar (Always on Top)",
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

            var walkItem = new Forms.ToolStripMenuItem("🐾 Jalan di Atas Taskbar")
            {
                Checked = _petWalkEnabled,
                CheckOnClick = true
            };
            walkItem.CheckedChanged += (s, e) =>
            {
                _petWalkEnabled = walkItem.Checked;
                _walkToggleBtn.Foreground = HexBrush(_petWalkEnabled ? "#5CE8A0" : "#8E9692");
            };

            var pillItem = new Forms.ToolStripMenuItem("🎛️ Buka/Tutup Tombol Kontrol Bawah");
            pillItem.Click += (s, e) => TogglePillVisibility();

            var patItem = new Forms.ToolStripMenuItem("♥ Elus Kepala REYA");
            patItem.Click += (s, e) => TriggerReaction("headpat", "♥ NYAMAN DIELUS~", "Hehe makasih udah elus kepalaku! ♥", true);

            var bobaItem = new Forms.ToolStripMenuItem("🧋 Kasih Boba ke REYA");
            bobaItem.Click += (s, e) => TriggerReaction("boba", "🧋 NYAM NYAM BOBA!", "Segernya boba manis~ makasih ya! ⚡", true);

            var inputItem = new Forms.ToolStripMenuItem("📝 Buka Kotak Obrolan & Lagu");
            inputItem.Click += (s, e) =>
            {
                Show();
                Activate();
                ToggleDrawer();
            };

            var taskbarItem = new Forms.ToolStripMenuItem("📌 Pindahkan ke Atas Taskbar");
            taskbarItem.Click += (s, e) => SnapToTaskbarBottom();

            var exitItem = new Forms.ToolStripMenuItem("❌ Tutup REYA");
            exitItem.Click += (s, e) =>
            {
                _trayIcon.Visible = false;
                Application.Current.Shutdown();
            };

            menu.Items.Add(topItem);
            menu.Items.Add(walkItem);
            menu.Items.Add(pillItem);
            menu.Items.Add(patItem);
            menu.Items.Add(bobaItem);
            menu.Items.Add(inputItem);
            menu.Items.Add(taskbarItem);
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add(exitItem);
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.DoubleClick += (s, e) =>
            {
                Show();
                Activate();
                TogglePillVisibility();
            };
        }

        private void SetCloudBubble(string header, string text, bool darkSingMode)
        {
            _cloudHeaderText.Text = header;
            _cloudMainText.Text = text;
            _cloudBubble.Opacity = 0.75;
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

        private void TriggerReaction(string kind, string header, string bubbleText, bool playChime)
        {
            _reactionKind = kind;
            _reactionUntilTick = _tickCount + 65;
            if (!_isSinging)
            {
                SetCloudBubble(header, bubbleText, false);
                _speechClearTick = _tickCount + 100;
            }

            if (playChime)
            {
                Task.Run(() =>
                {
                    try
                    {
                        if (kind == "headpat" || kind == "love")
                        {
                            Console.Beep(784, 45);
                            Console.Beep(1046, 65);
                        }
                        else if (kind == "tickle")
                        {
                            Console.Beep(987, 35);
                            Console.Beep(1174, 35);
                            Console.Beep(1318, 50);
                        }
                        else if (kind == "boba" || kind == "star")
                        {
                            Console.Beep(659, 40);
                            Console.Beep(880, 40);
                            Console.Beep(1318, 65);
                        }
                        else if (kind == "dizzy")
                        {
                            Console.Beep(600, 40);
                            Console.Beep(480, 60);
                        }
                        else
                        {
                            Console.Beep(880, 50);
                        }
                    }
                    catch { }
                });
            }
        }

        private void OnAnimationTick(object sender, EventArgs e)
        {
            _tickCount++;
            double t = _tickCount * 0.14;

            if (_shakeEnergy > 0) _shakeEnergy = Math.Max(0, _shakeEnergy - 4);

            // Auto-close pill if untouched
            if (_pillAutoCloseTick > 0 && _tickCount >= _pillAutoCloseTick && _drawerPanel.Visibility != Visibility.Visible)
            {
                TogglePillVisibility(false);
            }

            bool inReaction = _tickCount < _reactionUntilTick;

            // ====================================================================
            // TASKBAR WALKING PET SYSTEM
            // ====================================================================
            var wa = SystemParameters.WorkArea;
            double minLeft = wa.Left + 10;
            double maxLeft = Math.Max(minLeft + 30, wa.Right - Width - 10);

            if (_petWalkEnabled && !_isDraggingWindow && !_isThinking)
            {
                if (_isWalking)
                {
                    _walkPhaseTicks++;
                    _walkStepCycle += 0.28;

                    double currentSpeed = _isSinging ? 0.8 : _walkSpeed;
                    Left += _walkDirection * currentSpeed;

                    if (Left <= minLeft)
                    {
                        Left = minLeft;
                        _walkDirection = 1;
                        _isWalking = false;
                        _walkPhaseTicks = 0;
                        _idleDurationTicks = 65;
                        TriggerReaction("wink", "✦ PUTAR", "Udah di pojok kiri, jalan ke kanan lagi ya ;3", false);
                    }
                    else if (Left >= maxLeft)
                    {
                        Left = maxLeft;
                        _walkDirection = -1;
                        _isWalking = false;
                        _walkPhaseTicks = 0;
                        _idleDurationTicks = 65;
                        TriggerReaction("wink", "✦ PUTAR", "Udah di pojok kanan, jalan ke kiri lagi ya ;3", false);
                    }
                    else if (_walkPhaseTicks >= _walkDurationTicks)
                    {
                        _isWalking = false;
                        _walkPhaseTicks = 0;
                        _idleDurationTicks = 55 + (_tickCount % 65);
                    }
                }
                else
                {
                    _walkPhaseTicks++;
                    if (_walkPhaseTicks >= _idleDurationTicks)
                    {
                        _isWalking = true;
                        _walkPhaseTicks = 0;
                        _walkDurationTicks = 75 + (_tickCount % 100);
                        if ((_tickCount % 4) == 0)
                        {
                            _walkDirection = -_walkDirection;
                        }
                    }
                }
            }

            // Ensure feet sit directly on taskbar
            if (!_isDraggingWindow && _drawerPanel.Visibility != Visibility.Visible)
            {
                double targetTop = wa.Bottom - Height;
                if (Math.Abs(Top - targetTop) < 50)
                {
                    Top = targetTop;
                }
            }

            // Autonomous Idle Antics
            if (!inReaction && !_isSinging && !_isSpeaking && !_isThinking && (_tickCount % 260 == 0))
            {
                int idlePick = (_tickCount / 260) % 5;
                if (idlePick == 0)
                    TriggerReaction("wave", "👋 HAI!", "Masih semangat kan? Aku temenin di sini ya ♥", false);
                else if (idlePick == 1)
                    TriggerReaction("boba", "🧋 REHAT", "Slurp~ jangan lupa minum air biar segar ♪", false);
                else if (idlePick == 2)
                    TriggerReaction("dance", "🎵 LAGU", "Klik badanku kalau mau putar lagu ya!", false);
                else if (idlePick == 3)
                    TriggerReaction("wink", "✨ FOKUS", "Kerjaanmu keren banget, teruskan ya! ;3", false);
                else
                    TriggerReaction("headpat", "♥ ELUS", "Klik badanku untuk elus atau buka tombol ya~", false);
                inReaction = true;
            }

            // Cursor Eye-Tracking
            POINT pt;
            if (GetCursorPos(out pt))
            {
                try
                {
                    Point screenCenter = _robotCanvas.PointToScreen(new Point(80, 65));
                    double dx = pt.X - screenCenter.X;
                    double dy = pt.Y - screenCenter.Y;
                    double dist = Math.Sqrt(dx * dx + dy * dy);
                    double factor = Math.Tanh(dist / 160.0);
                    double angle = Math.Atan2(dy, dx);

                    _eyesGazeTransform.X = Math.Cos(angle) * factor * 6.0;
                    _eyesGazeTransform.Y = Math.Sin(angle) * factor * 4.0;
                    _leftPupilTransform.X = Math.Cos(angle) * factor * 3.2;
                    _leftPupilTransform.Y = Math.Sin(angle) * factor * 2.8;
                    _rightPupilTransform.X = _leftPupilTransform.X;
                    _rightPupilTransform.Y = _leftPupilTransform.Y;
                }
                catch { }
            }

            int blinkMod = _tickCount % 68;
            _isBlinking = (blinkMod == 0 || blinkMod == 1);

            _robotScaleTransform.ScaleX = (_walkDirection > 0 ? 1.0 : -1.0);
            _torsoBadgeText.RenderTransform = new ScaleTransform(_walkDirection > 0 ? 1.0 : -1.0, 1.0);
            _propSticker.RenderTransform = new ScaleTransform(_walkDirection > 0 ? 1.0 : -1.0, 1.0);

            if (inReaction)
            {
                if (_reactionKind == "headpat" || _reactionKind == "love")
                {
                    ShowSpecialEyes("^", "^", "#5CE8A0");
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "♥";
                    _floatingHearts.Foreground = HexBrush("#FF8BA7");
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "💖";
                    _torsoBadgeText.Text = "♥";
                    _antennaBulb.Fill = HexBrush("#FF8BA7");
                }
                else if (_reactionKind == "tickle")
                {
                    ShowSpecialEyes(">", "<", "#E8F47A");
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "★";
                    _floatingHearts.Foreground = HexBrush("#FFD166");
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "😆";
                    _torsoBadgeText.Text = "★";
                    _antennaBulb.Fill = HexBrush("#FFD166");
                }
                else if (_reactionKind == "boba" || _reactionKind == "star")
                {
                    ShowSpecialEyes("★", "★", "#FFD166");
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "⚡";
                    _floatingHearts.Foreground = HexBrush("#FFD166");
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "🧋";
                    _torsoBadgeText.Text = "⚡";
                    _antennaBulb.Fill = HexBrush("#FFD166");
                }
                else if (_reactionKind == "dizzy")
                {
                    ShowSpecialEyes("@", "@", "#FF8BA7");
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "🌀";
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "💫";
                    _torsoBadgeText.Text = "@";
                }
                else if (_reactionKind == "wink")
                {
                    ShowNormalEyes();
                    _leftEye.Height = 23;
                    _rightEye.Height = 4;
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "✨";
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "✨";
                }
                else if (_reactionKind == "sleepy")
                {
                    ShowNormalEyes();
                    _leftEye.Height = 6;
                    _rightEye.Height = 6;
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "Zzz";
                    _propSticker.Visibility = Visibility.Collapsed;
                }
                else
                {
                    ShowSpecialEyes("^", "^", "#E8F47A");
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = "♪";
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "👋";
                }

                _robotBobTransform.Y = -Math.Abs(Math.Sin(t * 2.6)) * 5.5;
                _robotTiltTransform.Angle = Math.Sin(t * 2.8) * (_reactionKind == "tickle" || _reactionKind == "dizzy" ? 7.5 : 4.5);
                _leftEarRotate.Angle = -14 + Math.Sin(t * 3.5) * 10;
                _rightEarRotate.Angle = 14 - Math.Sin(t * 3.5) * 10;
                _leftArmRotate.Angle = -35 + Math.Sin(t * 3.2) * 26;
                _rightArmRotate.Angle = 35 - Math.Sin(t * 3.2) * 26;
                _leftLegRotate.Angle = Math.Sin(t * 3.2) * 12;
                _rightLegRotate.Angle = -Math.Sin(t * 3.2) * 12;
                Canvas.SetTop(_propSticker, 90 + Math.Sin(t * 2.5) * 4);
            }
            else if (_petWalkEnabled && _isWalking && !_isDraggingWindow)
            {
                ShowNormalEyes();
                _leftEye.Height = _isBlinking ? 3 : 23;
                _rightEye.Height = _isBlinking ? 3 : 23;

                double stepSin = Math.Sin(_walkStepCycle);
                _leftLegRotate.Angle = stepSin * 24.0;
                _rightLegRotate.Angle = -stepSin * 24.0;
                _robotBobTransform.Y = -Math.Abs(stepSin) * 3.5;
                _robotTiltTransform.Angle = stepSin * 3.0;
                _leftArmRotate.Angle = -15 + stepSin * 18.0;
                _rightArmRotate.Angle = 15 - stepSin * 18.0;
                _leftEarRotate.Angle = -14 + stepSin * 5;
                _rightEarRotate.Angle = 14 - stepSin * 5;
                _antennaRotate.Angle = Math.Sin(_walkStepCycle * 0.9) * 7.0;

                if (_isSinging)
                {
                    _floatingHearts.Visibility = Visibility.Visible;
                    _floatingHearts.Text = (_tickCount / 10) % 2 == 0 ? "♪" : "♫";
                    _floatingHearts.Foreground = HexBrush("#E8F47A");
                    _propSticker.Visibility = Visibility.Visible;
                    _propSticker.Text = "🎤";
                    _torsoBadgeText.Text = "♪";
                }
                else
                {
                    _floatingHearts.Visibility = Visibility.Collapsed;
                    _propSticker.Visibility = Visibility.Collapsed;
                    _torsoBadgeText.Text = "♥";
                }
            }
            else if (_isSinging && !_isAudioPaused)
            {
                ShowNormalEyes();
                _leftEye.Height = _isBlinking ? 3 : 23;
                _rightEye.Height = _isBlinking ? 3 : 23;

                _robotBobTransform.Y = Math.Sin(t * 2.2) * 4.0;
                _robotTiltTransform.Angle = Math.Sin(t * 1.1) * 4.0;
                _leftEarRotate.Angle = -14 + Math.Sin(t * 2.2) * 8;
                _rightEarRotate.Angle = 14 - Math.Sin(t * 2.2) * 8;
                _leftArmRotate.Angle = -25 + Math.Sin(t * 2.2) * 18;
                _rightArmRotate.Angle = 25 - Math.Sin(t * 2.2) * 18;
                _leftLegRotate.Angle = Math.Sin(t * 2.2) * 10;
                _rightLegRotate.Angle = -Math.Sin(t * 2.2) * 10;

                _floatingHearts.Visibility = Visibility.Visible;
                _floatingHearts.Text = (_tickCount / 10) % 2 == 0 ? "♪" : "♫";
                _floatingHearts.Foreground = HexBrush("#E8F47A");
                _propSticker.Visibility = Visibility.Visible;
                _propSticker.Text = "🎤";
                _torsoBadgeText.Text = "♪";
                _antennaBulb.Fill = HexBrush((_tickCount / 8) % 2 == 0 ? "#5CE8A0" : "#E8F47A");
            }
            else
            {
                ShowNormalEyes();
                _leftEye.Height = _isBlinking ? 3 : 23;
                _rightEye.Height = _isBlinking ? 3 : 23;

                _robotBobTransform.Y = Math.Sin(t * 0.8) * 2.0;
                _robotTiltTransform.Angle = Math.Sin(t * 0.4) * 1.0;
                _leftEarRotate.Angle = -14 + Math.Sin(t * 0.7) * 2.5;
                _rightEarRotate.Angle = 14 - Math.Sin(t * 0.7) * 2.5;
                _leftArmRotate.Angle = -15 + Math.Sin(t * 0.8) * 5;
                _rightArmRotate.Angle = 15 - Math.Sin(t * 0.8) * 5;
                _leftLegRotate.Angle = 0;
                _rightLegRotate.Angle = 0;

                _floatingHearts.Visibility = Visibility.Collapsed;
                _propSticker.Visibility = Visibility.Collapsed;
                _torsoBadgeText.Text = "♥";
                _antennaBulb.Fill = HexBrush("#5CE8A0");
            }

            // Sync Karaoke Lyrics
            if (_isSinging && !_isAudioPaused)
            {
                double currentSec = 0;
                double totalSec = _estimatedDurationSec;
                try
                {
                    currentSec = _musicPlayer.Position.TotalSeconds;
                    if (_musicPlayer.NaturalDuration.HasTimeSpan)
                    {
                        totalSec = Math.Max(1, _musicPlayer.NaturalDuration.TimeSpan.TotalSeconds);
                        _songProgressSlider.Maximum = totalSec;
                    }
                }
                catch { }

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
                        if (_currentLyrics[i].TimeMs <= currentMs + 160)
                            activeIdx = i;
                        else
                            break;
                    }

                    if (activeIdx >= 0)
                    {
                        var line = _currentLyrics[activeIdx];
                        double nextTime = (activeIdx + 1 < _currentLyrics.Count)
                            ? _currentLyrics[activeIdx + 1].TimeMs
                            : line.TimeMs + 6000;
                        double endMs = line.EndMs > line.TimeMs ? line.EndMs : Math.Min(nextTime - 80, line.TimeMs + 6000);

                        if (currentMs <= endMs + 2200)
                        {
                            SetCloudBubble("🎤 " + _currentSongTitle, line.Text, true);
                        }
                        else if (activeIdx == _currentLyrics.Count - 1)
                        {
                            SetCloudBubble("🎵 " + _currentSongTitle, "Instrumental Outro ♪", true);
                        }

                        if (currentMs >= line.TimeMs && currentMs <= endMs)
                        {
                            _mouthOpen = (_tickCount / 2) % 2 == 0;
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
                        "Lagi jalan di atas taskbar nemenin kamu ♪",
                        "Semangat kerjanya ya! Klik badanku untuk menu~",
                        "Jangan lupa senyum dan minum air ya! ;3",
                        "Klik badanku kalau mau putar lagu full ♪"
                    };
                    SetCloudBubble("✦ REYA", idleLines[(_tickCount / 80) % idleLines.Length], false);
                }
            }

            // Mouth & Waveform Animation
            bool showActiveMouth = _isSpeaking || (_isSinging && !_isAudioPaused && _mouthOpen);
            bool showHappyLaughMouth = inReaction && (_reactionKind == "tickle" || _reactionKind == "boba" || _reactionKind == "headpat");

            _talkMouth.Visibility = showActiveMouth ? Visibility.Visible : Visibility.Collapsed;
            _happyOpenMouth.Visibility = (!showActiveMouth && showHappyLaughMouth) ? Visibility.Visible : Visibility.Collapsed;
            _catMouth.Visibility = (!showActiveMouth && !showHappyLaughMouth) ? Visibility.Visible : Visibility.Collapsed;

            double[] baseWave = { 4, 8, 12, 8, 4 };
            for (int i = 0; i < 5; i++)
            {
                if (showActiveMouth)
                {
                    double h = 3.0 + Math.Abs(Math.Sin((_tickCount * 0.45) + i * 1.1)) * 8;
                    _mouthBars[i].Height = h;
                }
                if ((_isSinging && !_isAudioPaused) || _isSpeaking)
                {
                    double wh = 3.5 + Math.Abs(Math.Sin((_tickCount * 0.4) + i * 0.9)) * 9;
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

        private void ShowSpecialEyes(string leftChar, string rightChar, string colorHex)
        {
            _leftEye.Visibility = Visibility.Collapsed;
            _rightEye.Visibility = Visibility.Collapsed;
            _leftSpecialEye.Text = leftChar;
            _rightSpecialEye.Text = rightChar;
            _leftSpecialEye.Foreground = HexBrush(colorHex);
            _rightSpecialEye.Foreground = HexBrush(colorHex);
            _leftSpecialEye.Visibility = Visibility.Visible;
            _rightSpecialEye.Visibility = Visibility.Visible;
        }

        private void ShowNormalEyes()
        {
            _leftSpecialEye.Visibility = Visibility.Collapsed;
            _rightSpecialEye.Visibility = Visibility.Collapsed;
            _leftEye.Visibility = Visibility.Visible;
            _rightEye.Visibility = Visibility.Visible;
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
                reply = "Aku siap nemenin kamu di atas taskbar! Kalau mau lagu, ketik aja judulnya ya ♪";
            }
            _statusMiniText.Text = "REYA: " + reply;
            TriggerReaction("love", "🗣️ REYA", reply, false);
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
                        string tempFile = System.IO.Path.Combine(
                            System.IO.Path.GetTempPath(),
                            "reya_tts_" + Guid.NewGuid().ToString("N") + ".mp3"
                        );
                        File.WriteAllBytes(tempFile, audioBytes);
                        _ttsPlayer.Open(new Uri(tempFile, UriKind.Absolute));
                        _ttsPlayer.Play();
                        return;
                    }
                }
            }
            catch { }

            _isSpeaking = false;
            _speechClearTick = _tickCount + 80;
        }

        private async Task PlayBitChordSongAsync(string query)
        {
            StopSong();
            _statusMiniText.Text = "Mencari \"" + query + "\"...";
            SetCloudBubble("🔍 CARI LAGU...", "Mencari \"" + query + "\" ♪", true);

            try
            {
                string url = BaseApiUrl + "/api/enchor?q=" + Uri.EscapeDataString(query);
                string json = await Http.GetStringAsync(url);

                int selIdx = json.IndexOf("\"selected\":", StringComparison.Ordinal);
                string selBlock = selIdx >= 0 ? json.Substring(selIdx) : json;

                string name = ExtractJsonString(selBlock, "name");
                string artist = ExtractJsonString(selBlock, "artist");
                string audioUrl = ExtractJsonString(selBlock, "audioUrl");
                string songLenStr = ExtractJsonNumber(selBlock, "songLengthMs");

                double songLenMs = 210000;
                if (!string.IsNullOrEmpty(songLenStr))
                {
                    double.TryParse(songLenStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out songLenMs);
                }
                _estimatedDurationSec = Math.Max(30, songLenMs / 1000.0);

                if (string.IsNullOrEmpty(audioUrl) || audioUrl.Contains(".opus"))
                {
                    var saavnMatch = Regex.Match(json, "https://aac\\.saavncdn\\.com/[^\"\\\\]+\\.mp4");
                    if (saavnMatch.Success)
                    {
                        audioUrl = saavnMatch.Value;
                    }
                }

                if (string.IsNullOrEmpty(name)) name = query;
                _currentSongTitle = string.IsNullOrEmpty(artist) ? name : (name + " · " + artist);
                _currentLyrics = ParseLyricsFromJson(selBlock);

                if (string.IsNullOrEmpty(audioUrl))
                {
                    _statusMiniText.Text = "Audio tidak ditemukan";
                    SetCloudBubble("✦ INFO LAGU", "Lagu belum tersedia, coba judul lain ya!", false);
                    return;
                }

                if (audioUrl.StartsWith("/"))
                {
                    audioUrl = BaseApiUrl + audioUrl;
                }

                _statusMiniText.Text = "Menyiapkan: " + _currentSongTitle + "...";
                SetCloudBubble("🎧 MENYIAPKAN...", _currentSongTitle + " ♪", true);

                string fastStreamUrl = audioUrl.Replace("_320.mp4", "_160.mp4");
                byte[] songBytes = null;
                try
                {
                    songBytes = await Http.GetByteArrayAsync(fastStreamUrl);
                }
                catch
                {
                    songBytes = null;
                }
                if (songBytes == null || songBytes.Length < 1000)
                {
                    try
                    {
                        songBytes = await Http.GetByteArrayAsync(audioUrl);
                    }
                    catch
                    {
                        songBytes = null;
                    }
                }

                if (songBytes == null || songBytes.Length == 0)
                {
                    _statusMiniText.Text = "Audio belum dapat diunduh";
                    SetCloudBubble("✦ KONEKSI SIBUK", "Coba klik judul lagunya lagi ya ♪", false);
                    return;
                }

                string ext = audioUrl.Contains(".mp3") ? ".mp3" : ".m4a";
                string localSongPath = System.IO.Path.Combine(
                    System.IO.Path.GetTempPath(),
                    "reya_song_" + Math.Abs(_currentSongTitle.GetHashCode()) + "_" + DateTime.Now.Ticks + ext
                );
                File.WriteAllBytes(localSongPath, songBytes);

                _songTitleMini.Text = "🎤 " + _currentSongTitle;
                _songProgressSlider.Maximum = _estimatedDurationSec;
                _songProgressSlider.Value = 0;
                _playerMiniRow.Visibility = Visibility.Visible;
                _pauseResumeBtn.Content = "⏸";
                _statusMiniText.Text = "Memutar: " + _currentSongTitle;

                _isSinging = true;
                _isAudioPaused = false;
                SetCloudBubble(
                    "🎤 " + _currentSongTitle,
                    _currentLyrics.Count > 0 ? _currentLyrics[0].Text : "♪ Bernyanyi lagu penuh... ♫",
                    true
                );

                _musicPlayer.Open(new Uri(localSongPath, UriKind.Absolute));
                _musicPlayer.Play();
            }
            catch (Exception ex)
            {
                _isSinging = false;
                _statusMiniText.Text = "Gagal: " + ex.Message;
                SetCloudBubble("✦ COBA LAGI", "Klik ulang judul lagunya ya ♪", false);
            }
        }

        private void TogglePauseSong()
        {
            if (!_isSinging) return;
            try
            {
                if (!_isAudioPaused)
                {
                    _musicPlayer.Pause();
                    _isAudioPaused = true;
                    _pauseResumeBtn.Content = "▶";
                    _mouthOpen = false;
                }
                else
                {
                    _musicPlayer.Play();
                    _isAudioPaused = false;
                    _pauseResumeBtn.Content = "⏸";
                }
            }
            catch { }
        }

        private void StopSong()
        {
            try
            {
                _musicPlayer.Stop();
            }
            catch { }
            _isSinging = false;
            _isAudioPaused = false;
            _mouthOpen = false;
            if (_playerMiniRow != null)
            {
                _playerMiniRow.Visibility = Visibility.Collapsed;
            }
            SetCloudBubble("✦ REYA", "Semangat kerjanya ya! Aku temenin di sini ♥", false);
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

        private static string ExtractJsonNumber(string json, string key)
        {
            var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*([0-9.]+)");
            if (!m.Success) return "";
            return m.Groups[1].Value;
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
                        EndMs = eMs > tMs ? eMs : tMs + 3600,
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
