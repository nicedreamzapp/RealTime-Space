// CelestialCatalog.js - Complete database of all celestial objects
// Includes everything from Hubble: stars, planets, moons, asteroids, comets,
// nebulae, black holes, galaxies, pulsars, quasars, and more

class CelestialCatalog {
    constructor() {
        this.categories = {
            STAR: { icon: '⭐', color: '#ffdd44', priority: 1 },
            PLANET: { icon: '🌍', color: '#4a90e2', priority: 2 },
            MOON: { icon: '🌙', color: '#cccccc', priority: 3 },
            DWARF_PLANET: { icon: '🪨', color: '#aa8866', priority: 4 },
            ASTEROID: { icon: '☄️', color: '#666666', priority: 5 },
            COMET: { icon: '💫', color: '#88ddff', priority: 6 },
            ASTEROID_BELT: { icon: '🪐', color: '#887755', priority: 7 },
            NEBULA: { icon: '☁️', color: '#ff66aa', priority: 8 },
            BLACK_HOLE: { icon: '🕳️', color: '#220022', priority: 9 },
            GALAXY: { icon: '🌌', color: '#8866ff', priority: 10 },
            PULSAR: { icon: '💠', color: '#00ffff', priority: 11 },
            QUASAR: { icon: '✴️', color: '#ff4488', priority: 12 },
            STAR_CLUSTER: { icon: '✨', color: '#ffaa66', priority: 13 },
            SATELLITE: { icon: '🛰️', color: '#aaaaaa', priority: 14 },
            SPACE_STATION: { icon: '🚀', color: '#ffffff', priority: 15 }
        };

        this.objects = [];
        this.objectsByName = new Map();
        this.objectsByCategory = new Map();

        // Initialize category maps
        Object.keys(this.categories).forEach(cat => {
            this.objectsByCategory.set(cat, []);
        });

        console.log("📚 CelestialCatalog initialized");
    }

    // Register an object from the scene
    registerObject(obj) {
        const catalogEntry = {
            id: this.objects.length + 1,
            name: obj.name || `Unknown-${this.objects.length + 1}`,
            type: this._determineType(obj),
            mesh: obj.mesh || obj,
            radius: obj.radius || 1,
            discovered: false,
            explored: false,
            visitCount: 0,
            firstVisit: null,
            lastVisit: null,
            description: this._generateDescription(obj),
            facts: this._generateFacts(obj),
            distanceFromSun: 0,
            parentBody: obj.parentPlanet?.name || null
        };

        this.objects.push(catalogEntry);
        this.objectsByName.set(catalogEntry.name.toLowerCase(), catalogEntry);

        const categoryList = this.objectsByCategory.get(catalogEntry.type);
        if (categoryList) {
            categoryList.push(catalogEntry);
        }

        return catalogEntry;
    }

    // Register multiple objects
    registerObjects(objectsArray) {
        objectsArray.forEach(obj => this.registerObject(obj));
    }

    // Determine object type from properties
    _determineType(obj) {
        const type = obj.type?.toLowerCase() || '';
        const name = obj.name?.toLowerCase() || '';

        if (type === 'star' || name.includes('sol') || name.includes('sun')) return 'STAR';
        if (type === 'moon') return 'MOON';
        if (type === 'planet') return 'PLANET';
        if (type === 'comet') return 'COMET';
        if (type === 'nebula') return 'NEBULA';
        if (type === 'asteroid' || type === 'debris') return 'ASTEROID';
        if (name.includes('belt')) return 'ASTEROID_BELT';
        if (name.includes('black hole') || name.includes('blackhole')) return 'BLACK_HOLE';
        if (name.includes('galaxy') || name.includes('andromeda')) return 'GALAXY';
        if (name.includes('pulsar')) return 'PULSAR';
        if (name.includes('quasar')) return 'QUASAR';
        if (name.includes('cluster')) return 'STAR_CLUSTER';
        if (name.includes('station') || name.includes('iss')) return 'SPACE_STATION';
        if (name.includes('satellite')) return 'SATELLITE';

        // Check by object properties
        if (obj.luminosity && obj.luminosity > 1) return 'STAR';
        if (obj.orbitalData && obj.radius > 0.5) return 'PLANET';

        return 'ASTEROID';
    }

    // Generate description for object
    _generateDescription(obj) {
        const type = this._determineType(obj);
        const name = obj.name || 'Unknown';

        const descriptions = {
            STAR: `${name} is a stellar body that produces light and heat through nuclear fusion. It serves as the gravitational center of its solar system.`,
            PLANET: `${name} is a celestial body orbiting a star, massive enough to be rounded by gravity but not massive enough to cause thermonuclear fusion.`,
            MOON: `${name} is a natural satellite orbiting a planet, held in place by gravitational forces.`,
            DWARF_PLANET: `${name} is a planetary-mass object that orbits the Sun but has not cleared its orbital neighborhood.`,
            ASTEROID: `${name} is a rocky remnant left over from the early formation of our solar system, billions of years ago.`,
            COMET: `${name} is an icy small Solar System body that develops a visible tail when passing close to the Sun.`,
            ASTEROID_BELT: `${name} is a region of space containing numerous small rocky bodies and debris.`,
            NEBULA: `${name} is an interstellar cloud of dust, hydrogen, helium, and other ionized gases - often the birthplace of stars.`,
            BLACK_HOLE: `${name} is a region of spacetime where gravity is so strong that nothing can escape from it, not even light.`,
            GALAXY: `${name} is a massive gravitationally bound system of stars, stellar remnants, interstellar gas, dust, and dark matter.`,
            PULSAR: `${name} is a highly magnetized rotating neutron star that emits beams of electromagnetic radiation.`,
            QUASAR: `${name} is an extremely luminous active galactic nucleus powered by a supermassive black hole.`,
            STAR_CLUSTER: `${name} is a group of stars that share a common origin and are gravitationally bound for some length of time.`,
            SATELLITE: `${name} is an artificial object intentionally placed into orbit around a celestial body.`,
            SPACE_STATION: `${name} is a habitable artificial satellite in orbit around Earth or another body.`
        };

        return descriptions[type] || `${name} is a celestial object in the cosmos.`;
    }

