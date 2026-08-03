import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

struct ProbeOptions {
  var duration: TimeInterval = 10
  var outputPath: String = "/tmp/system-audio-probe.wav"
  var streamJson = false
}

final class WavWriter {
  private let handle: FileHandle
  private(set) var sampleCount: UInt32 = 0
  let sampleRate: UInt32

  init(path: String, sampleRate: UInt32 = 48_000) throws {
    self.sampleRate = sampleRate
    FileManager.default.createFile(atPath: path, contents: nil)
    self.handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    self.handle.write(Data(repeating: 0, count: 44))
  }

  func appendMonoFloatSamples(_ samples: [Float]) {
    var data = Data(capacity: samples.count * 2)
    for sample in samples {
      let clamped = max(-1, min(1, sample))
      var intSample = Int16(clamped * Float(Int16.max)).littleEndian
      withUnsafeBytes(of: &intSample) { data.append(contentsOf: $0) }
    }
    handle.write(data)
    sampleCount += UInt32(samples.count)
  }

  func finalize() throws {
    let byteRate = sampleRate * 2
    let dataBytes = sampleCount * 2
    let riffSize = 36 + dataBytes

    var header = Data()
    header.append(contentsOf: "RIFF".utf8)
    header.appendUInt32LE(riffSize)
    header.append(contentsOf: "WAVE".utf8)
    header.append(contentsOf: "fmt ".utf8)
    header.appendUInt32LE(16)
    header.appendUInt16LE(1)
    header.appendUInt16LE(1)
    header.appendUInt32LE(sampleRate)
    header.appendUInt32LE(byteRate)
    header.appendUInt16LE(2)
    header.appendUInt16LE(16)
    header.append(contentsOf: "data".utf8)
    header.appendUInt32LE(dataBytes)

    try handle.seek(toOffset: 0)
    handle.write(header)
    try handle.close()
  }
}

extension Data {
  mutating func appendUInt16LE(_ value: UInt16) {
    var little = value.littleEndian
    Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
  }

  mutating func appendUInt32LE(_ value: UInt32) {
    var little = value.littleEndian
    Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
  }
}

final class SystemAudioOutput: NSObject, SCStreamOutput {
  private let writer: WavWriter?
  private let streamJson: Bool
  private var lastLog = Date.distantPast
  private var resamplerRemainder: [Float] = []

  init(writer: WavWriter?, streamJson: Bool = false) {
    self.writer = writer
    self.streamJson = streamJson
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sampleBuffer.isValid else { return }
    guard let extracted = extractMonoFloatSamples(from: sampleBuffer), !extracted.samples.isEmpty else { return }
    writer?.appendMonoFloatSamples(extracted.samples)

    if streamJson {
      let resampled = resampleTo16k(samples: extracted.samples, sourceSampleRate: extracted.sampleRate)
      if !resampled.isEmpty {
        printSampleChunk(resampled)
      }
    }

    let now = Date()
    if now.timeIntervalSince(lastLog) >= 1 {
      lastLog = now
      let rms = sqrt(extracted.samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(extracted.samples.count))
      print(String(format: "{\"event\":\"audio\",\"rms\":%.6f,\"samples\":%d}", rms, extracted.samples.count))
      fflush(stdout)
    }
  }

  private func printSampleChunk(_ samples: [Float]) {
    var data = Data(capacity: samples.count * MemoryLayout<Float>.size)
    for sample in samples {
      var value = sample
      Swift.withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }

    let payload = data.base64EncodedString()
    print("{\"event\":\"samples\",\"sampleRate\":16000,\"samples\":\"\(payload)\"}")
    fflush(stdout)
  }

  private func resampleTo16k(samples: [Float], sourceSampleRate: Double) -> [Float] {
    if sourceSampleRate <= 0 { return [] }
    if abs(sourceSampleRate - 16_000) < 1 { return samples }

    let input = resamplerRemainder + samples
    let ratio = sourceSampleRate / 16_000
    guard input.count > Int(ceil(ratio)) + 1 else {
      resamplerRemainder = input
      return []
    }

    var output: [Float] = []
    var position = 0.0
    while Int(position) + 1 < input.count {
      let index = Int(position)
      let fraction = Float(position - Double(index))
      let sample = input[index] * (1 - fraction) + input[index + 1] * fraction
      output.append(sample)
      position += ratio
    }

    let consumed = max(0, Int(position))
    if consumed < input.count {
      resamplerRemainder = Array(input[consumed..<input.count])
    } else {
      resamplerRemainder = []
    }

    return output
  }

  private func extractMonoFloatSamples(from sampleBuffer: CMSampleBuffer) -> (samples: [Float], sampleRate: Double)? {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
          let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
      return nil
    }

