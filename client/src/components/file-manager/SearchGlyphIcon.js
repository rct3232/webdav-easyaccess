import React, { useId, useLayoutEffect, useRef } from 'react';
import { SvgIcon } from '@mui/material';
import { SEARCH_ORBIT_CYCLE_MS } from '../../constants/fileManager';

const CLOUD_PATH =
  'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96';

const STROKE_WIDTH = 1.6;
const CLEARANCE = 1.2;
const KNOCKOUT_WIDTH = STROKE_WIDTH + 2 * CLEARANCE;

const LENS = { cx: 17.4, cy: 6.4, r: 3.2 };
const HANDLE = { x1: 19.7, y1: 8.7, x2: 22.1, y2: 11.1 };

const SPARKLE_FACTOR = 0.44;
const sparklePath = (cx, cy, radius) => {
  const inner = radius * SPARKLE_FACTOR;
  return (
    `M${cx} ${cy - radius} L${cx - inner} ${cy - inner} L${cx - radius} ${cy} ` +
    `L${cx - inner} ${cy + inner} L${cx} ${cy + radius} L${cx + inner} ${cy + inner} ` +
    `L${cx + radius} ${cy} L${cx + inner} ${cy - inner} Z`
  );
};

const WAND_SPARKLES = [
  sparklePath(17.6, 7.4, 3.6),
  sparklePath(21.6, 3.2, 1.5),
  sparklePath(22, 11.8, 1.1),
];
const WAND_MIRROR_CENTER = 18.4;
const WAND_SPIN_CENTER = { x: 17.6, y: 7.4 };

// Add overlay (results-empty): left-CENTER of the cloud flank, 1.5x the
// original plus arm (2.1 → 3.15) — a bigger plus knocked into the cloud body.
const ADD_CENTER = { cx: 4.6, cy: 12, arm: 3.15 };

// Orbit geometry (FloatingSearchBar.md §2.6): the overlay's SPIN CENTER — the
// point that sits at its home spot in the static composite — rides the orbit
// circle as its 3-o'clock point, so the orbit center sits R to its left. The
// travel is counter-clockwise and the additive counter-rotation keeps the
// glyph upright; at 0% the glyph is exactly at home and every cycle returns
// there.
const ORBIT_RADIUS = 4.5;
/** One-decimal rounding keeps the SMIL center strings stable against float drift. */
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * SearchGlyphIcon — knockout-stroke composite: the filled Material cloud is
 * cut along the overlay's line geometry (SVG mask with clearance around every
 * stroke), and the stroke-style overlay renders on top — over cloud the line
 * sits inside its gap, over background it renders as a plain line. No plates.
 * Variants: search magnifier (llmConfigured=false) / mirrored wand-stars
 * (true); `showAdd` knocks a plus into the cloud's left-center flank;
 * `orbit` drives the traveling cut with a SINGLE SMIL clock — the overlay
 * geometry is defined once in <defs> and rendered twice through <use>
 * (visible line + mask knockout), so both instances share one animation
 * timeline and the cut in the cloud travels with the line every frame
 * (pending). FloatingSearchBar.md §2.6.
 */