    // Generate interesting facts
    _generateFacts(obj) {
        const facts = [];
        const name = obj.name || 'This object';

        if (obj.radius) {
            facts.push(`Radius: ${obj.radius.toFixed(2)} units`);
        }
        if (obj.temperature) {
            facts.push(`Surface temperature: ${obj.temperature}K`);
        }
        if (obj.orbitalData?.orbitalPeriod) {
            facts.push(`Orbital period: ${obj.orbitalData.orbitalPeriod} units`);
        }
        if (obj.luminosity) {
            facts.push(`Luminosity: ${obj.luminosity}x solar`);
        }
        if (obj.atmosphereDensity) {
            facts.push(`Has atmosphere (density: ${obj.atmosphereDensity})`);
        }
        if (obj.hasRings) {
            facts.push(`Has ring system`);
        }

        return facts;
    }

    // Mark object as discovered (seen from distance)
    discoverObject(name) {
        const obj = this.getByName(name);
        if (obj && !obj.discovered) {
            obj.discovered = true;
            obj.firstVisit = Date.now();
            return { newDiscovery: true, object: obj };
        }
        return { newDiscovery: false, object: obj };
    }

    // Mark object as explored (visited closely)
    exploreObject(name) {
        const obj = this.getByName(name);
        if (obj) {
            const wasExplored = obj.explored;
            obj.explored = true;
            obj.visitCount++;
            obj.lastVisit = Date.now();
            if (!obj.firstVisit) obj.firstVisit = Date.now();
            if (!obj.discovered) obj.discovered = true;
            return { firstExploration: !wasExplored, object: obj };
        }
        return null;
    }

    // Get object by name
    getByName(name) {
        return this.objectsByName.get(name.toLowerCase());
    }

    // Get all objects of a type
    getByCategory(category) {
        return this.objectsByCategory.get(category) || [];
    }

    // Get exploration statistics
    getStats() {
        const total = this.objects.length;
        const discovered = this.objects.filter(o => o.discovered).length;
        const explored = this.objects.filter(o => o.explored).length;

        const byCategory = {};
        Object.keys(this.categories).forEach(cat => {
            const catObjects = this.objectsByCategory.get(cat) || [];
            byCategory[cat] = {
                total: catObjects.length,
                discovered: catObjects.filter(o => o.discovered).length,
                explored: catObjects.filter(o => o.explored).length
            };
        });

        return {
            total,
            discovered,
            explored,
            percentDiscovered: total > 0 ? Math.round((discovered / total) * 100) : 0,
            percentExplored: total > 0 ? Math.round((explored / total) * 100) : 0,
            byCategory
        };
    }

    // Get sorted leaderboard
    getLeaderboard() {
        const sorted = [...this.objects].sort((a, b) => {
            // First by explored status
            if (a.explored !== b.explored) return b.explored - a.explored;
            // Then by discovered status
            if (a.discovered !== b.discovered) return b.discovered - a.discovered;
            // Then by category priority
            const aPriority = this.categories[a.type]?.priority || 99;
            const bPriority = this.categories[b.type]?.priority || 99;
            return aPriority - bPriority;
        });

        return sorted;
    }

    // Get unexplored objects sorted by distance from camera
    getUnexplored(cameraPosition) {
        return this.objects
            .filter(o => !o.explored)
            .map(o => {
                const pos = o.mesh?.position || new THREE.Vector3();
                const distance = cameraPosition ? pos.distanceTo(cameraPosition) : 0;
                return { ...o, distance };
            })
            .sort((a, b) => a.distance - b.distance);
    }

    // Get nearest unexplored object
    getNearestUnexplored(cameraPosition) {
        const unexplored = this.getUnexplored(cameraPosition);
        return unexplored.length > 0 ? unexplored[0] : null;
    }

    // Get all objects sorted by distance
    getAllByDistance(cameraPosition) {
        return this.objects.map(o => {
            const pos = o.mesh?.position || new THREE.Vector3();
            const distance = cameraPosition ? pos.distanceTo(cameraPosition) : 0;
            return { ...o, distance };
        }).sort((a, b) => a.distance - b.distance);
    }

    // Get category info
    getCategoryInfo(type) {
        return this.categories[type] || { icon: '?', color: '#888888', priority: 99 };
    }

    // Search objects by name
    search(query) {
        const q = query.toLowerCase();
        return this.objects.filter(o =>
            o.name.toLowerCase().includes(q) ||
            o.type.toLowerCase().includes(q)
        );
    }
}

// Export for use
if (typeof module !== 'undefined') module.exports = CelestialCatalog;
