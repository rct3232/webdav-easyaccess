import React, { useId } from 'react';
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

const ADD_CENTER = { cx: 5.2, cy: 6.6, arm: 2.1 };

const renderSearch = (strokeWidth) => (
  <g
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    data-testid={strokeWidth === STROKE_WIDTH ? 'search-action-glyph-search' : undefined}
  >
    <circle cx={LENS.cx} cy={LENS.cy} r={LENS.r} />
    <line x1={HANDLE.x1} y1={HANDLE.y1} x2={HANDLE.x2} y2={HANDLE.y2} />
  </g>
);

const renderWand = (strokeWidth) => (
  <g
    data-testid={strokeWidth === STROKE_WIDTH ? 'search-action-glyph-wand' : undefined}
    transform={`translate(${WAND_MIRROR_CENTER * 2},0) scale(-1,1)`}
  >
    <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round">
      {WAND_SPARKLES.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  </g>
);

const renderAdd = (strokeWidth) => (
  <g
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    data-testid={strokeWidth === STROKE_WIDTH ? 'search-action-glyph-add' : undefined}
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
);

const ORBIT_ANIMATION = `searchGlyphOrbit ${SEARCH_ORBIT_CYCLE_MS}ms linear infinite`;

/**
 * SearchGlyphIcon — knockout-stroke composite: the filled Material cloud is
 * cut along the overlay's line geometry (SVG mask with clearance around every
 * stroke), and the stroke-style overlay renders on top — over cloud the line
 * sits inside its gap, over background it renders as a plain line. No plates.
 * Variants: search magnifier (llmConfigured=false) / mirrored wand-stars
 * (true); `showAdd` knocks a plus into the cloud's top-left; `orbit` moves the
 * overlay group along a small circle while the cloud stays still (pending).
 * FloatingSearchBar.md §2.6.
 */
const SearchGlyphIcon = ({ llmConfigured = false, showAdd = false, orbit = false }) => {
  const maskId = `search-glyph-cloud-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const overlay = llmConfigured ? renderWand(STROKE_WIDTH) : renderSearch(STROKE_WIDTH);

  return (
    <SvgIcon
      data-testid="search-glyph"
      viewBox="0 0 24 24"
      style={{ width: 24, height: 24 }}
      sx={{
        display: 'inline-block',
        flexShrink: 0,
        '& .search-glyph-orbit-anim': {
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: ORBIT_ANIMATION,
        },
        '@keyframes searchGlyphOrbit': {
          '0%': { transform: 'rotate(0deg) translateY(-2.2px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateY(-2.2px) rotate(-360deg)' },
        },
      }}
    >
      <defs>
        <mask id={maskId}>
          <rect x="-4" y="-4" width="32" height="32" fill="#fff" />
          <g
            stroke="#000"
            strokeWidth={KNOCKOUT_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            {llmConfigured ? (
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
            )}
            {showAdd && (
              <g>
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
          </g>
        </mask>
      </defs>
      <path
        data-testid="search-action-glyph-cloud"
        d={CLOUD_PATH}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      {orbit ? (
        <g data-testid="search-action-glyph-orbit" className="search-glyph-orbit-anim">
          {overlay}
        </g>
      ) : (
        overlay
      )}
      {showAdd && renderAdd(STROKE_WIDTH)}
    </SvgIcon>
  );
};

export default SearchGlyphIcon;