    let asbd = asbdPointer.pointee
    let sampleRate = asbd.mSampleRate
    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0 else { return nil }

    var neededSize = 0
    var blockBuffer: CMBlockBuffer?
    var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: &neededSize,
      bufferListOut: nil,
      bufferListSize: 0,
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: 0,
      blockBufferOut: &blockBuffer
    )
    guard status == noErr, neededSize > 0 else { return nil }

    let raw = UnsafeMutableRawPointer.allocate(byteCount: neededSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let audioBufferList = raw.assumingMemoryBound(to: AudioBufferList.self)

    status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: nil,
      bufferListOut: audioBufferList,
      bufferListSize: neededSize,
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: 0,
      blockBufferOut: &blockBuffer
    )
    guard status == noErr else { return nil }

    let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
    let channels = max(1, Int(asbd.mChannelsPerFrame))
    let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
    let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
    var output = Array(repeating: Float(0), count: frameCount)

    if isFloat {
      if isNonInterleaved || buffers.count > 1 {
        let channelCount = min(channels, buffers.count)
        guard channelCount > 0 else { return nil }
        for channel in 0..<channelCount {
          guard let data = buffers[channel].mData else { continue }
          let pointer = data.assumingMemoryBound(to: Float.self)
          for frame in 0..<frameCount { output[frame] += pointer[frame] / Float(channelCount) }
        }
      } else if let data = buffers.first?.mData {
        let pointer = data.assumingMemoryBound(to: Float.self)
        for frame in 0..<frameCount {
          var sum = Float(0)
          for channel in 0..<channels { sum += pointer[frame * channels + channel] }
          output[frame] = sum / Float(channels)
        }
      }
      return (output, sampleRate)
    }

    let isSignedInteger = (asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
    if isSignedInteger, asbd.mBitsPerChannel == 16 {
      if isNonInterleaved || buffers.count > 1 {
        let channelCount = min(channels, buffers.count)
        guard channelCount > 0 else { return nil }
        for channel in 0..<channelCount {
          guard let data = buffers[channel].mData else { continue }
          let pointer = data.assumingMemoryBound(to: Int16.self)
          for frame in 0..<frameCount { output[frame] += Float(pointer[frame]) / Float(Int16.max) / Float(channelCount) }
        }
      } else if let data = buffers.first?.mData {
        let pointer = data.assumingMemoryBound(to: Int16.self)
        for frame in 0..<frameCount {
          var sum = Float(0)
          for channel in 0..<channels { sum += Float(pointer[frame * channels + channel]) / Float(Int16.max) }
          output[frame] = sum / Float(channels)
        }
      }
      return (output, sampleRate)
    }

    return nil
  }
}

func parseOptions() -> ProbeOptions {
  var options = ProbeOptions()
  var args = Array(CommandLine.arguments.dropFirst())

  while !args.isEmpty {
    let arg = args.removeFirst()
    switch arg {
    case "--duration":
      if let value = args.first, let duration = TimeInterval(value) {
        options.duration = duration
        args.removeFirst()
      }
    case "--out":
      if let value = args.first {
        options.outputPath = value
        args.removeFirst()
      }
    case "--stream-json":
      options.streamJson = true
    default:
      break
    }
  }

  return options
}

@main
struct SystemAudioProbe {
  static func main() async throws {
    let options = parseOptions()

    if !CGPreflightScreenCaptureAccess() {
      print("{\"event\":\"permission_required\",\"message\":\"Screen Recording permission is required. Grant it and restart this helper.\"}")
      _ = CGRequestScreenCaptureAccess()
      return
    }

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first else {
      throw NSError(domain: "SystemAudioProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found for ScreenCaptureKit capture"])
    }

    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    configuration.queueDepth = 3
    configuration.capturesAudio = true
    configuration.excludesCurrentProcessAudio = false

    let writer = options.streamJson ? nil : try WavWriter(path: options.outputPath)
    let output = SystemAudioOutput(writer: writer, streamJson: options.streamJson)
    let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
    let queue = DispatchQueue(label: "system-audio-probe.audio")
    try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: queue)

    print("{\"event\":\"started\",\"out\":\"\(options.outputPath)\",\"streamJson\":\(options.streamJson)}")
    try await stream.startCapture()
    if options.streamJson {
      while !Task.isCancelled {
        try await Task.sleep(nanoseconds: 1_000_000_000)
      }
    } else {
      try await Task.sleep(nanoseconds: UInt64(options.duration * 1_000_000_000))
    }
    try await stream.stopCapture()
    try writer?.finalize()
    print("{\"event\":\"finished\",\"out\":\"\(options.outputPath)\",\"samples\":\(writer?.sampleCount ?? 0)}")
  }
}
