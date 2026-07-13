import SwiftUI
import SceneKit

// MARK: - Enhanced Solar System with PBR, HDR, Bloom, Shadows, Atmospheres
struct SolarSystemSceneView: UIViewRepresentable {

    var cinematicMode: Bool = true

    // MARK: - Dynamic Event Types
    enum DynamicEventType {
        case meteorShower
        case eclipse
        case comet
    }

    // MARK: - Dynamic Event Model
    struct DynamicEvent {
        var type: DynamicEventType
        var active: Bool
        var startTime: TimeInterval
        var duration: TimeInterval
        var node: SCNNode?
    }

    @State private var currentDynamicEvents: [DynamicEvent] = []

    class Coordinator: NSObject, SCNSceneRendererDelegate {
        weak var view: SCNView?
        weak var scene: SCNScene?
        weak var sunLightNode: SCNNode?

        private var cloudAnimationTimers: [SCNNode: TimeInterval] = [:]
        private var stormAnimationTimers: [SCNNode: TimeInterval] = [:]
        private var auroraNodes: [SCNNode] = []
        private var nebulaNodes: [SCNNode] = []
        private var starfieldNode: SCNNode?

        private var dynamicEvents: [DynamicEvent] = []

        // Camera Smooth Fly-To control
        private var cameraFlyToTarget: SCNNode?
        private var cameraFlyStartTime: TimeInterval?
        private var cameraFlyDuration: TimeInterval = 5.0
        private weak var cameraNode: SCNNode?

        init(view: SCNView?, scene: SCNScene?, sunLightNode: SCNNode?) {
            self.view = view
            self.scene = scene
            self.sunLightNode = sunLightNode
            super.init()
            setupInitialDynamicEvents()
        }

        // MARK: - Setup initial dynamic events (stub for future expansion)
        private func setupInitialDynamicEvents() {
            // Example stub: Add a meteor shower event starting in 3 seconds lasting 15 seconds
            let now = CACurrentMediaTime()
            dynamicEvents.append(DynamicEvent(type: .meteorShower, active: false, startTime: now + 3.0, duration: 15.0, node: nil))
        }

        func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
            guard let scene = scene else { return }

            // Compute sun direction in world space (from planet center outward)
            let sunDirWorld: SCNVector3 = {
                if let sun = sunLightNode {
                    let dir = SCNVector3(sun.worldPosition.x, sun.worldPosition.y, sun.worldPosition.z).normalized()
                    return dir
                } else {
                    return SCNVector3(1, 0.1, 0).normalized()
                }
            }()

            // Update atmosphere sunDir uniform
            scene.rootNode.enumerateChildNodes { node, _ in
                if node.name == "Atmosphere" {
                    node.enumerateChildNodes { child, _ in
                        if let mat = child.geometry?.firstMaterial, let mods = mat.shaderModifiers, mods[.fragment] != nil {
                            mat.setValue(NSValue(scnVector3: sunDirWorld), forKey: "sunDir")
                        }
                    }
                }
            }

            // Animate clouds for applicable planets
            animateClouds(atTime: time)

            // Animate auroras
            animateAuroras(atTime: time)

            // Animate storms on gas giants
            animateStorms(atTime: time)

            // Animate nebulae (rotation and emission pulse)
            animateNebulae(atTime: time)

            // Animate starfield (slow rotation)
            animateStarfield(atTime: time)

            // Process dynamic events (meteor showers, eclipses, comets)
            updateDynamicEvents(atTime: time)

            // Update camera fly-to smooth transitions
            updateCameraFlyTo(atTime: time)
        }

        // MARK: - Cloud Animation

        private func animateClouds(atTime time: TimeInterval) {
            // Find all cloud nodes by name "Clouds"
            scene?.rootNode.enumerateChildNodes { node, _ in
                if node.name == "Clouds" {
                    // Animate texture offset or rotation around Y axis
                    let speed: Float = 0.01
                    node.eulerAngles.y += speed * Float(1.0/60.0)
                }
            }
        }

        // MARK: - Aurora Animation

        private func animateAuroras(atTime time: TimeInterval) {
            // Pulsate aurora opacity & hue shift
            for auroraNode in auroraNodes {
                guard let mat = auroraNode.geometry?.firstMaterial else { continue }
                let pulse = 0.5 + 0.5 * sin(Float(time) * 2.0)
                mat.emission.intensity = CGFloat(0.8 + 0.3 * pulse)
                if let baseColor = mat.emission.contents as? UIColor {
                    let hueShift = CGFloat(0.05 * sin(Float(time) * 3.0))
                    var hue: CGFloat = 0, sat: CGFloat = 0, bri: CGFloat = 0, alpha: CGFloat = 0
                    baseColor.getHue(&hue, saturation: &sat, brightness: &bri, alpha: &alpha)
                    let newHue = (hue + hueShift).truncatingRemainder(dividingBy: 1.0)
                    mat.emission.contents = UIColor(hue: newHue, saturation: sat, brightness: bri, alpha: alpha)
                }
            }
        }

        // MARK: - Storm Animation on Gas Giants

        private func animateStorms(atTime time: TimeInterval) {
            // Animate Great Red Spot on Jupiter by rotating it slowly around sphere surface
            scene?.rootNode.enumerateChildNodes { node, _ in
                if node.name == "Jupiter" {
                    if let spotNode = node.childNode(withName: "GreatRedSpot", recursively: false) {
                        // Rotate the spot slowly
                        spotNode.eulerAngles.y += Float(0.02 * (1.0/60.0))
                    }
                }
            }
        }

        // MARK: - Nebula Animation

        private func animateNebulae(atTime time: TimeInterval) {
            for nebulaNode in nebulaNodes {
                // Slowly rotate nebula
                let rotationSpeed: Float = 0.005
                let frameDelta: Float = 1.0 / 60.0
                nebulaNode.eulerAngles.y += rotationSpeed * frameDelta

                // Pulse emission intensity subtly
                if let mat = nebulaNode.geometry?.firstMaterial {
                    // Break up the expression to help the type-checker
                    let timeF = Float(time)
                    let frequency: Float = 1.5
                    // Create a deterministic per-node phase from its hash
                    let hashValue = nebulaNode.hash
                    let seed = Float(abs(hashValue % 10)) * 0.31415927 // small per-node phase offset
                    let phase = timeF * frequency + seed
                    let s = sin(phase)
                    let base: Float = 0.8
                    let amp: Float = 0.2
                    let pulse = base + amp * s
                    mat.emission.intensity = CGFloat(pulse)
                }
            }
        }

        // MARK: - Starfield Animation

        private func animateStarfield(atTime time: TimeInterval) {
            starfieldNode?.eulerAngles.y += Float(0.0007 * (1.0/60.0))
        }

        // MARK: - Dynamic Events Update

        private func updateDynamicEvents(atTime time: TimeInterval) {
            for i in 0..<dynamicEvents.count {
                var event = dynamicEvents[i]
                if !event.active && time >= event.startTime {
                    event.active = true
                    // Activate event node here (stub)
                    if let scene = scene {
                        switch event.type {
                        case .meteorShower:
                            event.node = createMeteorShowerNode()
                            if let node = event.node {
                                scene.rootNode.addChildNode(node)
                            }
                        case .eclipse:
                            // Eclipse event stub
                            break
                        case .comet:
                            // Comet event stub
                            break
                        }
                    }
                    dynamicEvents[i] = event
                }
                if event.active && time >= event.startTime + event.duration {
                    // Deactivate and remove event node
                    if let node = event.node {
                        node.removeFromParentNode()
                    }
                    event.active = false
                    event.node = nil
                    dynamicEvents[i] = event
                }
            }
        }

