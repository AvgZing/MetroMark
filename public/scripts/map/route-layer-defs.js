function addMapRouteLayers(map) {
  map.addSource("focus-mask", {
    type: "geojson",
    data: focusMaskFeatureCollection(false)
  });

  map.addLayer({
    id: "routes-background-casing",
    type: "line",
    source: "routes",
    layout: {
      visibility: "none"
    },
    paint: {
      "line-color": "#111920",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.7,
        3,
        1.1,
        6,
        2.1,
        9,
        3.2,
        12,
        4.3
      ],
      "line-opacity": [
        "case",
        [
          "all",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
        ],
        0,
        0
      ]
    }
  });

  map.addLayer({
    id: "routes-background-casing-vector",
    type: "line",
    source: "routes-vector",
    "source-layer": "routes",
    paint: {
      "line-color": "#111920",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.7,
        3,
        1.1,
        6,
        2.1,
        9,
        3.2,
        12,
        4.3
      ],
      "line-opacity": [
        "case",
        [
          "all",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
          ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
        ],
        0,
        0
      ]
    }
  });

  map.addLayer({
    id: "routes-background-main",
    type: "line",
    source: "routes",
    layout: {
      visibility: "none"
    },
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.45,
        3,
        0.7,
        6,
        1.3,
        9,
        1.9,
        12,
        2.4
      ],
      "line-opacity": [
        "case",
        [
          "all",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
        ],
        0.9,
        0
      ]
    }
  });

  map.addLayer({
    id: "routes-background-main-vector",
    type: "line",
    source: "routes-vector",
    "source-layer": "routes",
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.45,
        3,
        0.7,
        6,
        1.3,
        9,
        1.9,
        12,
        2.4
      ],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
          ],
          0.3,
          0
        ],
        5,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
          ],
          0.55,
          0
        ],
        9,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
          ],
          0.9,
          0
        ]
      ]
    }
  });

  map.addLayer({
    id: "focus-dim-layer",
    type: "fill",
    source: "focus-mask",
    paint: {
      "fill-color": "#1f262d",
      "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.65, 0]
    }
  });

  map.addLayer({
    id: "routes-casing",
    type: "line",
    source: "routes",
    layout: {
      visibility: "none"
    },
    paint: {
      "line-color": "#0f1b22",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.95,
        3,
        1.4,
        6,
        2.6,
        9,
        3.9,
        12,
        5.2
      ],
      "line-opacity": [
        "case",
        [
          "all",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
        ],
        0.38,
        0
      ]
    }
  });

  map.addLayer({
    id: "routes-casing-vector",
    type: "line",
    source: "routes-vector",
    "source-layer": "routes",
    paint: {
      "line-color": "#0f1b22",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.95,
        3,
        1.4,
        6,
        2.6,
        9,
        3.9,
        12,
        5.2
      ],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.12,
          0
        ],
        5,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.22,
          0
        ],
        9,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.38,
          0
        ]
      ]
    }
  });

  map.addLayer({
    id: "routes-main",
    type: "line",
    source: "routes",
    layout: {
      visibility: "none"
    },
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.7,
        3,
        1.05,
        6,
        1.9,
        9,
        2.9,
        12,
        3.6
      ],
      "line-opacity": [
        "case",
        [
          "all",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
        ],
        0.96,
        0
      ]
    }
  });

  map.addLayer({
    id: "routes-main-vector",
    type: "line",
    source: "routes-vector",
    "source-layer": "routes",
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        0.7,
        3,
        1.05,
        6,
        1.9,
        9,
        2.9,
        12,
        3.6
      ],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.35,
          0
        ],
        5,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.6,
          0
        ],
        9,
        [
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.96,
          0
        ]
      ]
    }
  });

  map.addLayer({
    id: "routes-hit",
    type: "line",
    source: "routes-vector",
    "source-layer": "routes",
    paint: {
      "line-color": "#000000",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        6,
        4,
        10,
        8,
        14,
        13,
        18
      ],
      "line-opacity": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 1], 1],
        0,
        0
      ]
    }
  });

  map.addLayer({
    id: "stops-layer",
    type: "circle",
    source: "stops",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        2.9,
        8,
        4.2,
        11,
        5.6,
        14,
        7.1
      ],
      "circle-color": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
        "#ffffff",
        ["==", ["coalesce", ["to-number", ["feature-state", "visited"]], 0], 1],
        "#1a9b66",
        "#d9563a"
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
        "#0f1b22",
        "#ffffff"
      ],
      "circle-stroke-width": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
        0.9,
        1.2
      ],
      "circle-opacity": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
        ["case", ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1], 1, ["case", ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1], 0.94, 0.32]],
        0
      ],
      "circle-stroke-opacity": [
        "case",
        ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
        ["case", ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1], 1, ["case", ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1], 1, 0.45]],
        0
      ]
    }
  });
}
