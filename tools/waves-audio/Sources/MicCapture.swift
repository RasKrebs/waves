import Foundation
import AVFoundation

/// Captures audio from an input device (microphone or BlackHole) using AVAudioEngine.
/// Converts to PCM16 mono 16kHz and writes to stdout.
final class MicCapture {
    private let engine = AVAudioEngine()
    private let deviceUID: String?

    /// - Parameter deviceUID: Specific device UID, or nil for system default input.
    init(deviceUID: String?) {
        self.deviceUID = deviceUID
    }

    func start() throws {
        let inputNode = engine.inputNode

        // Select device if specified
        if let deviceUID {
            var deviceID = findDevice(uid: deviceUID)
            if deviceID == kAudioObjectUnknown {
                throw AudioError.message("Input device '\(deviceUID)' not found")
            }
            let err = AudioUnitSetProperty(
                inputNode.audioUnit!,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                &deviceID,
                UInt32(MemoryLayout<AudioDeviceID>.size)
            )
            guard err == noErr else {
                throw AudioError.message("Failed to set input device: \(err)")
            }
        }

        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        ) else {
            throw AudioError.message("Failed to create target format")
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw AudioError.message("Cannot create converter from \(inputFormat) to \(targetFormat)")
        }

        let deviceDesc = deviceUID ?? "system default"
        fputs("waves-audio: capturing mic (\(deviceDesc)) → PCM16 mono 16kHz on stdout\n", stderr)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, time in
            let ratio = targetFormat.sampleRate / inputFormat.sampleRate
            let outputFrameCount = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1

            guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outputFrameCount) else {
                return
            }

            var error: NSError?
            var inputConsumed = false
            converter.convert(to: outputBuffer, error: &error) { _, outStatus in
                if inputConsumed {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                inputConsumed = true
                outStatus.pointee = .haveData
                return buffer
            }

            guard error == nil, outputBuffer.frameLength > 0 else { return }

            let byteCount = Int(outputBuffer.frameLength) * Int(targetFormat.streamDescription.pointee.mBytesPerFrame)
            if let int16Data = outputBuffer.int16ChannelData {
                _ = int16Data[0].withMemoryRebound(to: UInt8.self, capacity: byteCount) { ptr in
                    var offset = 0
                    while offset < byteCount {
                        let written = Darwin.write(STDOUT_FILENO, ptr + offset, byteCount - offset)
                        if written <= 0 { break }
                        offset += written
                    }
                }
            }
        }

        try engine.start()
    }

    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
    }

    private func findDevice(uid: String) -> AudioDeviceID {
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

        for device in devices {
            if let devUID = try? device.readDeviceUID(), devUID == uid {
                return device
            }
        }
        return kAudioObjectUnknown
    }

    deinit { stop() }
}
