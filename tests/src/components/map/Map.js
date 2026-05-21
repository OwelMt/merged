import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  useMapEvents,
  useMap,
  Polyline,
  GeoJSON,
  Polygon,
} from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import "leaflet/dist/leaflet.css";
import jaenGeoJSON from "../data/jaen.json";

const DEFAULT_CENTER = [15.3382, 120.9056];
const BOUNDS_BUFFER = 0.01;

/* ---------------- Icons ---------------- */

const blueIcon = new L.Icon({
  iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const greenIcon = new L.Icon({
  iconUrl: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const orangeIcon = new L.Icon({
  iconUrl: "https://maps.google.com/mapfiles/ms/icons/orange-dot.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const redIcon = new L.Icon({
  iconUrl: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const greyIcon = L.divIcon({
  className: "custom-evac-archived-marker",
  html: '<span class="custom-evac-archived-marker__dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/* ---------------- Styles ---------------- */

const jaenStyle = {
  color: "#08661f",
  weight: 2,
  opacity: 0.95,
  fill: false,
  dashArray: "6, 6",
  lineCap: "round",
};

const maskStyle = {
  stroke: false,
  fillColor: "#1f2937",
  fillOpacity: 0.28,
  interactive: false,
};

function getBarangayPaletteSeed(colorKey = "") {
  const normalized = safeLower(colorKey);
  if (!normalized) return 0;

  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 1000003;
  }

  return hash;
}

function getBarangayColorParts(colorKey = "", fallbackIndex = 0) {
  const normalized = safeLower(colorKey);

  if (normalized === "hilera") {
    return { hue: 132, saturation: 68, lightness: 42 };
  }

  const seed = normalized ? getBarangayPaletteSeed(normalized) : fallbackIndex;
  const hue = Math.round((seed * 137.508 + 24) % 360);
  const saturationCycle = [78, 64, 86, 58];
  const lightnessCycle = [48, 60, 42, 66];
  const saturation = saturationCycle[seed % saturationCycle.length];
  const lightness = lightnessCycle[seed % lightnessCycle.length];

  return { hue, saturation, lightness };
}

function getBarangayFillColor(colorKey = "", fallbackIndex = 0) {
  const { hue, saturation, lightness } = getBarangayColorParts(
    colorKey,
    fallbackIndex
  );
  return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.54)`;
}

function getBarangayOutlineColor(colorKey = "", fallbackIndex = 0) {
  const { hue, saturation, lightness } = getBarangayColorParts(
    colorKey,
    fallbackIndex
  );
  return `hsl(${hue}, ${Math.min(88, saturation + 8)}%, ${Math.max(34, lightness - 8)}%)`;
}

function countGeometryVertices(geometry) {
  if (!geometry) return 0;

  if (geometry.type === "Polygon") {
    return geometry.coordinates?.[0]?.length || 0;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates?.reduce(
      (sum, polygon) => sum + (polygon?.[0]?.length || 0),
      0
    );
  }

  return 0;
}

function geometryToPolygonSets(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return [geometry.coordinates || []];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates || [];
  }

  return [];
}

function ringToLeafletPositions(ring = []) {
  return ring
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      return [Number(point[1]), Number(point[0])];
    })
    .filter(
      (point) =>
        Array.isArray(point) &&
        !Number.isNaN(point[0]) &&
        !Number.isNaN(point[1])
    );
}

/* ---------------- Helpers ---------------- */

function safeLower(value) {
  return String(value || "").toLowerCase().trim();
}

function isPointInsideJaen(lat, lng) {
  try {
    const clicked = turfPoint([lng, lat]);

    if (jaenGeoJSON.type === "FeatureCollection") {
      return jaenGeoJSON.features.some((feature) =>
        booleanPointInPolygon(clicked, feature)
      );
    }

    if (jaenGeoJSON.type === "Feature") {
      return booleanPointInPolygon(clicked, jaenGeoJSON);
    }

    return false;
  } catch (error) {
    console.error("Polygon check failed:", error);
    return false;
  }
}

function isPointInsideGeoJSON(lat, lng, geojson) {
  if (!geojson) return false;

  try {
    const clicked = turfPoint([lng, lat]);

    if (geojson.type === "FeatureCollection") {
      return geojson.features.some((feature) =>
        booleanPointInPolygon(clicked, feature)
      );
    }

    if (geojson.type === "Feature") {
      return booleanPointInPolygon(clicked, geojson);
    }

    if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
      return booleanPointInPolygon(clicked, {
        type: "Feature",
        properties: {},
        geometry: geojson,
      });
    }

    return false;
  } catch (error) {
    console.error("Barangay polygon check failed:", error);
    return false;
  }
}

function getBarangayBoundsData(entry) {
  if (!entry) return null;

  if (entry.type === "FeatureCollection") {
    const polygonFeatures = (entry.features || []).filter((feature) => {
      const type = feature?.geometry?.type;
      return type === "Polygon" || type === "MultiPolygon";
    });

    if (!polygonFeatures.length) return null;

    const preferredFeatures = polygonFeatures.filter(
      (feature) => countGeometryVertices(feature?.geometry) > 5
    );

    const chosenFeature =
      [...(preferredFeatures.length ? preferredFeatures : polygonFeatures)].sort(
        (a, b) =>
          countGeometryVertices(b?.geometry) - countGeometryVertices(a?.geometry)
      )[0] || null;

    return chosenFeature
      ? {
          type: "FeatureCollection",
          features: [chosenFeature],
        }
      : null;
  }
  if (entry.type === "Feature") return entry;

  if (Array.isArray(entry.features)) {
    return {
      type: "FeatureCollection",
      features: entry.features,
    };
  }

  if (entry.geometry) {
    return {
      type: "Feature",
      properties: entry.properties || {},
      geometry: entry.geometry,
    };
  }

  return null;
}

function getBarangayBoundsLabel(entry, fallbackIndex = 0) {
  const directLabel =
    entry?.barangayName ||
    entry?.name ||
    entry?.properties?.barangayName ||
    entry?.properties?.name ||
    entry?.properties?.NAME ||
    entry?.properties?.adm4_en ||
    entry?.properties?.barangay ||
    entry?.features?.[0]?.properties?.barangayName ||
    entry?.features?.[0]?.properties?.name ||
    entry?.features?.[0]?.properties?.NAME ||
    entry?.features?.[0]?.properties?.adm4_en ||
    entry?.features?.[0]?.properties?.barangay;

  return directLabel || `Barangay ${fallbackIndex + 1}`;
}

function buildBarangayPolygonStyle({
  colorKey = "",
  index = 0,
  isBarangayRole = false,
  isOwnedBarangay = false,
  hovered = false,
}) {
  const { hue, saturation, lightness } = getBarangayColorParts(
    colorKey,
    index
  );

  if (isBarangayRole) {
    if (isOwnedBarangay) {
      return {
        color: hovered
          ? getBarangayOutlineColor(colorKey, index)
          : `hsla(${hue}, ${Math.min(92, saturation + 10)}%, ${Math.max(26, lightness - 14)}%, 0.96)`,
        weight: hovered ? 3.25 : 2.35,
        fillColor: hovered
          ? getBarangayFillColor(colorKey, index)
          : `hsla(${hue}, ${Math.max(68, saturation)}%, ${Math.max(46, lightness - 2)}%, 0.56)`,
        fillOpacity: hovered ? 0.84 : 0.8,
      };
    }

    return {
      color: hovered
        ? getBarangayOutlineColor(colorKey, index)
        : `hsla(${hue}, 18%, 28%, 0.52)`,
      weight: hovered ? 2.5 : 1.2,
      fillColor: hovered
        ? getBarangayFillColor(colorKey, index)
        : `hsla(${hue}, 20%, 32%, 0.34)`,
      fillOpacity: hovered ? 0.64 : 0.72,
    };
  }

  return {
    color: hovered
      ? getBarangayOutlineColor(colorKey, index)
      : `hsla(${hue}, ${Math.min(86, saturation + 4)}%, ${Math.max(32, lightness - 8)}%, 0.82)`,
    weight: hovered ? 3 : 1.8,
    fillColor: hovered
      ? getBarangayFillColor(colorKey, index)
      : `hsla(${hue}, ${Math.max(58, saturation - 8)}%, ${Math.max(52, lightness + 2)}%, 0.34)`,
    fillOpacity: hovered ? 0.76 : 0.58,
  };
}

function extractOuterRings(geojson) {
  const rings = [];

  if (!geojson) return rings;

  const features =
    geojson.type === "FeatureCollection"
      ? geojson.features
      : geojson.type === "Feature"
      ? [geojson]
      : [];

  features.forEach((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return;

    if (geometry.type === "Polygon") {
      if (geometry.coordinates?.[0]) {
        rings.push(geometry.coordinates[0]);
      }
    }

    if (geometry.type === "MultiPolygon") {
      geometry.coordinates?.forEach((polygon) => {
        if (polygon?.[0]) {
          rings.push(polygon[0]);
        }
      });
    }
  });

  return rings;
}

function buildInverseMaskGeoJSON(geojson) {
  const outerWorldRing = [
    [-180, 90],
    [180, 90],
    [180, -90],
    [-180, -90],
    [-180, 90],
  ];

  const holes = extractOuterRings(geojson);

  return {
    type: "Feature",
    properties: { name: "Jaen Outside Mask" },
    geometry: {
      type: "Polygon",
      coordinates: [outerWorldRing, ...holes],
    },
  };
}

function getStatusIcon(placeOrStatus) {
  const place =
    placeOrStatus && typeof placeOrStatus === "object"
      ? placeOrStatus
      : { capacityStatus: placeOrStatus };
  const normalized = safeLower(place?.capacityStatus);

  if (place?.isArchived) return greyIcon;

  if (normalized === "limited") return orangeIcon;
  if (normalized === "full") return redIcon;
  return greenIcon;
}

/* ---------------- Fit map to Jaen ---------------- */

function FitToJaenBounds({ bounds, publicMode = false }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;

    let cancelled = false;

    map.fitBounds(bounds, {
      padding: publicMode ? [28, 28] : [20, 20],
    });

    if (!publicMode) {
      map.setMaxBounds(bounds);
    } else {
      map.setMaxBounds(null);
    }

    const timer = setTimeout(() => {
      if (!cancelled && map?._container) {
        map.invalidateSize();
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bounds, map, publicMode]);

  return null;
}

/* ---------------- Map Updater ---------------- */

function MapUpdater({ position, zoom, allowedBounds, publicMode = false }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;

    let cancelled = false;

    const target = L.latLng(position[0], position[1]);

    if (publicMode) {
      map.setView(position, zoom);
    } else if (!allowedBounds || allowedBounds.contains(target)) {
      map.setView(position, zoom);
    }

    const timer = setTimeout(() => {
      if (!cancelled && map?._container) {
        map.invalidateSize();
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [position, zoom, map, allowedBounds, publicMode]);

  useEffect(() => {
    let cancelled = false;

    const handleResize = () => {
      if (map?._container) {
        map.invalidateSize();
      }
    };

    window.addEventListener("resize", handleResize);

    const timer = setTimeout(() => {
      if (!cancelled && map?._container) {
        map.invalidateSize();
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [map]);

  return null;
}

/* ---------------- Map Click Handler ---------------- */

function MapClickHandler({
  setPosition,
  setPlaceName,
  onSelectLocation,
  onBlockedSelection,
  allowedBounds,
  pickMode,
  pickBoundaryGeoJSON,
}) {
  useMapEvents({
    click(e) {
      if (!pickMode) return;

      const { lat, lng } = e.latlng;

      if (allowedBounds && !allowedBounds.contains(e.latlng)) return;
      if (!isPointInsideJaen(lat, lng)) return;
      if (
        pickBoundaryGeoJSON &&
        !isPointInsideGeoJSON(lat, lng, pickBoundaryGeoJSON)
      ) {
        onBlockedSelection?.();
        return;
      }

      setPosition([lat, lng]);

      axios
        .get("https://nominatim.openstreetmap.org/reverse", {
          params: {
            lat,
            lon: lng,
            format: "json",
            addressdetails: 1,
          },
        })
        .then((res) => {
          let short = "Unknown Location";

          if (res.data.name) {
            short = res.data.name;
          } else if (res.data.address) {
            const a = res.data.address;
            const street =
              a.road || a.pedestrian || a.suburb || a.village || "Unknown Street";
            const city =
              a.city || a.town || a.village || a.county || "Unknown City";
            short = `${street}, ${city}`;
          }

          setPlaceName(short);
          onSelectLocation?.(short, lat, lng);
        })
        .catch(() => {
          setPlaceName("Unknown Location");
          onSelectLocation?.("Unknown Location", lat, lng);
        });
    },
  });

  return null;
}

/* ---------------- MapBusBridge ---------------- */

function MapBusBridge({ allowedBounds, publicMode = false }) {
  const map = useMap();

  useEffect(() => {
    const handler = (e) => {
      const { lat, lng, zoom = 17 } = e.detail || {};

      if (typeof lat !== "number" || typeof lng !== "number") return;

      const target = L.latLng(lat, lng);

      if (!publicMode && allowedBounds && !allowedBounds.contains(target)) return;
      if (!isPointInsideJaen(lat, lng)) return;

      map.flyTo([lat, lng], zoom, { duration: 0.6 });
    };

    window.addEventListener("emap:flyTo", handler);
    return () => window.removeEventListener("emap:flyTo", handler);
  }, [map, allowedBounds, publicMode]);

  return null;
}

/* ---------------- Popup Builders ---------------- */

function renderPublicPopup(place) {
  return (
    <Popup>
      <div className="map-popup public-popup">
        <strong>{place.name}</strong>
        <br />
        {place.location || "No location provided"}
        <br />
        <em>Barangay:</em> {place.barangayName || "-"}
        <br />
        <em>Status:</em> {place.capacityStatus || "available"}
        {place?.isArchived ? " (archived)" : ""}
        <br />
        <em>Tip:</em> Click marker to view the details card
      </div>
    </Popup>
  );
}

function renderOperationalPopup(place) {
  return (
    <Popup>
      <div className="map-popup operational-popup">
        <strong>{place.name}</strong>
        <br />
        {place.location || "No location provided"} —{" "}
        {place.barangayName || place.barangay || "-"}
        <br />
        <em>Capacity:</em> Individual {place.capacityIndividual || 0}, Family{" "}
        {place.capacityFamily || 0}, Bed {place.bedCapacity || 0}
        <br />
        <em>Floor Area:</em> {place.floorArea ?? 0} m²
        <br />
        <em>Facilities:</em>
        {place.femaleCR && " Female CR"}
        {place.maleCR && " Male CR"}
        {place.commonCR && " Common CR"}
        {place.potableWater && " Potable Water"}
        {place.nonPotableWater && " Non-potable Water"}
        {place.foodPackCapacity ? ` | Food Packs: ${place.foodPackCapacity}` : ""}
        <br />
        <em>Flags:</em> {place.isPermanent ? "Permanent " : ""}
        {place.isCovidFacility ? "COVID Facility" : ""}
        <br />
        <em>Status:</em> {place.capacityStatus || "available"}
        {place?.isArchived ? " (archived)" : ""}
        <br />
        <em>Tip:</em> Click marker to open the details panel
      </div>
    </Popup>
  );
}

/* ---------------- Marker Renderer ---------------- */

function FlyToOnClickMarker({
  place,
  icon,
  onSelectLocation,
  onSelectPlace,
  allowedBounds,
  publicMode = false,
}) {
  const map = useMap();
  const lat = Number(place.latitude);
  const lng = Number(place.longitude);

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (!publicMode && allowedBounds && !allowedBounds.contains(L.latLng(lat, lng))) {
    return null;
  }
  if (!isPointInsideJaen(lat, lng)) return null;

  const handleMarkerClick = () => {
    map.flyTo([lat, lng], 17, { duration: 0.6 });
    onSelectLocation?.(place.location || "Unknown Location", lat, lng);
    onSelectPlace?.(place);
  };

  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      eventHandlers={{
        click: handleMarkerClick,
      }}
    >
      <Tooltip
        direction="top"
        offset={[0, -28]}
        opacity={1}
        permanent
        className="evac-marker-label"
      >
        <div className="evac-marker-label__text">{place.name}</div>
      </Tooltip>

      {publicMode ? renderPublicPopup(place) : renderOperationalPopup(place)}
    </Marker>
  );
}

/* =================== MAP COMPONENT =================== */

const Map = ({
  onSelectLocation,
  onSelectPlace,
  onBlockedSelection,
  places = [],
  barangayBounds = [],
  matchedBarangayBounds = null,
  isBarangayRole = false,
  currentCoords = {},
  evacCoords = {},
  routeCoords = [],
  pickMode = false,
  publicMode = false,
}) => {
  const jaenBounds = useMemo(() => {
    if (!jaenGeoJSON) return null;
    return L.geoJSON(jaenGeoJSON).getBounds();
  }, []);

  const allowedBounds = useMemo(() => {
    if (!jaenBounds) return null;

    return L.latLngBounds(
      [
        [
          jaenBounds.getSouthWest().lat - BOUNDS_BUFFER,
          jaenBounds.getSouthWest().lng - BOUNDS_BUFFER,
        ],
        [
          jaenBounds.getNorthEast().lat + BOUNDS_BUFFER,
          jaenBounds.getNorthEast().lng + BOUNDS_BUFFER,
        ],
      ]
    );
  }, [jaenBounds]);

  const relaxedPublicBounds = useMemo(() => {
    if (!jaenBounds) return null;

    return L.latLngBounds(
      [
        [
          jaenBounds.getSouthWest().lat - 0.08,
          jaenBounds.getSouthWest().lng - 0.08,
        ],
        [
          jaenBounds.getNorthEast().lat + 0.08,
          jaenBounds.getNorthEast().lng + 0.08,
        ],
      ]
    );
  }, [jaenBounds]);

  const effectiveBounds = publicMode ? relaxedPublicBounds : allowedBounds;

  const maskGeoJSON = useMemo(() => {
    return buildInverseMaskGeoJSON(jaenGeoJSON);
  }, []);

  const pickBoundaryGeoJSON = useMemo(() => {
    if (!matchedBarangayBounds) return null;
    return getBarangayBoundsData(matchedBarangayBounds);
  }, [matchedBarangayBounds]);

  const initialCenter = useMemo(() => {
    if (jaenBounds) {
      const center = jaenBounds.getCenter();
      return [center.lat, center.lng];
    }
    return DEFAULT_CENTER;
  }, [jaenBounds]);

  const [position, setPosition] = useState(initialCenter);
  const [zoom, setZoom] = useState(publicMode ? 12 : 13);
  const [placeName, setPlaceName] = useState("Jaen, Nueva Ecija");
  const [hoveredBarangayKey, setHoveredBarangayKey] = useState("");
  const renderedBarangayBounds = useMemo(() => {
    return [...barangayBounds].sort((a, b) => {
      const aLabel = getBarangayBoundsLabel(a);
      const bLabel = getBarangayBoundsLabel(b);
      const aOwned =
        matchedBarangayBounds &&
        (String(a?._id || "") === String(matchedBarangayBounds?._id || "") ||
          safeLower(aLabel) === safeLower(getBarangayBoundsLabel(matchedBarangayBounds)));
      const bOwned =
        matchedBarangayBounds &&
        (String(b?._id || "") === String(matchedBarangayBounds?._id || "") ||
          safeLower(bLabel) === safeLower(getBarangayBoundsLabel(matchedBarangayBounds)));

      if (aOwned === bOwned) return 0;
      return aOwned ? 1 : -1;
    });
  }, [barangayBounds, matchedBarangayBounds]);

  useEffect(() => {
    setPosition(initialCenter);
  }, [initialCenter]);

  useEffect(() => {
    setZoom(publicMode ? 12 : 13);
  }, [publicMode]);

  return (
    <MapContainer
      center={initialCenter}
      zoom={publicMode ? 12 : 14}
      minZoom={publicMode ? 11 : 13}
      maxZoom={18}
      maxBounds={effectiveBounds || jaenBounds || undefined}
      maxBoundsViscosity={publicMode ? 0.35 : 1.0}
      style={{ height: "100%", width: "100%" }}
      whenCreated={(map) => {
        const timer = setTimeout(() => {
          if (map?._container) {
            map.invalidateSize();
          }
        }, 200);

        return () => clearTimeout(timer);
      }}
    >
      <FitToJaenBounds bounds={jaenBounds} publicMode={publicMode} />
      <MapBusBridge allowedBounds={effectiveBounds} publicMode={publicMode} />
      <MapUpdater
        position={position}
        zoom={zoom}
        allowedBounds={effectiveBounds}
        publicMode={publicMode}
      />

      <MapClickHandler
        setPosition={setPosition}
        setPlaceName={setPlaceName}
        onSelectLocation={onSelectLocation}
        onBlockedSelection={onBlockedSelection}
        allowedBounds={allowedBounds}
        pickMode={pickMode}
        pickBoundaryGeoJSON={pickBoundaryGeoJSON}
      />

      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />

      <GeoJSON data={maskGeoJSON} style={maskStyle} />
      <GeoJSON data={jaenGeoJSON} style={jaenStyle} />

      {pickMode && (
        <Marker position={position} icon={blueIcon}>
          <Popup>{placeName}</Popup>
        </Marker>
      )}

      {places.map((place) => {
        if (place?.latitude === undefined || place?.longitude === undefined) {
          return null;
        }

        return (
          <FlyToOnClickMarker
            key={place._id}
            place={place}
            icon={getStatusIcon(place)}
            onSelectLocation={onSelectLocation}
            onSelectPlace={onSelectPlace}
            allowedBounds={effectiveBounds}
            publicMode={publicMode}
          />
        );
      })}

      {renderedBarangayBounds.map((b, index) => {
        const geoData = getBarangayBoundsData(b);
        const label = getBarangayBoundsLabel(b, index);
        const isOwnedBarangay =
          matchedBarangayBounds &&
          (String(b?._id || "") === String(matchedBarangayBounds?._id || "") ||
            safeLower(label) ===
              safeLower(getBarangayBoundsLabel(matchedBarangayBounds, index)));

        if (!geoData) return null;

        const geometry =
          geoData?.type === "FeatureCollection"
            ? geoData.features?.[0]?.geometry || null
            : geoData?.type === "Feature"
            ? geoData.geometry
            : geoData?.geometry || null;

        const polygonSets = geometryToPolygonSets(geometry)
          .map((polygon) => polygon.map((ring) => ringToLeafletPositions(ring)))
          .filter((polygon) => Array.isArray(polygon?.[0]) && polygon[0].length >= 3);

        const barangayKey = String(b?._id || label || index);
        const style = buildBarangayPolygonStyle({
          colorKey: label,
          index,
          isBarangayRole,
          isOwnedBarangay,
          hovered: hoveredBarangayKey === barangayKey,
        });

        return polygonSets.map((polygon, polygonIndex) => (
          <Polygon
            key={`${barangayKey}-${polygonIndex}`}
            positions={polygon}
            pathOptions={style}
            eventHandlers={{
              mouseover: () => setHoveredBarangayKey(barangayKey),
              mouseout: () => setHoveredBarangayKey((current) =>
                current === barangayKey ? "" : current
              ),
            }}
          >
            <Tooltip
              sticky
              direction="top"
              className="barangay-bound-label"
              opacity={0.96}
            >
              {label}
            </Tooltip>
          </Polygon>
        ));
      })}

      {currentCoords.lat &&
        currentCoords.lng &&
        isPointInsideJaen(currentCoords.lat, currentCoords.lng) && (
          <Marker
            position={[currentCoords.lat, currentCoords.lng]}
            icon={greenIcon}
          >
            <Popup>Current Location</Popup>
          </Marker>
        )}

      {evacCoords.lat &&
        evacCoords.lng &&
        isPointInsideJaen(evacCoords.lat, evacCoords.lng) && (
          <Marker position={[evacCoords.lat, evacCoords.lng]} icon={redIcon}>
            <Popup>Evacuation Location</Popup>
          </Marker>
        )}

      {routeCoords.length > 0 && (
        <Polyline positions={routeCoords} color="blue" />
      )}
      
    </MapContainer>
  );
};

export default Map;