        // MARK: - Meteor Shower Effect (Stub)

        private func createMeteorShowerNode() -> SCNNode {
            let meteorNode = SCNNode()
            meteorNode.name = "MeteorShower"

            // Create simple particle system for meteors
            let meteorParticles = SCNParticleSystem()
            meteorParticles.birthRate = 150
            meteorParticles.particleLifeSpan = 3.0
            meteorParticles.emissionDuration = 0
            meteorParticles.emittingDirection = SCNVector3(-1, -1, 0)
            meteorParticles.spreadingAngle = 15
            meteorParticles.particleSize = 0.05
            meteorParticles.particleColor = UIColor.white
            meteorParticles.particleColorVariation = SCNVector4(0.2, 0.2, 0.2, 0)
            meteorParticles.particleVelocity = 7.0
            meteorParticles.particleVelocityVariation = 3.0
            meteorParticles.acceleration = SCNVector3(0, -9.8, 0)
            meteorParticles.particleImage = UIImage(systemName: "sparkle") ?? nil
            meteorParticles.isAffectedByGravity = false
            meteorParticles.blendMode = .additive

            meteorNode.addParticleSystem(meteorParticles)
            meteorNode.position = SCNVector3(40, 40, 0)
            meteorNode.eulerAngles = SCNVector3(-Float.pi / 4, 0, 0)

            return meteorNode
        }

        // MARK: - Camera Fly-To Control

        func startCameraFlyTo(targetNode: SCNNode) {
            cameraNode = view?.pointOfView
            cameraFlyToTarget = targetNode
            cameraFlyStartTime = CACurrentMediaTime()
        }

        private func updateCameraFlyTo(atTime time: TimeInterval) {
            guard let cameraNode = cameraNode else { return }
            guard let target = cameraFlyToTarget else { return }
            guard let start = cameraFlyStartTime else { return }

            let elapsed = time - start
            if elapsed > cameraFlyDuration {
                // Finish animation and set camera to final position and orientation
                cameraNode.position = target.worldPosition
                cameraNode.look(at: target.worldPosition)
                cameraFlyToTarget = nil
                cameraFlyStartTime = nil
                return
            }

            // Interpolate position
            let t = Float(elapsed / cameraFlyDuration)
            let startPos = cameraNode.position
            let endPos = SCNVector3(target.worldPosition.x, target.worldPosition.y + 2.0, target.worldPosition.z + 6.0)

            let lerpPos = SCNVector3(
                startPos.x + (endPos.x - startPos.x) * t,
                startPos.y + (endPos.y - startPos.y) * t,
                startPos.z + (endPos.z - startPos.z) * t
            )
            cameraNode.position = lerpPos

            // Interpolate look-at - just look directly at target position for simplicity
            cameraNode.look(at: target.worldPosition)
        }

        // MARK: - Register aurora nodes for animation

        func registerAuroraNode(_ node: SCNNode) {
            auroraNodes.append(node)
        }

        // MARK: - Register nebula nodes for animation

        func registerNebulaNode(_ node: SCNNode) {
            nebulaNodes.append(node)
        }

        // MARK: - Register starfield node for animation

