// active-win v7 is CommonJS compatible. v8+ is ESM-only.
import activeWin from 'active-win'

const MEETING_APPS: Record<string, string> = {
  'com.microsoft.teams':       'Microsoft Teams',
  'com.microsoft.teams2':      'Microsoft Teams',
  'us.zoom.xos':               'Zoom',
  'com.cisco.webex.meetings':  'Webex',
  'com.loom.desktop':          'Loom',
  'com.slack.Slack':           'Slack',
  'com.apple.FaceTime':        'FaceTime',
  'com.discord.Discord':       'Discord',
}

const MEETING_TITLE_PATTERNS = [
  /meeting/i,
  /call in progress/i,
  /you('re| are) (in a|on a) (call|meeting)/i,
  /presenting/i,
  /meet\.google\.com/i,
  /zoom meeting/i,
  /on a video call/i,
]

const TITLE_BASED_APPS = new Set(['com.google.Chrome', 'org.mozilla.firefox', 'company.thebrowser.Browser'])

export class MeetingDetector {
  private onStarted: (appName: string) => void
  private onEnded: () => void
  private interval: ReturnType<typeof setInterval> | null = null
  private activeMeeting: string | null = null

  constructor(onStarted: (appName: string) => void, onEnded: () => void) {
    this.onStarted = onStarted
    this.onEnded = onEnded
  }

  start() {
    this.poll()
    this.interval = setInterval(() => this.poll(), 4000)
  }

  stop() {
    if (this.interval) clearInterval(this.interval)
  }

  private async poll() {
    try {
      const win = await activeWin()
      if (!win) return

      const detected = this.checkWindow(win)

      if (detected && !this.activeMeeting) {
        this.activeMeeting = detected
        this.onStarted(detected)
      } else if (!detected && this.activeMeeting) {
        this.activeMeeting = null
        this.onEnded()
      }
    } catch {
      // active-win may fail before permissions are granted
    }
  }

  private checkWindow(win: activeWin.Result): string | null {
    const bundleId = (win.owner as any)?.bundleId ?? ''
    const title = win.title ?? ''

    if (MEETING_APPS[bundleId]) {
      return MEETING_APPS[bundleId]
    }

    if (TITLE_BASED_APPS.has(bundleId)) {
      for (const pattern of MEETING_TITLE_PATTERNS) {
        if (pattern.test(title)) {
          return 'Google Meet'
        }
      }
    }

    return null
  }
}
