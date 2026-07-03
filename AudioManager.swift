import AVFoundation
import Foundation
import UIKit
import Combine

final class AudioManager: ObservableObject {
    let objectWillChange = ObservableObjectPublisher()
    
    static let shared = AudioManager()

    /// Master gate for ALL native audio (ambient + SFX). Defaults OFF — the high-pitched
    /// fly-to "lock" / warp SFX were firing even with sound "off". Only the Spatial Audio
    /// toggle turns this on.
    var soundEnabled = false

    private let engine = AVAudioEngine()
    private let environment = AVAudioEnvironmentNode()
    private let ambientPlayer = AVAudioPlayerNode()
    private let sfxPlayer = AVAudioPlayerNode()
    
    private var ambientBuffer: AVAudioPCMBuffer?
    private var sfxBuffers: [String: AVAudioPCMBuffer] = [:]
    
    private var audioFormat: AVAudioFormat?
    
    private init() {
        audioFormat = engine.outputNode.outputFormat(forBus: 0)
        
        // Configure environment node listener defaults
        environment.listenerAngularOrientation = AVAudioMake3DAngularOrientation(0, 0, 0)
        environment.listenerPosition = AVAudio3DPoint(x: 0, y: 0, z: 0)
        
        // Set rendering algorithm for 3D spatialization
        if #available(iOS 13.0, *) {
            environment.renderingAlgorithm = .HRTF
        } else {
            environment.renderingAlgorithm = .equalPowerPanning
        }
    }
    
    public func start() {
        DispatchQueue.main.async {
            self.engine.attach(self.ambientPlayer)
            self.engine.attach(self.sfxPlayer)
            self.engine.attach(self.environment)
            
            let mainMixer = self.engine.mainMixerNode
            
            // Connect ambientPlayer and sfxPlayer to environment node with their audio format
            self.engine.connect(self.ambientPlayer, to: self.environment, format: self.audioFormat)
            self.engine.connect(self.sfxPlayer, to: self.environment, format: self.audioFormat)
            
            // Connect environment node to main mixer
            self.engine.connect(self.environment, to: mainMixer, format: self.audioFormat)
            
            do {
                try self.engine.start()
            } catch {
                print("AudioEngine start error: \(error)")
            }
            
            if self.ambientBuffer != nil {
                self.scheduleLoop()
                self.ambientPlayer.play()
            }
        }
    }
    
    public func loadAmbient(named name: String) {
        DispatchQueue.main.async {
            guard let url = Bundle.main.url(forResource: name, withExtension: "mp3") ?? Bundle.main.url(forResource: name, withExtension: "m4a") else {
                print("Ambient file \(name) not found")
                return
            }
            do {
                let file = try AVAudioFile(forReading: url)
                guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                    print("Failed to create buffer for ambient \(name)")
                    return
                }
                try file.read(into: buffer)
                self.ambientBuffer = buffer
                if self.ambientPlayer.isPlaying == false {
                    self.scheduleLoop()
                    self.ambientPlayer.play()
                }
            } catch {
                print("Ambient load error \(name): \(error)")
            }
        }
    }
    
    private func scheduleLoop() {
        guard let buffer = ambientBuffer else { return }
        ambientPlayer.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
    }
    
    /// Sets the 3D position of the listener in the environment.
    public func setListenerPosition(x: Float, y: Float, z: Float) {
        DispatchQueue.main.async {
            self.environment.listenerPosition = AVAudio3DPoint(x: x, y: y, z: z)
        }
    }
    
    /// Plays a sound effect at the specified 3D position with optional gain (volume).
    /// - Parameters:
    ///   - name: The name of the sound effect file (without extension).
    ///   - position: The 3D position of the sound source.
    ///   - gain: The gain (volume multiplier) for the sound effect. Default is 1.0.
    ///
    /// Note: This implementation uses a single sfxPlayer node for simplicity.
    /// For multiple simultaneous spatialized SFX, consider using a pool of AVAudioPlayerNodes.
    public func playSFX(named name: String, at position: SIMD3<Float>, gain: Float = 1.0) {
        guard soundEnabled else { return }
        DispatchQueue.main.async {
            // AVAudioPlayerNode conforms to AVAudio3DMixing; set position directly
            (self.sfxPlayer as AVAudio3DMixing).position = AVAudio3DPoint(x: position.x, y: position.y, z: position.z)
            self.sfxPlayer.volume = gain
            
            if let buffer = self.sfxBuffers[name] {
                self.sfxPlayer.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
                if !self.sfxPlayer.isPlaying {
                    self.sfxPlayer.play()
                }
            } else {
                guard let url = Bundle.main.url(forResource: name, withExtension: "mp3") ?? Bundle.main.url(forResource: name, withExtension: "m4a") else {
                    print("SFX file \(name) not found")
                    return
                }
                do {
                    let file = try AVAudioFile(forReading: url)
                    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                        print("Failed to create buffer for SFX \(name)")
                        return
                    }
                    try file.read(into: buffer)
                    self.sfxBuffers[name] = buffer
                    self.sfxPlayer.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
                    if !self.sfxPlayer.isPlaying {
                        self.sfxPlayer.play()
                    }
                } catch {
                    print("SFX load error \(name): \(error)")
                }
            }
        }
    }
    
    /// Convenience method to play a sound effect without spatial position (plays at listener position).
    public func playSFX(named name: String) {
        guard soundEnabled else { return }
        // Play at listener position
        playSFX(named: name, at: SIMD3<Float>(0, 0, 0), gain: 1.0)
    }
    
    public func setAmbientVolume(_ v: Float) {
        DispatchQueue.main.async {
            self.ambientPlayer.volume = v
        }
    }
    
    public func stop() {
        DispatchQueue.main.async {
            self.ambientPlayer.stop()
            self.sfxPlayer.stop()
            self.engine.stop()
        }
    }
    
    public func preloadCommonSFX() {
        let names = ["warp", "lock", "arrive"]
        DispatchQueue.main.async {
            for name in names {
                if self.sfxBuffers[name] != nil { continue }
                guard let url = Bundle.main.url(forResource: name, withExtension: "mp3") ?? Bundle.main.url(forResource: name, withExtension: "m4a") else {
                    print("Preload SFX file \(name) not found")
                    continue
                }
                do {
                    let file = try AVAudioFile(forReading: url)
                    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                        print("Failed to create buffer for preload SFX \(name)")
                        continue
                    }
                    try file.read(into: buffer)
                    self.sfxBuffers[name] = buffer
                } catch {
                    print("Preload SFX error \(name): \(error)")
                }
            }
        }
    }
}