        func registerStarfieldNode(_ node: SCNNode) {
            starfieldNode = node
        }
    }

    func makeCoordinator() -> Coordinator {
        // Will be initialized in makeUIView after nodes are created
        return Coordinator(view: nil, scene: nil, sunLightNode: nil)
    }

    func makeUIView(context: Context) -> SCNView {
        let scnView = SCNView()
        let scene = SCNScene()
        context.coordinator.scene = scene
        context.coordinator.view = scnView

        scnView.scene = scene
        scnView.backgroundColor = .black
        scnView.antialiasingMode = .multisampling4X
        scnView.allowsCameraControl = true
        scnView.autoenablesDefaultLighting = false
        scnView.showsStatistics = false

        // Enable HDR rendering pipeline
        scnView.rendersContinuously = true

        // Setup camera with HDR
        setupCamera(scene: scene, scnView: scnView)
        // Camera node will be returned by setupCamera

        // Create the sun with volumetric glow
        createSun(scene: scene)

        // Create planets with PBR materials and atmospheres
        createPlanets(scene: scene, coordinator: context.coordinator)

        // Create realistic starfield
        createStarfield(scene: scene, coordinator: context.coordinator)

        // Create nebula background
        createNebula(scene: scene, coordinator: context.coordinator)

        // Setup advanced lighting
        setupLighting(scene: scene)

        // After lighting setup, assign sunLightNode to coordinator and set delegate
        if let sun = scene.rootNode.childNodes.first(where: { $0.light?.type == .omni }) {
            sun.name = "MainSunLight"
            context.coordinator.sunLightNode = sun
        }
        scnView.delegate = context.coordinator

        // Apply post-processing (bloom, tone mapping, vignette, motion blur overlay)
        applyPostProcessing(scnView: scnView)

        if cinematicMode {
            let grain = GrainOverlayView(frame: scnView.bounds)
            grain.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            scnView.addSubview(grain)
        }

        // Coordinator is now wired to update atmosphere sunDir each frame and rings cast shadows.

        return scnView
    }

    func updateUIView(_ uiView: SCNView, context: Context) {}

    // MARK: - Camera Setup with HDR and fly-to stub
    private func setupCamera(scene: SCNScene, scnView: SCNView) {
        let camera = SCNCamera()
        camera.zNear = 0.1
        camera.zFar = 500
        camera.fieldOfView = 60

        // HDR and tone mapping
        camera.wantsHDR = true
        camera.exposureOffset = cinematicMode ? 0.2 : 0
        camera.averageGray = cinematicMode ? 0.18 : 0.18
        camera.whitePoint = cinematicMode ? 1.2 : 1.0
        camera.minimumExposure = -8
        camera.maximumExposure = 10

        // Bloom effect
        camera.bloomIntensity = cinematicMode ? 0.85 : 0.5
        camera.bloomThreshold = cinematicMode ? 0.75 : 0.8
        camera.bloomBlurRadius = cinematicMode ? 14 : 10

        // Depth of field (subtle)
        camera.wantsDepthOfField = cinematicMode
        camera.focusDistance = cinematicMode ? 20 : 30
        camera.fStop = cinematicMode ? 2.4 : 5.6

        // Motion blur
        camera.motionBlurIntensity = cinematicMode ? 0.3 : 0.1

        // Screen space ambient occlusion
        camera.screenSpaceAmbientOcclusionIntensity = cinematicMode ? 0.45 : 0.3
        camera.screenSpaceAmbientOcclusionRadius = cinematicMode ? 6 : 5
        camera.screenSpaceAmbientOcclusionDepthThreshold = 0.2

        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 15, 45)
        cameraNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(cameraNode)
        scnView.pointOfView = cameraNode

        if cinematicMode {
            let drift = SCNAction.repeatForever(.sequence([
                .moveBy(x: 0.0, y: 0.2, z: -0.6, duration: 6.0),
                .moveBy(x: 0.0, y: -0.2, z: 0.6, duration: 6.0)
            ]))
            drift.timingMode = .easeInEaseOut
            cameraNode.runAction(drift)
        }
    }

    // MARK: - Sun with Volumetric Glow
    private func createSun(scene: SCNScene) {
        // Core sun sphere
        let sunGeometry = SCNSphere(radius: 2.5)
        sunGeometry.segmentCount = 64

        let sunMaterial = SCNMaterial()
        sunMaterial.lightingModel = .constant
        sunMaterial.diffuse.contents = UIColor.black
        sunMaterial.emission.contents = createSunTexture()
        sunMaterial.emission.intensity = 2.0
        sunMaterial.multiply.contents = UIColor(red: 1.0, green: 0.9, blue: 0.7, alpha: 1.0)
        sunGeometry.materials = [sunMaterial]

        let sunNode = SCNNode(geometry: sunGeometry)
        sunNode.name = "Sun"
        sunNode.position = SCNVector3(0, 0, 0)

        // Sun rotation
        let sunRotation = SCNAction.repeatForever(
            SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 25)
        )
        sunNode.runAction(sunRotation)
        scene.rootNode.addChildNode(sunNode)

        // Corona/glow layers
        for i in 1...4 {
            let glowRadius = 2.5 + Double(i) * 0.8
            let glowGeometry = SCNSphere(radius: glowRadius)
            glowGeometry.segmentCount = 32

            let glowMaterial = SCNMaterial()
            glowMaterial.lightingModel = .constant
            glowMaterial.diffuse.contents = UIColor.clear
            glowMaterial.emission.contents = UIColor(
                red: 1.0,
                green: 0.6 + CGFloat(i) * 0.1,
                blue: 0.2,
                alpha: 0.3 / CGFloat(i)
            )
            glowMaterial.emission.intensity = 1.5 / CGFloat(i)
            glowMaterial.isDoubleSided = true
            glowMaterial.blendMode = .add
            glowMaterial.writesToDepthBuffer = false
            glowGeometry.materials = [glowMaterial]

            let glowNode = SCNNode(geometry: glowGeometry)
            glowNode.name = "SunGlow\(i)"
            sunNode.addChildNode(glowNode)
        }

        // Solar flares particle system
        if let flareSystem = createSolarFlareParticles() {
            sunNode.addParticleSystem(flareSystem)
        }
    }

    // MARK: - Create Sun Texture Procedurally
    private func createSunTexture() -> UIImage {
        let size = CGSize(width: 1024, height: 512)
        let renderer = UIGraphicsImageRenderer(size: size)

        return renderer.image { ctx in
            let context = ctx.cgContext

            // Base orange-yellow gradient
            let colors = [
                UIColor(red: 1.0, green: 0.95, blue: 0.6, alpha: 1.0).cgColor,
                UIColor(red: 1.0, green: 0.7, blue: 0.3, alpha: 1.0).cgColor,
                UIColor(red: 1.0, green: 0.5, blue: 0.1, alpha: 1.0).cgColor
            ]
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                       colors: colors as CFArray,
                                       locations: [0, 0.5, 1])!

            context.drawLinearGradient(gradient,
                                        start: CGPoint(x: 0, y: 0),
                                        end: CGPoint(x: size.width, y: size.height),
                                        options: [])

            // Add noise/turbulence for surface detail
            for _ in 0..<500 {
                let x = CGFloat.random(in: 0...size.width)
                let y = CGFloat.random(in: 0...size.height)
                let radius = CGFloat.random(in: 2...15)
                let alpha = CGFloat.random(in: 0.1...0.4)

                let spotColor = Bool.random() ?
                    UIColor(red: 1.0, green: 0.9, blue: 0.5, alpha: alpha) :
                    UIColor(red: 1.0, green: 0.4, blue: 0.1, alpha: alpha)

                context.setFillColor(spotColor.cgColor)
                context.fillEllipse(in: CGRect(x: x - radius, y: y - radius,
                                               width: radius * 2, height: radius * 2))
            }
        }
    }

    // MARK: - Solar Flare Particles
    private func createSolarFlareParticles() -> SCNParticleSystem? {
        let particles = SCNParticleSystem()
        particles.particleColor = UIColor(red: 1.0, green: 0.6, blue: 0.2, alpha: 0.8)
        particles.particleColorVariation = SCNVector4(0.1, 0.2, 0.1, 0.2)
        particles.particleSize = 0.3
        particles.particleSizeVariation = 0.2
        particles.birthRate = 50
        particles.particleLifeSpan = 2.0
        particles.particleLifeSpanVariation = 1.0
        particles.spreadingAngle = 180
        particles.emitterShape = SCNSphere(radius: 2.5)
        particles.particleVelocity = 0.5
        particles.particleVelocityVariation = 0.3
        particles.blendMode = .additive
        particles.isAffectedByGravity = false
        particles.isAffectedByPhysicsFields = false
        return particles
    }

    // MARK: - Planets with PBR Materials and NASA/ESA textures + animations
    private func createPlanets(scene: SCNScene, coordinator: Coordinator) {
        // Break out tuples into separate variables for compiler sanity
        let mercury = (
            name: "Mercury",
            radius: Float(0.25),
            distance: Float(5.0),
            color: UIColor(red: 0.6, green: 0.5, blue: 0.5, alpha: 1),
            hasAtmosphere: false,
            atmosphereColor: UIColor.clear,
            metalness: Float(0.1),
            roughness: Float(0.9),
            hasRings: false,
            orbitSpeed: Double(8.0),
            rotationSpeed: Double(1.5)
        )
        let venus = (
            name: "Venus",
            radius: Float(0.35),
            distance: Float(7.0),
            color: UIColor(red: 0.9, green: 0.8, blue: 0.6, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 1.0, green: 0.9, blue: 0.7, alpha: 0.3),
            metalness: Float(0.0),
            roughness: Float(0.7),
            hasRings: false,
            orbitSpeed: Double(12.0),
            rotationSpeed: Double(4.0)
        )
        let earth = (
            name: "Earth",
            radius: Float(0.38),
            distance: Float(9.5),
            color: UIColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 0.6, green: 0.8, blue: 1.0, alpha: 0.25),
            metalness: Float(0.0),
            roughness: Float(0.5),
            hasRings: false,
            orbitSpeed: Double(15.0),
            rotationSpeed: Double(1.0)
        )
        let mars = (
            name: "Mars",
            radius: Float(0.30),
            distance: Float(12.0),
            color: UIColor(red: 0.8, green: 0.4, blue: 0.2, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 1.0, green: 0.8, blue: 0.6, alpha: 0.1),
            metalness: Float(0.2),
            roughness: Float(0.8),
            hasRings: false,
            orbitSpeed: Double(20.0),
            rotationSpeed: Double(1.1)
        )
        let jupiter = (
            name: "Jupiter",
            radius: Float(0.80),
            distance: Float(18.0),
            color: UIColor(red: 0.8, green: 0.7, blue: 0.6, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 0.9, green: 0.8, blue: 0.7, alpha: 0.15),
            metalness: Float(0.0),
            roughness: Float(0.6),
            hasRings: false,
            orbitSpeed: Double(35.0),
            rotationSpeed: Double(0.4)
        )
        let saturn = (
            name: "Saturn",
            radius: Float(0.70),
            distance: Float(25.0),
            color: UIColor(red: 0.9, green: 0.85, blue: 0.7, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 1.0, green: 0.95, blue: 0.8, alpha: 0.1),
            metalness: Float(0.0),
            roughness: Float(0.5),
            hasRings: true,
            orbitSpeed: Double(50.0),
            rotationSpeed: Double(0.45)
        )
        let uranus = (
            name: "Uranus",
            radius: Float(0.50),
            distance: Float(32.0),
            color: UIColor(red: 0.6, green: 0.85, blue: 0.9, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 0.7, green: 0.9, blue: 1.0, alpha: 0.15),
            metalness: Float(0.0),
            roughness: Float(0.4),
            hasRings: true,
            orbitSpeed: Double(70.0),
            rotationSpeed: Double(0.7)
        )
        let neptune = (
            name: "Neptune",
            radius: Float(0.48),
            distance: Float(38.0),
            color: UIColor(red: 0.3, green: 0.5, blue: 0.9, alpha: 1),
            hasAtmosphere: true,
            atmosphereColor: UIColor(red: 0.4, green: 0.6, blue: 1.0, alpha: 0.2),
            metalness: Float(0.0),
            roughness: Float(0.4),
            hasRings: false,
            orbitSpeed: Double(90.0),
            rotationSpeed: Double(0.65)
        )

        let planetData = [mercury, venus, earth, mars, jupiter, saturn, uranus, neptune]

        for planet in planetData {
            let name = planet.name
            let radius = planet.radius
            let distance = planet.distance
            let color = planet.color
            let hasAtmosphere = planet.hasAtmosphere
            let atmosphereColor = planet.atmosphereColor
            let metalness = planet.metalness
            let roughness = planet.roughness
            let hasRings = planet.hasRings
            let orbitSpeed = planet.orbitSpeed
            let rotationSpeed = planet.rotationSpeed

            // Orbital container
            let orbitNode = SCNNode()
            orbitNode.position = SCNVector3(0, 0, 0)
            orbitNode.name = "\(name)Orbit"

            // Create orbit ring visual
            let orbitRing = createOrbitRing(radius: distance)
            scene.rootNode.addChildNode(orbitRing)

            // Planet geometry with high detail
            let planetGeometry = SCNSphere(radius: CGFloat(radius))
            planetGeometry.segmentCount = 48

            // PBR Material
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased

            // Use NASA/ESA high-res textures if available, else fallback to procedural
            if let nasaTexture = loadNasaTexture(for: name) {
                material.diffuse.contents = nasaTexture
            } else {
                material.diffuse.contents = createPlanetTexture(baseColor: color, name: name)
            }

            material.metalness.contents = metalness
            material.roughness.contents = roughness
            material.normal.contents = createNormalMapTexture()
            material.normal.intensity = 0.3
            material.ambientOcclusion.contents = UIColor(white: 0.8, alpha: 1.0)
            material.ambientOcclusion.intensity = 0.5
            planetGeometry.materials = [material]

            let planetNode = SCNNode(geometry: planetGeometry)
            planetNode.name = name
            planetNode.position = SCNVector3(distance, 0, 0)

            // Ensure planet casts and receives shadows properly
            planetNode.castsShadow = false
            planetNode.categoryBitMask = 1
            planetNode.geometry?.firstMaterial?.writesToDepthBuffer = true

            if cinematicMode && (name == "Earth" || name == "Saturn") {
                planetNode.geometry?.firstMaterial?.roughness.contents = 0.45
                planetNode.geometry?.firstMaterial?.ambientOcclusion.intensity = 0.6
            }

            // Add clouds layer for applicable planets with animation
            if name == "Earth" || name == "Venus" || name == "Mars" {
                let cloudsNode = createClouds(radius: CGFloat(radius * 1.015))
                cloudsNode.name = "Clouds"
                planetNode.addChildNode(cloudsNode)

                // If Earth, add aurora effects too
                if name == "Earth" {
                    let auroraNode = createAurora(radius: CGFloat(radius * 1.025))
                    planetNode.addChildNode(auroraNode)
                    coordinator.registerAuroraNode(auroraNode)
                }
            }

            // Add atmosphere if applicable
            if hasAtmosphere {
                let atmosphere = createAtmosphere(
                    radius: CGFloat(radius),
                    color: atmosphereColor
                )
                planetNode.addChildNode(atmosphere)
            }

            // Add rings for Saturn and Uranus
            if hasRings {
                let rings = createPlanetRings(
                    innerRadius: CGFloat(radius) * 1.3,
                    outerRadius: CGFloat(radius) * 2.5,
                    planetName: name
                )
                planetNode.addChildNode(rings)
                if name == "Saturn" {
                    addRingContactShadow(to: planetNode, inner: CGFloat(radius) * 1.3, outer: CGFloat(radius) * 2.5)
                }
            }

            // Add gas giant storms (e.g. Great Red Spot)
            if name == "Jupiter" {
                let greatRedSpot = createGreatRedSpot(radius: CGFloat(radius))
                planetNode.addChildNode(greatRedSpot)
            }

            // Add moon for Earth
            if name == "Earth" {
                let moon = createMoon()
                planetNode.addChildNode(moon)
            }

            orbitNode.addChildNode(planetNode)
            scene.rootNode.addChildNode(orbitNode)

            // Orbital animation
            let orbitAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: orbitSpeed)
            )
            orbitNode.runAction(orbitAction)

            // Planet rotation
            let rotateAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: rotationSpeed)
            )
            planetNode.runAction(rotateAction)
        }
    }

    // MARK: - Load NASA/ESA Texture if available (conditional)
    private func loadNasaTexture(for planetName: String) -> UIImage? {
        // Use bundled or downloaded higher-res NASA/ESA textures if available.
        // For demonstration, check asset catalog by name convention "NASA_{PlanetName}"
        let imageName = "NASA_\(planetName)"
        return UIImage(named: imageName)
    }

    // MARK: - Clouds Layer
    private func createClouds(radius: CGFloat) -> SCNNode {
        let cloudsGeometry = SCNSphere(radius: radius)
        cloudsGeometry.segmentCount = 48

        let cloudsMaterial = SCNMaterial()
        cloudsMaterial.lightingModel = .physicallyBased
        cloudsMaterial.diffuse.contents = UIImage(named: "CloudsTexture") ?? UIColor(white: 1.0, alpha: 0.3) // placeholder cloud texture
        cloudsMaterial.transparency = 0.4
        cloudsMaterial.isDoubleSided = true
        cloudsMaterial.writesToDepthBuffer = false
        cloudsMaterial.blendMode = .alpha
        cloudsGeometry.materials = [cloudsMaterial]

        let cloudsNode = SCNNode(geometry: cloudsGeometry)
        return cloudsNode
    }

    // MARK: - Aurora Effect
    private func createAurora(radius: CGFloat) -> SCNNode {
        let auroraGeometry = SCNSphere(radius: radius)
        auroraGeometry.segmentCount = 64

        let auroraMaterial = SCNMaterial()
        auroraMaterial.lightingModel = .constant
        auroraMaterial.diffuse.contents = UIColor.clear
        auroraMaterial.emission.contents = UIColor.green.withAlphaComponent(0.3)
        auroraMaterial.isDoubleSided = true
        auroraMaterial.blendMode = .add
        auroraMaterial.writesToDepthBuffer = false
        auroraGeometry.materials = [auroraMaterial]

        let auroraNode = SCNNode(geometry: auroraGeometry)
        return auroraNode
    }

    // MARK: - Great Red Spot Storm on Jupiter
    private func createGreatRedSpot(radius: CGFloat) -> SCNNode {
        // Small flattened sphere on surface of Jupiter representing storm
        let spotGeometry = SCNSphere(radius: radius * 0.18)
        spotGeometry.segmentCount = 24

        let spotMaterial = SCNMaterial()
        spotMaterial.lightingModel = .physicallyBased
        spotMaterial.diffuse.contents = UIColor(red: 0.85, green: 0.4, blue: 0.3, alpha: 0.8)
        spotMaterial.emission.contents = UIColor(red: 0.9, green: 0.35, blue: 0.25, alpha: 0.4)
        spotMaterial.isDoubleSided = false
        spotMaterial.roughness.contents = 0.8
        spotGeometry.materials = [spotMaterial]

        let spotNode = SCNNode(geometry: spotGeometry)
        spotNode.name = "GreatRedSpot"

        // Position on giant planet surface (slightly tilted)
        let latitude = CGFloat.pi / 3.8
        let longitude = CGFloat.pi / 5.0
        let radiusCG = radius
        let x = radiusCG * sin(latitude) * cos(longitude)
        let y = radiusCG * cos(latitude)
        let z = radiusCG * sin(latitude) * sin(longitude)
        spotNode.position = SCNVector3(Float(x), Float(y), Float(z))

        // Align sphere normal outwards
        spotNode.look(at: SCNVector3(0, 0, 0), up: spotNode.worldUp, localFront: spotNode.worldPosition)

        return spotNode
    }

    private func addRingContactShadow(to planetNode: SCNNode, inner: CGFloat, outer: CGFloat) {
        // A thin dark torus hugging the planet surface to emulate ring shadow contact
        let torus = SCNTube(innerRadius: inner * 1.02, outerRadius: outer * 0.98, height: 0.002)
        torus.radialSegmentCount = 96
        let mat = SCNMaterial()
        mat.lightingModel = .constant
        mat.diffuse.contents = UIColor(white: 0, alpha: 0.12)
        mat.isDoubleSided = true
        mat.blendMode = .multiply
        mat.writesToDepthBuffer = false
        torus.materials = [mat]
        let node = SCNNode(geometry: torus)
        node.eulerAngles.x = .pi / 2
        planetNode.addChildNode(node)
    }

    // MARK: - Create Planet Texture
    private func createPlanetTexture(baseColor: UIColor, name: String) -> UIImage {
        let size = CGSize(width: 512, height: 256)
        let renderer = UIGraphicsImageRenderer(size: size)

        return renderer.image { ctx in
            let context = ctx.cgContext

            // Fill with base color
            context.setFillColor(baseColor.cgColor)
            context.fill(CGRect(origin: .zero, size: size))

            // Add surface details based on planet type
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            baseColor.getRed(&r, green: &g, blue: &b, alpha: &a)

            // Add bands for gas giants
            if name == "Jupiter" || name == "Saturn" {
                for i in 0..<20 {
                    let y = CGFloat(i) * size.height / 20
                    let bandColor = UIColor(
                        red: r + CGFloat.random(in: -0.1...0.1),
                        green: g + CGFloat.random(in: -0.1...0.1),
                        blue: b + CGFloat.random(in: -0.05...0.05),
                        alpha: 1.0
                    )
                    context.setFillColor(bandColor.cgColor)
                    context.fill(CGRect(x: 0, y: y, width: size.width, height: size.height / 20 + 2))
                }

                // Jupiter's Great Red Spot
                if name == "Jupiter" {
                    context.setFillColor(UIColor(red: 0.85, green: 0.4, blue: 0.3, alpha: 0.8).cgColor)
                    context.fillEllipse(in: CGRect(x: size.width * 0.6, y: size.height * 0.55,
                                                    width: 60, height: 35))
                }
            }

            // Add craters/features for rocky planets
            if name == "Mercury" || name == "Mars" || name == "Venus" {
                for _ in 0..<50 {
                    let x = CGFloat.random(in: 0...size.width)
                    let y = CGFloat.random(in: 0...size.height)
                    let craterSize = CGFloat.random(in: 3...15)
                    let craterColor = UIColor(
                        red: r * CGFloat.random(in: 0.7...1.1),
                        green: g * CGFloat.random(in: 0.7...1.1),
                        blue: b * CGFloat.random(in: 0.8...1.0),
                        alpha: 0.6
                    )
                    context.setFillColor(craterColor.cgColor)
                    context.fillEllipse(in: CGRect(x: x, y: y, width: craterSize, height: craterSize))
                }
            }

            // Earth-specific: continents and oceans
            if name == "Earth" {
                // Add green landmasses
                let landColor = UIColor(red: 0.3, green: 0.6, blue: 0.3, alpha: 0.7)
                context.setFillColor(landColor.cgColor)

                // Simplified continent shapes
                context.fillEllipse(in: CGRect(x: 80, y: 60, width: 100, height: 80))  // Americas-ish
                context.fillEllipse(in: CGRect(x: 280, y: 50, width: 120, height: 100)) // Eurasia-ish
                context.fillEllipse(in: CGRect(x: 320, y: 150, width: 50, height: 60))  // Africa-ish

                // Add clouds
                context.setFillColor(UIColor(white: 1.0, alpha: 0.4).cgColor)
                for _ in 0..<30 {
                    let x = CGFloat.random(in: 0...size.width)
                    let y = CGFloat.random(in: 0...size.height)
                    context.fillEllipse(in: CGRect(x: x, y: y,
                                                    width: CGFloat.random(in: 20...60),
                                                    height: CGFloat.random(in: 10...25)))
                }
            }

            // Ice caps for applicable planets
            if name == "Earth" || name == "Mars" {
                context.setFillColor(UIColor(white: 0.95, alpha: 0.8).cgColor)
                context.fillEllipse(in: CGRect(x: 0, y: -20, width: size.width, height: 50))
                context.fillEllipse(in: CGRect(x: 0, y: size.height - 30, width: size.width, height: 50))
            }
        }
    }

    // MARK: - Normal Map Texture
    private func createNormalMapTexture() -> UIImage {
        let size = CGSize(width: 256, height: 256)
        let renderer = UIGraphicsImageRenderer(size: size)

        return renderer.image { ctx in
            let context = ctx.cgContext

            // Base normal (pointing up in tangent space = RGB 128, 128, 255)
            context.setFillColor(UIColor(red: 0.5, green: 0.5, blue: 1.0, alpha: 1.0).cgColor)
            context.fill(CGRect(origin: .zero, size: size))

            // Add subtle normal variations
            for _ in 0..<200 {
                let x = CGFloat.random(in: 0...size.width)
                let y = CGFloat.random(in: 0...size.height)
                let normalColor = UIColor(
                    red: 0.5 + CGFloat.random(in: -0.1...0.1),
                    green: 0.5 + CGFloat.random(in: -0.1...0.1),
                    blue: 1.0,
                    alpha: 0.5
                )
                context.setFillColor(normalColor.cgColor)
                context.fillEllipse(in: CGRect(x: x, y: y,
                                                width: CGFloat.random(in: 5...20),
                                                height: CGFloat.random(in: 5...20)))
            }
        }
    }

    // MARK: - Atmosphere Shader
    private func createAtmosphere(radius: CGFloat, color: UIColor) -> SCNNode {
        let root = SCNNode()
        root.name = "Atmosphere"

        // Inner soft glow
        let innerGeo = SCNSphere(radius: radius * 1.04)
        innerGeo.segmentCount = 48
        let innerMat = SCNMaterial()
        innerMat.lightingModel = .constant
        innerMat.diffuse.contents = UIColor.clear
        innerMat.emission.contents = color.withAlphaComponent(0.15)
        innerMat.transparent.contents = UIColor.white
        innerMat.transparency = 0.35
        innerMat.isDoubleSided = true
        innerMat.blendMode = .add
        innerMat.writesToDepthBuffer = false
        innerGeo.materials = [innerMat]
        let innerNode = SCNNode(geometry: innerGeo)
        root.addChildNode(innerNode)

        // Outer scattering shell
        let outerGeo = SCNSphere(radius: radius * 1.10)
        outerGeo.segmentCount = 64
        let outerMat = SCNMaterial()
        outerMat.lightingModel = .constant
        outerMat.diffuse.contents = UIColor.clear
        outerMat.isDoubleSided = true
        outerMat.blendMode = .add
        outerMat.writesToDepthBuffer = false

        // Metal-compatible shader modifier for atmosphere scattering and rim lighting
        // Using correct SceneKit Metal surface variables
        let frag = """
        #pragma arguments
        float3 sunDir;
        float mieG;
        float rayleighStrength;
        float mieStrength;
        float rimBoost;
        #pragma body
        float3 N = normalize(_surface.normal);
        float3 V = normalize(_surface.view);
        float cosTheta = clamp(dot(V, sunDir), -1.0, 1.0);

        // Rayleigh phase function approximation
        float rayleigh = 0.75 * (1.0 + cosTheta * cosTheta);

        // Henyey-Greenstein phase function for Mie scattering
        float g = mieG;
        float g2 = g * g;
        float denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
        float mie = (1.0 - g2) / (2.0 + g2) * (1.0 + cosTheta * cosTheta) / max(denom, 1e-3);

        // Rim term to enhance limb glow
        float rim = pow(1.0 - max(0.0, dot(N, V)), 3.0);

        // Combine scattering contributions
        float3 atmo = _surface.emission.rgb * (rayleigh * rayleighStrength + mie * mieStrength);
        atmo += _surface.emission.rgb * rim * rimBoost;

        // Alpha falls off toward center
        float alpha = clamp(rim * 0.8 + (rayleigh + mie) * 0.05, 0.0, 0.6);

        _output.color = float4(atmo, alpha);
        """

        outerMat.shaderModifiers = [ .fragment: frag ]
        outerMat.setValue(SCNVector3(1, 0.1, 0), forKey: "sunDir")
        outerMat.setValue(0.76, forKey: "mieG")
        outerMat.setValue(0.5, forKey: "rayleighStrength")
        outerMat.setValue(0.14, forKey: "mieStrength")
        outerMat.setValue(0.4, forKey: "rimBoost")
        outerMat.emission.contents = color.withAlphaComponent(0.6)
        outerGeo.materials = [outerMat]
        let outerNode = SCNNode(geometry: outerGeo)
        root.addChildNode(outerNode)

        return root
    }

    // MARK: - Planet Rings (Saturn, Uranus)
    private func createPlanetRings(innerRadius: CGFloat, outerRadius: CGFloat, planetName: String) -> SCNNode {
        let ringNode = SCNNode()
        ringNode.name = "\(planetName)Rings"

        // Single torus-like thin ring with textured material
        let ringGeometry = SCNTube(innerRadius: innerRadius, outerRadius: outerRadius, height: 0.01)
        ringGeometry.radialSegmentCount = 128
        ringGeometry.heightSegmentCount = 1

        let ringMaterial = SCNMaterial()
        ringMaterial.lightingModel = .physicallyBased
        ringMaterial.diffuse.contents = createRingTexture(planetName: planetName)
        ringMaterial.diffuse.wrapS = .repeat
        ringMaterial.diffuse.wrapT = .clamp
        ringMaterial.transparencyMode = .rgbZero
        ringMaterial.isDoubleSided = true
        ringMaterial.blendMode = .alpha
        ringMaterial.roughness.contents = 0.7
        ringMaterial.metalness.contents = 0.2
        ringMaterial.diffuse.mipFilter = .linear

        // Shader modifier for anisotropic-like highlight - using correct Metal/SceneKit variables
        let ringFrag = """
        #pragma body
        // Fake anisotropy: brighten when view aligns with ring plane
        float3 N = normalize(_surface.normal);
        float3 V = normalize(_surface.view);
        float grazing = pow(1.0 - abs(dot(N, V)), 2.0);
        _output.color.rgb *= (1.0 + 0.25 * grazing);
        """
        ringMaterial.shaderModifiers = [ .fragment: ringFrag ]

        ringGeometry.materials = [ringMaterial]

        let ringSegment = SCNNode(geometry: ringGeometry)
        ringNode.addChildNode(ringSegment)

        // Enable ring casting shadows
        ringSegment.castsShadow = true
        ringNode.childNodes.forEach { $0.castsShadow = true }

        // Tilt for Uranus
        if planetName == "Uranus" {
            ringNode.eulerAngles.x = .pi / 2 * 0.9
        }

        return ringNode
    }

    private func createRingTexture(planetName: String, width: Int = 2048, height: Int = 8) -> UIImage {
        let size = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: size)
        let isSaturn = planetName == "Saturn"
        return renderer.image { ctx in
            let context = ctx.cgContext
            // Base transparent
            context.setFillColor(UIColor.clear.cgColor)
            context.fill(CGRect(origin: .zero, size: size))

            // Generate radial bands horizontally (x axis is radius)
            for x in 0..<width {
                let t = CGFloat(x) / CGFloat(width - 1) // 0..1 radius fraction

                // Band density: mix of smooth steps and noise to create divisions
                // Cassini-like gap for Saturn around ~0.6..0.7
                var density: CGFloat = 0.65
                let noise = CGFloat.random(in: -0.12...0.12) * (0.6 + 0.4 * sin(t * 40))
                density += noise

                if isSaturn {
                    // Cassini Division
                    let cassini = smoothstep(edge0: 0.58, edge1: 0.62, x: t) - smoothstep(edge0: 0.68, edge1: 0.72, x: t)
                    density *= (1.0 - 0.8 * max(0, cassini))
                } else {
                    // Uranus thinner/darker rings: overall lower density with sparse opaque bands
                    density *= 0.5
                    if sin(t * 120) > 0.92 { density *= 0.2 }
                }

                density = max(0.0, min(1.0, density))

                // Color palette
                let base: UIColor
                if isSaturn {
                    // Warm beige palette with subtle variation
                    let r = 0.80 + CGFloat.random(in: -0.05...0.05)
                    let g = 0.74 + CGFloat.random(in: -0.05...0.05)
                    let b = 0.60 + CGFloat.random(in: -0.04...0.04)
                    base = UIColor(red: r, green: g, blue: b, alpha: 1.0)
                } else {
                    // Uranus: cooler, darker palette
                    base = UIColor(red: 0.35, green: 0.38, blue: 0.42, alpha: 1.0)
                }

                let alpha = 0.15 + 0.6 * density // translucency varies with density
                context.setFillColor(base.withAlphaComponent(alpha).cgColor)
                context.fill(CGRect(x: CGFloat(x), y: 0, width: 1, height: size.height))

                // Add subtle thin bright lines to emulate fine ringlets
                if isSaturn && x % 37 == 0 {
                    context.setFillColor(UIColor(white: 1.0, alpha: 0.25 * density).cgColor)
                    context.fill(CGRect(x: CGFloat(x), y: 0, width: 1, height: size.height))
                }
            }
        }
    }

    private func smoothstep(edge0: CGFloat, edge1: CGFloat, x: CGFloat) -> CGFloat {
        let t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
        return t * t * (3 - 2 * t)
    }

    // MARK: - Moon
    private func createMoon() -> SCNNode {
        let moonOrbit = SCNNode()
        moonOrbit.name = "MoonOrbit"

        let moonGeometry = SCNSphere(radius: 0.1)
        moonGeometry.segmentCount = 24

        let moonMaterial = SCNMaterial()
        moonMaterial.lightingModel = .physicallyBased
        moonMaterial.diffuse.contents = UIColor(white: 0.7, alpha: 1.0)
        moonMaterial.metalness.contents = 0.0
        moonMaterial.roughness.contents = 0.9
        moonGeometry.materials = [moonMaterial]

        let moonNode = SCNNode(geometry: moonGeometry)
        moonNode.name = "Moon"
        moonNode.position = SCNVector3(0.8, 0, 0)

        moonOrbit.addChildNode(moonNode)

        // Moon orbit around Earth
        let moonOrbitAction = SCNAction.repeatForever(
            SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 3.0)
        )
        moonOrbit.runAction(moonOrbitAction)

        return moonOrbit
    }

    // MARK: - Orbit Ring Visual
    private func createOrbitRing(radius: Float) -> SCNNode {
        let ringGeometry = SCNTorus(ringRadius: CGFloat(radius), pipeRadius: 0.02)
        ringGeometry.ringSegmentCount = 128

        let ringMaterial = SCNMaterial()
        ringMaterial.lightingModel = .constant
        ringMaterial.diffuse.contents = UIColor.clear
        ringMaterial.emission.contents = UIColor(white: 0.3, alpha: 0.3)
        ringMaterial.isDoubleSided = true
        ringMaterial.blendMode = .add
        ringGeometry.materials = [ringMaterial]

        let ringNode = SCNNode(geometry: ringGeometry)
        ringNode.eulerAngles.x = .pi / 2
        return ringNode
    }

    // MARK: - Starfield with subtle animation support
    private func createStarfield(scene: SCNScene, coordinator: Coordinator) {
        let starContainer = SCNNode()
        starContainer.name = "Starfield"

        // Multiple star layers for depth
        let starLayers: [(count: Int, minDist: Float, maxDist: Float, minSize: CGFloat, maxSize: CGFloat)] = [
            (800, 80, 120, 0.02, 0.05),   // Distant dim stars
            (400, 60, 80, 0.04, 0.08),    // Medium stars
            (100, 50, 60, 0.05, cinematicMode ? 0.10 : 0.15),    // Closer bright stars
            (20, 45, 55, 0.08, cinematicMode ? 0.18 : 0.25)       // Very bright stars
        ]

        for layer in starLayers {
            for _ in 0..<layer.count {
                let starGeometry = SCNSphere(radius: CGFloat.random(in: layer.minSize...layer.maxSize))
                starGeometry.segmentCount = 6

                let starMaterial = SCNMaterial()
                starMaterial.lightingModel = .constant
                starMaterial.diffuse.contents = UIColor.clear

                // Vary star colors (blue, white, yellow, orange)
                let colorChoice = Int.random(in: 0...10)
                let starColor: UIColor
                switch colorChoice {
                    case 0...2:
                        starColor = UIColor(red: 0.8, green: 0.9, blue: 1.0, alpha: 1.0) // Blue-white
                    case 3...6:
                        starColor = UIColor(red: 1.0, green: 1.0, blue: 0.95, alpha: 1.0) // White
                    case 7...8:
                        starColor = UIColor(red: 1.0, green: 0.95, blue: 0.8, alpha: 1.0) // Yellow
                    default:
                        starColor = UIColor(red: 1.0, green: 0.8, blue: 0.6, alpha: 1.0) // Orange
                }

                starMaterial.emission.contents = starColor
                starMaterial.emission.intensity = CGFloat.random(in: 0.8...2.0)
                starGeometry.materials = [starMaterial]

                let starNode = SCNNode(geometry: starGeometry)

                // Random spherical distribution
                let distance = Float.random(in: layer.minDist...layer.maxDist)
                let theta = Float.random(in: 0...Float.pi * 2)
                let phi = Float.random(in: 0...Float.pi)

                starNode.position = SCNVector3(
                    distance * sin(phi) * cos(theta),
                    distance * cos(phi),
                    distance * sin(phi) * sin(theta)
                )

                starContainer.addChildNode(starNode)
            }
        }

        // Subtle rotation for star parallax effect (registered for animation)
        coordinator.registerStarfieldNode(starContainer)

        scene.rootNode.addChildNode(starContainer)
    }

    // MARK: - Nebula Background with animation registration
    private func createNebula(scene: SCNScene, coordinator: Coordinator) {
        // Create several nebula clouds
        let nebulaColors: [UIColor] = [
            UIColor(red: 0.4, green: 0.2, blue: 0.6, alpha: 0.15),  // Purple
            UIColor(red: 0.2, green: 0.3, blue: 0.6, alpha: 0.12),  // Blue
            UIColor(red: 0.6, green: 0.2, blue: 0.3, alpha: 0.10),  // Red/pink
            UIColor(red: 0.2, green: 0.5, blue: 0.4, alpha: 0.08)   // Teal
        ]

        for (index, color) in nebulaColors.enumerated() {
            let nebulaGeometry = SCNSphere(radius: 150 + CGFloat(index) * 20)
            nebulaGeometry.segmentCount = 32

            let nebulaMaterial = SCNMaterial()
            nebulaMaterial.lightingModel = .constant
            nebulaMaterial.diffuse.contents = UIColor.clear
            nebulaMaterial.emission.contents = createNebulaTexture(color: color)
            nebulaMaterial.emission.intensity = 0.5
            nebulaMaterial.isDoubleSided = true
            nebulaMaterial.blendMode = .add
            nebulaMaterial.cullMode = .front
            nebulaGeometry.materials = [nebulaMaterial]

            let nebulaNode = SCNNode(geometry: nebulaGeometry)
            nebulaNode.name = "Nebula\(index)"
            nebulaNode.eulerAngles = SCNVector3(
                Float.random(in: 0...Float.pi),
                Float.random(in: 0...Float.pi),
                Float.random(in: 0...Float.pi)
            )

            coordinator.registerNebulaNode(nebulaNode)
            scene.rootNode.addChildNode(nebulaNode)
        }
    }

    // MARK: - Nebula Texture
    private func createNebulaTexture(color: UIColor) -> UIImage {
        let size = CGSize(width: 512, height: 256)
        let renderer = UIGraphicsImageRenderer(size: size)

        return renderer.image { ctx in
            let context = ctx.cgContext

            // Start with transparent
            context.setFillColor(UIColor.clear.cgColor)
            context.fill(CGRect(origin: .zero, size: size))

            // Add cloudy nebula patches
            for _ in 0..<100 {
                let x = CGFloat.random(in: 0...size.width)
                let y = CGFloat.random(in: 0...size.height)
                let patchSize = CGFloat.random(in: 30...150)

                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                color.getRed(&r, green: &g, blue: &b, alpha: &a)

                let patchColor = UIColor(
                    red: r + CGFloat.random(in: -0.1...0.1),
                    green: g + CGFloat.random(in: -0.1...0.1),
                    blue: b + CGFloat.random(in: -0.1...0.1),
                    alpha: a * CGFloat.random(in: 0.3...1.0)
                )

                context.setFillColor(patchColor.cgColor)
                context.fillEllipse(in: CGRect(x: x - patchSize/2, y: y - patchSize/2,
                                                width: patchSize, height: patchSize * 0.6))
            }
        }
    }

    // MARK: - Advanced Lighting Setup
    private func setupLighting(scene: SCNScene) {
        // Main sun light (point light at center)
        let sunLight = SCNLight()
        sunLight.type = .omni
        sunLight.intensity = 2500
        sunLight.color = UIColor(red: 1.0, green: 0.95, blue: 0.85, alpha: 1.0)
        sunLight.attenuationStartDistance = 0
        sunLight.attenuationEndDistance = 100
        sunLight.attenuationFalloffExponent = 2

        // Disable shadows on omni light (causes texture type mismatch with deferred rendering)
        // Shadows will be handled by a separate directional light
        sunLight.castsShadow = false

        let sunLightNode = SCNNode()
        sunLightNode.light = sunLight
        sunLightNode.position = SCNVector3(0, 0, 0)
        scene.rootNode.addChildNode(sunLightNode)

        // Add a directional light for shadows (directional lights use 2D shadow maps)
        let shadowLight = SCNLight()
        shadowLight.type = .directional
        shadowLight.intensity = 800
        shadowLight.color = UIColor(red: 1.0, green: 0.98, blue: 0.9, alpha: 1.0)
        shadowLight.castsShadow = true
        shadowLight.shadowMode = .forward
        shadowLight.shadowColor = UIColor(white: 0, alpha: 0.5)
        shadowLight.shadowRadius = 3
        shadowLight.shadowSampleCount = cinematicMode ? 8 : 4
        shadowLight.shadowMapSize = CGSize(width: 2048, height: 2048)
        shadowLight.orthographicScale = 50
        shadowLight.zNear = 1
        shadowLight.zFar = 150

        let shadowLightNode = SCNNode()
        shadowLightNode.light = shadowLight
        shadowLightNode.position = SCNVector3(0, 20, 30)
        shadowLightNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(shadowLightNode)

        // Ambient light for fill
        let ambientLight = SCNLight()
        ambientLight.type = .ambient
        ambientLight.intensity = 150
        ambientLight.color = UIColor(red: 0.1, green: 0.1, blue: 0.2, alpha: 1.0)

        let ambientNode = SCNNode()
        ambientNode.light = ambientLight
        scene.rootNode.addChildNode(ambientNode)

        // Subtle rim light from behind for depth
        let rimLight = SCNLight()
        rimLight.type = .directional
        rimLight.intensity = 300
        rimLight.color = UIColor(red: 0.6, green: 0.7, blue: 1.0, alpha: 1.0)

        let rimNode = SCNNode()
        rimNode.light = rimLight
        rimNode.position = SCNVector3(0, 10, -50)
        rimNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(rimNode)
    }

    // MARK: - Post-Processing Effects (including motion blur overlay stub & soundscape hook)
    private func applyPostProcessing(scnView: SCNView) {
        // The HDR camera settings handle bloom and tone mapping
        // Additional SCNTechnique could be added here for more effects such as SSAO, color grading, etc.

        // For vignette effect, we can add an overlay
        let vignetteView = createVignetteOverlay(frame: scnView.bounds)
        vignetteView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scnView.addSubview(vignetteView)

        // Add subtle motion blur overlay (stub)
        let motionBlurView = createMotionBlurOverlay(frame: scnView.bounds)
        motionBlurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scnView.addSubview(motionBlurView)

        // Soundscape hooks (stub)
        // Future: integrate audio engine and dynamically adjust ambient space sounds here
        // e.g., based on camera position, events, etc.
    }

    private func createVignetteOverlay(frame: CGRect) -> UIView {
        let view = UIView(frame: frame)
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear

        let gradient = CAGradientLayer()
        gradient.frame = frame
        gradient.type = .radial
        gradient.colors = [
            UIColor.clear.cgColor,
            UIColor.clear.cgColor,
            UIColor(white: 0, alpha: 0.3).cgColor,
            UIColor(white: 0, alpha: 0.6).cgColor
        ]
        gradient.locations = [0, 0.5, 0.8, 1.0]
        gradient.startPoint = CGPoint(x: 0.5, y: 0.5)
        gradient.endPoint = CGPoint(x: 1.0, y: 1.0)

        view.layer.addSublayer(gradient)
        return view
    }

    private func createMotionBlurOverlay(frame: CGRect) -> UIView {
        // Simple translucent dark layer to simulate slight blur buildup effect
        let view = UIView(frame: frame)
        view.isUserInteractionEnabled = false
        view.backgroundColor = UIColor(white: 0.0, alpha: 0.07)
        return view
    }
}

