import SwiftUI
import Foundation
import Combine

final class GalaxyDataManager: ObservableObject {
    @Published var galaxyRegions: [GalaxyRegion] = []
    @Published var currentRegion: GalaxyRegion?
    @Published var visibleObjects: [CelestialObject] = []
    
    var targetNames: [String] {
        currentRegion?.objects.map { $0.name } ?? []
    }
    
    // Scale factors for different levels of detail
    let localSystemScale: Float = 1.0
    let stellarNeighborhoodScale: Float = 0.001
    let galacticScale: Float = 0.000001
    
    init() {
        loadGalaxyData()
    }
    
    // MARK: - Load from JSON
    private func loadGalaxyData() {
        guard let url = Bundle.main.url(forResource: "GalaxyData", withExtension: "json") else {
            print("ERROR: GalaxyData.json not found in bundle")
            generateFallbackData()
            return
        }
        
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            let regionList = try decoder.decode([GalaxyRegion].self, from: data)
            galaxyRegions = regionList
            currentRegion = regionList.first
        } catch {
            print("ERROR decoding GalaxyData.json: \(error)")
            generateFallbackData()
        }
    }
    
    private func generateFallbackData() {
        // Minimal solar system for fallback
        let sun = CelestialObject(
            id: "sol",
            name: "Sol",
            type: .star,
            position: Vector3D(x: 0, y: 0, z: 0),
            radius: 0.1,
            mass: 333000,
            color: 0xFFFFFF,
            temperature: 5778,
            luminosity: 2.5,
            spectralClass: "G2V",
            orbitalData: nil
        )
        
        let earth = CelestialObject(
            id: "earth",
            name: "Earth",
            type: .planet,
            position: Vector3D(x: 1.0, y: 0, z: 0),
            radius: 0.013,
            mass: 1.0,
            color: 0x82BFFF,
            temperature: 288,
            luminosity: 0.0,
            spectralClass: "Rocky",
            orbitalData: OrbitalData(semiMajorAxis: 1.0, eccentricity: 0.017, inclination: 0.0, longitudeOfAscendingNode: 0.0, argumentOfPeriapsis: 102.9, meanAnomalyAtEpoch: 100.5, orbitalPeriod: 365.25)
        )
        
        let localRegion = GalaxyRegion(
            name: "Fallback Solar System",
            position: Vector3D(x: 0, y: 0, z: 0),
            radius: 20,
            objects: [sun, earth],
            scale: localSystemScale
        )
        
        galaxyRegions = [localRegion]
        currentRegion = localRegion
    }
    
    // MARK: - Public Helpers
    func getObjectsInRange(from position: Vector3D, range: Float) -> [CelestialObject] {
        guard let region = currentRegion else { return [] }
        return region.objects.filter { object in
            let distance = (object.position - position).magnitude()
            return distance <= range
        }
    }
    
    func findNearestObject(to position: Vector3D) -> CelestialObject? {
        guard let region = currentRegion else { return nil }
        return region.objects.min { a, b in
            (a.position - position).magnitude() < (b.position - position).magnitude()
        }
    }
    
    func switchToRegion(named regionName: String) {
        currentRegion = galaxyRegions.first { $0.name == regionName }
    }
    
    func object(named name: String) -> CelestialObject? {
        return currentRegion?.objects.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }
    }
    
    func exportCurrentRegionJSON() -> String? {
        guard let region = currentRegion else { return nil }
        let payload: [String: Any] = [
            "name": region.name,
            "radius": region.radius,
            "scale": region.scale,
            "objects": region.objects.map { obj in
                return [
                    "id": obj.id,
                    "name": obj.name,
                    "type": obj.type.rawValue,
                    "position": [obj.position.x, obj.position.y, obj.position.z],
                    "radius": obj.radius,
                    "mass": obj.mass,
                    "color": obj.color,
                    "temperature": obj.temperature,
                    "luminosity": obj.luminosity,
                    "spectralClass": obj.spectralClass
                ] as [String: Any]
            }
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return nil
    }
}

// MARK: - Data Structures

struct GalaxyRegion: Codable {
    let name: String
    let position: Vector3D
    let radius: Float
    let objects: [CelestialObject]
    let scale: Float
}

struct CelestialObject: Identifiable, Codable {
    let id: String
    let name: String
    let type: ObjectType
    let position: Vector3D
    let radius: Float
    let mass: Float
    let color: Int
    let temperature: Float
    let luminosity: Float
    let spectralClass: String
    let orbitalData: OrbitalData?
    
    enum ObjectType: String, Codable {
        case star, planet, moon, asteroid, comet, blackHole, nebula, galaxy, neutronStar
    }
}

struct OrbitalData: Codable {
    let semiMajorAxis: Float
    let eccentricity: Float
    let inclination: Float
    let longitudeOfAscendingNode: Float
    let argumentOfPeriapsis: Float
    let meanAnomalyAtEpoch: Float
    let orbitalPeriod: Float
}
