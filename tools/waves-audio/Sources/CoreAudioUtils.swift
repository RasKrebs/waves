import Foundation
import AudioToolbox

// MARK: - AudioObjectID Convenience

extension AudioObjectID {
    static let system = AudioObjectID(kAudioObjectSystemObject)
    static let unknown = kAudioObjectUnknown

    var isValid: Bool { self != Self.unknown }
}

// MARK: - Concrete Property Helpers

extension AudioObjectID {
    static func readDefaultSystemOutputDevice() throws -> AudioDeviceID {
        try AudioDeviceID.system.readProperty(
            kAudioHardwarePropertyDefaultSystemOutputDevice,
            defaultValue: AudioDeviceID.unknown
        )
    }

    static func readProcessList() throws -> [AudioObjectID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        var err = AudioObjectGetPropertyDataSize(self.system, &address, 0, nil, &dataSize)
        guard err == noErr else { throw AudioError.propertyError("readProcessList size", err) }

        var value = [AudioObjectID](repeating: .unknown, count: Int(dataSize) / MemoryLayout<AudioObjectID>.size)
        err = AudioObjectGetPropertyData(self.system, &address, 0, nil, &dataSize, &value)
        guard err == noErr else { throw AudioError.propertyError("readProcessList data", err) }

        return value
    }

    static func translatePID(_ pid: pid_t) throws -> AudioObjectID {
        try AudioDeviceID.system.readProperty(
            kAudioHardwarePropertyTranslatePIDToProcessObject,
            defaultValue: AudioObjectID.unknown,
            qualifier: pid
        )
    }

    func readDeviceUID() throws -> String {
        try readStringProperty(kAudioDevicePropertyDeviceUID)
    }

    func readTapStreamDescription() throws -> AudioStreamBasicDescription {
        try readProperty(kAudioTapPropertyFormat, defaultValue: AudioStreamBasicDescription())
    }

    func readProcessPID() throws -> pid_t {
        try readProperty(kAudioProcessPropertyPID, defaultValue: pid_t(-1))
    }

    func readProcessBundleID() -> String? {
        try? readStringProperty(kAudioProcessPropertyBundleID)
    }

    func readProcessIsRunning() -> Bool {
        let val: Int = (try? readProperty(kAudioProcessPropertyIsRunning, defaultValue: 0)) ?? 0
        return val == 1
    }

    func readNominalSampleRate() throws -> Float64 {
        try readProperty(kAudioDevicePropertyNominalSampleRate, defaultValue: Float64(0))
    }
}

// MARK: - Generic Property Access

extension AudioObjectID {
    func readProperty<T>(_ selector: AudioObjectPropertySelector, defaultValue: T) throws -> T {
        try readProperty(selector, defaultValue: defaultValue, qualifierSize: 0, qualifierData: nil)
    }

    func readProperty<T, Q>(_ selector: AudioObjectPropertySelector, defaultValue: T, qualifier: Q) throws -> T {
        var q = qualifier
        let qSize = UInt32(MemoryLayout<Q>.size(ofValue: q))
        return try withUnsafeMutablePointer(to: &q) { ptr in
            try readProperty(selector, defaultValue: defaultValue, qualifierSize: qSize, qualifierData: ptr)
        }
    }

    func readStringProperty(_ selector: AudioObjectPropertySelector) throws -> String {
        try readProperty(selector, defaultValue: "" as CFString) as String
    }

    private func readProperty<T>(
        _ selector: AudioObjectPropertySelector,
        defaultValue: T,
        qualifierSize: UInt32,
        qualifierData: UnsafeRawPointer?
    ) throws -> T {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        var err = AudioObjectGetPropertyDataSize(self, &address, qualifierSize, qualifierData, &dataSize)
        guard err == noErr else { throw AudioError.propertyError("getSize(\(selector))", err) }

        var value: T = defaultValue
        err = withUnsafeMutablePointer(to: &value) { ptr in
            AudioObjectGetPropertyData(self, &address, qualifierSize, qualifierData, &dataSize, ptr)
        }
        guard err == noErr else { throw AudioError.propertyError("getData(\(selector))", err) }

        return value
    }
}

// MARK: - Error Type

enum AudioError: LocalizedError {
    case propertyError(String, OSStatus)
    case tapCreationFailed(OSStatus)
    case aggregateDeviceFailed(OSStatus)
    case ioProcFailed(OSStatus)
    case deviceStartFailed(OSStatus)
    case noTapFormat
    case message(String)

    var errorDescription: String? {
        switch self {
        case .propertyError(let ctx, let err): return "\(ctx): CoreAudio error \(err)"
        case .tapCreationFailed(let err): return "Process tap creation failed: \(err)"
        case .aggregateDeviceFailed(let err): return "Aggregate device creation failed: \(err)"
        case .ioProcFailed(let err): return "IO proc creation failed: \(err)"
        case .deviceStartFailed(let err): return "Device start failed: \(err)"
        case .noTapFormat: return "Could not read tap stream format"
        case .message(let msg): return msg
        }
    }
}
