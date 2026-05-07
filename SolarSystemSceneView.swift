import SwiftUI
import SceneKit

// MARK: - Enhanced Solar System with PBR, HDR, Bloom, Shadows, Atmospheres
struct SolarSystemSceneView: UIViewRepresentable {

    var cinematicMode: Bool = true

    class Coordinator: NSObject, SCNSceneRendererDelegate {
        weak var view: SCNView?
        weak var scene: SCNScene?
        weak var sunLightNode: SCNNode?

        init(view: SCNView?, scene: SCNScene?, sunLightNode: SCNNode?) {
            self.view = view
            self.scene = scene
            self.sunLightNode = sunLightNode
        }

        func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
            guard let scene = scene else { return }
            // Compute sun direction in world space (from planet center outward)
            let sunDirWorld: SCNVector3 = {
                if let sun = sunLightNode {
                    let dir = SCNVector3( sun.worldPosition.x, sun.worldPosition.y, sun.worldPosition.z ).normalized()
                    return dir
                } else {
                    return SCNVector3(1, 0.1, 0).normalized()
                }
            }()

            // Update all atmosphere outer materials
            scene.rootNode.enumerateChildNodes { node, _ in
                if node.name == "Atmosphere" {
                    node.enumerateChildNodes { child, _ in
                        if let mat = child.geometry?.firstMaterial, let mods = mat.shaderModifiers, mods[.fragment] != nil {
                            mat.setValue(NSValue(scnVector3: sunDirWorld), forKey: "sunDir")
                        }
                    }
                }
            }
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
        createPlanets(scene: scene)

        // Create realistic starfield
        createStarfield(scene: scene)

        // Create nebula background
        createNebula(scene: scene)

        // Setup advanced lighting
        setupLighting(scene: scene)

        // After lighting setup, assign sunLightNode to coordinator and set delegate
        if let sun = scene.rootNode.childNodes.first(where: { $0.light?.type == .omni }) {
            sun.name = "MainSunLight"
            context.coordinator.sunLightNode = sun
        }
        scnView.delegate = context.coordinator

        // Apply post-processing (bloom, tone mapping)
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

    // MARK: - Camera Setup with HDR
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

    // MARK: - Planets with PBR Materials
    private func createPlanets(scene: SCNScene) {
        let planetData: [(name: String, radius: Float, distance: Float,
                          color: UIColor, hasAtmosphere: Bool, atmosphereColor: UIColor,
                          metalness: Float, roughness: Float, hasRings: Bool,
                          orbitSpeed: Double, rotationSpeed: Double)] = [
            ("Mercury", 0.25, 5.0, UIColor(red: 0.6, green: 0.5, blue: 0.5, alpha: 1),
             false, .clear, 0.1, 0.9, false, 8.0, 1.5),
            ("Venus", 0.35, 7.0, UIColor(red: 0.9, green: 0.8, blue: 0.6, alpha: 1),
             true, UIColor(red: 1.0, green: 0.9, blue: 0.7, alpha: 0.3), 0.0, 0.7, false, 12.0, 4.0),
            ("Earth", 0.38, 9.5, UIColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1),
             true, UIColor(red: 0.6, green: 0.8, blue: 1.0, alpha: 0.25), 0.0, 0.5, false, 15.0, 1.0),
            ("Mars", 0.30, 12.0, UIColor(red: 0.8, green: 0.4, blue: 0.2, alpha: 1),
             true, UIColor(red: 1.0, green: 0.8, blue: 0.6, alpha: 0.1), 0.2, 0.8, false, 20.0, 1.1),
            ("Jupiter", 0.80, 18.0, UIColor(red: 0.8, green: 0.7, blue: 0.6, alpha: 1),
             true, UIColor(red: 0.9, green: 0.8, blue: 0.7, alpha: 0.15), 0.0, 0.6, false, 35.0, 0.4),
            ("Saturn", 0.70, 25.0, UIColor(red: 0.9, green: 0.85, blue: 0.7, alpha: 1),
             true, UIColor(red: 1.0, green: 0.95, blue: 0.8, alpha: 0.1), 0.0, 0.5, true, 50.0, 0.45),
            ("Uranus", 0.50, 32.0, UIColor(red: 0.6, green: 0.85, blue: 0.9, alpha: 1),
             true, UIColor(red: 0.7, green: 0.9, blue: 1.0, alpha: 0.15), 0.0, 0.4, true, 70.0, 0.7),
            ("Neptune", 0.48, 38.0, UIColor(red: 0.3, green: 0.5, blue: 0.9, alpha: 1),
             true, UIColor(red: 0.4, green: 0.6, blue: 1.0, alpha: 0.2), 0.0, 0.4, false, 90.0, 0.65)
        ]

