import Foundation

struct Vector3D {
    var x: Double
    var y: Double
    var z: Double
}

class CameraController {
    private var rotationInput = Vector3D(x: 0, y: 0, z: 0)
    private var angularVelocity = Vector3D(x: 0, y: 0, z: 0)
    private var thrustInput = Vector3D(x: 0, y: 0, z: 0)

    // Applies rotation based on current input
    func applyRotation() {
        angularVelocity.x += rotationInput.x
        angularVelocity.y += rotationInput.y
        angularVelocity.z += rotationInput.z
        // Logic to update camera rotation based on angularVelocity
    }

    // Applies thrust based on current input
    func applyThrust() {
        // Logic to update camera position based on thrustInput
    }

    /// Stops ALL camera rotation instantly by resetting rotation input and angular velocity.
    public func stopRotation() {
        rotationInput = Vector3D(x: 0, y: 0, z: 0)
        angularVelocity = Vector3D(x: 0, y: 0, z: 0)
    }
}