final class GrainOverlayView: UIView {
      private var displayLink: CADisplayLink?
      private let grainLayer = CALayer()

      override init(frame: CGRect) {
          super.init(frame: frame)
          isUserInteractionEnabled = false
          backgroundColor = .clear
          grainLayer.frame = bounds
          grainLayer.compositingFilter = "screenBlendMode"
          layer.addSublayer(grainLayer)

          displayLink = CADisplayLink(target: self, selector: #selector(tick))
          displayLink?.add(to: .main, forMode: .common)
      }

      required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

      @objc private func tick() {
          // regenerate small noise texture each frame for subtle movement
          let size = CGSize(width: 128, height: 128)
          UIGraphicsBeginImageContextWithOptions(size, false, 0)
          let ctx = UIGraphicsGetCurrentContext()!
          ctx.setFillColor(UIColor.clear.cgColor)
          ctx.fill(CGRect(origin: .zero, size: size))
          for _ in 0..<1400 {
              let x = CGFloat.random(in: 0..<size.width)
              let y = CGFloat.random(in: 0..<size.height)
              let alpha = CGFloat.random(in: 0.02...0.05)
              let gray = CGFloat.random(in: 0.7...1.0)
              ctx.setFillColor(UIColor(white: gray, alpha: alpha).cgColor)
              ctx.fill(CGRect(x: x, y: y, width: 1, height: 1))
          }
          let img = UIGraphicsGetImageFromCurrentImageContext()!
          UIGraphicsEndImageContext()

          grainLayer.contents = img.cgImage
          grainLayer.contentsScale = 1
          grainLayer.frame = bounds
          grainLayer.magnificationFilter = .nearest
          grainLayer.minificationFilter = .nearest
          grainLayer.opacity = 0.12
          grainLayer.contentsCenter = CGRect(x: 0, y: 0, width: 1, height: 1)
          grainLayer.contentsGravity = .resizeAspectFill
      }

      deinit { displayLink?.invalidate() }
  }

// MARK: - Preview
#Preview {
    SolarSystemSceneView(cinematicMode: true)
        .ignoresSafeArea()
}
private extension SCNVector3 {
    func length() -> Float {
        return sqrt(x*x + y*y + z*z)
    }
    func normalized() -> SCNVector3 {
        let len = length()
        guard len > 0 else { return self }
        return SCNVector3(x/len, y/len, z/len)
    }
}


