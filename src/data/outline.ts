// The binder's table of contents. A lesson with `slug` is written; others are planned.
// `levels` = which students the topic applies to (pa = Private, ir = Instrument, ca = Commercial).
export type Level = 'pa' | 'ir' | 'ca';
export interface Topic { title: string; slug?: string; levels: Level[] }
export interface Area { title: string; topics: Topic[] }

const all: Level[] = ['pa', 'ir', 'ca'];

export const outline: Area[] = [
  { title: 'Preflight Preparation', topics: [
    { title: 'Pilot Qualifications', levels: all },
    { title: 'Airworthiness Requirements', levels: all },
    { title: 'Weather Information', levels: all },
    { title: 'Cross-Country Flight Planning', levels: all },
    { title: 'National Airspace System', levels: all },
    { title: 'Performance & Limitations', levels: all },
    { title: 'Operation of Systems', levels: all },
    { title: 'Human Factors', levels: all },
  ]},
  { title: 'Aerodynamics', topics: [
    { title: 'Four Forces & Airfoils', levels: all },
    { title: 'Angle of Attack & Stalls', levels: all },
    { title: 'Stability & Controllability', slug: 'aerodynamics/stability', levels: all },
    { title: 'Load Factor & Maneuvering Speed', levels: all },
    { title: 'Left-Turning Tendencies', levels: all },
    { title: 'Wake Turbulence', levels: all },
  ]},
  { title: 'Preflight Procedures', topics: [
    { title: 'Preflight Inspection', levels: all },
    { title: 'Flight Deck Management', levels: all },
    { title: 'Engine Starting & Taxiing', levels: all },
    { title: 'Before Takeoff Check', levels: all },
  ]},
  { title: 'Airport Operations', topics: [
    { title: 'Radio Communications & Light Signals', levels: all },
    { title: 'Traffic Patterns', levels: ['pa', 'ca'] },
    { title: 'Runway Incursion Avoidance', levels: all },
  ]},
  { title: 'Takeoffs, Landings & Go-Arounds', topics: [
    { title: 'Normal Takeoff & Landing', levels: ['pa', 'ca'] },
    { title: 'Crosswind Technique', levels: ['pa', 'ca'] },
    { title: 'Soft-Field Takeoff & Landing', levels: ['pa', 'ca'] },
    { title: 'Short-Field Takeoff & Landing', levels: ['pa', 'ca'] },
    { title: 'Forward Slip to a Landing', levels: ['pa', 'ca'] },
    { title: 'Go-Around', levels: ['pa', 'ca'] },
    { title: 'Power-Off 180° Accuracy Landing', levels: ['ca'] },
  ]},
  { title: 'Performance Maneuvers', topics: [
    { title: 'Steep Turns', levels: ['pa', 'ca'] },
    { title: 'Steep Spiral', levels: ['ca'] },
    { title: 'Chandelles', levels: ['ca'] },
    { title: 'Lazy Eights', levels: ['ca'] },
  ]},
  { title: 'Ground Reference Maneuvers', topics: [
    { title: 'Rectangular Course, S-Turns & Turns Around a Point', levels: ['pa'] },
    { title: 'Eights on Pylons', levels: ['ca'] },
  ]},
  { title: 'Slow Flight & Stalls', topics: [
    { title: 'Slow Flight', levels: ['pa', 'ca'] },
    { title: 'Power-Off Stalls', levels: ['pa', 'ca'] },
    { title: 'Power-On Stalls', levels: ['pa', 'ca'] },
    { title: 'Accelerated Stalls', levels: ['ca'] },
    { title: 'Spin Awareness', levels: ['pa', 'ca'] },
  ]},
  { title: 'Navigation', topics: [
    { title: 'Pilotage & Dead Reckoning', levels: ['pa', 'ca'] },
    { title: 'Navigation Systems & Radar Services', levels: all },
    { title: 'Diversion & Lost Procedures', levels: ['pa', 'ca'] },
  ]},
  { title: 'Instrument Flying', topics: [
    { title: 'Flight Instruments: Round Dials & Glass', levels: all },
    { title: 'Attitude Instrument Flying', levels: all },
    { title: 'Recovery from Unusual Attitudes', levels: all },
    { title: 'Holding', levels: ['ir'] },
    { title: 'Instrument Approaches', levels: ['ir'] },
    { title: 'IFR Clearances & Departures', levels: ['ir'] },
  ]},
  { title: 'Emergency Operations', topics: [
    { title: 'Emergency Descent', levels: ['pa', 'ca'] },
    { title: 'Emergency Approach & Landing', levels: ['pa', 'ca'] },
    { title: 'Systems & Equipment Malfunctions', levels: all },
  ]},
  { title: 'Night & High Altitude', topics: [
    { title: 'Night Operations', levels: ['pa', 'ca'] },
    { title: 'Supplemental Oxygen', levels: ['ca'] },
  ]},
];
