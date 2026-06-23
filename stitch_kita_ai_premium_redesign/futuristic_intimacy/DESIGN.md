---
name: Futuristic Intimacy
colors:
  surface: '#12121f'
  surface-dim: '#12121f'
  surface-bright: '#383846'
  surface-container-lowest: '#0d0d1a'
  surface-container-low: '#1a1a28'
  surface-container: '#1e1e2c'
  surface-container-high: '#292937'
  surface-container-highest: '#343342'
  on-surface: '#e3e0f3'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#e3e0f3'
  inverse-on-surface: '#2f2f3d'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#ddb7ff'
  on-secondary: '#490080'
  secondary-container: '#6f00be'
  on-secondary-container: '#d6a9ff'
  tertiary: '#ffb783'
  on-tertiary: '#4f2500'
  tertiary-container: '#d97721'
  on-tertiary-container: '#452000'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#703700'
  background: '#12121f'
  on-background: '#e3e0f3'
  surface-variant: '#343342'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar-width: 220px
  container-max: 1440px
  gutter: 1.5rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 2rem
---

## Brand & Style
The design system centers on a "Futuristic Intimacy" narrative, bridging the gap between advanced artificial intelligence and human connection. It targets a sophisticated audience seeking a premium, focused communication environment. 

The aesthetic is a hybrid of **Modern Corporate** and **Glassmorphism**, emphasizing high-clarity layouts with depth created through translucent layers and luminous accents. The UI should evoke a sense of calm, precision, and intelligence. Transitions must be fluid and eased, avoiding abrupt state changes to maintain the premium feel.

## Colors
The palette is dominated by deep space indigos and vibrant violet accents. 

- **Primary & Accent:** The core identity is driven by `#6366f1` (Indigo). Use this for primary actions, active states, and focus indicators.
- **Surface Hierarchy:** In dark mode, use `#0a0a12` for the base canvas and `#12121f` for elevated cards and sidebars. In light mode, transition to a clean `#f5f5ff` base with pure white surfaces.
- **Gradients:** Primary buttons and high-priority AI elements should utilize a linear gradient from `#6366f1` to `#a855f7` at a 135-degree angle.
- **Scrollbars:** Use a custom 6px width scrollbar with a `#6366f1` thumb and transparent track.

## Typography
This design system utilizes **Inter** exclusively to ensure maximum legibility and a systematic, technical feel. 

- **Hierarchy:** Use `display-lg` for welcome screens and `headline-lg` for chat headers. 
- **Readability:** Body copy uses `body-lg` for actual chat messages to reduce eye strain, while metadata (timestamps, status) uses `body-sm`.
- **Labels:** Use `label-caps` for sidebar category headers and small interactive UI hints.

## Layout & Spacing
The layout follows a **Fixed-Fluid** hybrid model. 

- **Sidebar:** A fixed 220px vertical navigation bar anchors the left side. It uses a slightly darker shade than the main surface to provide structural grounding.
- **Chat Canvas:** The main content area is fluid, with a maximum content width of 1000px for the chat thread to maintain optimal line length.
- **Grid:** Use an 8px base grid for all internal component spacing and a 12-column grid for dashboard views.
- **Mobile:** On mobile devices, the sidebar collapses into a bottom navigation bar or a hamburger drawer, and horizontal margins reduce from 24px to 16px.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and **Subtle Outlines** rather than heavy shadows.

- **Level 0 (Base):** Background color.
- **Level 1 (Surface):** Sidebar and cards. Use a 1px border with 10% white (dark mode) or 10% black (light mode) to define edges.
- **Level 2 (Popups/Modals):** Apply a backdrop-filter (blur: 12px) and a subtle 20% opacity shadow of the primary accent color to create a "glow" effect.
- **AI Presence:** AI-generated content blocks should have a very faint inner glow (0px 0px 15px) using the accent color at 5% opacity to differentiate them from human messages.

## Shapes
The shape language is modern and approachable. 

- **Standard Elements:** Buttons, input fields, and cards use the `rounded` (0.5rem) setting.
- **Chat Bubbles:** These use a hybrid approach; three corners are rounded at 1rem, while the corner nearest the avatar is sharp (2px) to indicate the speaker.
- **Avatars:** Circular (pill-shaped) to provide a soft contrast to the geometric grid.

## Components

- **Buttons:** 
  - *Primary:* Gradient background (#6366f1 to #a855f7), white text, 0.5rem radius. On hover, increase brightness by 10%. On press, scale 0.98x.
  - *Ghost:* Transparent background, 1px border, accent text.
- **Chat Bubbles:**
  - *User (Right):* Primary color (#6366f1) background, white text. 
  - *Contact (Left):* Surface color (#12121f) with a #a855f7 subtle border.
  - *AI (Left):* Deepest neutral background with a subtle "shimmer" animation on the border.
- **Side Nav:** Active state uses a full #6366f1 background with a white icon. Inactive states use 60% opacity text.
- **Form Inputs:** 
  - Focus state: 1px solid #6366f1 with a 4px outer glow of the same color at 20% opacity.
  - Dropdowns: Use the blur effect defined in Elevation & Depth.
- **Feedback:** 
  - Popups should slide in from the top-center. 
  - Status dots (Online/Offline) use a 2px white ring around them to pop against any background.
- **Cards:** Minimalist layout, no shadow, 1px surface-stroke, 1rem padding.