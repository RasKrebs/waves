package audio

/*
#cgo LDFLAGS: -framework CoreAudio -framework AudioToolbox -framework Foundation
#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioQueue.h>
#include <string.h>
#include <stdlib.h>

// Shared ring buffer for audio data
#define RING_BUFFER_SIZE (1024 * 1024 * 4) // 4MB
static unsigned char ring_buffer[RING_BUFFER_SIZE];
static int ring_write = 0;
static int ring_read  = 0;
static int capturing  = 0;

static int ring_available() {
    int w = ring_write;
    int r = ring_read;
    if (w >= r) return w - r;
    return RING_BUFFER_SIZE - r + w;
}

static void audio_callback(void *inUserData, AudioQueueRef inAQ,
                            AudioQueueBufferRef inBuffer,
                            const AudioTimeStamp *inStartTime,
                            UInt32 inNumPackets,
                            const AudioStreamPacketDescription *inPacketDesc) {
    if (!capturing) return;
    UInt32 len = inBuffer->mAudioDataByteSize;
    unsigned char *src = (unsigned char *)inBuffer->mAudioData;
    for (UInt32 i = 0; i < len; i++) {
        ring_buffer[ring_write] = src[i];
        ring_write = (ring_write + 1) % RING_BUFFER_SIZE;
    }
    AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
}

static AudioQueueRef queue = NULL;
#define NUM_BUFFERS 3
static AudioQueueBufferRef buffers[NUM_BUFFERS];

static int start_capture(const char *device_uid) {
    AudioStreamBasicDescription fmt = {
        .mSampleRate       = 16000.0,
        .mFormatID         = kAudioFormatLinearPCM,
        .mFormatFlags      = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
        .mBitsPerChannel   = 16,
        .mChannelsPerFrame = 1,
        .mBytesPerFrame    = 2,
        .mFramesPerPacket  = 1,
        .mBytesPerPacket   = 2,
    };
    OSStatus err = AudioQueueNewInput(&fmt, audio_callback, NULL, NULL, NULL, 0, &queue);
    if (err != noErr) return (int)err;

    if (device_uid != NULL) {
        CFStringRef uid = CFStringCreateWithCString(NULL, device_uid, kCFStringEncodingUTF8);
        AudioQueueSetProperty(queue, kAudioQueueProperty_CurrentDevice, &uid, sizeof(uid));
        CFRelease(uid);
    }

    UInt32 buf_size = 8192;
    for (int i = 0; i < NUM_BUFFERS; i++) {
        AudioQueueAllocateBuffer(queue, buf_size, &buffers[i]);
        AudioQueueEnqueueBuffer(queue, buffers[i], 0, NULL);
    }
    ring_read = ring_write = 0;
    capturing = 1;
    return (int)AudioQueueStart(queue, NULL);
}

static void stop_capture() {
    capturing = 0;
    if (queue) {
        AudioQueueStop(queue, true);
        AudioQueueDispose(queue, true);
        queue = NULL;
    }
}

static int read_audio(unsigned char *dst, int max_bytes) {
    int avail = ring_available();
    if (avail > max_bytes) avail = max_bytes;
    for (int i = 0; i < avail; i++) {
        dst[i] = ring_buffer[ring_read];
        ring_read = (ring_read + 1) % RING_BUFFER_SIZE;
    }
    return avail;
}

typedef struct {
    char uid[256];
    char name[256];
} DeviceInfo;

static int list_audio_inputs(DeviceInfo *out, int max_count) {
    AudioObjectPropertyAddress prop = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &prop, 0, NULL, &size);
    int count = size / sizeof(AudioDeviceID);
    AudioDeviceID *devices = malloc(size);
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &prop, 0, NULL, &size, devices);

    int found = 0;
    for (int i = 0; i < count && found < max_count; i++) {
        CFStringRef name_ref = NULL;
        UInt32 name_size = sizeof(name_ref);
        AudioObjectPropertyAddress name_prop = {
            kAudioDevicePropertyDeviceNameCFString,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(devices[i], &name_prop, 0, NULL, &name_size, &name_ref);

        AudioObjectPropertyAddress input_prop = {
            kAudioDevicePropertyStreamConfiguration,
            kAudioDevicePropertyScopeInput,
            kAudioObjectPropertyElementMain
        };
        UInt32 stream_size = 0;
        AudioObjectGetPropertyDataSize(devices[i], &input_prop, 0, NULL, &stream_size);
        if (stream_size == 0 || name_ref == NULL) {
            if (name_ref) CFRelease(name_ref);
            continue;
        }

        CFStringGetCString(name_ref, out[found].name, 256, kCFStringEncodingUTF8);
        CFRelease(name_ref);

        CFStringRef uid_ref = NULL;
        UInt32 uid_size = sizeof(uid_ref);
        AudioObjectPropertyAddress uid_prop = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(devices[i], &uid_prop, 0, NULL, &uid_size, &uid_ref);
        if (uid_ref) {
            CFStringGetCString(uid_ref, out[found].uid, 256, kCFStringEncodingUTF8);
            CFRelease(uid_ref);
        }
        found++;
    }
    free(devices);
    return found;
}
*/
import "C"
import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
	"unsafe"
)

