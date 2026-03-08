import Foundation
import AudioToolbox
import AVFoundation

/// Captures audio from a specific process using CoreAudio Process Tap (macOS 14.2+).
/// Converts to PCM16 mono 16kHz and writes to stdout for whisper compatibility.
@available(macOS 14.2, *)
final class ProcessTapCapture {
    private let pid: pid_t
    private var processTapID: AudioObjectID = .unknown
    private var aggregateDeviceID: AudioObjectID = .unknown
    private var deviceProcID: AudioDeviceIOProcID?
    private let queue = DispatchQueue(label: "waves-audio.tap", qos: .userInitiated)

    private var sourceFormat: AVAudioFormat?
    private let targetFormat: AVAudioFormat

    init(pid: pid_t) throws {
        self.pid = pid

        guard let fmt = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        ) else {
            throw AudioError.message("Failed to create target audio format")
        }
        self.targetFormat = fmt
    }

    func start() throws {
        // Create process tap
        let tapDescription: CATapDescription
        if pid == -1 {
            // Global tap: capture all system audio
            tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        } else {
            let objectID = try AudioObjectID.translatePID(pid)
            guard objectID.isValid else {
                throw AudioError.message("Process \(pid) has no audio object (is it playing audio?)")
            }
            tapDescription = CATapDescription(stereoMixdownOfProcesses: [objectID])
        }
        tapDescription.uuid = UUID()
        tapDescription.muteBehavior = .unmuted

        var tapID: AudioObjectID = .unknown
        var err = AudioHardwareCreateProcessTap(tapDescription, &tapID)
        guard err == noErr else { throw AudioError.tapCreationFailed(err) }
        self.processTapID = tapID

        // Read tap's native format BEFORE creating aggregate device (matches AudioCap order)
        var streamDesc = try tapID.readTapStreamDescription()
        fputs("waves-audio: tap format: \(streamDesc.mSampleRate)Hz, \(streamDesc.mChannelsPerFrame)ch, \(streamDesc.mBitsPerChannel)bit, formatFlags=\(streamDesc.mFormatFlags)\n", stderr)

        // Use the EXACT format from the tap (AudioCap does this)
        guard let srcFmt = AVAudioFormat(streamDescription: &streamDesc) else {
            throw AudioError.noTapFormat
        }
        fputs("waves-audio: AVAudioFormat: \(srcFmt)\n", stderr)
        self.sourceFormat = srcFmt

        // Get system output device for aggregate
        let systemOutputID = try AudioObjectID.readDefaultSystemOutputDevice()
        let outputUID = try systemOutputID.readDeviceUID()

        fputs("waves-audio: system output device UID: \(outputUID)\n", stderr)

        // Create private aggregate device with the tap
        let aggregateUID = UUID().uuidString
        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "WavesTap-\(pid)",
            kAudioAggregateDeviceUIDKey: aggregateUID,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [
                [kAudioSubDeviceUIDKey: outputUID]
            ],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: tapDescription.uuid.uuidString
                ]
            ]
        ]

        self.aggregateDeviceID = .unknown
        err = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateDeviceID)
        guard err == noErr else { throw AudioError.aggregateDeviceFailed(err) }

        fputs("waves-audio: aggregate device ID: \(aggregateDeviceID)\n", stderr)

        // Read the aggregate device's actual sample rate — this is what the IO callback delivers,
        // which may differ from the tap's reported format (e.g. system output at 96kHz, tap reports 48kHz)
        let actualSampleRate = try aggregateDeviceID.readNominalSampleRate()
        fputs("waves-audio: aggregate device nominal rate: \(actualSampleRate)Hz (tap reported: \(streamDesc.mSampleRate)Hz)\n", stderr)

        // Set up IO callback
        let srcFormat = srcFmt
        let tgtFormat = targetFormat
        let resampleSourceRate = actualSampleRate > 0 ? actualSampleRate : srcFmt.sampleRate
        var callbackCount = 0
        err = AudioDeviceCreateIOProcIDWithBlock(&deviceProcID, aggregateDeviceID, queue) {
            inNow, inInputData, inInputTime, outOutputData, inOutputTime in
            callbackCount += 1

            // Use UnsafeMutableAudioBufferListPointer for safe variable-length buffer access
            let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
            guard abl.count > 0 else { return }

            let channelCount = Int(srcFormat.channelCount)
            let bytesPerSample = MemoryLayout<Float>.size

            // Determine frame count and extract mono float samples
            let firstBuf = abl[0]
            guard firstBuf.mDataByteSize > 0, let firstData = firstBuf.mData else { return }

            // Debug: check both input and output buffers
            if callbackCount < 5 {
                let floats = firstData.assumingMemoryBound(to: Float.self)
                let sampleCount = Int(firstBuf.mDataByteSize) / bytesPerSample
                var sumSq: Float = 0
                for i in 0..<min(sampleCount, 512) { sumSq += floats[i] * floats[i] }
                let inRms = (sumSq / Float(min(sampleCount, 512))).squareRoot()

                // Check output buffers too
                let outAbl = UnsafeMutableAudioBufferListPointer(outOutputData)
                var outRms: Float = 0
                if outAbl.count > 0, outAbl[0].mDataByteSize > 0, let outData = outAbl[0].mData {
                    let outFloats = outData.assumingMemoryBound(to: Float.self)
                    let outCount = Int(outAbl[0].mDataByteSize) / bytesPerSample
                    var outSumSq: Float = 0
                    for i in 0..<min(outCount, 512) { outSumSq += outFloats[i] * outFloats[i] }
                    outRms = (outSumSq / Float(min(outCount, 512))).squareRoot()
                }
                fputs("waves-audio: cb#\(callbackCount) inBufs=\(abl.count) inRms=\(inRms) outBufs=\(outAbl.count) outRms=\(outRms)\n", stderr)
            }

            var monoSamples: [Float]

            if abl.count == 1 {
                // Single buffer — interleaved stereo (or mono)
                let totalSamples = Int(firstBuf.mDataByteSize) / bytesPerSample
                let chans = max(Int(firstBuf.mNumberChannels), channelCount)
                let frameCount = totalSamples / max(chans, 1)
                guard frameCount > 0 else { return }

                let floats = firstData.assumingMemoryBound(to: Float.self)
                monoSamples = [Float](repeating: 0, count: frameCount)

                if chans == 1 {
                    for f in 0..<frameCount { monoSamples[f] = floats[f] }
                } else {
                    for f in 0..<frameCount {
                        var sum: Float = 0
                        for c in 0..<chans { sum += floats[f * chans + c] }
                        monoSamples[f] = sum / Float(chans)
                    }
                }
            } else {
                // Multiple buffers — non-interleaved (one buffer per channel)
                let frameCount = Int(firstBuf.mDataByteSize) / bytesPerSample
                guard frameCount > 0 else { return }

                monoSamples = [Float](repeating: 0, count: frameCount)
                var validBufs = 0
                for i in 0..<abl.count {
                    let buf = abl[i]
                    guard buf.mDataByteSize > 0, let data = buf.mData else { continue }
                    let floats = data.assumingMemoryBound(to: Float.self)
                    let count = min(frameCount, Int(buf.mDataByteSize) / bytesPerSample)
                    for f in 0..<count { monoSamples[f] += floats[f] }
                    validBufs += 1
                }
                if validBufs > 1 {
                    let scale = 1.0 / Float(validBufs)
                    for f in 0..<monoSamples.count { monoSamples[f] *= scale }
                }
            }

            // Resample to 16kHz and convert to Int16
            let ratio = tgtFormat.sampleRate / resampleSourceRate
            let outputCount = Int(Double(monoSamples.count) * ratio)
            guard outputCount > 0 else { return }

            var pcm16 = [Int16](repeating: 0, count: outputCount)
            let srcCount = monoSamples.count
            for i in 0..<outputCount {
                let srcIdx = Double(i) / ratio
                let idx0 = Int(srcIdx)
                let frac = Float(srcIdx - Double(idx0))
                let idx1 = min(idx0 + 1, srcCount - 1)

                let sample = monoSamples[idx0] * (1.0 - frac) + monoSamples[idx1] * frac
                let clamped = max(-1.0, min(1.0, sample))
                pcm16[i] = Int16(clamped * 32767.0)
            }

            // Write to stdout using POSIX write() for reliable pipe/redirect behavior
            _ = pcm16.withUnsafeBytes { rawBuf in
                var offset = 0
                while offset < rawBuf.count {
                    let written = Darwin.write(STDOUT_FILENO, rawBuf.baseAddress! + offset, rawBuf.count - offset)
                    if written <= 0 { break }
                    offset += written
                }
            }
        }
        guard err == noErr else { throw AudioError.ioProcFailed(err) }

        err = AudioDeviceStart(aggregateDeviceID, deviceProcID)
        guard err == noErr else { throw AudioError.deviceStartFailed(err) }

        fputs("waves-audio: capturing PID \(pid) → PCM16 mono 16kHz on stdout\n", stderr)
    }

    func stop() {
        if aggregateDeviceID.isValid {
            AudioDeviceStop(aggregateDeviceID, deviceProcID)
            if let deviceProcID {
                AudioDeviceDestroyIOProcID(aggregateDeviceID, deviceProcID)
                self.deviceProcID = nil
            }
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = .unknown
        }

        if processTapID.isValid {
            AudioHardwareDestroyProcessTap(processTapID)
            processTapID = .unknown
        }
    }

    deinit { stop() }
}
