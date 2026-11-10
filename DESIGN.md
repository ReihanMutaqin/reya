# DESIGN.md: REYA Tactile Studio Hardware

## Identity & Character
- **Product**: REYA (Robot AI Lokal Indonesia & Gesture Synth Console)
- **Visual Language**: Tactile Studio Hardware (inspired by Braun industrial design and Teenage Engineering audio instruments).
- **Personality**: Physical, articulate, warm, engineered, responsive. Treats voice synthesis (Voicebox), camera hand-tracking, and pentatonic synthesis as real hardware modules mounted on a single desk console.

## Design Read & Dials
> Reading this as: Interactive AI voice companion and gesture-controlled synthesizer workstation for Indonesian users, in a Tactile Studio Hardware (Braun / Teenage Engineering) visual language, dial ENERGY 2 / RHYTHM 3 / MOTION 2.

- `Dial: ENERGY 2 / RHYTHM 3 / MOTION 2`
- **ENERGY 2 (Balanced)**: Clear physical module boundaries, high-contrast status indicators, bold typographic hierarchy without decorative gradients or floating glass.
- **RHYTHM 3 (Varied)**: Sections vary deliberately by function:
  1. Top Console Header (hardware unit ID, Gemini Flash & Voicebox telemetry strip, physical theme toggle, hands-free mic toggle, studio voice config).
  2. Primary Split Console: Left module (`MOD-01`) houses the Robot Audio-Visual CRT Unit, Mood Selector, and Live Dialog Console; Right module (`MOD-02`) houses the Optical Hand-Tracking Viewfinder & Gesture Telemetry.
  3. Full-Width Polyphonic Gesture Synth Deck (`MOD-03`): Horizontal instrument bank selector, 2D X/Y frequency-brightness matrix (playable by hand gesture AND mouse/touch), and hardware reference panel.
- **MOTION 2 (Functional transitions)**: Mechanical switch states, real-time audio equalizer bars when speaking/listening, and 60fps hand landmark tracking. Zero endless decorative floating loops on containers.

## Color Palette (2 Core Neutrals + 1 Primary Accent + 1 Functional Signal)
All pairings verified with `contrast-check.py` against WCAG AA (4.5:1 normal text, 3:1 large text and UI boundaries).

### Light Mode: Paper Chassis (Default)
- **Chassis Base (`--bg-chassis`)**: `#F4F1EA` (Warm anodized paper-aluminum)
- **Module Surface (`--bg-module`)**: `#FFFFFF` (Clean module face)
- **Recessed Well (`--bg-well`)**: `#E6E1D6` (Inset control well)
- **Primary Ink (`--ink`)**: `#161817` (Contrast on `#F4F1EA`: 15.82:1, on `#FFFFFF`: 17.9:1)
- **Secondary Ink (`--ink-muted`)**: `#4A504D` (Contrast on `#F4F1EA`: 7.31:1, on `#E6E1D6`: 6.33:1)
- **Structural Border (`--border-strong`)**: `#737A76` (Contrast on `#F4F1EA`: 3.7:1, meets 3:1 non-text contrast)
- **Subtle Divider (`--border-subtle`)**: `#C7C1B4`
- **Primary Accent (`--accent`)**: `#B83312` (Braun Signal Vermilion; `#FFFFFF` on `#B83312` is 5.97:1, `#B83312` on `#F4F1EA` is 5.29:1, `#B83312` on `#E6E1D6` is 4.58:1)
- **Functional Active Signal (`--signal-green`)**: `#0E623D` (Hardware LED Green; `#FFFFFF` on `#0E623D` is 7.41:1, `#0E623D` on `#E6E1D6` is 5.68:1)

### Dark Mode: Night Studio
- **Chassis Base (`--bg-chassis`)**: `#121413`
- **Module Surface (`--bg-module`)**: `#1B1E1C`
- **Recessed Well (`--bg-well`)**: `#252A27`
- **Primary Ink (`--ink`)**: `#F2EFE9` (Contrast on `#1B1E1C`: 14.65:1)
- **Secondary Ink (`--ink-muted`)**: `#A9B0AC` (Contrast on `#1B1E1C`: 7.60:1, on `#252A27`: 6.60:1)
- **Structural Border (`--border-strong`)**: `#6C7570` (Contrast on `#1B1E1C`: 3.5:1)
- **Subtle Divider (`--border-subtle`)**: `#323835`
- **Primary Accent (`--accent`)**: `#FF6B45` (`#121413` on `#FF6B45` is 6.55:1, `#FF6B45` on `#1B1E1C` is 5.88:1)
- **Functional Active Signal (`--signal-green`)**: `#3CE095` (`#121413` on `#3CE095` is 10.82:1, `#3CE095` on `#1B1E1C` is 9.71:1)

## Written Reasons for Every Major Visual Decision (R-31)
1. **Color Palette**: Warm paper-aluminum (`#F4F1EA`) and dark studio carbon (`#121413`) with Braun vermilion (`#B83312`) and LED green (`#0E623D`) distinguish physical module hierarchy and real-time active hardware states.
2. **Layout**: A 3-module hardware console (`MOD-01` Dialog & Voice, `MOD-02` Optical Sensor, `MOD-03` 2D Synth Deck) groups voice interaction, camera tracking, and musical synthesis by their operational workflow.
3. **Typography**: `'Plus Jakarta Sans'` provides high-legibility Indonesian conversational copy while `'JetBrains Mono'` isolates numeric telemetry (Hz, confidence %, port numbers, musical pitches).
4. **Border Radius**: Stepped radii (`16px` outer module chassis, `10px` inset display wells, `8px` mechanical buttons) visually separate housing from interactive controls.
5. **Shadows**: Crisp bottom-edge shadows (`0 2px 0 var(--border-strong)`) on buttons indicate physical press travel rather than floating decoration.
6. **Pitch Field Gradient**: The subtle vertical tint inside the synth matrix maps high-frequency treble at the top to low-frequency bass at the bottom for spatial hand orientation.
7. **Custom SVG Icons**: Geometric technical SVGs directly depict audio waveforms, camera aperture, microphone capsule, and synth oscillators without generic AI emoji.
