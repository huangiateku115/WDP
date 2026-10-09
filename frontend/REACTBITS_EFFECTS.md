# React Bits motion layer

Public pages now use a small React Bits-style motion layer in `src/components/reactbits/`:
- FadeContent: scroll-triggered reveal
- SpotlightCard: pointer spotlight on cards
- ShinyText: animated highlight text
- Magnet: magnetic CTA interaction
- ClickSpark: global click spark feedback
- ScrollProgress: global page scroll progress
- CountUp: reusable animated number component

The effects use the existing green/orange VaultSpace palette and include `prefers-reduced-motion` fallbacks.
