---
name: VaultSpace
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#434654'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#747686'
  outline-variant: '#c4c5d7'
  surface-tint: '#2153d5'
  primary: '#0038a9'
  on-primary: '#ffffff'
  primary-container: '#1b4fd2'
  on-primary-container: '#c8d2ff'
  inverse-primary: '#b6c4ff'
  secondary: '#006591'
  on-secondary: '#ffffff'
  secondary-container: '#39b8fd'
  on-secondary-container: '#004666'
  tertiary: '#732f00'
  on-tertiary: '#ffffff'
  tertiary-container: '#984100'
  on-tertiary-container: '#ffc8ac'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b6c4ff'
  on-primary-fixed: '#00164f'
  on-primary-fixed-variant: '#003bb0'
  secondary-fixed: '#c9e6ff'
  secondary-fixed-dim: '#89ceff'
  on-secondary-fixed: '#001e2f'
  on-secondary-fixed-variant: '#004c6e'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783200'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Manrope
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Manrope
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2.5rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system reimagines the self-storage customer experience by moving away from industrial, windowless warehouse tropes toward an architectural, urban, and human-centric service environment. The visual atmosphere balances industrial reliability with hospitality-grade warmth: secure without feeling carceral, modern without feeling sterile, and deeply approachable.

The aesthetic fuses contemporary corporate modernism with high-touch editorial clarity. Interfaces feature crisp multi-paneled layouts, generous whitespace, subtle geometric space-grid accents referencing architectural blueprints, and tactile card surfaces. Primary interactions convey absolute confidence and security through structured geometry, while rounded containers and warm accents ease the stress inherent to moving and life transitions.

## Colors

The palette establishes an immediate atmosphere of institutional safety and welcoming clarity:

- **Primary (`#1B4FD2`)**: A bold, deep cobalt blue embodying architectural integrity, modern security, and operational clarity. Used for definitive primary calls-to-action, navigation anchors, key interactive states, and active selection perimeters.
- **Secondary (`#0EA5E9`)**: An airy, technical sky-cyan used for secondary button fills, soft category badging, interactive hover washes, and atmospheric background fills (via lighter tints like `#E0F2FE` and `#F0F9FF`).
- **Tertiary (`#F97316`)**: A vibrant, warm coral-orange reserved strictly for directional focus: high-value pricing callouts, availability pings ("Only 2 units left"), promotional discount badges, and key selected micro-states. It must never compete with primary actions.
- **Neutral Dark (`#0F172A` & `#1E293B`)**: Rich slate navy replacing stark carbon blacks. It delivers premium contrast while maintaining a subtle chromatic connection to the cobalt foundation.
- **Neutral Surfaces (`#FFFFFF`, `#F8FAFC`, `#F0F9FF`)**: Layered base surfaces transitioning from pure white elevation planes to pale cool stone and faint cyan-tinted atmospheric backdrops.

## Typography

The typographic hierarchy pairs the geometric friendliness and structural stability of **Plus Jakarta Sans** for headers with the clarity and humanist proportions of **Manrope** for body and data-dense information layouts.

- **Headings**: Displayed in sentence case. The tightening of negative tracking in large display sizes prevents titles from loosening on wide desktop screens, maintaining an architectural, editorial posture.
- **Body Text**: Manrope provides even vertical rhythm and open counters, ensuring high legibility for unit specifications, lease terms, and facility access guides.
- **Labels & Microcopy**: Medium and small labels employ elevated weights (`600` and `700`) with subtle positive tracking for glanceable unit tags, dimension specs, status chips, and spatial indicators.

## Layout & Spacing

This design system uses an adaptive 12-column layout on desktop (max width: 1280px) and tablet, transitioning to a single-column 4-column flow on mobile. Layout rhythm adheres to a strict 8pt base grid unit (`0.5rem`), scaling up to `2.5rem` for major section block divisions.

- **Desktop (1024px+)**: 12 columns with 24px (`1.5rem`) gutters and minimum 40px (`2.5rem`) margin offsets. Unit browsing filters dock to a sticky 3-column configuration, leaving 9 columns for unit discovery and visual capacity maps.
- **Tablet (768px - 1023px)**: 8 columns with 20px gutters and 32px margins. Filter sidebars collapse into a floating action sheet.
- **Mobile (<768px)**: 4 columns with 16px (`1rem`) gutters and 20px (`1.25rem`) safe margin padding. Size calculators and visual fit guides shift from multi-unit comparative horizontal cards to full-width vertically stacked modular cards.

