/**
 * Meeting Detection — polls ListProcesses to detect known meeting apps
 * producing audio, and emits events so Electron can prompt the user.
 */

import { DaemonClient, AudioProcess } from './daemon.cjs'

export interface DetectedMeeting {
  pid: number
  bundleId: string
  appName: string
  detectedAt: number
}

// Bundle IDs for apps that are always meetings (native clients)
const MEETING_APP_BUNDLES = new Set([
  'us.zoom.xos',
  'com.microsoft.teams2',
  'com.microsoft.teams',
  'com.tinyspeck.slackmacgap',
  'com.slack.Slack',
  'com.hnc.Discord',
  'com.skype.skype',
  'com.webex.meetingmanager',
  'com.apple.FaceTime',
  'com.facetime',
])

// Friendly names for display
const APP_NAMES: Record<string, string> = {
  'us.zoom.xos': 'Zoom',
  'com.microsoft.teams2': 'Microsoft Teams',
  'com.microsoft.teams': 'Microsoft Teams',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.slack.Slack': 'Slack',
  'com.hnc.Discord': 'Discord',
  'com.skype.skype': 'Skype',
  'com.webex.meetingmanager': 'Webex',
  'com.apple.FaceTime': 'FaceTime',
  'com.facetime': 'FaceTime',
}

type MeetingCallback = (meeting: DetectedMeeting) => void
type MeetingEndedCallback = (meeting: DetectedMeeting) => void

export class MeetingDetector {
  private client: DaemonClient
  private timer: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs: number
  private enabled = true

  // Currently detected meeting (only track one at a time)
  private activeMeeting: DetectedMeeting | null = null
  // PIDs that the user has dismissed (don't re-prompt)
  private dismissedPids = new Set<number>()
  // Whether we're currently recording (don't prompt during recording)
  private isRecording = false

  private onDetected: MeetingCallback | null = null
  private onEnded: MeetingEndedCallback | null = null

  constructor(client: DaemonClient, pollIntervalMs = 8000) {
    this.client = client
    this.pollIntervalMs = pollIntervalMs
  }

  setCallbacks(onDetected: MeetingCallback, onEnded: MeetingEndedCallback) {
    this.onDetected = onDetected
    this.onEnded = onEnded
  }

  setRecording(recording: boolean) {
    this.isRecording = recording
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) this.stop()
    else if (!this.timer) this.start()
  }

  dismiss(pid: number) {
    this.dismissedPids.add(pid)
    if (this.activeMeeting?.pid === pid) {
      this.activeMeeting = null
    }
  }

  getActiveMeeting(): DetectedMeeting | null {
    return this.activeMeeting
  }

  start() {
    if (this.timer) return
    // Initial poll after a short delay
    setTimeout(() => this.poll(), 2000)
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll() {
    if (!this.enabled || this.isRecording) return

    try {
      const res = await this.client.listProcesses()
      const processes = res.Processes ?? []
      this.checkForMeetings(processes)
    } catch {
      // Daemon not ready — ignore
    }
  }

  private checkForMeetings(processes: AudioProcess[]) {
    // Find meeting apps that are actively producing audio
    const activeMeetingProcesses = processes.filter(
      (p) => p.Active && this.isMeetingApp(p.Name) && !this.dismissedPids.has(p.PID)
    )

    if (activeMeetingProcesses.length > 0) {
      const proc = activeMeetingProcesses[0]

      // Already tracking this meeting
      if (this.activeMeeting?.pid === proc.PID) return

      const meeting: DetectedMeeting = {
        pid: proc.PID,
        bundleId: proc.Name,
        appName: APP_NAMES[proc.Name] || this.extractAppName(proc.Name),
        detectedAt: Date.now(),
      }

      this.activeMeeting = meeting
      this.onDetected?.(meeting)
    } else if (this.activeMeeting) {
      // Meeting app stopped producing audio
      const ended = this.activeMeeting
      this.activeMeeting = null
      this.onEnded?.(ended)
    }
  }

  private isMeetingApp(bundleId: string): boolean {
    if (MEETING_APP_BUNDLES.has(bundleId)) return true
    // Check helper processes (e.g., "com.microsoft.teams2.helper")
    const base = bundleId.replace(/\.helper.*$/i, '')
    return MEETING_APP_BUNDLES.has(base)
  }

  private extractAppName(bundleId: string): string {
    const parts = bundleId.split('.')
    if (parts.length >= 3) {
      return parts[parts.length - 1].replace(/([a-z])([A-Z])/g, '$1 $2')
    }
    return bundleId
  }

  /** Reset dismissed PIDs (e.g., on a new day or after long idle) */
  resetDismissed() {
    this.dismissedPids.clear()
  }
}
