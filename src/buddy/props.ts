// Hand-held props, hats and scene props, drawn in the same ink style.
// Hand props are authored around the hand centre (0,0) with +y pointing down.

const S = `stroke="var(--ink)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"`;
const P = `fill="var(--paper)"`;
const I = `fill="var(--ink)"`;
const A = `fill="var(--accent)"`;

export interface Prop { svg: string; upright: boolean; }

export const HAND_PROPS: Record<string, Prop> = {
  mug: { upright: true, svg: `
    <path d="M-9 -16 h16 v15 q0 6 -6 6 h-4 q-6 0 -6 -6z" ${P} ${S}/>
    <path d="M7 -12 q7 0 7 5 q0 5 -7 5" fill="none" ${S}/>
    <path d="M-7 -12 h12" ${S} stroke-width="1.6" opacity=".5"/>` },
  bottle: { upright: true, svg: `
    <rect x="-6" y="-26" width="12" height="28" rx="4" ${A} ${S}/>
    <rect x="-3.5" y="-31" width="7" height="6" rx="1.5" ${I}/>
    <path d="M-6 -14 h12" ${S} stroke-width="1.8"/>` },
  book: { upright: true, svg: `
    <path d="M0 -20 q-12 -4 -22 0 v24 q10 -4 22 0z" ${P} ${S}/>
    <path d="M0 -20 q12 -4 22 0 v24 q-10 -4 -22 0z" ${P} ${S}/>
    <path d="M-17 -12 q7 -2 13 0 M-17 -6 q7 -2 13 0 M4 -12 q7 -2 13 0 M4 -6 q7 -2 13 0" fill="none" ${S} stroke-width="1.4"/>` },
  pencil: { upright: false, svg: `
    <path d="M-2 0 l0 -2 l20 -8 l3 6 l-20 8z" ${A} ${S} stroke-width="2.2"/>
    <path d="M18 -10 l6 -2 l-3 6z" ${I}/>` },
  paper: { upright: true, svg: `
    <path d="M-12 -24 h20 l6 6 v24 h-26z" ${P} ${S} stroke-width="2.6"/>
    <path d="M-7 -14 h14 M-7 -8 h14 M-7 -2 h9" ${S} stroke-width="1.5"/>` },
  camera: { upright: true, svg: `<g transform="translate(-4,-22)">
    <rect x="-16" y="-20" width="32" height="22" rx="5" ${I}/>
    <rect x="-8" y="-25" width="12" height="6" rx="2" ${I}/>
    <circle cx="0" cy="-9" r="7.5" ${P} stroke="var(--ink)" stroke-width="2.5"/>
    <circle cx="0" cy="-9" r="3.5" ${I}/></g>` },
  umbrella: { upright: true, svg: `
    <path d="M0 0 L-32 -160" ${S} stroke-width="3"/>
    <path d="M0 4 q0 6 -6 5" fill="none" ${S} stroke-width="3"/>
    <g transform="translate(-32,0)"><path d="M-84 -156 q84 -76 168 0 q-21 -12 -42 0 q-21 -12 -42 0 q-21 -12 -42 0 q-21 -12 -42 0z" ${A} ${S}/>
    <path d="M0 -194 v-8" ${S} stroke-width="3"/></g>` },
  fan: { upright: false, svg: `
    <path d="M0 0 l-14 -24 q14 -10 28 0z" ${P} ${S} stroke-width="2.6"/>
    <path d="M0 0 l-7 -26 M0 0 v-27 M0 0 l7 -26" ${S} stroke-width="1.4"/>` },
  yoyo: { upright: true, svg: `<path d="M0 0 v18" ${S} stroke-width="1.4"/>
    <g class="yoyo-disc"><circle cx="0" cy="24" r="7" ${A} ${S} stroke-width="2.6"/><circle cx="0" cy="24" r="2" ${I}/></g>` },
  binoculars: { upright: true, svg: `<g transform="translate(-6,-30)">
    <rect x="-15" y="-10" width="12" height="16" rx="4" ${I}/><rect x="3" y="-10" width="12" height="16" rx="4" ${I}/>
    <rect x="-4" y="-6" width="8" height="6" ${I}/></g>` },
  ball: { upright: true, svg: `<circle cx="0" cy="-4" r="6" ${A} ${S} stroke-width="2.4"/>` },
  phone: { upright: true, svg: `<rect x="-7" y="-22" width="14" height="24" rx="3" ${I}/>
    <rect x="-5" y="-19" width="10" height="16" rx="1.5" fill="var(--accent)" opacity=".85"/>` },
  plug: { upright: true, svg: `
    <rect x="-6" y="-14" width="12" height="14" rx="2" ${P} ${S} stroke-width="2.6"/>
    <path d="M-3 -14 v-7 M3 -14 v-7" ${S} stroke-width="2.4"/>
    <path d="M0 0 q0 30 -30 34" fill="none" ${S} stroke-width="2.4"/>` },
  wand: { upright: false, svg: `<path d="M0 0 l0 -26" ${S} stroke-width="3"/>
    <path d="M0 -34 l2.5 5 5.5 .8 -4 3.8 1 5.4 -5 -2.6 -5 2.6 1 -5.4 -4 -3.8 5.5 -.8z" ${A} ${S} stroke-width="1.6"/>` },
};