const SearchGlyphIcon = ({ llmConfigured = false, showAdd = false, orbit = false }) => {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const maskId = `search-glyph-cloud-${uid}`;
  const geomId = `search-glyph-overlay-${uid}`;
  const orbitAnimRef = useRef(null);
  const spinAnimRef = useRef(null);

  // SMIL begin="indefinite" + beginElement(): both animations start in the
  // same tick when the orbit mounts, so the shared timeline begins exactly at
  // the home position (a document-relative begin would start mid-phase).
  useLayoutEffect(() => {
    if (!orbit) return;
    [orbitAnimRef.current, spinAnimRef.current].forEach((el) => {
      if (el && typeof el.beginElement === 'function') el.beginElement();
    });
  }, [orbit]);

  const spinCenterRaw = llmConfigured ? WAND_SPIN_CENTER : { x: LENS.cx, y: LENS.cy };
  const spinCenter = { x: r1(spinCenterRaw.x), y: r1(spinCenterRaw.y) };
  const orbitCenter = { x: r1(spinCenter.x - ORBIT_RADIUS), y: r1(spinCenter.y) };

  const shapes = llmConfigured ? (
    <g transform={`translate(${WAND_MIRROR_CENTER * 2},0) scale(-1,1)`}>
      {WAND_SPARKLES.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  ) : (
    [
      <circle key="lens" cx={LENS.cx} cy={LENS.cy} r={LENS.r} />,
      <line key="handle" x1={HANDLE.x1} y1={HANDLE.y1} x2={HANDLE.x2} y2={HANDLE.y2} />,
    ]
  );

  return (
    <SvgIcon
      data-testid="search-glyph"
      viewBox="0 0 24 24"
      style={{ width: 24, height: 24 }}
      sx={{
        display: 'inline-block',
        flexShrink: 0,
        overflow: 'visible',
      }}
    >
      <defs>
        <g
          id={geomId}
          data-testid="search-glyph-geom"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {orbit && (
            <>
              <animateTransform
                ref={orbitAnimRef}
                data-testid="search-action-glyph-orbit"
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from={`0 ${orbitCenter.x} ${orbitCenter.y}`}
                to={`-360 ${orbitCenter.x} ${orbitCenter.y}`}
                dur={`${SEARCH_ORBIT_CYCLE_MS}ms`}
                repeatCount="indefinite"
                begin="indefinite"
              />
              <animateTransform
                ref={spinAnimRef}
                additive="sum"
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from={`0 ${spinCenter.x} ${spinCenter.y}`}
                to={`360 ${spinCenter.x} ${spinCenter.y}`}
                dur={`${SEARCH_ORBIT_CYCLE_MS}ms`}
                repeatCount="indefinite"
                begin="indefinite"
              />
            </>
          )}
          {shapes}
        </g>
        <mask id={maskId}>
          <rect x="-4" y="-4" width="32" height="32" fill="#fff" />
          <use href={`#${geomId}`} stroke="#000" strokeWidth={KNOCKOUT_WIDTH} />
          {showAdd && (
            <g stroke="#000" strokeWidth={KNOCKOUT_WIDTH} strokeLinecap="round" fill="none">
              <line
                x1={ADD_CENTER.cx}
                y1={ADD_CENTER.cy - ADD_CENTER.arm}
                x2={ADD_CENTER.cx}
                y2={ADD_CENTER.cy + ADD_CENTER.arm}
              />
              <line
                x1={ADD_CENTER.cx - ADD_CENTER.arm}
                y1={ADD_CENTER.cy}
                x2={ADD_CENTER.cx + ADD_CENTER.arm}
                y2={ADD_CENTER.cy}
              />
            </g>
          )}
        </mask>
      </defs>
      <path
        data-testid="search-action-glyph-cloud"
        d={CLOUD_PATH}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <use
        href={`#${geomId}`}
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        data-testid={llmConfigured ? 'search-action-glyph-wand' : 'search-action-glyph-search'}
      />
      {showAdd && (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          data-testid="search-action-glyph-add"
        >
          <line
            x1={ADD_CENTER.cx}
            y1={ADD_CENTER.cy - ADD_CENTER.arm}
            x2={ADD_CENTER.cx}
            y2={ADD_CENTER.cy + ADD_CENTER.arm}
          />
          <line
            x1={ADD_CENTER.cx - ADD_CENTER.arm}
            y1={ADD_CENTER.cy}
            x2={ADD_CENTER.cx + ADD_CENTER.arm}
            y2={ADD_CENTER.cy}
          />
        </g>
      )}
    </SvgIcon>
  );
};

export default SearchGlyphIcon;
