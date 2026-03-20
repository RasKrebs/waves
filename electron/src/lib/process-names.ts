/**
 * Maps macOS bundle IDs to friendly display names.
 * waves-audio returns bundle IDs like "com.spotify.client" — this makes them human-readable.
 */

const BUNDLE_ID_MAP: Record<string, string> = {
  // Browsers
  "com.google.Chrome": "Google Chrome",
  "com.google.Chrome.helper": "Google Chrome",
  "com.google.Chrome.helper (Renderer)": "Google Chrome",
  "com.google.Chrome.helper (GPU)": "Google Chrome",
  "org.mozilla.firefox": "Firefox",
  "org.mozilla.firefox.helper": "Firefox",
  "com.apple.Safari": "Safari",
  "com.apple.WebKit.WebContent": "Safari",
  "com.microsoft.edgemac": "Microsoft Edge",
  "com.microsoft.edgemac.helper": "Microsoft Edge",
  "com.brave.Browser": "Brave",
  "com.brave.Browser.helper": "Brave",
  "company.thebrowser.Browser": "Arc",
  "company.thebrowser.Browser.helper": "Arc",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "com.operasoftware.Opera": "Opera",

  // Communication
  "com.microsoft.teams2": "Microsoft Teams",
  "com.microsoft.teams": "Microsoft Teams",
  "us.zoom.xos": "Zoom",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.slack.Slack": "Slack",
  "com.hnc.Discord": "Discord",
  "com.skype.skype": "Skype",
  "com.webex.meetingmanager": "Webex",
  "com.google.meet": "Google Meet",
  "com.facetime": "FaceTime",
  "com.apple.FaceTime": "FaceTime",

  // Music & Media
  "com.spotify.client": "Spotify",
  "com.spotify.client.helper": "Spotify",
  "com.apple.Music": "Apple Music",
  "com.apple.iTunes": "iTunes",
  "com.apple.podcasts": "Apple Podcasts",
  "com.apple.QuickTimePlayerX": "QuickTime",
  "org.videolan.vlc": "VLC",
  "io.mpv": "mpv",
  "com.colliderli.iina": "IINA",
  "com.amazon.music": "Amazon Music",
  "com.tidal.desktop": "Tidal",
  "tv.plex.player": "Plex",
  "com.netflix": "Netflix",
  "com.apple.TV": "Apple TV",

  // Productivity
  "com.apple.Preview": "Preview",
  "com.apple.finder": "Finder",
  "com.apple.Notes": "Notes",
  "com.apple.reminders": "Reminders",
  "com.apple.mail": "Mail",
  "com.apple.iCal": "Calendar",
  "com.notion.id": "Notion",
  "md.obsidian": "Obsidian",

  // Dev tools
  "com.microsoft.VSCode": "VS Code",
  "com.microsoft.VSCode.helper": "VS Code",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "dev.warp.Warp-Stable": "Warp",
  "com.googlecode.iterm2": "iTerm",
  "com.apple.Terminal": "Terminal",

  // System
  "com.apple.systempreferences": "System Settings",
  "com.apple.VoiceMemos": "Voice Memos",
}

/**
 * Resolve a bundle ID or process name to a friendly display name.
 * Falls back to extracting a readable name from the bundle ID pattern,
 * or returns the original string if nothing matches.
 */
export function getProcessDisplayName(bundleId: string): string {
  // Direct match
  if (BUNDLE_ID_MAP[bundleId]) return BUNDLE_ID_MAP[bundleId]

  // Try stripping common helper suffixes
  const base = bundleId.replace(/\.helper.*$/i, "")
  if (BUNDLE_ID_MAP[base]) return BUNDLE_ID_MAP[base]

  // Reverse-DNS heuristic: take the last segment and capitalize
  // e.g. "com.example.MyApp" → "MyApp"
  const parts = bundleId.split(".")
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]
    // Skip generic segments like "helper", "agent", "xpc"
    const generic = new Set(["helper", "agent", "xpc", "service", "daemon"])
    const candidate = generic.has(last.toLowerCase()) && parts.length > 3
      ? parts[parts.length - 2]
      : last
    // Insert spaces before capitals: "QuickTime" → "Quick Time" — only if mixed case
    if (candidate !== candidate.toLowerCase() && candidate !== candidate.toUpperCase()) {
      return candidate.replace(/([a-z])([A-Z])/g, "$1 $2")
    }
    return candidate
  }

  return bundleId
}
