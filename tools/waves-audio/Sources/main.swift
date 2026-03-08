import Foundation
import AudioToolbox

// MARK: - Usage

func printUsage() {
    let usage = """
    waves-audio - Audio capture tool for Waves

    Streams PCM16 mono 16kHz audio to stdout.

    USAGE:
      waves-audio list                     List processes with active audio
      waves-audio tap <pid>                Capture audio from a process (macOS 14.4+)
      waves-audio mic [--device <uid>]     Capture from microphone/input device
      waves-audio devices                  List audio input devices

    EXAMPLES:
      waves-audio list
      waves-audio tap 1234                 Capture from PID 1234
      waves-audio tap 1234 | whisper-cli -m model.bin -f -
      waves-audio mic                      Use system default mic
      waves-audio mic --device BlackHole2ch_UID

    Output is raw PCM16 signed little-endian, mono, 16000 Hz.
    All status/error messages go to stderr; only audio data goes to stdout.
    """
    fputs(usage + "\n", stderr)
}

// MARK: - List Processes

func listProcesses() throws {
    let objectIDs = try AudioObjectID.readProcessList()

    struct ProcessInfo {
        let pid: pid_t
        let bundleID: String
        let active: Bool
    }

    var processes = [ProcessInfo]()
    for objectID in objectIDs {
        guard let pid = try? objectID.readProcessPID(), pid > 0 else { continue }
        let bundleID = objectID.readProcessBundleID() ?? processName(pid: pid) ?? "unknown"
        let active = objectID.readProcessIsRunning()
        processes.append(ProcessInfo(pid: pid, bundleID: bundleID, active: active))
    }

    // Sort: active first, then by name
    processes.sort {
        if $0.active != $1.active { return $0.active }
        return $0.bundleID.localizedStandardCompare($1.bundleID) == .orderedAscending
    }

    print("PID\tACTIVE\tNAME")
    for p in processes {
        print("\(p.pid)\t\(p.active ? "●" : "○")\t\(p.bundleID)")
    }
}

func processName(pid: pid_t) -> String? {
    let nameBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(MAXPATHLEN))
    defer { nameBuffer.deallocate() }
    let len = proc_name(pid, nameBuffer, UInt32(MAXPATHLEN))
    guard len > 0 else { return nil }
    return String(cString: nameBuffer)
}

// MARK: - List Input Devices

func listDevices() {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID.system, &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var devices = [AudioDeviceID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID.system, &address, 0, nil, &size, &devices)

    print("UID\tNAME")
    for device in devices {
        // Check if device has input channels
        var inputAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var streamSize: UInt32 = 0
        AudioObjectGetPropertyDataSize(device, &inputAddress, 0, nil, &streamSize)
        guard streamSize > 0 else { continue }

        let uid = (try? device.readDeviceUID()) ?? "?"

        let name = (try? device.readStringProperty(kAudioDevicePropertyDeviceNameCFString)) ?? "?"

        print("\(uid)\t\(name)")
    }
}

// MARK: - Signal Handling

var running = true

func setupSignalHandling() {
    signal(SIGINT) { _ in running = false }
    signal(SIGTERM) { _ in running = false }
    signal(SIGPIPE) { _ in running = false }
}

// MARK: - Main

setupSignalHandling()

let args = CommandLine.arguments
guard args.count >= 2 else {
    printUsage()
    exit(1)
}

let command = args[1]

switch command {
case "list":
    do {
        try listProcesses()
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

case "devices":
    listDevices()

case "tap":
    guard args.count >= 3, let pid = Int32(args[2]) else {
        fputs("Usage: waves-audio tap <pid>\n", stderr)
        exit(1)
    }

    guard #available(macOS 14.2, *) else {
        fputs("Error: process tap requires macOS 14.2 or later\n", stderr)
        exit(1)
    }

    do {
        let capture = try ProcessTapCapture(pid: pid)
        try capture.start()

        // Use DispatchSourceSignal for clean shutdown with dispatchMain()
        let sigintSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        let sigtermSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let cleanup = {
            fputs("\nwaves-audio: stopping capture\n", stderr)
            capture.stop()
            exit(0)
        }
        sigintSrc.setEventHandler(handler: cleanup)
        sigtermSrc.setEventHandler(handler: cleanup)
        sigintSrc.resume()
        sigtermSrc.resume()

        dispatchMain()
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

case "mic":
    var deviceUID: String? = nil
    if args.count >= 4, args[2] == "--device" {
        deviceUID = args[3]
    }

    do {
        let capture = MicCapture(deviceUID: deviceUID)
        try capture.start()

        let sigintSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        let sigtermSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let cleanup = {
            fputs("\nwaves-audio: stopping capture\n", stderr)
            capture.stop()
            exit(0)
        }
        sigintSrc.setEventHandler(handler: cleanup)
        sigtermSrc.setEventHandler(handler: cleanup)
        sigintSrc.resume()
        sigtermSrc.resume()

        dispatchMain()
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

case "tap-all":
    guard #available(macOS 14.2, *) else {
        fputs("Error: process tap requires macOS 14.2 or later\n", stderr)
        exit(1)
    }

    do {
        let capture = try ProcessTapCapture(pid: -1)
        try capture.start()

        let sigintSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        let sigtermSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let cleanup = {
            fputs("\nwaves-audio: stopping capture\n", stderr)
            capture.stop()
            exit(0)
        }
        sigintSrc.setEventHandler(handler: cleanup)
        sigtermSrc.setEventHandler(handler: cleanup)
        sigintSrc.resume()
        sigtermSrc.resume()

        dispatchMain()
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

case "help", "--help", "-h":
    printUsage()

default:
    fputs("Unknown command: \(command)\n", stderr)
    printUsage()
    exit(1)
}
