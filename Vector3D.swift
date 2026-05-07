import Foundation

struct Vector3D: Codable, Equatable {
    var x: Float
    var y: Float
    var z: Float
    
    // MARK: - Math
    func magnitude() -> Float {
        return sqrt(x * x + y * y + z * z)
    }
    
    func normalized() -> Vector3D {
        let mag = magnitude()
        guard mag > 0 else { return Vector3D(x: 0, y: 0, z: 0) }
        return Vector3D(x: x / mag, y: y / mag, z: z / mag)
    }
    
    func rotated(by rotation: Vector3D) -> Vector3D {
        let cosY = cos(rotation.y)
        let sinY = sin(rotation.y)
        let newX = x * cosY - z * sinY
        let newZ = x * sinY + z * cosY
        return Vector3D(x: newX, y: y, z: newZ)
    }
    
    // MARK: - Operators
    static func + (lhs: Vector3D, rhs: Vector3D) -> Vector3D {
        Vector3D(x: lhs.x + rhs.x, y: lhs.y + rhs.y, z: lhs.z + rhs.z)
    }
    
    static func - (lhs: Vector3D, rhs: Vector3D) -> Vector3D {
        Vector3D(x: lhs.x - rhs.x, y: lhs.y - rhs.y, z: lhs.z - rhs.z)
    }
    
    static func * (lhs: Vector3D, rhs: Float) -> Vector3D {
        Vector3D(x: lhs.x * rhs, y: lhs.y * rhs, z: lhs.z * rhs)
    }
}