## Elevation & Depth

Visual depth is achieved through quiet, atmospheric ambient shadows combined with calibrated low-contrast outlines. Deep dropshadows are avoided in favor of crisp boundary delineation and diffuse navy-tinted ambient lifts:

- **Flat/Canvas**: `#F8FAFC` base page backdrop, bordered by `#E2E8F0` hairline dividers.
- **Resting Layer (Surface Cards)**: `#FFFFFF` background with a crisp border (`1px solid #E2E8F0` or `#E0F2FE`) and an ultra-diffused shadow: `0 2px 8px -2px rgba(15, 23, 42, 0.04), 0 1px 3px -1px rgba(15, 23, 42, 0.02)`.
- **Raised Interactive Layer (Cards on Hover / Active Units)**: Subtle blue-tinted elevation: `0 12px 24px -6px rgba(27, 79, 210, 0.08), 0 4px 8px -2px rgba(15, 23, 42, 0.03)` with a border shift to `#BAE6FD`.
- **Floating Overlays & Menus**: Crisp white background, `1px solid rgba(226, 232, 240, 0.8)`, with an expanded ambient lift: `0 20px 32px -8px rgba(15, 23, 42, 0.12)`.

## Shapes

The interface expresses a modern, welcoming tactile identity using balanced rounding across all structural components:

- **Base Radius (`rounded-md` / 8px - 10px)**: Applied to input fields, unit spec chips, and utility badges.
- **Component Radius (`rounded-lg` / 12px)**: The standard anchor radius across all primary buttons, interactive controls, and nested sub-panels.
- **Container Radius (`rounded-xl` / 16px - 20px)**: Assigned to primary unit cards, booking summary sidebars, modal dialogs, and facility access panels.
- **Interactive Pill (`rounded-full`)**: Applied strictly to status dots, active step rings, and circular utility buttons.

## Components

### Buttons
- **Primary**: Background `#1B4FD2`, text `#FFFFFF`, rounded 12px (`rounded-lg`), bold font weight (`600`). On hover: background `#1E40AF` with a subtle 2px Y-translation. Active state: `#1E3A8A`.
- **Secondary**: Soft cyan tint background `#F0F9FF`, text `#0369A1`, border `1px solid #BAE6FD`. On hover: background `#E0F2FE`, border color `#38BDF8`.
- **Tertiary / Utility**: Ghost surface with `#1E293B` text and `#E2E8F0` border. For small inline actions, comparisons, and auxiliary modal triggers.

### Unit Cards & Containers
- Clean white card face (`#FFFFFF`) with a 16px corner radius (`rounded-xl`), bordered by `1px solid #F1F5F9`.
- Structural content segmentation: Top row features unit dimensions (e.g., "10' × 10' • 100 sq ft") paired with a climate-control badge; middle section highlights visual fit capability (e.g., "Fits 2-bedroom home"); bottom row pins coral-accented pricing (`#F97316`) on the left and a cobalt "Hold Unit" button on the right.

### Visual Size Finder & Interactive Grid
- An interactive spatial tool utilizing a blueprint-inspired dotted grid background (`#E2E8F0` dots on `#F8FAFC`).
- 2D/3D modular unit wireframes demonstrate volume dynamically when dragging sliders (5x5, 10x10, 10x20).
- Selected size nodes render in `#1B4FD2` outline with `#E0F2FE` soft volume shading.

### Form Inputs & Location Search
- Background `#FFFFFF`, height 48px, radius 10px, border `1.5px solid #E2E8F0`, placeholder text `#94A3B8`.
- Focus state activates an immediate `#1B4FD2` boundary stroke paired with a soft 3px box-glow ring in `rgba(14, 165, 233, 0.20)`.

### Badges & Chips
- **Climate Controlled / Drive-Up Access**: Pill badge with `#F0F9FF` background, `#0284C7` text, and `#BAE6FD` border.
- **Urgency / Promotion**: Soft coral background `rgba(249, 115, 22, 0.10)`, text `#C2410C`, font weight `700`.

### Checkboxes & Segmented Toggles
- Custom 20px rounded squares (`rounded-md` / 6px) with 1.5px border `#CBD5E1`.
- Checked state transitions immediately to `#1B4FD2` fill with a sharp white checkmark.