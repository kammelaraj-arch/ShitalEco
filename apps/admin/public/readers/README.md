# Reader provider images

Admin → Terminal Devices and Admin → Devices render a provider illustration in the onboarding wizards. By default an inline SVG is drawn (no network dependency, license-clean).

If you want a nicer-looking product photo:

1. Drop a PNG (square, 240 × 240 or bigger, transparent background preferred) at one of these paths:
   - `/readers/stripe_terminal.png`
   - `/readers/sumup.png`
   - `/readers/clover.png`
   - `/readers/square.png`
   - `/readers/cash.png`
2. Keep the filename exactly as above — the component does a direct lookup.
3. Hard-refresh the admin UI; the component uses the PNG whenever the file is present and falls back to the SVG on a 404.

No code change required.
