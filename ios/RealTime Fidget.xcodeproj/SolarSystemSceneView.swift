import SwiftUI
import SceneKit

struct SolarSystemSceneView: UIViewRepresentable {
    func makeUIView(context: Context) -> SCNView {
        // SceneKit scene setup
        let scene = SCNScene()
        
        // Sun
        let sun = SCNNode(geometry: SCNSphere(radius: 1.5))
        sun.geometry?.firstMaterial?.emission.contents = UIColor.yellow
        sun.geometry?.firstMaterial?.multiply.contents = UIColor(white: 1.0, alpha: 0.6)
        sun.position = SCNVector3(0, 0, 0)
        scene.rootNode.addChildNode(sun)
        
        // Planets (name, radius, distance, color)
        let planets: [(String, CGFloat, Float, UIColor)] = [
            ("Mercury", 0.18, 3.0, .lightGray),
            ("Venus", 0.22, 4.5, .systemYellow),
            ("Earth", 0.24, 6.0, .systemBlue),
            ("Mars", 0.20, 7.8, .systemRed),
            ("Jupiter", 0.50, 11.5, .brown),
            ("Saturn", 0.48, 16.0, .systemOrange),
            ("Uranus", 0.36, 21.0, .cyan),
            ("Neptune", 0.34, 24.0, .blue)
        ]
        
        for (i, p) in planets.enumerated() {
            let planetNode = SCNNode(geometry: SCNSphere(radius: p.1))
            planetNode.geometry?.firstMaterial?.diffuse.contents = p.3
            planetNode.position = SCNVector3(Float(p.1 + p.2), 0, 0)
            planetNode.name = p.0
            
            // Add orbital node for revolution
            let orbitNode = SCNNode()
            orbitNode.position = .zero
            orbitNode.addChildNode(planetNode)
            scene.rootNode.addChildNode(orbitNode)
            
            // Animate planet revolution
            let orbitDuration = 10.0 + Double(i) * 5.0
            let orbitAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: CGFloat.pi * 2, z: 0, duration: orbitDuration)
            )
            orbitNode.runAction(orbitAction)
            
            // Animate planet rotation
            let spinAction = SCNAction.repeatForever(
                SCNAction.rotateBy(x: 0, y: CGFloat.pi * 2, z: 0, duration: 2.0 + Double.random(in: 0.5...1.5))
            )
            planetNode.runAction(spinAction)
        }
        
        // Stars background
        let starNode = SCNNode()
        let starCount = 400
        for _ in 0..<starCount {
            let star = SCNNode(geometry: SCNSphere(radius: 0.03))
            star.geometry?.firstMaterial?.diffuse.contents = UIColor(white: CGFloat.random(in: 0.7...1.0), alpha: 1.0)
            let d = Float.random(in: 30.0...60.0)
            let theta = Float.random(in: 0...Float.pi * 2)
            let phi = Float.random(in: 0...Float.pi)
            star.position = SCNVector3(d * sin(phi) * cos(theta), d * cos(phi), d * sin(phi) * sin(theta))
            starNode.addChildNode(star)
        }
        scene.rootNode.addChildNode(starNode)
        
        // Lighting
        let light = SCNLight()
        light.type = .omni
        light.intensity = 2000
        let lightNode = SCNNode()
        lightNode.light = light
        lightNode.position = SCNVector3(0, 0, 0) // At the sun
        scene.rootNode.addChildNode(lightNode)
        
        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.intensity = 400
        ambient.color = UIColor(white: 0.15, alpha: 1.0)
        let ambientNode = SCNNode()
        ambientNode.light = ambient
        scene.rootNode.addChildNode(ambientNode)
        
        // SceneKit view config
        let scnView = SCNView()
        scnView.scene = scene
        scnView.allowsCameraControl = true
        scnView.backgroundColor = UIColor.black
        scnView.autoenablesDefaultLighting = false
        
        // Camera
        let camera = SCNCamera()
        camera.zFar = 200
        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 0, 32)
        scene.rootNode.addChildNode(cameraNode)
        scnView.pointOfView = cameraNode
        
        return scnView
    }
    
    func updateUIView(_ uiView: SCNView, context: Context) {}
}

// Example SwiftUI usage:
#Preview {
    SolarSystemSceneView().frame(height: 400)
}