/** Things that sit on the head (head local coords; face centre = 0,0). */
export const HATS: Record<string, string> = {
  headphones: `
    <path d="M-72 4 q-6 -96 72 -100 q78 4 72 100" fill="none" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>
    <rect x="-82" y="-8" width="18" height="30" rx="8" ${A} ${S}/>
    <rect x="64" y="-8" width="18" height="30" rx="8" ${A} ${S}/>`,
  cap: `
    <path d="M-60 -70 q60 -70 120 0 z" ${A} ${S}/>
    <path d="M30 -72 q40 -6 62 8 q-28 6 -62 4z" ${A} ${S}/>
    <circle cx="0" cy="-104" r="4" ${I}/>`,
  party: `
    <path d="M-22 -96 L4 -170 L30 -96 z" ${A} ${S}/>
    <path d="M-12 -122 l30 -6 M-4 -146 l18 -4" stroke="var(--paper)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="4" cy="-172" r="6" fill="var(--paper)" ${S} stroke-width="2.4"/>`,
  nightcap: `
    <path d="M-62 -78 q20 -60 80 -50 q40 10 48 70 q8 30 -6 42 q-10 -40 -22 -52 q-50 -20 -100 -10z" ${A} ${S}/>
    <path d="M-66 -76 q66 -24 132 0" fill="none" stroke="var(--paper)" stroke-width="9" stroke-linecap="round"/>
    <circle cx="58" cy="-2" r="9" fill="var(--paper)" ${S} stroke-width="2.6"/>`,
  crown: `<path d="M-30 -104 l8 -30 l14 18 l8 -26 l8 26 l14 -18 l8 30z" fill="#f4c542" ${S}/>`,
  sunglasses: `
    <path d="M-56 -14 h50 q2 30 -24 30 q-26 0 -26 -30z M6 -14 h50 q0 30 -26 30 q-26 0 -24 -30z" ${I}/>
    <path d="M-6 -12 h12" stroke="var(--ink)" stroke-width="5"/>
    <path d="M-48 -8 l10 0 M14 -8 l10 0" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`,
};

/** Scene props that live in the root (body) space, not in a hand. */
export const SCENE: Record<string, string> = {
  laptop: `
    <g transform="translate(0,-6)">
      <path d="M-30 -2 l5 -32 h50 l5 32z" fill="#cfd5dc" stroke="var(--ink)" stroke-width="3.2" stroke-linejoin="round"/>
      <path d="M-3 -21 q3 -5 6 0 q-3 5 -6 0z" fill="var(--ink)" opacity=".6"/>
      <rect x="-36" y="-3" width="72" height="6" rx="2" fill="var(--paper)" stroke="var(--ink)" stroke-width="3"/>
    </g>`,
  box: `
    <rect x="-30" y="-52" width="60" height="44" rx="3" fill="#d8b07a" stroke="var(--ink)" stroke-width="3.2"/>
    <path d="M-30 -40 h60 M0 -52 v12" stroke="var(--ink)" stroke-width="2.4"/>
    <text x="0" y="-18" font-size="13" text-anchor="middle" font-weight="800" fill="var(--ink)">RAM</text>`,
  sign: `
    <rect x="-46" y="-48" width="92" height="44" rx="6" fill="var(--paper)" stroke="var(--ink)" stroke-width="3.2"/>
    <text class="sign-text" x="0" y="-21" font-size="14" text-anchor="middle" font-weight="800" fill="var(--ink)"></text>`,
  scarf: `
    <path d="M-22 -2 q22 12 44 0 l0 9 q-22 12 -44 0z" fill="var(--accent)" stroke="var(--ink)" stroke-width="3"/>
    <path d="M10 6 l4 24 l10 -2 l-4 -22z" fill="var(--accent)" stroke="var(--ink)" stroke-width="3"/>`,
};