        for planet in planetData {
            // Orbital container
            let orbitNode = SCNNode()
            orbitNode.position = SCNVector3(0, 0, 0)
            orbitNode.name = "\(planet.name)Orbit"

            // Create orbit ring visual
            let orbitRing = createOrbitRing(radius: planet.distance)
            scene.rootNode.addChildNode(orbitRing)

            // Planet geometry with high detail
            let planetGeometry = SCNSphere(radius: CGFloat(planet.radius))
            planetGeometry.segmentCount = 48

            // PBR Material
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = createPlanetTexture(baseColor: planet.color, name: planet.name)
            material.metalness.contents = planet.metalness
            material.roughness.contents = planet.roughness
            material.normal.contents = createNormalMapTexture()
            material.normal.intensity = 0.3
            material.ambientOcclusion.contents = UIColor(white: 0.8, alpha: 1.0)
            material.ambientOcclusion.intensity = 0.5
            planetGeometry.materials = [material]

            let planetNode = SCNNode(geometry: planetGeometry)
            planetNode.name = planet.name
            planetNode.position = SCNVector3(planet.distance, 0, 0)

            // Ensure planet casts and receives shadows properly
            planetNode.castsShadow = false
            planetNode.categoryBitMask = 1
            planetNode.geometry?.firstMaterial?.writesToDepthBuffer = true

            if cinematicMode && (planet.name == "Earth" || planet.name == "Saturn") {
                planetNode.geometry?.firstMaterial?.roughness.contents = 0.45
                planetNode.geometry?.firstMaterial?.ambientOcclusion.intensity = 0.6
            }

            // Add atmosphere if applicable
            if planet.hasAtmosphere {
                let atmosphere = createAtmosphere(
                    radius: CGFloat(planet.radius),
                    color: planet.atmosphereColor
                )
                planetNode.addChildNode(atmosphere)
            }

            // Add rings for Saturn and Uranus
            if planet.hasRings {
                let rings = createPlanetRings(
                    innerRadius: CGFloat(planet.radius) * 1.3,
                    outerRadius: CGFloat(planet.radius) * 2.5,
                    planetName: planet.name
                )
                planetNode.addChildNode(rings)
                if planet.name == "Saturn" {
                    addRingContactShadow(to: planetNode, inner: CGFloat(planet.radius) * 1.3, outer: CGFloat(planet.radius) * 2.5)
                }
            }

            // Add moon for Earth
            if planet.name == "Earth" {
                let moon = createMoon()
                planetNode.addChildNode(moon)
            }

            orbitNode.addChildNode(planetNode)
            scene.rootNode.addChildNode(orbitNode)

            // Orbital animation
            let orbitAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: planet.orbitSpeed)
            )
            orbitNode.runAction(orbitAction)

            // Planet rotation
            let rotateAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: planet.rotationSpeed)
            )
            planetNode.runAction(rotateAction)
        }
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

    // MARK: - Starfield
    private func createStarfield(scene: SCNScene) {
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

        // Subtle rotation for star parallax effect
        let starRotation = SCNAction.repeatForever(
            SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 600)
        )
        starContainer.runAction(starRotation)

        scene.rootNode.addChildNode(starContainer)
    }

    // MARK: - Nebula Background
    private func createNebula(scene: SCNScene) {
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

    // MARK: - Post-Processing Effects
    private func applyPostProcessing(scnView: SCNView) {
        // The HDR camera settings handle bloom and tone mapping
        // Additional SCNTechnique could be added here for more effects

        // For vignette effect, we can add an overlay
        let vignetteView = createVignetteOverlay(frame: scnView.bounds)
        vignetteView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scnView.addSubview(vignetteView)
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