// Capturer manages audio input from a virtual loopback device (e.g. BlackHole).
type Capturer struct {
	mu        sync.Mutex
	capturing bool
	deviceUID string
}

func NewCapturer() *Capturer {
	return &Capturer{}
}

// Device represents an audio input device.
type Device struct {
	UID  string
	Name string
}

// ListDevices returns all available audio input devices.
func (c *Capturer) ListDevices() ([]Device, error) {
	const maxDevices = 32
	var infos [maxDevices]C.DeviceInfo
	count := int(C.list_audio_inputs(&infos[0], C.int(maxDevices)))

	devices := make([]Device, 0, count)
	for i := 0; i < count; i++ {
		devices = append(devices, Device{
			UID:  C.GoString(&infos[i].uid[0]),
			Name: C.GoString(&infos[i].name[0]),
		})
	}
	return devices, nil
}

// FindBlackHole returns the first BlackHole device UID, or empty string if not found.
func (c *Capturer) FindBlackHole() string {
	devices, _ := c.ListDevices()
	for _, d := range devices {
		if strings.Contains(strings.ToLower(d.Name), "blackhole") {
			return d.UID
		}
	}
	return ""
}

// Start begins audio capture from the given device UID.
// Pass empty string to use the system default input device.
func (c *Capturer) Start(deviceUID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.capturing {
		return fmt.Errorf("already capturing")
	}

	var cUID *C.char
	if deviceUID != "" {
		cUID = C.CString(deviceUID)
		defer C.free(unsafe.Pointer(cUID))
	}

	ret := C.start_capture(cUID)
	if ret != 0 {
		return fmt.Errorf("CoreAudio error: %d (check microphone permissions)", ret)
	}
	c.capturing = true
	c.deviceUID = deviceUID
	return nil
}

// Stop ends audio capture.
func (c *Capturer) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.capturing {
		C.stop_capture()
		c.capturing = false
	}
}

// Read implements io.Reader - reads raw PCM16 mono 16kHz audio bytes.
func (c *Capturer) Read(p []byte) (int, error) {
	c.mu.Lock()
	if !c.capturing {
		c.mu.Unlock()
		return 0, io.EOF
	}
	c.mu.Unlock()

	buf := make([]byte, len(p))
	cBuf := (*C.uchar)(unsafe.Pointer(&buf[0]))
	n := int(C.read_audio(cBuf, C.int(len(p))))
	if n == 0 {
		time.Sleep(20 * time.Millisecond)
		return 0, nil
	}
	copy(p, buf[:n])
	return n, nil
}
