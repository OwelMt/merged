import { useState, useRef, useContext } from "react";
import axios from "axios";
import api from "../../lib/api";
import { MapContext } from "../contexts/MapContext";
import {
  isValidCoordinate,
  sanitizeSearchText,
  safeDisplayText,
} from "../utils/validation";

/* ✅ JAEN, NUEVA ECIJA — MUNICIPALITY‑WIDE BOUNDS */
const JAEN_BOUNDS = {
  north: 15.460,
  south: 15.300,
  west: 120.820,
  east: 120.960,
};

function isInsideJaenCoords(lat, lon) {
  if (!isValidCoordinate(lat, lon)) return false;
  return (
    lat >= JAEN_BOUNDS.south &&
    lat <= JAEN_BOUNDS.north &&
    lon >= JAEN_BOUNDS.west &&
    lon <= JAEN_BOUNDS.east
  );
}

export default function useJaenPlaceSearch() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  /* ✅ MAP CONTEXT (SAFE) */
  const mapCtx = useContext(MapContext);
  const setEvacPlaces =
    typeof mapCtx?.setEvacPlaces === "function"
      ? mapCtx.setEvacPlaces
      : null;

  /* ---------- CACHES ---------- */
  const evacCache = useRef([]);
  const evacLoadedRef = useRef(false);
  const debounceRef = useRef(null);

  /* ✅ LOAD EVACUATION CENTERS (ON DEMAND ONLY) */
  const loadEvacPlaces = async () => {
    if (evacLoadedRef.current) return;

    try {
      const res = await api.get("/evacs");
      evacCache.current = Array.isArray(res.data) ? res.data : [];
      evacLoadedRef.current = true;

      /* ✅ PUBLISH TO MAP CONTEXT ONLY IF AVAILABLE */
      if (setEvacPlaces) {
        setEvacPlaces(evacCache.current);
      }

      console.log(
        "[JaenSearch] Loaded evac places:",
        evacCache.current.length
      );
    } catch (err) {
      console.error(
        "[JaenSearch] Failed to load evac places:",
        err?.message
      );
    }
  };

  /* ---------- CORE SEARCH ---------- */
  const performSearch = async (value) => {
    await loadEvacPlaces();

    const cleanValue = sanitizeSearchText(value);
    if (cleanValue.length < 3) {
      setSuggestions([]);
      return;
    }

    const q = cleanValue.toLowerCase();

    /* ✅ 1️⃣ EVACUATION CENTERS FIRST */
    const evacMatches = evacCache.current
      .filter(
        (p) =>
          !p.isArchived &&
          p.capacityStatus !== "closed" &&
          (
            p.name?.toLowerCase().includes(q) ||
            p.location?.toLowerCase().includes(q) ||
            p.barangayName?.toLowerCase().includes(q)
          )
      )
      .map((p) => ({
        id: p._id,
        label: safeDisplayText(p?.name, "Evacuation center"),
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        source: "evacuation",
        raw: p,
      }))
      .filter((p) => isValidCoordinate(p.latitude, p.longitude));

    let results = [...evacMatches];

    /* ✅ 2️⃣ NOMINATIM FALLBACK */
    if (results.length < 5) {
      try {
        const res = await axios.get(
          "https://nominatim.openstreetmap.org/search",
          {
            params: {
              q: cleanValue,
              format: "json",
              countrycodes: "ph",
              bounded: 1,
              viewbox: `${JAEN_BOUNDS.west},${JAEN_BOUNDS.north},${JAEN_BOUNDS.east},${JAEN_BOUNDS.south}`,
              limit: 5,
              email: "admin@jaen.gov.ph",
            },
            headers: {
              "User-Agent": "SafeJaen/1.0 (contact: admin@jaen.gov.ph)",
            },
          }
        );

        const mapMatches = (res.data || [])
          .filter((p) =>
            isInsideJaenCoords(Number(p.lat), Number(p.lon))
          )
          .map((p, idx) => ({
            id: p.place_id || `map-${p.lat}-${p.lon}-${idx}`,
            label: safeDisplayText(p.display_name, "Selected location"),
            latitude: Number(p.lat),
            longitude: Number(p.lon),
            source: "map",
            raw: null,
          }));

        results = [...results, ...mapMatches];
      } catch (err) {
        console.error(
          "[JaenSearch] Nominatim error:",
          err?.response?.status,
          err?.message
        );
      }
    }

    setSuggestions(results.slice(0, 5));
  };

  /* ---------- PUBLIC API ---------- */
  const search = (value) => {
    const cleanValue = sanitizeSearchText(value);
    setQuery(cleanValue);

    if (!cleanValue || cleanValue.length < 3) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSearch(cleanValue);
    }, 500);
  };

  const clear = () => {
    setQuery("");
    setSuggestions([]);
  };

  return {
    query,
    suggestions,
    search,
    clear,
  };
}
